// media-control — Q-SYS external control surface for signage programs (docs/15, M2).
//
// A token-gated command endpoint the bar's Q-SYS UCI buttons call (via Lua HttpClient) to switch
// what a landscape screen plays — WITHOUT a hub browser open. It is the SAME single source of
// truth the hub writes: program-level commands write signage_slots.program (the TV + hub chip
// both follow via realtime, exactly as if a manager clicked the PROGRAM control); transport-level
// commands (pause/resume/next) don't touch the DB — they ride a Supabase realtime BROADCAST on
// `media-cmd:{slug}` that the player subscribes to (an ephemeral pause must not survive a reload).
//
// Auth model: NO JWT (verify_jwt off) — a Q-SYS core is not a Supabase user. The gate is the
// x-qsys-token header == QSYS_CONTROL_TOKEN, a secret SEPARATE from the shell's MEDIA_DEVICE_TOKEN
// (different holder, independently revocable via the secrets API). Same shape as the other
// token-gated fns (toast-sync's CRON_SECRET, media-catalog-sync's device token). Service role for
// all DB writes + the server-side broadcast (bypasses RLS after the token gate authenticates).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONTROL_TOKEN = Deno.env.get("QSYS_CONTROL_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qsys-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The broadcast channel a slot's transport commands ride on. Contract mirror of the web player's
// transportTopic(slug) in apps/web/src/modules/signage/mediaTransport.ts — keep the two in sync.
function transportTopic(slug: string): string {
  return `media-cmd:${slug}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 'schedule' (M3, D5): clear the manual override so the slot follows its daypart schedule again
// (alias 'rotation' kept from M2 — both clear the override; with no schedule that IS rotation).
const PROGRAM_CMDS = new Set(["playlist", "rotation", "capture", "schedule"]);
const TRANSPORT_CMDS = new Set(["pause", "resume", "next"]);
// The manual-override hold tier a program write carries (docs/15 M3, D4/D5). A Q-SYS press defaults
// to 'event' — a SPECIAL EVENT hold that survives daypart boundaries and expires at the 04:00
// business-day rollover (the owner's overtime case). An explicit `hold` param overrides it.
const HOLDS = new Set(["pin", "boundary", "event"]);
const DEFAULT_HOLD = "event";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

/** Send a broadcast message server-side via the realtime REST endpoint (no socket needed). */
async function broadcast(topic: string, event: string, payload: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ messages: [{ topic, event, payload }] }),
  });
  if (!res.ok) throw new Error(`broadcast failed: ${res.status} ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Token gate.
  if (!CONTROL_TOKEN || req.headers.get("x-qsys-token") !== CONTROL_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { slug?: string; cmd?: string; playlist?: string; hold?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const slug = (body.slug ?? "").trim();
  const cmd = (body.cmd ?? "").trim();
  if (!slug) return json({ error: "slug required" }, 400);
  if (!cmd) return json({ error: "cmd required" }, 400);
  if (!PROGRAM_CMDS.has(cmd) && !TRANSPORT_CMDS.has(cmd)) {
    return json({ error: `unknown cmd '${cmd}' (expected playlist|rotation|capture|schedule|pause|resume|next)` }, 400);
  }
  // Optional hold tier for a program write (D4/D5). Default 'event'. Ignored by rotation/schedule.
  const hold = (body.hold ?? "").trim() || DEFAULT_HOLD;
  if ((cmd === "playlist" || cmd === "capture") && !HOLDS.has(hold)) {
    return json({ error: `invalid hold '${hold}' (expected pin|boundary|event)` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve + validate the target slot: it must exist and be a landscape screen (programs are a
  // landscape-only feature in the hub — the same semantics the PROGRAM control enforces).
  const { data: slot, error: slotErr } = await admin
    .from("signage_slots")
    .select("id, venue_id, orientation")
    .eq("slug", slug)
    .maybeSingle();
  if (slotErr) return json({ error: `slot lookup failed: ${slotErr.message}` }, 500);
  if (!slot) return json({ error: `no slot with slug '${slug}'` }, 404);
  if (slot.orientation !== "landscape") {
    return json({ error: `slot '${slug}' is ${slot.orientation}; programs are landscape-only` }, 400);
  }

  // Transport commands: broadcast only, never touch the DB.
  if (TRANSPORT_CMDS.has(cmd)) {
    try {
      await broadcast(transportTopic(slug), "cmd", { cmd });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }
    return json({ ok: true, slug, cmd, kind: "transport" });
  }

  // Program commands: write signage_slots.program + the M3 hold pair (single source of truth; the
  // TV + hub follow live). rotation/schedule CLEAR the override (null program + null hold) so the
  // slot follows its daypart schedule; playlist/capture SET an override with a hold + set-at anchor.
  let program: { kind: "playlist"; playlist_id: string } | { kind: "capture" } | null;
  let update: Record<string, unknown>;
  if (cmd === "rotation" || cmd === "schedule") {
    program = null;
    update = { program: null, program_hold: null, program_set_at: null };
  } else {
    if (cmd === "capture") {
      program = { kind: "capture" };
    } else {
      // playlist — resolve by id (uuid) else case-insensitive name, scoped to the slot's venue.
      const ref = (body.playlist ?? "").trim();
      if (!ref) return json({ error: "playlist required for cmd 'playlist'" }, 400);
      let q = admin.from("media_playlists").select("id, name").eq("venue_id", slot.venue_id);
      q = UUID_RE.test(ref) ? q.eq("id", ref) : q.ilike("name", ref);
      const { data: pls, error: plErr } = await q.limit(2);
      if (plErr) return json({ error: `playlist lookup failed: ${plErr.message}` }, 500);
      if (!pls || pls.length === 0) return json({ error: `no playlist matching '${ref}'` }, 404);
      if (pls.length > 1) return json({ error: `playlist '${ref}' is ambiguous (matches ${pls.length})` }, 409);
      program = { kind: "playlist", playlist_id: pls[0].id as string };
    }
    update = { program, program_hold: hold, program_set_at: new Date().toISOString() };
  }

  const { error: upErr } = await admin.from("signage_slots").update(update).eq("id", slot.id);
  if (upErr) return json({ error: `program write failed: ${upErr.message}` }, 500);
  return json({ ok: true, slug, cmd, kind: "program", program, hold: program ? hold : null });
});

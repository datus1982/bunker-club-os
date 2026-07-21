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
import {
  resolveEffectiveProgramWithSource,
  mapScheduleRow,
  type ScheduleRow,
} from "./scheduleResolve.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONTROL_TOKEN = Deno.env.get("QSYS_CONTROL_TOKEN") ?? "";
// Single-venue scope for the slug-less `playlists` command (media_playlists carries venue_id but
// `playlists` has no slot to derive it from). Optional — absent ⇒ every venue's playlists (the
// deployment is single-venue, so this is belt-and-suspenders).
const VENUE_ID = Deno.env.get("VENUE_ID") ?? "";

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
// The virtual ALL-MEDIA playlist (owner beat 2026-07-20) — a `playlist` program pointed at this
// sentinel plays every present media_file shuffled. Contract mirror of ALL_MEDIA_PLAYLIST_ID/NAME in
// apps/web/src/modules/signage/mediaProgram.ts — keep the two literals in sync (like MEDIA_SHELL_PORT).
const ALL_MEDIA_ID = "all-media";
const ALL_MEDIA_NAME = "ALL MEDIA (SHUFFLE)";
// Carousel step order (owner beat) — a `carousel` program plays each playlist through then hops.
const CAROUSEL_ORDERS = new Set(["ordered", "random"]);
// 'schedule' (M3, D5): clear the manual override so the slot follows its daypart schedule again
// (alias 'rotation' kept from M2 — both clear the override; with no schedule that IS rotation).
// 'carousel' (owner beat): set a carousel program (order param 'ordered'|'random', default ordered).
const PROGRAM_CMDS = new Set(["playlist", "rotation", "capture", "schedule", "carousel"]);
const TRANSPORT_CMDS = new Set(["pause", "resume", "next"]);
// v3: discovery + status. `playlists` needs NO slug (a global picker feed); `status` reads a slug
// but writes nothing and is orientation-agnostic (a UCI may report on any screen).
const NOSLUG_CMDS = new Set(["playlists"]);
const READ_CMDS = new Set(["status"]);

// v5: a `status` on a playlist screen enriches with the film ON SCREEN (title/year/poster) when the
// TV has reported it (report_now_playing, 0054) within this window. Older ⇒ omit nowPlaying (the UCI
// falls back to the playlist name), so a TV that stopped reporting never shows a stale film.
// v6: nowPlaying also carries `posterUrl` — the media_files.poster_path (a real one-sheet, 0055)
// preferred, falling back to the frame-thumb; `thumbUrl` is retained UNCHANGED for compatibility, so
// the Q-SYS plugin upgrades its art with a one-word change (read posterUrl instead of thumbUrl) and
// no other change. posterUrl always carries the best available image (real poster when sourced,
// frame-grab otherwise) — same public-JPEG mechanics as thumbUrl.
const NOW_PLAYING_FRESH_MS = 15 * 60_000;

/** The NOW SHOWING name + year for a reported file, mirroring mediaProgram.ts's
 *  parseTitleYear/nowShowingParts (the framed TV header's label). Kept inline + tiny here like the
 *  scheduleResolve port — if the Kodi-name split changes in one place, mirror it in the other.
 *  "Labyrinth (1986)" → {title:"Labyrinth", year:"1986"}; falls back to the filename (ext stripped)
 *  when the title is unset; blank ⇒ null (no label). */
function nowPlayingParts(title: string | null, filename: string): { title: string; year: string | null } | null {
  const raw = (title && title.trim()) || filename.replace(/\.[^.]+$/, "");
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(.*\S)\s*\((\d{4})\)\s*$/);
  return m ? { title: m[1].trim(), year: m[2] } : { title: t, year: null };
}

/** Escape LIKE/ILIKE metacharacters so a playlist name with % or _ matches LITERALLY (NOTE-5,
 *  PR #56 accepted backlog). Backslash is the default LIKE ESCAPE; `\%`/`\_`/`\\` are literals.
 *  Keeps the case-insensitive EXACT semantics the runbook promises for a name reference. */
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

/** Fetch every row of a query in pages of `size` (defeats PostgREST's max-rows cap — the PR #38
 *  truncation-bug class). `build(from,to)` returns a fresh ranged query each call. */
async function fetchAllRanged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
// The manual-override hold tier a program write carries (docs/15 M3, D4/D5). A Q-SYS press defaults
// to 'event' — a SPECIAL EVENT hold that survives daypart boundaries and expires at the 04:00
// business-day rollover (the owner's overtime case). An explicit `hold` param overrides it.
const HOLDS = new Set(["pin", "boundary", "event"]);
const DEFAULT_HOLD = "event";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

interface NowPlaying { title: string; year: string | null; posterUrl: string | null; thumbUrl: string | null; reportedAt: string }

/** The film ON SCREEN (title/year/poster) for a playlist-or-carousel slot, when the TV reported it
 *  via report_now_playing (0054) within NOW_PLAYING_FRESH_MS — else undefined (the UCI falls back to
 *  the playlist name / carousel label). Shared by the `status` cmd for both a playlist and a carousel
 *  program (a carousel is a chain of playlists, so the same per-file stamp applies). */
// deno-lint-ignore no-explicit-any
async function enrichNowPlaying(admin: any, reportedAt: string | null, fileId: string | null): Promise<NowPlaying | undefined> {
  if (!reportedAt || !fileId || Date.now() - new Date(reportedAt).getTime() > NOW_PLAYING_FRESH_MS) return undefined;
  const { data: file } = await admin
    .from("media_files").select("title, filename, poster_path, thumb_path").eq("id", fileId).maybeSingle();
  if (!file) return undefined;
  const parts = nowPlayingParts((file.title as string | null) ?? null, (file.filename as string) ?? "");
  if (!parts) return undefined;
  const pub = (path: string | null) =>
    path ? admin.storage.from("signage").getPublicUrl(path).data.publicUrl ?? null : null;
  const thumbUrl = pub(file.thumb_path as string | null);
  // v6: poster_path (real one-sheet, 0055) preferred, frame-thumb fallback. thumbUrl kept unchanged.
  const posterUrl = pub(file.poster_path as string | null) ?? thumbUrl;
  return { title: parts.title, year: parts.year, posterUrl, thumbUrl, reportedAt };
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

  let body: { slug?: string; cmd?: string; playlist?: string; hold?: string; order?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const slug = (body.slug ?? "").trim();
  const cmd = (body.cmd ?? "").trim();
  if (!cmd) return json({ error: "cmd required" }, 400);
  const known = PROGRAM_CMDS.has(cmd) || TRANSPORT_CMDS.has(cmd) || NOSLUG_CMDS.has(cmd) || READ_CMDS.has(cmd);
  if (!known) {
    return json({ error: `unknown cmd '${cmd}' (expected playlist|rotation|capture|carousel|schedule|pause|resume|next|playlists|status)` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── v3 `playlists`: a slug-less discovery feed for a dynamic UCI picker ───────────────
  // Returns every playlist (id, name, non-missing fileCount) sorted by name. Read-only.
  if (cmd === "playlists") {
    let plQ = admin.from("media_playlists").select("id, name");
    if (VENUE_ID) plQ = plQ.eq("venue_id", VENUE_ID);
    const { data: pls, error: plErr } = await plQ;
    if (plErr) return json({ error: `playlist list failed: ${plErr.message}` }, 500);

    // Only status='present' files count — that's exactly what the TV plays (mediaProgram.ts) and
    // what the hub counts; 'unsupported'/'missing' are library-known but non-playable, so the
    // picker must never advertise them (NOTE-1 — three-way fn/hub/TV parity).
    // .order("id") gives a STABLE cross-page order: without it Postgres makes no ordering guarantee
    // across .range() pages, so rows could dup/skip past 1000 → wrong counts (WARN-1; the exact
    // truncation class the paginator exists to defeat — PR #38/#54).
    const files = await fetchAllRanged<{ id: string }>((from, to) => {
      let fq = admin.from("media_files").select("id").eq("status", "present");
      if (VENUE_ID) fq = fq.eq("venue_id", VENUE_ID);
      return fq.order("id").range(from, to);
    }).catch((e) => { throw e; });
    const liveIds = new Set(files.map((f) => f.id));

    const items = await fetchAllRanged<{ playlist_id: string; file_id: string }>((from, to) =>
      admin.from("media_playlist_items").select("playlist_id, file_id")
        .order("playlist_id").order("file_id").range(from, to),
    );
    const counts = new Map<string, number>();
    for (const it of items) {
      if (liveIds.has(it.file_id)) counts.set(it.playlist_id, (counts.get(it.playlist_id) ?? 0) + 1);
    }

    const playlists = (pls ?? [])
      .map((p) => ({ id: p.id as string, name: p.name as string, fileCount: counts.get(p.id as string) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // The virtual ALL-MEDIA playlist (owner beat) — every present file shuffled; fileCount = all
    // present files. Prepended so a UCI list always offers it (and `playlist all-media` accepts it).
    playlists.unshift({ id: ALL_MEDIA_ID, name: ALL_MEDIA_NAME, fileCount: liveIds.size });
    return json({ ok: true, playlists });
  }

  // Everything below needs a slug.
  if (!slug) return json({ error: "slug required" }, 400);

  // Optional hold tier for a program write (D4/D5). Default 'event'. Ignored by rotation/schedule.
  const hold = (body.hold ?? "").trim() || DEFAULT_HOLD;
  if ((cmd === "playlist" || cmd === "capture" || cmd === "carousel") && !HOLDS.has(hold)) {
    return json({ error: `invalid hold '${hold}' (expected pin|boundary|event)` }, 400);
  }

  // Resolve + validate the target slot: it must exist and be a landscape screen (programs are a
  // landscape-only feature in the hub — the same semantics the PROGRAM control enforces).
  const { data: slot, error: slotErr } = await admin
    .from("signage_slots")
    .select("id, venue_id, orientation, program, program_hold, program_set_at, now_playing_file_id, now_playing_at")
    .eq("slug", slug)
    .maybeSingle();
  if (slotErr) return json({ error: `slot lookup failed: ${slotErr.message}` }, 500);
  if (!slot) return json({ error: `no slot with slug '${slug}'` }, 404);

  // ── v3 `status`: report what the slot is ACTUALLY playing (the WARN-1 parity lesson) ──
  // Runs the SAME resolver the TV runs (scheduleResolve port) over the slot's program + schedule
  // rows in venue-local time. Read-only + orientation-agnostic (a UCI may query any screen).
  if (cmd === "status") {
    const rawRows = await fetchAllRanged<Parameters<typeof mapScheduleRow>[0]>((from, to) =>
      admin.from("slot_program_schedule")
        .select("id, program, days_of_week, start_minute, end_minute, position, active")
        // .order("id") = stable cross-page order (the resolver re-sorts by position/id itself; this
        // is purely paging safety, mirroring the media_files/items call sites — WARN-1).
        .eq("slot_id", slot.id).order("id").range(from, to),
    ).catch((e: Error) => { throw e; });
    const rows: ScheduleRow[] = rawRows.map(mapScheduleRow);

    // Venue timezone (venues.timezone; default America/Chicago — same fallback as useSignage).
    const { data: venue } = await admin.from("venues").select("timezone").eq("id", slot.venue_id).maybeSingle();
    const tz = (venue?.timezone as string | undefined) ?? "America/Chicago";

    // Business-day rollover hour (venue_settings.toast_closeout_hour, jsonb scalar; default 4).
    const { data: co } = await admin.from("venue_settings")
      .select("value").eq("venue_id", slot.venue_id).eq("key", "toast_closeout_hour").maybeSingle();
    const cv = Number((co as { value?: unknown } | null)?.value);
    const rolloverHour = Number.isFinite(cv) && cv >= 0 && cv <= 23 ? cv : 4;

    const { program, source } = resolveEffectiveProgramWithSource(
      { program: slot.program ?? null, program_hold: slot.program_hold ?? null, program_set_at: slot.program_set_at ?? null },
      rows, new Date(), tz, rolloverHour,
    );
    const kind = program ? program.kind : "rotation";
    // hold only means something while a manual override is live (override/pinned).
    const activeHold = source === "override" || source === "pinned" ? (slot.program_hold as string | null) ?? null : null;

    const status: {
      kind: string; source: string; hold: string | null;
      playlistId?: string; playlistName?: string | null; order?: string;
      nowPlaying?: NowPlaying;
    } = { kind, source, hold: activeHold };

    // Now-playing enrichment (0054, v5/v6): the film ON SCREEN, when the TV reported it recently.
    // The shuffle position lives only in the TV browser, so the TV pings report_now_playing on each
    // advance; here we surface it iff fresh (≤15 min). Applies to a playlist AND a carousel program
    // (a carousel is a chain of playlists — same per-file stamp); a capture/rotation program never
    // reads it (guarded below), so a leftover stamp can't leak into the wrong kind.
    if (program && (program.kind === "playlist" || program.kind === "carousel")) {
      status.nowPlaying = await enrichNowPlaying(admin, slot.now_playing_at as string | null, slot.now_playing_file_id as string | null);
    }
    if (program && program.kind === "playlist") {
      status.playlistId = program.playlist_id;
      if (program.playlist_id === ALL_MEDIA_ID) {
        status.playlistName = ALL_MEDIA_NAME; // virtual — no media_playlists row to name it
      } else {
        const { data: pl } = await admin.from("media_playlists").select("name").eq("id", program.playlist_id).maybeSingle();
        status.playlistName = (pl?.name as string | undefined) ?? null;
      }
    }
    if (program && program.kind === "carousel") status.order = program.order;
    return json({ ok: true, slug, status });
  }

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
  let program:
    | { kind: "playlist"; playlist_id: string }
    | { kind: "capture" }
    | { kind: "carousel"; order: "ordered" | "random" }
    | null;
  let update: Record<string, unknown>;
  if (cmd === "rotation" || cmd === "schedule") {
    program = null;
    update = { program: null, program_hold: null, program_set_at: null };
  } else {
    if (cmd === "capture") {
      program = { kind: "capture" };
    } else if (cmd === "carousel") {
      // carousel — order param (default 'ordered'); plays a whole playlist through then hops.
      const order = (body.order ?? "").trim() || "ordered";
      if (!CAROUSEL_ORDERS.has(order)) return json({ error: `invalid order '${order}' (expected ordered|random)` }, 400);
      program = { kind: "carousel", order: order as "ordered" | "random" };
    } else {
      // playlist — the virtual ALL-MEDIA sentinel (by id 'all-media' or its name), else resolve by
      // id (uuid) or case-insensitive name, scoped to the slot's venue.
      const ref = (body.playlist ?? "").trim();
      if (!ref) return json({ error: "playlist required for cmd 'playlist'" }, 400);
      if (ref.toLowerCase() === ALL_MEDIA_ID || ref.toLowerCase() === ALL_MEDIA_NAME.toLowerCase()) {
        program = { kind: "playlist", playlist_id: ALL_MEDIA_ID };
      } else {
        let q = admin.from("media_playlists").select("id, name").eq("venue_id", slot.venue_id);
        // NOTE-5 (PR #56 backlog): escape %/_ so a name with them matches literally, not as wildcards.
        q = UUID_RE.test(ref) ? q.eq("id", ref) : q.ilike("name", escapeLike(ref));
        const { data: pls, error: plErr } = await q.limit(2);
        if (plErr) return json({ error: `playlist lookup failed: ${plErr.message}` }, 500);
        if (!pls || pls.length === 0) return json({ error: `no playlist matching '${ref}'` }, 404);
        if (pls.length > 1) return json({ error: `playlist '${ref}' is ambiguous (matches ${pls.length})` }, 409);
        program = { kind: "playlist", playlist_id: pls[0].id as string };
      }
    }
    update = { program, program_hold: hold, program_set_at: new Date().toISOString() };
  }

  const { error: upErr } = await admin.from("signage_slots").update(update).eq("id", slot.id);
  if (upErr) return json({ error: `program write failed: ${upErr.message}` }, 500);
  return json({ ok: true, slug, cmd, kind: "program", program, hold: program ? hold : null });
});

/**
 * Smoke test for migration 0067 (audio module PR A): RLS + grants + the agent's RPC.
 * `npx tsx scripts/test-audio-rls.ts` (pnpm test:audiorls).
 *
 * Runs AFTER 0067 is applied to the live project. Until then the audio tables are absent and
 * the script SKIPS cleanly (exit 0 with a clear message) — it is not a failure to run it early.
 *
 * What it proves (the standing post-RLS-migration smoke: anon writes rejected, host reads 200):
 *   (1) seeds — 4 scenes (NORMAL default / DJ / KARAOKE / TRIVIA), 6 zone presets (gain_db null),
 *       1 audio_state row, all for VENUE
 *   (2) anon — every audio table is invisible (permission denied, not an empty 200), anon INSERT
 *       rejected, the RPC with a wrong/empty token rejected
 *   (3) a throwaway host WITH the `audio` grant reads all four tables (200, the seeded rows)
 *   (4) a throwaway host WITHOUT the grant reads 200 but ZERO rows (RLS filters, no error) and
 *       cannot insert into audio_scenes (42501)
 *   (5) the RPC with the REAL token (only when AUDIO_AGENT_TOKEN is in the env) upserts
 *       audio_live for VENUE; a snapshot naming a bogus venue is rejected
 *
 * Throwaway users: audio-rls-host@bunker.test / audio-rls-nomod@bunker.test — created here with
 * the documented recipe (admin createUser + generateLink magiclink → verifyOtp, sends nothing) and
 * DELETED in the finally block (auth user + venue_staff row). Zero `.test` users remain after.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (root .env) and an anon key — SUPABASE_ANON_KEY
 * or VITE_SUPABASE_ANON_KEY (apps/web/.env is loaded as a fallback).
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: "apps/web/.env" });

const URL_ = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
const VENUE = process.env.VENUE_ID ?? "11111111-1111-1111-1111-111111111111";
const AGENT_TOKEN = process.env.AUDIO_AGENT_TOKEN ?? "";

if (!URL_ || !SERVICE) {
  console.error("✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (root .env)");
  process.exit(1);
}
if (!ANON) {
  console.error("✗ no anon key — set SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY (apps/web/.env)");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const TABLES = ["audio_scenes", "audio_zone_presets", "audio_state", "audio_live"] as const;
const USERS = {
  host: "audio-rls-host@bunker.test", // host{audio}
  nomod: "audio-rls-nomod@bunker.test", // host{} — no audio grant
};

let failures = 0;
function assert(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Migration-applied gate: absent tables → skip cleanly. */
async function tablesPresent(): Promise<boolean> {
  // A real GET (not HEAD — PostgREST answers HEAD on a missing table without an error body).
  const { error } = await admin.from("audio_scenes").select("id").limit(1);
  if (!error) return true;
  // PostgREST: PGRST205 = relation not in the schema cache; 42P01 = undefined table.
  if (error.code === "PGRST205" || error.code === "42P01" || /schema cache/.test(error.message)) return false;
  throw new Error(`unexpected error probing audio_scenes: ${error.code} ${error.message}`);
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink ${email}: ${error.message}`);
  const otp = (data.properties as { email_otp?: string } | null)?.email_otp;
  if (!otp) throw new Error(`generateLink ${email}: no email_otp in properties`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await c.auth.verifyOtp({ email, token: otp, type: "email" });
  if (v.error) throw new Error(`verifyOtp ${email}: ${v.error.message}`);
  return c;
}

async function findUserId(email: string): Promise<string | null> {
  // listUsers has no email filter; page through (the project has far fewer than 1000 users).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function createThrowaway(email: string, modules: string[]): Promise<string> {
  const existing = await findUserId(email);
  if (existing) await admin.auth.admin.deleteUser(existing);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const uid = data.user.id;
  // profiles row comes from the 0002 trigger; venue_staff needs it as an FK.
  const ins = await admin.from("venue_staff").insert({ venue_id: VENUE, profile_id: uid, role: "host", modules });
  if (ins.error) throw new Error(`venue_staff insert ${email}: ${ins.error.message}`);
  return uid;
}

async function cleanup() {
  for (const email of Object.values(USERS)) {
    const uid = await findUserId(email);
    if (!uid) continue;
    await admin.from("venue_staff").delete().eq("profile_id", uid);
    await admin.auth.admin.deleteUser(uid);
  }
}

async function main() {
  if (!(await tablesPresent())) {
    console.log("⏭ audio tables not present — migration 0067 is not applied yet; nothing to smoke. (exit 0)");
    return;
  }

  // ── (1) seeds ──────────────────────────────────────────────────────────────
  const scenes = await admin.from("audio_scenes").select("name,position,is_default,requires_confirm,payload,ramp_seconds").eq("venue_id", VENUE).order("position");
  assert("seed: 4 scenes NORMAL/DJ/KARAOKE/TRIVIA in position order", !scenes.error && scenes.data?.map((s) => s.name).join(",") === "NORMAL,DJ,KARAOKE,TRIVIA", scenes.error ?? scenes.data);
  assert("seed: NORMAL is the only default and needs no confirm", !!scenes.data && scenes.data.filter((s) => s.is_default).map((s) => s.name).join() === "NORMAL" && scenes.data.find((s) => s.name === "NORMAL")?.requires_confirm === false);
  assert("seed: DJ/KARAOKE/TRIVIA require confirm", !!scenes.data && scenes.data.filter((s) => s.requires_confirm).map((s) => s.name).join(",") === "DJ,KARAOKE,TRIVIA");
  assert("seed: every payload is EMPTY {} (the app never invents levels)", !!scenes.data && scenes.data.every((s) => JSON.stringify(s.payload) === "{}"));
  assert("seed: ramp_seconds default 3", !!scenes.data && scenes.data.every((s) => Number(s.ramp_seconds) === 3));

  const presets = await admin.from("audio_zone_presets").select("zone,level,gain_db,ramp_seconds").eq("venue_id", VENUE);
  assert("seed: 6 zone presets (inside/patio × low/med/high)", !presets.error && presets.data?.length === 6 && new Set(presets.data.map((p) => `${p.zone}:${p.level}`)).size === 6, presets.error ?? presets.data);
  assert("seed: presets unauthored (gain_db null, ramp 2)", !!presets.data && presets.data.every((p) => p.gain_db === null && Number(p.ramp_seconds) === 2));

  const state = await admin.from("audio_state").select("venue_id,active_scene_id").eq("venue_id", VENUE);
  assert("seed: one audio_state row, no active scene yet", !state.error && state.data?.length === 1 && state.data[0].active_scene_id === null, state.error ?? state.data);

  // ── (2) anon: nothing ──────────────────────────────────────────────────────
  for (const t of TABLES) {
    const r = await anon.from(t).select("*").limit(1);
    assert(`anon SELECT ${t} → permission denied (42501), not an empty 200`, !!r.error && r.error.code === "42501", r.error ?? r.data);
  }
  const anonIns = await anon.from("audio_scenes").insert({ venue_id: VENUE, name: "ANON-PROBE" });
  assert("anon INSERT audio_scenes → rejected", !!anonIns.error, anonIns.error);
  const anonState = await anon.from("audio_state").update({ recalled_by: "anon" }).eq("venue_id", VENUE);
  assert("anon UPDATE audio_state → rejected", !!anonState.error, anonState.error);
  const badTok = await anon.rpc("audio_agent_report", { p_token: "not-the-token", p_snapshot: { venue_id: VENUE }, p_agent_id: "smoke" });
  assert("anon RPC audio_agent_report with a wrong token → unauthorized", !!badTok.error && /unauthorized/i.test(badTok.error.message), badTok.error);
  const emptyTok = await anon.rpc("audio_agent_report", { p_token: "", p_snapshot: { venue_id: VENUE }, p_agent_id: "smoke" });
  assert("anon RPC audio_agent_report with an empty token → unauthorized", !!emptyTok.error && /unauthorized/i.test(emptyTok.error.message), emptyTok.error);
  const capBad = await anon.rpc("audio_agent_capture", { p_token: "not-the-token", p_scene_name: "NORMAL", p_payload: { venue_id: VENUE }, p_agent_id: "smoke" });
  assert("anon RPC audio_agent_capture with a wrong token → unauthorized", !!capBad.error && /unauthorized/i.test(capBad.error.message), capBad.error);
  const oracle = await anon.rpc("audio_agent_token_ok", { p_token: "anything" });
  assert("anon cannot call audio_agent_token_ok directly (no token oracle)", !!oracle.error, oracle.error);

  // ── (3)/(4) throwaway hosts ────────────────────────────────────────────────
  await createThrowaway(USERS.host, ["audio"]);
  await createThrowaway(USERS.nomod, []);
  const host = await signedInClient(USERS.host);
  const nomod = await signedInClient(USERS.nomod);

  const hm = await host.rpc("has_module", { p_venue: VENUE, p_module: "audio" });
  assert("host{audio}: has_module(audio) = true", !hm.error && hm.data === true, hm.error ?? hm.data);
  const nm = await nomod.rpc("has_module", { p_venue: VENUE, p_module: "audio" });
  assert("host{}: has_module(audio) = false", !nm.error && nm.data === false, nm.error ?? nm.data);

  const expectRows: Record<(typeof TABLES)[number], number> = { audio_scenes: 4, audio_zone_presets: 6, audio_state: 1, audio_live: -1 };
  for (const t of TABLES) {
    const r = await host.from(t).select("*").eq("venue_id", VENUE);
    const want = expectRows[t];
    const ok = !r.error && (want < 0 ? true : r.data?.length === want);
    assert(`host{audio} SELECT ${t} → 200${want >= 0 ? ` with ${want} rows` : ""}`, ok, r.error ?? r.data?.length);
    const n = await nomod.from(t).select("*").eq("venue_id", VENUE);
    assert(`host{} SELECT ${t} → 200 with 0 rows (RLS filters, no error)`, !n.error && n.data?.length === 0, n.error ?? n.data?.length);
  }
  const nomodIns = await nomod.from("audio_scenes").insert({ venue_id: VENUE, name: "NOMOD-PROBE" });
  assert("host{} INSERT audio_scenes → 42501", !!nomodIns.error && nomodIns.error.code === "42501", nomodIns.error);
  const hostLive = await host.from("audio_live").insert({ venue_id: VENUE, snapshot: {} });
  assert("host{audio} INSERT audio_live → rejected (no INSERT grant; the RPC is the only writer)", !!hostLive.error, hostLive.error);

  // host{audio} can edit a scene's ramp and the trigger touches updated_at
  const before = await host.from("audio_scenes").select("id,updated_at").eq("venue_id", VENUE).eq("name", "TRIVIA").single();
  const upd = await host.from("audio_scenes").update({ ramp_seconds: 3 }).eq("id", before.data!.id).select("updated_at").single();
  assert("host{audio} UPDATE audio_scenes (no-op value) → 200 + updated_at touched", !upd.error && !!before.data && new Date(upd.data!.updated_at) >= new Date(before.data.updated_at), upd.error);

  // ── (5) the RPC with the real token (opt-in) ───────────────────────────────
  if (AGENT_TOKEN) {
    const snap = { venue_id: VENUE, smoke: true, at: new Date().toISOString() };
    const ok = await anon.rpc("audio_agent_report", { p_token: AGENT_TOKEN, p_snapshot: snap, p_agent_id: "smoke-test" });
    assert("RPC with the real token → ok", !ok.error, ok.error);
    const live = await admin.from("audio_live").select("snapshot,agent_id").eq("venue_id", VENUE).single();
    assert("audio_live row carries the snapshot + agent_id", !live.error && live.data?.agent_id === "smoke-test" && (live.data.snapshot as { smoke?: boolean }).smoke === true, live.error ?? live.data);
    const bogus = await anon.rpc("audio_agent_report", { p_token: AGENT_TOKEN, p_snapshot: { venue_id: "00000000-0000-4000-8000-000000000000" }, p_agent_id: "smoke-test" });
    assert("RPC snapshot naming an unknown venue → rejected", !!bogus.error && /venue/i.test(bogus.error.message), bogus.error);
    const notObj = await anon.rpc("audio_agent_report", { p_token: AGENT_TOKEN, p_snapshot: [1, 2], p_agent_id: "smoke-test" });
    assert("RPC non-object snapshot → rejected", !!notObj.error, notObj.error);
    // capture: an unknown scene is refused WITHOUT touching any real scene payload
    const capUnknown = await anon.rpc("audio_agent_capture", { p_token: AGENT_TOKEN, p_scene_name: "SMOKE-NO-SUCH-SCENE", p_payload: { venue_id: VENUE }, p_agent_id: "smoke-test" });
    assert("capture RPC for an unknown scene → rejected (never creates scenes)", !!capUnknown.error && /no scene named/i.test(capUnknown.error.message), capUnknown.error);
  } else {
    console.log("⏭ AUDIO_AGENT_TOKEN not in env — the real-token RPC upsert check skipped (wrong/empty-token rejection proven above)");
  }
}

main()
  .catch((e) => { failures++; console.error("✗ crashed:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e));
    const left = await findUserId(USERS.host).catch(() => null);
    const left2 = await findUserId(USERS.nomod).catch(() => null);
    console.log(`cleanup: throwaway users remaining = ${[left, left2].filter(Boolean).length}`);
    console.log(failures ? `\n${failures} FAILED` : "\nALL GREEN");
    process.exit(failures ? 1 : 0);
  });

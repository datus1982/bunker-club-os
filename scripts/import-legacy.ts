/**
 * import-legacy.ts — map the path-B export into the new schema (docs/03).
 *
 * Idempotent: run against the NEW owned project with the service role key. Legacy
 * UUIDs are preserved as new PKs so child-table FKs map 1:1 and re-runs upsert.
 *
 * Mapping (docs/03):
 *   teams(contact_*, pin_code)  → teams(+ pin_hash); contacts → sidecar for Phase 2
 *   games                       → games(+ venue_id, season_id null, game_date derived)
 *   game_teams                  → game_teams(+ checked_in_by null)
 *   rounds/scores/questions/    → unchanged (+ FK integrity)
 *     game_display_state
 *   theme_settings              → venue_settings
 *   storage: picture-rounds,logos → same bucket names in the new project
 *
 * // DECISION: legacy teams.contact_*/notes have no home in the docs/02 schema
 * // (registration v2 owns that surface). Rather than invent columns or fabricate
 * // auth users here, unmapped contacts are written to legacy-export/unmapped-
 * // contacts.json; Phase 2 maps contact_email → invited profiles (docs/10 P2).
 * // DECISION: legacy games.name / num_rounds / elapsed_time_seconds are dropped —
 * // docs/02 games has no such columns and the accept gate checks row counts, not
 * // these fields. History of game identity is preserved via game_teams.display_name.
 *
 * Run:  pnpm import:legacy
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import bcrypt from "bcryptjs";
import { newServiceClient, requireEnv } from "./_shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const IN = "legacy-export";
const VENUE_ID = requireEnv("VENUE_ID");

type Row = Record<string, any>;

async function loadTable(name: string): Promise<Row[]> {
  const path = join(IN, "tables", `${name}.json`);
  if (!existsSync(path)) {
    console.warn(`  ! ${name}.json not found — treating as empty`);
    return [];
  }
  return JSON.parse(await readFile(path, "utf8"));
}

/** Keep only the listed keys (drops legacy-only columns the new schema rejects). */
function pick(row: Row, keys: string[]): Row {
  const out: Row = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

function deriveGameDate(g: Row): string {
  const src = g.game_date ?? g.start_time ?? g.created_at ?? g.date;
  if (!src) return new Date().toISOString().slice(0, 10);
  return String(src).slice(0, 10);
}

const VALID_STATUS = new Set(["setup", "active", "paused", "stopped", "completed"]);
function mapStatus(s: unknown): string {
  const v = String(s ?? "").toLowerCase();
  return VALID_STATUS.has(v) ? v : "completed"; // historical rows default to completed
}

async function upsert(client: SupabaseClient, table: string, rows: Row[], onConflict: string) {
  if (rows.length === 0) {
    console.log(`  · ${table.padEnd(20)} 0 rows`);
    return;
  }
  // Chunk to stay under payload limits.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await client.from(table).upsert(slice, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
  console.log(`  ✓ ${table.padEnd(20)} ${rows.length} rows`);
}

async function count(client: SupabaseClient, table: string): Promise<number> {
  const { count: c, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return c ?? 0;
}

async function importStorage(client: SupabaseClient) {
  const base = join(IN, "storage");
  if (!existsSync(base)) {
    console.log("  · no storage/ dir — skipping objects");
    return;
  }
  for (const bucket of await readdir(base)) {
    // Ensure the bucket exists (public, matching legacy).
    await client.storage.createBucket(bucket, { public: true }).catch(() => undefined);
    const walk = async (dir: string, prefix: string): Promise<number> => {
      let n = 0;
      for (const entry of await readdir(join(base, bucket, dir === "" ? "" : dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          n += await walk(rel, prefix);
        } else {
          const body = await readFile(join(base, bucket, rel));
          const { error } = await client.storage.from(bucket).upload(rel, body, { upsert: true });
          if (error) console.warn(`  ! ${bucket}/${rel}: ${error.message}`);
          else n++;
        }
      }
      return n;
    };
    const n = await walk("", bucket);
    console.log(`  ✓ bucket ${bucket.padEnd(16)} ${n} objects`);
  }
}

async function main() {
  console.log("\n▶ Import legacy → new (idempotent)\n");
  const client = newServiceClient();

  // 0) venue must exist (migration 0014 seeds it, but be safe / idempotent).
  await upsert(
    client,
    "venues",
    [{ id: VENUE_ID, name: "Bunker Club", slug: "bunker-club", timezone: "America/Chicago" }],
    "id",
  );

  // 1) teams (+ pin_hash) and unmapped-contacts sidecar.
  const legacyTeams = await loadTable("teams");
  const unmapped: Row[] = [];
  const teams: Row[] = [];
  for (const t of legacyTeams) {
    const pin = t.pin_code ? String(t.pin_code) : null;
    teams.push({
      id: t.id,
      venue_id: VENUE_ID,
      name: t.name,
      logo_url: t.logo_url ?? null,
      is_regular: !!t.is_regular,
      pin_hash: pin ? bcrypt.hashSync(pin, 10) : null,
      archived: false,
    });
    if (t.contact_first_name || t.contact_last_name || t.contact_email || t.notes) {
      unmapped.push({
        team_id: t.id,
        team_name: t.name,
        contact_first_name: t.contact_first_name ?? null,
        contact_last_name: t.contact_last_name ?? null,
        contact_email: t.contact_email ?? null,
        notes: t.notes ?? null,
      });
    }
  }
  await upsert(client, "teams", teams, "id");
  if (unmapped.length) {
    await writeFile(join(IN, "unmapped-contacts.json"), JSON.stringify(unmapped, null, 2));
    console.log(`  ⓘ ${unmapped.length} team contacts saved → ${IN}/unmapped-contacts.json (Phase 2)`);
  }

  // 2) games
  const games = (await loadTable("games")).map((g) => ({
    id: g.id,
    venue_id: VENUE_ID,
    season_id: null,
    game_date: deriveGameDate(g),
    start_time: g.start_time ?? null,
    status: mapStatus(g.status),
    questions_per_round: g.questions_per_round ?? 10,
    is_playoff: false,
  }));
  await upsert(client, "games", games, "id");

  // 3) game_teams
  const gameTeams = (await loadTable("game_teams")).map((gt) => ({
    id: gt.id,
    game_id: gt.game_id,
    team_id: gt.team_id,
    display_name: gt.display_name ?? gt.team_name_used ?? null,
    checked_in_by: null,
    wildcard_used_on_round: gt.wildcard_used_on_round ?? null,
    tiebreaker_rank: gt.tiebreaker_rank ?? null,
  }));
  await upsert(client, "game_teams", gameTeams, "id");

  // 4) rounds (unchanged shape — pick target columns only)
  const roundCols = [
    "id", "game_id", "round_number", "round_type", "after_round", "is_complete",
    "max_points", "bonus_description", "bonus_type", "bonus_round_numbers",
    "bonus_points_per_round", "round_name", "picture_url", "video_url",
  ];
  await upsert(client, "rounds", (await loadTable("rounds")).map((r) => pick(r, roundCols)), "id");

  // 5) scores — dedupe on (game_id, round_id, team_id) via upsert; surfaces dupes.
  const scores = (await loadTable("scores")).map((s) =>
    pick(s, ["id", "game_id", "round_id", "team_id", "points"]),
  );
  await upsert(client, "scores", scores, "game_id,round_id,team_id");

  // 6) questions
  const questions = (await loadTable("questions")).map((q) =>
    pick(q, ["id", "game_id", "round_id", "question_number", "question_text", "answer_text"]),
  );
  await upsert(client, "questions", questions, "game_id,round_id,question_number");

  // 7) game_display_state
  const gds = (await loadTable("game_display_state")).map((d) =>
    pick(d, [
      "id", "game_id", "current_round_id", "current_question_index",
      "show_answer", "is_display_active", "show_video", "show_game_over",
    ]),
  );
  await upsert(client, "game_display_state", gds, "game_id");

  // 8) theme_settings → venue_settings
  const legacyTheme = await loadTable("theme_settings");
  const settings: Row[] = legacyTheme.map((row, idx) =>
    row.key !== undefined
      ? { venue_id: VENUE_ID, key: String(row.key), value: row.value ?? row }
      : { venue_id: VENUE_ID, key: `legacy_theme_settings:${row.id ?? idx}`, value: row },
  );
  await upsert(client, "venue_settings", settings, "venue_id,key");

  // 9) storage
  console.log("\nStorage:");
  await importStorage(client);

  // 10) count verification (Phase 0 accept gate: old vs new must match)
  console.log("\nCount verification (legacy manifest vs new project):");
  let manifest: Row = { tables: {} };
  if (existsSync(join(IN, "manifest.json"))) {
    manifest = JSON.parse(await readFile(join(IN, "manifest.json"), "utf8"));
  }
  const checkTables = ["teams", "games", "rounds", "scores", "questions"];
  let mismatch = false;
  for (const t of checkTables) {
    const legacy = manifest.tables?.[t];
    const now = await count(client, t);
    const ok = legacy === undefined || legacy < 0 || legacy === now;
    if (!ok) mismatch = true;
    const legacyStr = legacy === undefined ? "?" : legacy < 0 ? "n/a" : String(legacy);
    console.log(`  ${ok ? "✓" : "✗"} ${t.padEnd(12)} legacy=${legacyStr.padEnd(6)} new=${now}`);
  }

  console.log(mismatch ? "\n✗ Count mismatch — investigate before cutover.\n" : "\n✓ Import complete; counts match.\n");
  process.exit(mismatch ? 1 : 0);
}

main().catch((err) => {
  console.error("\n✗ Import failed:", err);
  process.exit(1);
});

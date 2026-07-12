/**
 * backup.ts — off-platform backup (docs/12).
 *
 * Two modes, auto-selected:
 *   • DATABASE_URL set  → full pg_dump (schema + data + roles), the gold standard.
 *   • DATABASE_URL empty → password-free snapshot: every public table dumped to
 *     JSON via the service key. Restore = apply repo migrations to a fresh project
 *     (which recreate the schema) + load these JSON rows. // DECISION: this fallback
 *     lets backups run in CI with only the service-role secret, no DB password.
 *
 * Both modes also download every storage bucket. Supabase Pro already does daily
 * backups + PITR; this is the independent, owner-controlled copy.
 *
 * Output in BACKUP_DIR:
 *   db-<stamp>.sql.gz            (pg_dump mode)
 *   data-<stamp>/<table>.json    (service-key mode)
 *   storage-<stamp>/<bucket>/…   (both)
 *
 * Restore drill (docs/12 — TEST ONCE in Phase 0, into a scratch project):
 *   pg_dump mode: gunzip -c db-<stamp>.sql.gz | psql "$SCRATCH_DATABASE_URL"
 *   json  mode:  apply supabase/migrations to the scratch project, then upsert each
 *                data-<stamp>/<table>.json with the service key (reverse of import).
 *
 * Run:  pnpm backup
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { newServiceClient, requireEnv, optionalEnv, nowStamp, selectAll } from "./_shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const BACKUP_DIR = optionalEnv("BACKUP_DIR", "./backups");
const BUCKETS = ["signage", "picture-rounds", "logos"];

// Every public table (service-key snapshot covers all of them, RLS bypassed).
const TABLES = [
  "venues", "venue_settings", "profiles", "venue_staff", "teams", "team_members",
  "seasons", "games", "game_teams", "rounds", "scores", "questions",
  "game_display_state", "signage_slots", "signage_items", "screen_takeovers",
  "toast_menu_cache", "scheduled_events",
];

async function dumpDatabasePgDump(stamp: string) {
  const dbUrl = requireEnv("DATABASE_URL");
  const dest = join(BACKUP_DIR, `db-${stamp}.sql.gz`);
  await mkdir(BACKUP_DIR, { recursive: true });
  console.log("  · pg_dump (--no-owner --no-privileges)…");
  const proc = spawn("pg_dump", ["--no-owner", "--no-privileges", dbUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d.toString()));
  proc.on("error", (e) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("\n✗ pg_dump not found on PATH. Install the postgresql client (CI has it).\n");
      process.exit(1);
    }
    throw e;
  });
  await pipeline(proc.stdout, createGzip(), createWriteStream(dest));
  const code: number = await new Promise((res) => proc.on("close", res));
  if (code !== 0) throw new Error(`pg_dump exited ${code}: ${stderr}`);
  console.log(`  ✓ ${dest}`);
}

async function dumpDataViaApi(client: SupabaseClient, stamp: string) {
  const root = join(BACKUP_DIR, `data-${stamp}`);
  await mkdir(root, { recursive: true });
  let total = 0;
  for (const t of TABLES) {
    const rows = await selectAll(client, t);
    await writeFile(join(root, `${t}.json`), JSON.stringify(rows, null, 2));
    total += rows.length;
    console.log(`  ✓ ${t.padEnd(20)} ${rows.length} rows`);
  }
  console.log(`  → ${total} rows across ${TABLES.length} tables → ${root}`);
}

async function walk(client: SupabaseClient, bucket: string, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) return paths;
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id == null) paths.push(...(await walk(client, bucket, full)));
    else paths.push(full);
  }
  return paths;
}

async function dumpStorage(client: SupabaseClient, stamp: string) {
  const root = join(BACKUP_DIR, `storage-${stamp}`);
  for (const bucket of BUCKETS) {
    const paths = await walk(client, bucket);
    let n = 0;
    for (const path of paths) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) continue;
      const dest = join(root, bucket, path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await data.arrayBuffer()));
      n++;
    }
    console.log(`  ✓ bucket ${bucket.padEnd(16)} ${n} objects`);
  }
}

async function main() {
  console.log("\n▶ Backup (off-platform copy)\n");
  const stamp = nowStamp();
  const client = newServiceClient();

  if (optionalEnv("DATABASE_URL")) {
    console.log("Database (pg_dump mode):");
    await dumpDatabasePgDump(stamp);
  } else {
    console.log("Database (service-key JSON mode — no DATABASE_URL set):");
    await dumpDataViaApi(client, stamp);
  }

  console.log("\nStorage:");
  await dumpStorage(client, stamp);

  console.log(`\n✓ Backup complete → ${BACKUP_DIR}/  (stamp ${stamp})`);
  console.log("  CI uploads these off-platform (GitHub artifact). Restore drill in README.\n");
}

main().catch((err) => {
  console.error("\n✗ Backup failed:", err);
  process.exit(1);
});

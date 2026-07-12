/**
 * backup.ts — off-platform backup (docs/12).
 *
 * Weekly full pg_dump + storage-bucket download to owner-controlled storage.
 * Supabase Pro already does daily backups + PITR; this is the independent copy.
 * Scheduled via GitHub Actions cron (where pg_dump is available and the off-
 * platform upload step — R2/S3/Drive/artifact — is wired). Locally it writes to
 * BACKUP_DIR so the Phase 0 restore drill can be exercised.
 *
 *   BACKUP_DIR/db-<stamp>.sql.gz         gzip'd pg_dump (schema + data)
 *   BACKUP_DIR/storage-<stamp>/<bucket>  every storage object
 *
 * Restore drill (docs/12 — TEST ONCE in Phase 0, into a scratch project):
 *   gunzip -c db-<stamp>.sql.gz | psql "$SCRATCH_DATABASE_URL"
 *   then re-upload storage objects with a short supabase-js loop.
 *
 * Run:  pnpm backup
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { newServiceClient, requireEnv, optionalEnv, nowStamp } from "./_shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const BACKUP_DIR = optionalEnv("BACKUP_DIR", "./backups");
const BUCKETS = ["signage", "picture-rounds", "logos"];

async function dumpDatabase(stamp: string) {
  const dbUrl = requireEnv("DATABASE_URL");
  const dest = join(BACKUP_DIR, `db-${stamp}.sql.gz`);
  await mkdir(BACKUP_DIR, { recursive: true });

  console.log("  · running pg_dump (--no-owner --no-privileges)…");
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

async function walk(client: SupabaseClient, bucket: string, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) return paths; // bucket may not exist yet
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
  await dumpDatabase(stamp);
  console.log("\nStorage:");
  await dumpStorage(newServiceClient(), stamp);
  console.log(`\n✓ Backup complete → ${BACKUP_DIR}/  (stamp ${stamp})`);
  console.log("  CI: upload these artifacts off-platform (R2/S3/Drive). Restore drill in README.\n");
}

main().catch((err) => {
  console.error("\n✗ Backup failed:", err);
  process.exit(1);
});

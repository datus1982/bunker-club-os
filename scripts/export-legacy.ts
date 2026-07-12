/**
 * export-legacy.ts — Path B legacy export (docs/03).
 *
 * The old OptiDev data lives in THEIR Supabase project. There is no dashboard
 * access, but the anon key + fully-open legacy RLS means every table is readable
 * through the API, and the storage buckets are public. This script walks all
 * tables to JSON and downloads all storage objects.
 *
 * READ-ONLY. It performs only .select() and storage .download(). It NEVER writes
 * to the legacy project, which is live production for Wednesday trivia.
 *
 * Output: ./legacy-export/
 *   tables/<name>.json         one file per table
 *   storage/<bucket>/<path>    every object, preserving paths
 *   manifest.json              row/object counts + timestamp
 *
 * Run:  pnpm export:legacy
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { legacyReadClient, selectAll } from "./_shared";

// Legacy table names (docs/03 mapping table, left column). Base tables predate the
// legacy migrations folder; theme_settings is the customization store.
const LEGACY_TABLES = [
  "teams",
  "games",
  "game_teams",
  "rounds",
  "scores",
  "questions",
  "game_display_state",
  "theme_settings",
];

const LEGACY_BUCKETS = ["picture-rounds", "logos"];

const OUT = "legacy-export";

async function exportTables(client: ReturnType<typeof legacyReadClient>) {
  const counts: Record<string, number> = {};
  await mkdir(join(OUT, "tables"), { recursive: true });
  for (const table of LEGACY_TABLES) {
    try {
      const rows = await selectAll(client, table);
      await writeFile(join(OUT, "tables", `${table}.json`), JSON.stringify(rows, null, 2));
      counts[table] = rows.length;
      console.log(`  ✓ ${table.padEnd(20)} ${rows.length} rows`);
    } catch (err) {
      // A missing table is not fatal — record it and continue.
      counts[table] = -1;
      console.warn(`  ! ${table.padEnd(20)} skipped (${(err as Error).message})`);
    }
  }
  return counts;
}

async function walkBucket(
  client: ReturnType<typeof legacyReadClient>,
  bucket: string,
  prefix = "",
): Promise<string[]> {
  const paths: string[] = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) {
    console.warn(`  ! bucket ${bucket} list("${prefix}") failed: ${error.message}`);
    return paths;
  }
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Folders come back with no id/metadata; recurse into them.
    if (entry.id == null && (entry.metadata == null || Object.keys(entry.metadata).length === 0)) {
      paths.push(...(await walkBucket(client, bucket, full)));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

async function exportStorage(client: ReturnType<typeof legacyReadClient>) {
  const counts: Record<string, number> = {};
  for (const bucket of LEGACY_BUCKETS) {
    const paths = await walkBucket(client, bucket);
    let downloaded = 0;
    for (const path of paths) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) {
        console.warn(`  ! ${bucket}/${path}: ${error?.message ?? "no data"}`);
        continue;
      }
      const dest = join(OUT, "storage", bucket, path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await data.arrayBuffer()));
      downloaded++;
    }
    counts[bucket] = downloaded;
    console.log(`  ✓ bucket ${bucket.padEnd(16)} ${downloaded}/${paths.length} objects`);
  }
  return counts;
}

async function main() {
  console.log("\n▶ Legacy export (path B, READ-ONLY)\n");
  const client = legacyReadClient();

  console.log("Tables:");
  const tableCounts = await exportTables(client);

  console.log("\nStorage:");
  const storageCounts = await exportStorage(client);

  const manifest = {
    exported_at: new Date().toISOString(),
    source: process.env.LEGACY_SUPABASE_URL,
    tables: tableCounts,
    storage: storageCounts,
  };
  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Export complete → ./${OUT}/  (manifest.json written)`);
  console.log("  Next: verify counts, then run  pnpm import:legacy\n");
}

main().catch((err) => {
  console.error("\n✗ Export failed:", err);
  process.exit(1);
});

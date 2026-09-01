/**
 * Unit test for the Toast menu-prune diff (toast-menu-sync menuPrune, 0066).
 * `pnpm test:menuprune` (npx tsx scripts/test-menu-prune.ts). Pure fixtures, no I/O —
 * same style as test-menu-order.ts / test-price-options.ts.
 *
 * Contract under test (owner ruling 2026-09-01 — Toast is the sole source of truth):
 *   - a cached guid ABSENT from the Toast walk is planned for removal;
 *   - a guid that came BACK is reported restored (the caller's upsert clears its flag);
 *   - an EMPTY present set is a hard no-op — a failed/partial payload must never blank the
 *     menu (the media-catalog "empty flap" lesson). This is the load-bearing assertion;
 *   - an ALREADY-removed absent guid is NOT rewritten, so its original removal timestamp
 *     survives;
 *   - malformed cache rows are skipped, never thrown.
 */
import { chunk, planPrune, type PruneCacheRow } from "../supabase/functions/toast-menu-sync/menuPrune.ts";

let failures = 0;
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${g}, want ${w}`);
}

const REMOVED_AT = "2026-08-01T00:00:00.000Z";
const present = (guid: string): PruneCacheRow => ({ guid, removed_at: null });
const flagged = (guid: string): PruneCacheRow => ({ guid, removed_at: REMOVED_AT });

// ── Absent → removed ─────────────────────────────────────────────────────────
{
  const cache = [present("keep1"), present("keep2"), present("gone")];
  const plan = planPrune(cache, ["keep1", "keep2"]);
  eq("absent guid is planned for removal", plan.removed, ["gone"]);
  eq("present guids are untouched", plan.alreadyRemoved, []);
  eq("nothing restored", plan.restored, []);
}

// The real shape: several absent at once (the 21 rows this shipped for).
{
  const cache = [present("a"), present("b"), present("c"), present("d")];
  const plan = planPrune(cache, new Set(["a", "c"]));
  eq("multiple absent guids", plan.removed, ["b", "d"]);
}

// ── Returning item → restored (no write planned; the upsert clears the flag) ──
{
  const cache = [flagged("comeback"), present("steady")];
  const plan = planPrune(cache, ["comeback", "steady"]);
  eq("returning guid reported restored", plan.restored, ["comeback"]);
  eq("returning guid is NOT re-removed", plan.removed, []);
  eq("returning guid is not 'alreadyRemoved'", plan.alreadyRemoved, []);
}

// ── EMPTY PAYLOAD → HARD NO-OP (the guard that protects the live menu) ───────
{
  const cache = [present("a"), present("b"), present("c")];
  eq("empty array present-set prunes nothing", planPrune(cache, []), { removed: [], alreadyRemoved: [], restored: [] });
  eq("empty Set present-set prunes nothing", planPrune(cache, new Set<string>()), { removed: [], alreadyRemoved: [], restored: [] });
}
{
  // …and it stays a no-op even when the cache is entirely flagged already.
  const plan = planPrune([flagged("x"), present("y")], []);
  eq("empty present-set reports no restores either", plan.restored, []);
  eq("empty present-set reports no alreadyRemoved either", plan.alreadyRemoved, []);
}

// ── Already-removed absent row keeps its original timestamp (no rewrite) ────
{
  const cache = [present("live"), flagged("longGone")];
  const plan = planPrune(cache, ["live"]);
  eq("already-removed guid is not re-removed", plan.removed, []);
  eq("already-removed guid is reported separately", plan.alreadyRemoved, ["longGone"]);
}
{
  // Mixed: one fresh removal beside one long-gone row.
  const cache = [present("live"), present("justDropped"), flagged("longGone")];
  const plan = planPrune(cache, ["live"]);
  eq("only the newly-absent guid is written", plan.removed, ["justDropped"]);
  eq("the long-gone guid is left alone", plan.alreadyRemoved, ["longGone"]);
}

// ── Defensive shapes ────────────────────────────────────────────────────────
{
  const cache = [
    present("ok"),
    { guid: "" } as PruneCacheRow,
    { guid: 42 } as unknown as PruneCacheRow,
    null as unknown as PruneCacheRow,
    undefined as unknown as PruneCacheRow,
    { guid: "noField" } as PruneCacheRow, // removed_at absent entirely = present
  ];
  const plan = planPrune(cache, ["ok"]);
  eq("malformed rows skipped; missing removed_at treated as present", plan.removed, ["noField"]);
}
{
  eq("empty cache with a real payload does nothing", planPrune([], ["a", "b"]), { removed: [], alreadyRemoved: [], restored: [] });
  eq("null cache tolerated", planPrune(null as unknown as PruneCacheRow[], ["a"]), { removed: [], alreadyRemoved: [], restored: [] });
}

// ── chunk() — PostgREST .in() URL safety ────────────────────────────────────
{
  eq("chunk splits evenly", chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  eq("chunk of empty list", chunk([], 100), []);
  eq("chunk larger than list", chunk([1, 2], 100), [[1, 2]]);
  eq("chunk covers every element once", chunk(["a", "b", "c"], 1).flat(), ["a", "b", "c"]);
}

console.log(failures === 0 ? "\nAll menu-prune assertions passed." : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

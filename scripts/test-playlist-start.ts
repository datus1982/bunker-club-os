/**
 * Unit test for START-AT-FILE playlist ordering (owner beat: "start a specific film").
 * `npx tsx scripts/test-playlist-start.ts` (pnpm test:playliststart). Pure — no DB, no network.
 *
 * Imports the PURE module (no react / supabase / `@/` alias), the scheduleResolve.ts precedent.
 * Asserts the two ratified semantics and — the load-bearing part — every DEGRADE path: an absent,
 * unknown, or non-member start id must return the playlist's normal order UNCHANGED (identity), so
 * a stale id from a Q-SYS press or an old program row can never blank or reorder a bar screen.
 */
import { applyStartFile, type Identified } from "../apps/web/src/modules/signage/playlistOrder.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `: got ${g}, want ${w}`}`);
}
function checkSame(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : " (expected the SAME array reference)"}`);
}

const id = (s: string): Identified => ({ id: s });
const ids = (l: Identified[]) => l.map((f) => f.id);
/** A 5-clip playlist in authored order. */
const AUTHORED = ["a", "b", "c", "d", "e"].map(id);
/** The same 5 clips as a mount's shuffled walk (what shuffleSeeded would have produced). */
const SHUFFLED = ["d", "a", "e", "b", "c"].map(id);

console.log("── IN ORDER (shuffle off): rotate so the loop opens on the chosen film ──");
check("start at c → c,d,e then wraps to a,b", ids(applyStartFile(AUTHORED, false, "c")), ["c", "d", "e", "a", "b"]);
check("start at the LAST clip → e then the whole playlist", ids(applyStartFile(AUTHORED, false, "e")), ["e", "a", "b", "c", "d"]);
check("start at the FIRST clip → unchanged", ids(applyStartFile(AUTHORED, false, "a")), ["a", "b", "c", "d", "e"]);
checkSame("start at the first clip keeps the same array reference", applyStartFile(AUTHORED, false, "a"), AUTHORED);
check("every clip still appears exactly once", applyStartFile(AUTHORED, false, "d").length, 5);
check("rotation never mutates the input", ids(AUTHORED), ["a", "b", "c", "d", "e"]);

console.log("\n── SHUFFLE ON: the chosen film first, then the normal shuffled walk ──");
check("start at c → c first, rest keep shuffled order", ids(applyStartFile(SHUFFLED, true, "c")), ["c", "d", "a", "e", "b"]);
check("start at d (already first) → unchanged", ids(applyStartFile(SHUFFLED, true, "d")), ["d", "a", "e", "b", "c"]);
check("start at e (middle) → e, then d,a,b,c", ids(applyStartFile(SHUFFLED, true, "e")), ["e", "d", "a", "b", "c"]);
check("shuffle path never mutates the input", ids(SHUFFLED), ["d", "a", "e", "b", "c"]);
check("no clip lost or duplicated", [...ids(applyStartFile(SHUFFLED, true, "c"))].sort(), ["a", "b", "c", "d", "e"]);

console.log("\n── DEGRADE SILENTLY (the fail-safe): normal start, byte-identical order ──");
checkSame("undefined start id → same reference (in order)", applyStartFile(AUTHORED, false, undefined), AUTHORED);
checkSame("null start id → same reference (shuffled)", applyStartFile(SHUFFLED, true, null), SHUFFLED);
checkSame("empty-string start id → same reference", applyStartFile(AUTHORED, false, ""), AUTHORED);
checkSame("id not in this playlist (wrong playlist) → same reference", applyStartFile(AUTHORED, false, "zzz"), AUTHORED);
checkSame("id filtered out as MISSING on the host → same reference", applyStartFile(SHUFFLED, true, "gone"), SHUFFLED);
check("empty playlist + a start id → still empty (no throw)", applyStartFile([], false, "a"), []);

console.log("\n── SINGLE-CLIP + ALL-MEDIA-scale sanity ──");
const ONE = [id("solo")];
checkSame("single-clip playlist, start = that clip → same reference", applyStartFile(ONE, true, "solo"), ONE);
checkSame("single-clip playlist, start = something else → same reference", applyStartFile(ONE, true, "other"), ONE);
// ALL MEDIA is the whole library (361+ files at the bar) — prove the rotation lands exactly.
const LIBRARY = Array.from({ length: 400 }, (_, i) => id(`f${i}`));
const fromMid = applyStartFile(LIBRARY, false, "f250");
check("400-file library: opens on the chosen film", fromMid[0].id, "f250");
check("400-file library: continues in order", ids(fromMid.slice(0, 3)), ["f250", "f251", "f252"]);
check("400-file library: wraps to the top after the end", fromMid[400 - 250].id, "f0");
check("400-file library: nothing lost", fromMid.length, 400);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll playlist start-at-file tests passed.");

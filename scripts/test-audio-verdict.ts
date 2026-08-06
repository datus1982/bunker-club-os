/**
 * Unit test for the inter-round video's audio-probe decision logic (docs/04 A/V rounds).
 * `npx tsx scripts/test-audio-verdict.ts` (pnpm test:audioverdict).
 *
 * Imports the PURE module (no react / no supabase / no `@/` alias) so it runs standalone.
 *
 * Guards the 2026-08-05 trivia-night regression: the probe used to read the player state ONCE
 * at 700ms and treat "I don't know yet" (null / UNSTARTED / CUED) as "the browser blocked
 * sound", muting a video that was about to play fine. The contract asserted here is that only
 * PLAYING/BUFFERING ever proves sound works, and only a FULLY elapsed patience window with no
 * evidence of playback ever justifies muting.
 */
import {
  evaluateProbe, simulateProbe,
  PROBE_INTERVAL_MS, PROBE_WINDOW_MS,
  YT_UNSTARTED, YT_ENDED, YT_PLAYING, YT_PAUSED, YT_BUFFERING, YT_CUED,
} from "../apps/web/src/modules/trivia/audioVerdict.ts";

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

console.log("\n── evaluateProbe() — single sample ──");
assert("PLAYING → unlocked", evaluateProbe({ state: YT_PLAYING, elapsedMs: 300 }), "unlocked");
assert("BUFFERING → unlocked", evaluateProbe({ state: YT_BUFFERING, elapsedMs: 300 }), "unlocked");
assert("null mid-window → unknown (THE BUG: this used to mute)", evaluateProbe({ state: null, elapsedMs: 700 }), "unknown");
assert("UNSTARTED mid-window → unknown", evaluateProbe({ state: YT_UNSTARTED, elapsedMs: 700 }), "unknown");
assert("CUED mid-window → unknown", evaluateProbe({ state: YT_CUED, elapsedMs: 700 }), "unknown");
assert("PAUSED mid-window → unknown", evaluateProbe({ state: YT_PAUSED, elapsedMs: 700 }), "unknown");
assert("ENDED → abandon (never seal a finished clip)", evaluateProbe({ state: YT_ENDED, elapsedMs: 700 }), "abandon");
assert("null at 1ms before the window closes → still unknown",
  evaluateProbe({ state: null, elapsedMs: PROBE_WINDOW_MS - 1 }), "unknown");
assert("null exactly AT the window (inclusive) → blocked",
  evaluateProbe({ state: null, elapsedMs: PROBE_WINDOW_MS }), "blocked");
assert("PLAYING past the window still wins over the timeout",
  evaluateProbe({ state: YT_PLAYING, elapsedMs: PROBE_WINDOW_MS + 5000 }), "unlocked");
assert("PAUSED past the window → blocked", evaluateProbe({ state: YT_PAUSED, elapsedMs: PROBE_WINDOW_MS }), "blocked");
assert("custom windowMs honoured", evaluateProbe({ state: null, elapsedMs: 1000, windowMs: 900 }), "blocked");

console.log("\n── trusted env (Electron media shell) short-circuit ──");
assert("trusted + null → unlocked, immediately",
  evaluateProbe({ state: null, elapsedMs: 0, trustedEnv: true }), "unlocked");
assert("trusted + PAUSED past the window → still unlocked (never seals)",
  evaluateProbe({ state: YT_PAUSED, elapsedMs: PROBE_WINDOW_MS * 10, trustedEnv: true }), "unlocked");
assert("trusted simulate → unlocked at 0ms, no polling",
  simulateProbe(() => null, { trustedEnv: true }), { verdict: "unlocked", elapsedMs: 0 });

console.log("\n── simulateProbe() — the real bounded poll ──");

// The poll samples at multiples of PROBE_INTERVAL_MS, so the first sample that can time out is
// the first multiple at or past the window; the last sample still inside the window is the one
// before it. Derived (not hardcoded) so retuning either constant can't rot the test.
const TIMEOUT_TICK = Math.ceil(PROBE_WINDOW_MS / PROBE_INTERVAL_MS) * PROBE_INTERVAL_MS;
const LAST_IN_WINDOW_TICK = TIMEOUT_TICK - PROBE_INTERVAL_MS;

// 1. Null forever: no infoDelivery ever arrives (the handshake never took). Must ride the
//    WHOLE window before muting — not 700ms.
assert("null forever → blocked, and only at the window edge",
  simulateProbe(() => null), { verdict: "blocked", elapsedMs: TIMEOUT_TICK });

// 2. Slow start on a busy bar network — exactly tonight's failure. Unknown until 3s, then PLAYING.
const slowStart = (ms: number) => (ms < 3000 ? null : YT_PLAYING);
assert("slow start (null → PLAYING at 3s) → unlocked, never sealed",
  simulateProbe(slowStart), { verdict: "unlocked", elapsedMs: 3000 });
assert("slow start is past the OLD 700ms verdict point (proof this was a race)",
  slowStart(700), null);

// 3. Immediate success.
assert("immediate PLAYING → unlocked on the first sample",
  simulateProbe(() => YT_PLAYING), { verdict: "unlocked", elapsedMs: PROBE_INTERVAL_MS });

// 4. Genuine block: the player reports UNSTARTED, then sits PAUSED and never plays.
assert("genuine block (UNSTARTED → PAUSED forever) → blocked at the window edge",
  simulateProbe((ms) => (ms < 900 ? YT_UNSTARTED : YT_PAUSED)),
  { verdict: "blocked", elapsedMs: TIMEOUT_TICK });

// 5. BUFFERING only — a stuttering network start still counts as proof of sound.
assert("BUFFERING only → unlocked",
  simulateProbe(() => YT_BUFFERING), { verdict: "unlocked", elapsedMs: PROBE_INTERVAL_MS });
assert("BUFFERING arriving late (5s) → unlocked at 5s",
  simulateProbe((ms) => (ms < 5000 ? null : YT_BUFFERING)), { verdict: "unlocked", elapsedMs: 5100 });

// 6. Full realistic transition ladder: null → UNSTARTED → CUED → BUFFERING → PLAYING.
const ladder = (ms: number) => {
  if (ms < 600) return null;
  if (ms < 1500) return YT_UNSTARTED;
  if (ms < 2400) return YT_CUED;
  if (ms < 3000) return YT_BUFFERING;
  return YT_PLAYING;
};
assert("null→UNSTARTED→CUED→BUFFERING→PLAYING → unlocked at the first BUFFERING sample",
  simulateProbe(ladder), { verdict: "unlocked", elapsedMs: 2400 });
assert("…and every pre-BUFFERING sample was 'unknown', never a verdict",
  [300, 600, 1200, 1800, 2100].map((ms) => evaluateProbe({ state: ladder(ms), elapsedMs: ms })),
  ["unknown", "unknown", "unknown", "unknown", "unknown"]);

// 7. The clip ends while probing (very short video) → abandon, no prompt.
assert("clip ENDS mid-probe → abandon (no seal)",
  simulateProbe((ms) => (ms < 1200 ? null : YT_ENDED)), { verdict: "abandon", elapsedMs: 1200 });

// 8. A last-sample rescue: nothing until the final tick inside the window.
assert("PLAYING on the very last in-window sample → unlocked, not blocked",
  simulateProbe((ms) => (ms >= LAST_IN_WINDOW_TICK ? YT_PLAYING : null)),
  { verdict: "unlocked", elapsedMs: LAST_IN_WINDOW_TICK });

// 9. Termination guarantee — a pathological sampler must not spin forever.
assert("poll always terminates (window is a hard stop)",
  simulateProbe(() => YT_PAUSED, { windowMs: 1000, intervalMs: 300 }).verdict, "blocked");

console.log("\n── window sizing sanity ──");
assert("patience window is generous vs the old 700ms guess", PROBE_WINDOW_MS >= 8000, true);
assert("sample interval divides the window into many chances", PROBE_WINDOW_MS / PROBE_INTERVAL_MS >= 10, true);

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log("\nAll audioVerdict assertions passed.");

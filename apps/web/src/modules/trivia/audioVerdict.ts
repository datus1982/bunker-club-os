/**
 * PURE decision logic for the inter-round video's audio probe (docs/04 A/V rounds).
 *
 * WHY THIS EXISTS — the 2026-08-05 trivia-night bug: the old probe sent `unMute` to the
 * YouTube embed and read the player state exactly 700ms later. `lastState` is fed
 * asynchronously by `infoDelivery` postMessages, so at 700ms on a busy bar network it is
 * routinely still `null` / `-1` (UNSTARTED) / `5` (CUED) — "I don't know yet". The old code
 * read every one of those as "the browser blocked sound", muted a video that was about to
 * play perfectly well, and raised the AUDIO CHANNEL SEALED prompt. It was a race that had
 * been winning by luck. The browser was never blocking anything — the bar TV runs the
 * Electron media shell, which sets `autoplay-policy=no-user-gesture-required`.
 *
 * The rule encoded here: **only positive evidence decides.** PLAYING/BUFFERING proves sound
 * works. Nothing else ever proves it is blocked — we simply keep waiting, and only a fully
 * elapsed patience window (with no evidence of playback the whole time) justifies muting.
 *
 * No react, no supabase, no `@/` alias — imported directly by `scripts/test-audio-verdict.ts`
 * (`pnpm test:audioverdict`).
 */

/** YouTube IFrame API player states (https://developers.google.com/youtube/iframe_api_reference). */
export const YT_UNSTARTED = -1;
export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_PAUSED = 2;
export const YT_BUFFERING = 3;
export const YT_CUED = 5;

/** How often the bounded poll samples the player state. */
export const PROBE_INTERVAL_MS = 300;
/**
 * Total patience before we accept "blocked". Generous on purpose: a slow bar network start
 * costs us a few silent seconds; a wrong verdict costs the room the audio for the whole video.
 * Finite and self-terminating (display perf rule: no infinite animations/polls).
 */
export const PROBE_WINDOW_MS = 8000;

/**
 * - `unlocked` — proven playing; keep sound, mark the session unlocked, drop the prompt.
 * - `unknown`  — no verdict yet; KEEP WAITING (never mute on this).
 * - `abandon`  — the video ended while we were probing; stop, and do NOT seal (there is
 *                nothing left to play, so a prompt over it would be noise).
 * - `blocked`  — the whole window elapsed with no evidence of playback; mute + seal.
 */
export type ProbeVerdict = "unlocked" | "unknown" | "abandon" | "blocked";

export interface ProbeObservation {
  /** Last player state seen via `infoDelivery`, or null if none has arrived yet. */
  state: number | null;
  /** Milliseconds since the probe started. */
  elapsedMs: number;
  /** Patience window; defaults to PROBE_WINDOW_MS. */
  windowMs?: number;
  /**
   * True when the page runs inside an environment whose autoplay policy is known-permissive
   * (the Electron media shell). Short-circuits to `unlocked` — we never seal there.
   */
  trustedEnv?: boolean;
}

/** Verdict for ONE sample of the player state. This is the whole decision. */
export function evaluateProbe({
  state,
  elapsedMs,
  windowMs = PROBE_WINDOW_MS,
  trustedEnv = false,
}: ProbeObservation): ProbeVerdict {
  if (trustedEnv) return "unlocked";
  // Positive evidence — the only thing that ever proves sound works.
  if (state === YT_PLAYING || state === YT_BUFFERING) return "unlocked";
  // The clip finished under us; nothing to mute, nothing to prompt about.
  if (state === YT_ENDED) return "abandon";
  // UNSTARTED / CUED / PAUSED / null are all "not yet" — never a verdict on their own.
  if (elapsedMs >= windowMs) return "blocked";
  return "unknown";
}

/**
 * Simulation of the exact bounded poll the player runs (sample every `intervalMs` until a
 * verdict or the window elapses). Mirrors VideoPlayer's interval callback 1:1 so the test
 * script exercises the real loop shape, not just a single sample.
 *
 * @param sample returns the player state as it would be at `elapsedMs` (null = unknown).
 */
export function simulateProbe(
  sample: (elapsedMs: number) => number | null,
  opts: { windowMs?: number; intervalMs?: number; trustedEnv?: boolean } = {},
): { verdict: ProbeVerdict; elapsedMs: number } {
  const windowMs = opts.windowMs ?? PROBE_WINDOW_MS;
  const intervalMs = opts.intervalMs ?? PROBE_INTERVAL_MS;
  const trustedEnv = opts.trustedEnv ?? false;
  if (trustedEnv) return { verdict: "unlocked", elapsedMs: 0 };
  for (let elapsedMs = intervalMs; ; elapsedMs += intervalMs) {
    const verdict = evaluateProbe({ state: sample(elapsedMs), elapsedMs, windowMs });
    if (verdict !== "unknown") return { verdict, elapsedMs };
    // Safety: the window check inside evaluateProbe guarantees termination, but if an interval
    // ever landed past the window without producing a verdict we must not spin.
    if (elapsedMs >= windowMs) return { verdict: "blocked", elapsedMs };
  }
}

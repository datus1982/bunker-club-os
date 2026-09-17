import { useEffect, useRef, useState } from "react";
import {
  applyRoundState,
  hydrateRoundClocks,
  roundClockStorageKey,
  roundElapsed,
  serializeRoundClocks,
  type RoundClocks,
} from "./hostClocks";

/**
 * React wrappers for the two host-only Scoring clocks. All of the arithmetic lives in the
 * dependency-free `hostClocks.ts` next door (which is what the unit test imports); this
 * file is only the timers, the state and the sessionStorage I/O.
 *
 * Neither clock is ever written to the database or rendered on a TV — see hostClocks.ts.
 */

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null; // private mode / blocked storage — the clocks just don't survive a reload
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* ignore — see readSession */
  }
}

/**
 * Elapsed ms since `resetKey` last changed, ticking once a second. Used for the PER-QUESTION
 * clock with a `roundId:index` key, so every advance — PREV, NEXT, a jump square, BACK TO
 * Q1, loading a round — restarts it at 00:00, and revealing the answer does not.
 *
 * The reset happens in the RENDER phase (React's "adjusting state when a prop changes"
 * pattern), not in an effect: an effect would paint one frame of the PREVIOUS question's
 * elapsed time under the new question — a clock visibly jumping backwards exactly where
 * the host is looking.
 */
export function useElapsedClock(resetKey: string): number {
  const [anchor, setAnchor] = useState(() => ({ key: resetKey, startMs: Date.now() }));
  const [nowMs, setNowMs] = useState(() => anchor.startMs);
  if (anchor.key !== resetKey) {
    const t = Date.now();
    setAnchor({ key: resetKey, startMs: t });
    setNowMs(t);
  }
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, nowMs - anchor.startMs);
}

/**
 * The accumulating PER-ROUND clock for `roundId`, in ms.
 *
 * `running` is the host's SCORE ROUND toggle INVERTED: while the answers are revealed for
 * grading, the round is being scored rather than played, so its clock stops (Marvin's
 * ruling — no start button; the existing toggle is the lever). Loading a different round
 * pauses this one and resumes it when the host comes back.
 *
 * ⚠ The resume-on-HIDE-ANSWERS case is real and accepted: toggling SCORE ROUND back off
 * restarts the clock. There is no other signal for "done scoring" without adding a button.
 */
export function useRoundClock(gameId: string | null, roundId: string | null, running: boolean): number {
  const [clocks, setClocks] = useState<RoundClocks>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const storageKey = gameId ? roundClockStorageKey(gameId) : null;

  // Hydrate per game. Declared BEFORE the transition effect so that on a fresh mount the
  // stored banks land first and the transition below starts from them (React runs effects
  // in declaration order, and their setState updaters queue in that same order).
  useEffect(() => {
    setClocks(storageKey ? hydrateRoundClocks(readSession(storageKey)) : {});
  }, [storageKey]);

  // The one transition: pause everything that isn't the loaded round, run the loaded one
  // only while SCORE ROUND is off. `applyRoundState` returns the same reference when
  // nothing moved, so this cannot loop.
  useEffect(() => {
    setClocks((c) => applyRoundState(c, { roundId, running, nowMs: Date.now() }));
  }, [roundId, running]);

  // 1 Hz display tick — only while something is actually running. A paused clock's number
  // is derived from its bank and cannot change, so there is nothing to re-render for.
  const isRunning = !!roundId && running;
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // Persist on every change of either. One small JSON blob a second while a round runs;
  // the payoff is that an unexpected console reload keeps the seconds instead of starting
  // the round's clock over mid-show.
  const lastWritten = useRef<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    const blob = serializeRoundClocks(clocks, Date.now());
    if (blob === lastWritten.current) return;
    lastWritten.current = blob;
    writeSession(storageKey, blob);
  }, [storageKey, clocks, nowMs]);

  if (!roundId) return 0;
  return roundElapsed(clocks[roundId], nowMs);
}

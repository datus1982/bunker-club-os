/**
 * The two HOST-ONLY clocks on the Scoring console (trivia host notes, 2026-09-16 —
 * Stephen hosting: "we should have a per question timer for the host, it just resets as
 * the questions are advanced so he know how long he has lingered on the question" /
 * "same thing for the round").
 *
 * NEITHER CLOCK EVER REACHES A SCREEN. They are local state in the host's browser: no
 * column, no write, nothing the audience board or the TVs can read. The game clock
 * (0060 `clock_started_at`) is the only persisted one and it is untouched here.
 *
 * Two different shapes, because the two asks are different:
 *   · The QUESTION clock is pure elapsed-since — it restarts at 00:00 every time a
 *     different question becomes current (PREV / NEXT / a jump square / BACK TO Q1 /
 *     loading a round). `useElapsedClock` keyed on round+index does that.
 *   · The ROUND clock ACCUMULATES. It runs while its round is the loaded one and SCORE
 *     ROUND is off, and it STOPS the moment the host toggles SCORE ROUND on (Marvin's
 *     ruling: no start button — "no button needed"). Loading another round pauses it;
 *     coming back resumes where it stopped, which is why the accumulator is a map keyed
 *     by round id rather than one running timestamp.
 *
 * The round map is persisted to sessionStorage so a console reload (or the v2/classic
 * toggle, which remounts the page) keeps the numbers. A round that was RUNNING at unload
 * comes back PAUSED with its seconds intact: the host is not at the desk during a reload,
 * so crediting that gap would be a lie. It resumes when the round becomes current again.
 *
 * THIS FILE IS PURE — zero imports, react included. That is deliberate and load-bearing:
 * `scripts/test-host-clocks.ts` (`pnpm test:hostclocks`) runs it under tsx from the repo
 * ROOT, where react is not resolvable (apps/web installs standalone), so every unit-tested
 * module in `scripts/` imports a dependency-free source file. The two React hooks that wrap
 * these functions live beside it in `useHostClocks.ts`.
 */

/* ── formatting ────────────────────────────────────────────────────────────── */

/**
 * Elapsed ms → `mm:ss`, rolling to `h:mm:ss` past an hour.
 *
 * Zero-padded minutes (unlike Scoring's own `formatElapsed`, which renders the GAME clock
 * as `M:SS`): these two sit in header rows beside other text, and a fixed-width string in
 * a tabular-nums span is one less thing moving while the host reads the question.
 * Negative / non-finite input floors at 00:00 — a clock never runs backwards on screen.
 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ── the round accumulator (pure) ──────────────────────────────────────────── */

/** One round's stopwatch: banked time + the instant the current run began (null = paused). */
export interface RoundClock {
  accumulatedMs: number;
  startedAtMs: number | null;
}

/** Round id → its stopwatch. Rounds the host never loaded simply have no entry. */
export type RoundClocks = Record<string, RoundClock>;

const ZERO: RoundClock = { accumulatedMs: 0, startedAtMs: null };

/** Banked time plus the run in progress, if any. */
export function roundElapsed(clock: RoundClock | undefined, nowMs: number): number {
  if (!clock) return 0;
  const live = clock.startedAtMs == null ? 0 : Math.max(0, nowMs - clock.startedAtMs);
  return Math.max(0, clock.accumulatedMs) + live;
}

/** Start (or leave running) one round's clock. Idempotent — re-starting a running clock
 *  must not reset its run, or every re-render would zero the seconds. */
export function startRound(clocks: RoundClocks, roundId: string, nowMs: number): RoundClocks {
  const cur = clocks[roundId] ?? ZERO;
  if (cur.startedAtMs != null) return clocks;
  return { ...clocks, [roundId]: { accumulatedMs: cur.accumulatedMs, startedAtMs: nowMs } };
}

/** Fold a running clock's current run into its bank and stop it. Idempotent. */
export function pauseRound(clocks: RoundClocks, roundId: string, nowMs: number): RoundClocks {
  const cur = clocks[roundId];
  if (!cur || cur.startedAtMs == null) return clocks;
  return { ...clocks, [roundId]: { accumulatedMs: roundElapsed(cur, nowMs), startedAtMs: null } };
}

/**
 * The whole transition in one pure step: AT MOST ONE round may be running, it must be the
 * loaded one, and it runs only while `running` is true (= SCORE ROUND is off).
 *
 * Called on every relevant change, so it has to be a no-op when nothing moved — it returns
 * the SAME object reference in that case, which is what keeps the 1 Hz tick from looping
 * through React state forever.
 */
export function applyRoundState(
  clocks: RoundClocks,
  { roundId, running, nowMs }: { roundId: string | null; running: boolean; nowMs: number },
): RoundClocks {
  let next = clocks;
  for (const id of Object.keys(clocks)) {
    if (id !== roundId && clocks[id].startedAtMs != null) next = pauseRound(next, id, nowMs);
  }
  if (!roundId) return next;
  return running ? startRound(next, roundId, nowMs) : pauseRound(next, roundId, nowMs);
}

/* ── persistence (pure halves) ─────────────────────────────────────────────── */

/** sessionStorage key. Per GAME — two games never share a round id, but scoping the key
 *  means an old game's entries can't accumulate in a new game's blob either. */
export function roundClockStorageKey(gameId: string): string {
  return `bunker.hostRoundClock.${gameId}`;
}

/** Freeze the map for storage: every run is folded into its bank, so what comes back is
 *  the seconds earned up to this instant with nothing running. */
export function serializeRoundClocks(clocks: RoundClocks, nowMs: number): string {
  const out: Record<string, number> = {};
  for (const [id, c] of Object.entries(clocks)) {
    const ms = roundElapsed(c, nowMs);
    if (ms > 0) out[id] = Math.round(ms);
  }
  return JSON.stringify(out);
}

/** Read a stored blob back. Anything malformed yields an EMPTY map rather than throwing —
 *  a host clock is a convenience and must never be able to blank the Scoring console. */
export function hydrateRoundClocks(raw: string | null | undefined): RoundClocks {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: RoundClocks = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        // startedAtMs null on purpose: a round that was running at unload comes back paused.
        out[id] = { accumulatedMs: Math.round(v), startedAtMs: null };
      }
    }
    return out;
  } catch {
    return {};
  }
}

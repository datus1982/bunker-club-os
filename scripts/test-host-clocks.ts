/**
 * Unit test for the HOST-ONLY Scoring clocks (per-question elapsed + per-round accumulator).
 * `npx tsx scripts/test-host-clocks.ts` (pnpm test:hostclocks). No DB, no network.
 *
 * Imports the PURE module — `modules/trivia/hostClocks.ts` has zero imports (react included),
 * exactly like itemSchedule.ts / scheduleResolve.ts, so it runs under tsx from the repo root
 * where apps/web's node_modules are not on the path. The React wrappers in useHostClocks.ts
 * are deliberately NOT imported here.
 *
 * Covers: mm:ss / h:mm:ss formatting and its floors · start / accumulate / pause / resume ·
 * the SCORE ROUND stop · one-round-at-a-time enforcement · reference stability (a no-op
 * transition must return the SAME object or the 1 Hz tick loops through React state) ·
 * serialize→hydrate round-tripping with a RUNNING clock coming back PAUSED · malformed
 * storage failing to an empty map.
 */
import {
  formatClock,
  roundElapsed,
  startRound,
  pauseRound,
  applyRoundState,
  roundClockStorageKey,
  serializeRoundClocks,
  hydrateRoundClocks,
  type RoundClocks,
} from "../apps/web/src/modules/trivia/hostClocks.ts";

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;

/* ── formatClock ───────────────────────────────────────────────────────────── */

assert("format 0",                       formatClock(0), "00:00");
assert("format sub-second floors",       formatClock(999), "00:00");
assert("format 1s",                      formatClock(1 * S), "00:01");
assert("format 9s zero-padded",          formatClock(9 * S), "00:09");
assert("format 59s",                     formatClock(59 * S), "00:59");
assert("format 60s rolls the minute",    formatClock(60 * S), "01:00");
assert("format 1m05",                    formatClock(65 * S), "01:05");
assert("format 9m59",                    formatClock(9 * M + 59 * S), "09:59");
assert("format 12m34",                   formatClock(12 * M + 34 * S), "12:34");
assert("format 59m59 stays mm:ss",       formatClock(59 * M + 59 * S), "59:59");
assert("format 60m becomes h:mm:ss",     formatClock(1 * H), "1:00:00");
assert("format 1h02m03",                 formatClock(1 * H + 2 * M + 3 * S), "1:02:03");
assert("format 10h keeps the hour bare", formatClock(10 * H + 9 * M + 8 * S), "10:09:08");
assert("format truncates, never rounds", formatClock(1999), "00:01");
// A clock never runs backwards or prints NaN on screen — every bad input floors at 00:00.
assert("format negative floors",         formatClock(-5000), "00:00");
assert("format NaN floors",              formatClock(Number.NaN), "00:00");
assert("format Infinity floors",         formatClock(Number.POSITIVE_INFINITY), "00:00");

/* ── roundElapsed ──────────────────────────────────────────────────────────── */

const T0 = 1_700_000_000_000; // an arbitrary fixed epoch; all instants below are T0 + offsets

assert("elapsed of an unknown round is 0", roundElapsed(undefined, T0), 0);
assert("elapsed paused = its bank",        roundElapsed({ accumulatedMs: 7 * S, startedAtMs: null }, T0 + 99 * S), 7 * S);
assert("elapsed running = bank + run",     roundElapsed({ accumulatedMs: 7 * S, startedAtMs: T0 }, T0 + 5 * S), 12 * S);
assert("elapsed clamps a future start",    roundElapsed({ accumulatedMs: 7 * S, startedAtMs: T0 + 5 * S }, T0), 7 * S);
assert("elapsed clamps a negative bank",   roundElapsed({ accumulatedMs: -9 * S, startedAtMs: null }, T0), 0);

/* ── start / accumulate / pause / resume ───────────────────────────────────── */

const R1 = "round-one", R2 = "round-two";

let c: RoundClocks = {};
c = startRound(c, R1, T0);
assert("start banks nothing yet",          roundElapsed(c[R1], T0), 0);
assert("…and accumulates in real time",    roundElapsed(c[R1], T0 + 30 * S), 30 * S);

// Re-starting a RUNNING clock must be a no-op: the transition effect calls start on every
// relevant change, and a reset there would zero the seconds on every re-render.
const sameRef = startRound(c, R1, T0 + 30 * S);
assert("start on a running clock is a no-op", sameRef === c, true);
assert("…and does not move the run",          roundElapsed(sameRef[R1], T0 + 30 * S), 30 * S);

c = pauseRound(c, R1, T0 + 30 * S);
assert("pause banks the run",              c[R1], { accumulatedMs: 30 * S, startedAtMs: null });
assert("…and the number then holds still", roundElapsed(c[R1], T0 + 10 * M), 30 * S);
assert("pause on a paused clock is a no-op", pauseRound(c, R1, T0 + 10 * M) === c, true);
assert("pause on an unknown round is a no-op", pauseRound(c, "nope", T0) === c, true);

// Resume: the host comes back to the round, and the clock picks up from its bank.
c = startRound(c, R1, T0 + 5 * M);
assert("resume adds to the bank", roundElapsed(c[R1], T0 + 5 * M + 20 * S), 50 * S);

/* ── applyRoundState: the whole transition ─────────────────────────────────── */

// Loading round 1 with SCORE ROUND off starts it.
let t: RoundClocks = applyRoundState({}, { roundId: R1, running: true, nowMs: T0 });
assert("load starts the loaded round", t[R1], { accumulatedMs: 0, startedAtMs: T0 });

// A repeat of the same state must return the SAME reference — this is what stops the 1 Hz
// tick from writing React state forever.
assert("an unchanged transition is referentially stable",
  applyRoundState(t, { roundId: R1, running: true, nowMs: T0 + 3 * S }) === t, true);

// SCORE ROUND on → the round stops. Its number then never moves again while scoring.
t = applyRoundState(t, { roundId: R1, running: false, nowMs: T0 + 2 * M });
assert("SCORE ROUND stops the clock",      t[R1], { accumulatedMs: 2 * M, startedAtMs: null });
assert("…and it holds while scoring",      roundElapsed(t[R1], T0 + 20 * M), 2 * M);

// HIDE ANSWERS resumes it — accepted, documented behaviour (there is no other "done
// scoring" signal without adding the button Stephen said he did not want).
t = applyRoundState(t, { roundId: R1, running: true, nowMs: T0 + 20 * M });
assert("HIDE ANSWERS resumes", roundElapsed(t[R1], T0 + 20 * M + 10 * S), 2 * M + 10 * S);

// Loading round 2 pauses round 1 and starts round 2 — at most one runs at a time.
t = applyRoundState(t, { roundId: R2, running: true, nowMs: T0 + 21 * M });
assert("switching rounds pauses the old one", t[R1].startedAtMs, null);
assert("…banking its time",                   t[R1].accumulatedMs, 3 * M);
assert("…and starts the new one",             t[R2], { accumulatedMs: 0, startedAtMs: T0 + 21 * M });
assert("only one round runs at a time",
  Object.values(t).filter((x) => x.startedAtMs != null).length, 1);

// Round 1 keeps its banked time while round 2 runs.
assert("the paused round holds its total", roundElapsed(t[R1], T0 + 30 * M), 3 * M);
assert("the running round accumulates",    roundElapsed(t[R2], T0 + 24 * M), 3 * M);

// Coming back to round 1 resumes from its bank, not from zero (the "jumps back into a
// round" case in the card).
t = applyRoundState(t, { roundId: R1, running: true, nowMs: T0 + 30 * M });
assert("returning resumes from the bank", roundElapsed(t[R1], T0 + 30 * M + 15 * S), 3 * M + 15 * S);
// Round 2 ran T0+21M → T0+30M, so it banks the full nine minutes it was loaded for.
assert("…and pauses round 2",             t[R2], { accumulatedMs: 9 * M, startedAtMs: null });

// A null round (no round loaded / game with no rounds) pauses everything and starts nothing.
t = applyRoundState(t, { roundId: null, running: true, nowMs: T0 + 31 * M });
assert("no loaded round pauses everything",
  Object.values(t).filter((x) => x.startedAtMs != null).length, 0);
assert("…banking the run",  t[R1].accumulatedMs, 4 * M);

/* ── persistence ───────────────────────────────────────────────────────────── */

assert("storage key is scoped per game",
  roundClockStorageKey("fa11face-0000-4000-8000-000000000917"),
  "bunker.hostRoundClock.fa11face-0000-4000-8000-000000000917");

// Serializing freezes a RUNNING clock's current run into its bank…
const live: RoundClocks = { [R1]: { accumulatedMs: 90 * S, startedAtMs: T0 }, [R2]: { accumulatedMs: 5 * S, startedAtMs: null } };
const blob = serializeRoundClocks(live, T0 + 10 * S);
assert("serialize folds the live run", JSON.parse(blob), { [R1]: 100 * S, [R2]: 5 * S });

// …and hydration brings the seconds back PAUSED: the host was not at the desk during the
// reload, so that gap is not credited; it resumes when the round becomes current again.
const back = hydrateRoundClocks(blob);
assert("hydrate restores the totals", roundElapsed(back[R1], T0 + 99 * H), 100 * S);
assert("hydrate comes back paused",   back[R1].startedAtMs, null);
assert("…for every round",            back[R2], { accumulatedMs: 5 * S, startedAtMs: null });

// A hydrated round resumes correctly when it becomes current again.
const resumed = applyRoundState(back, { roundId: R1, running: true, nowMs: T0 });
assert("a hydrated round resumes from its stored bank", roundElapsed(resumed[R1], T0 + 20 * S), 120 * S);

// Zero-length clocks are not worth storing.
assert("serialize drops empty clocks", serializeRoundClocks({ [R1]: { accumulatedMs: 0, startedAtMs: null } }, T0), "{}");
assert("serialize of an empty map",    serializeRoundClocks({}, T0), "{}");

// Nothing in storage may ever throw into the Scoring console — every bad shape is an empty map.
assert("hydrate null",              hydrateRoundClocks(null), {});
assert("hydrate undefined",         hydrateRoundClocks(undefined), {});
assert("hydrate empty string",      hydrateRoundClocks(""), {});
assert("hydrate garbage",           hydrateRoundClocks("{not json"), {});
assert("hydrate a JSON array",      hydrateRoundClocks("[1,2,3]"), {});
assert("hydrate a JSON scalar",     hydrateRoundClocks("42"), {});
assert("hydrate JSON null",         hydrateRoundClocks("null"), {});
assert("hydrate drops non-numbers", hydrateRoundClocks(`{"a":"12000","b":7000}`), { b: { accumulatedMs: 7000, startedAtMs: null } });
assert("hydrate drops negatives",   hydrateRoundClocks(`{"a":-5,"b":7000}`), { b: { accumulatedMs: 7000, startedAtMs: null } });
assert("hydrate drops NaN-ish",     hydrateRoundClocks(`{"a":null,"b":7000}`), { b: { accumulatedMs: 7000, startedAtMs: null } });

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

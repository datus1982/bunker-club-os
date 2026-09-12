import { useLiveGame, type LiveGameRow } from "./useSignageAdmin";
import { useCloseoutHour, useTriviaArmedEffective, useVenue } from "./useSignage";
import { venueBusinessDay } from "./venueTime";

/**
 * THE TRIVIA ARM STATE — one definition, called by every staff surface that reports it.
 *
 * The "PUT TRIVIA ON SCREENS" arm (migrations 0056/0057) is what actually decides whether
 * the bar TVs show trivia: the bar is a SANDBOX BY DEFAULT, a game can run for scoring
 * without ever touching a screen, and a forgotten arm dies at the venue's nightly 04:00
 * rollover. Three different sentences fall out of (game?, armed?), and staff read them on
 * two different pages now:
 *
 *   game + armed    → gameOnScreens  — the TVs are on the boards (hub cards show GAME mode)
 *   game + NOT armed→ gameOffScreens — "⚠ TRIVIA IS NOT ON THE SCREENS" (the TVs are on rotation)
 *   armed + NO game → armedNoGame    — "◐ TRIVIA IS ARMED" (holding board the moment a game exists)
 *
 * WHY IT LIVES HERE (Beat 6 PR 2, code note N8): the HOME alert strip (letter E1) had to
 * report the same fact the Signage Hub reports, and the derivation was three lines inside
 * `SignageHub.tsx`. A second copy on HOME would be a second answer to "is trivia on the
 * screens" — the same class of bug the hub/TV parity invariant exists to prevent. The
 * inputs matter as much as the arithmetic, so the HOOK (not just the pure function) is the
 * shared unit: both surfaces resolve the game the way the TV does (`useLiveGame` — venue
 * wide, status setup/active/paused, DATE IGNORED) and the arm the way the TV does
 * (`useTriviaArmedEffective`, which applies the nightly expiry). HOME's own `useTonight()`
 * is a DIFFERENT question (today's game by venue date, for the Tonight card) and must not
 * be substituted here.
 *
 * WHEN the game is matters as much as whether it exists (PR 2 review, WARN-1). `useLiveGame`
 * ignores the date on purpose — the TV must show a game that is genuinely running past
 * midnight — but an `active` game nobody ever ended keeps looking "live" for days, and a
 * `setup` deck built for next Wednesday is not tonight's problem at all. So the state also
 * carries the game's relation to the venue BUSINESS day (04:00 closeout: a Wednesday game at
 * 1 AM Thursday is still tonight), and the ALERT surfaces read `alertNotArmed` rather than
 * `gameOffScreens`. The three original booleans are byte-identical arithmetic — they feed the
 * hub's MODE chips and the TV-parity claim, and nothing about what the TV shows has changed.
 *
 * This module is deliberately free of JSX and of any hub import, so a page outside
 * `modules/signage` can call it without dragging the hub's component graph into its chunk.
 */

/** Where the live game sits relative to the venue's current business day. */
export type GameWhen = "tonight" | "past" | "future";

/** The three mutually-exclusive sentences, plus their inputs. */
export interface TriviaArmState {
  /** Where the game sits relative to the venue business day; null when there is no game. */
  when: GameWhen | null;
  /** The game is the one the bar is running (or about to) tonight. A game with NO date is
   *  treated as tonight — fail LOUD: a row that reached the TV resolver is a live thing. */
  gameIsTonight: boolean;
  /** Dated before tonight and still open — almost always "nobody pressed END GAME". */
  gameIsPast: boolean;
  /** A deck built for a later night. Not tonight's problem, and must raise no alarm. */
  gameIsFuture: boolean;
  /**
   * Should a STAFF ALERT surface say something? Not armed, AND either the game is actually
   * running (active/paused, any date — a stale one still needs ending) or it is tonight's
   * un-started deck. A FUTURE `setup` deck raises nothing: building next week's game is not
   * a fault, and nagging about it is the bug this boolean fixes.
   * `gameOffScreens` deliberately keeps its old meaning for MODE/parity readers.
   */
  alertNotArmed: boolean;
  /** Trivia is EFFECTIVELY armed (nightly expiry already applied). */
  armed: boolean;
  /** A game exists that the TVs would show if armed (setup/active/paused, any date). */
  hasGame: boolean;
  /** The TVs are showing the game right now. */
  gameOnScreens: boolean;
  /** A game exists but the screens were never armed — the TVs are on rotation/media. */
  gameOffScreens: boolean;
  /** Armed with nothing loaded yet — must stay visible (PR #79 WARN-1 #4). */
  armedNoGame: boolean;
}

/**
 * Pure derivation. Exported so every sentence can be exercised against fixtures without a
 * DB, a clock or a React tree. `game` is the live row (or null); `today` is the venue
 * business day as `YYYY-MM-DD`.
 */
export function deriveTriviaArmState(
  armed: boolean,
  game: Pick<LiveGameRow, "status" | "game_date"> | null,
  today?: string | null,
): TriviaArmState {
  const hasGame = !!game;
  // No date, or no business day resolved yet (the venue/closeout queries are still in
  // flight) → treat the game as tonight. Fail LOUD: better one honest nag than a silent
  // "nothing to see here" on the one night it matters.
  const when: GameWhen | null = !game
    ? null
    : !game.game_date || !today
    ? "tonight"
    : game.game_date === today
    ? "tonight"
    : game.game_date < today
    ? "past"
    : "future";
  const running = game?.status === "active" || game?.status === "paused";
  return {
    armed,
    hasGame,
    when,
    gameIsTonight: when === "tonight",
    gameIsPast: when === "past",
    gameIsFuture: when === "future",
    // BYTE-IDENTICAL to the pre-review arithmetic — MODE chips and TV parity read these.
    gameOnScreens: hasGame && armed,
    gameOffScreens: hasGame && !armed,
    armedNoGame: armed && !hasGame,
    alertNotArmed: !armed && (running || (game?.status === "setup" && when === "tonight")),
  };
}

/** `YYYY-MM-DD` of the venue business day containing `at` (04:00 closeout aware). */
export function venueBusinessDate(at: Date, tz: string, closeoutHour: number): string {
  const { y, m1, d } = venueBusinessDay(at, tz, closeoutHour);
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The live arm state + the game row itself (the hub still needs the row for its
 * stale-game-date note). Read-only; both queries are the shared cached ones, so a page
 * that already reads them adds no fetch by calling this.
 */
export function useTriviaArmState(): TriviaArmState & { liveGame: LiveGameRow | null } {
  const armed = useTriviaArmedEffective().armed;
  const liveGame = useLiveGame().data ?? null;
  // The SAME venue clock the arm expiry is derived against (useTriviaArmedEffective reads
  // both of these too, so this adds no query): a game belongs to the business day it
  // started, not to the browser's calendar date.
  const tz = useVenue().data?.timezone ?? "America/Chicago";
  const closeout = useCloseoutHour().data ?? 4;
  const today = venueBusinessDate(new Date(), tz, closeout);
  return { ...deriveTriviaArmState(armed, liveGame, today), liveGame };
}

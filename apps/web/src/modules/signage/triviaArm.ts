import { useLiveGame, type LiveGameRow } from "./useSignageAdmin";
import { useTriviaArmedEffective } from "./useSignage";

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
 * This module is deliberately free of JSX and of any hub import, so a page outside
 * `modules/signage` can call it without dragging the hub's component graph into its chunk.
 */

/** The three mutually-exclusive sentences, plus their inputs. */
export interface TriviaArmState {
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
 * Pure derivation. Exported so the three sentences can be exercised against fixtures
 * without a DB, a clock or a React tree.
 */
export function deriveTriviaArmState(armed: boolean, hasGame: boolean): TriviaArmState {
  return {
    armed,
    hasGame,
    gameOnScreens: hasGame && armed,
    gameOffScreens: hasGame && !armed,
    armedNoGame: armed && !hasGame,
  };
}

/**
 * The live arm state + the game row itself (the hub still needs the row for its
 * stale-game-date note). Read-only; both queries are the shared cached ones, so a page
 * that already reads them adds no fetch by calling this.
 */
export function useTriviaArmState(): TriviaArmState & { liveGame: LiveGameRow | null } {
  const armed = useTriviaArmedEffective().armed;
  const liveGame = useLiveGame().data ?? null;
  return { ...deriveTriviaArmState(armed, !!liveGame), liveGame };
}

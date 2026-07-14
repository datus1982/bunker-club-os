import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { log } from "@/shared/log";

/**
 * Trivia leaderboard data layer (docs/04 ARCH-1, QUAL-4).
 *
 * The legacy Leaderboard ran NO realtime and four independent 5s-polled queries
 * (~48 req/min/screen) and assembled team totals in the browser. This replaces all
 * of that with:
 *   • one atomic RPC — game_scoreboard(game_id) — for standings (QUAL-4), and
 *   • ONE realtime channel per game that invalidates the relevant query keys on
 *     postgres_changes; the only polling is the 45s global safety-net (queryClient).
 * No sub-30s polling anywhere.
 */

export interface ScoreboardRow {
  team_id: string;
  team_name: string;
  is_regular: boolean;
  logo_url: string | null;
  total_score: number;
  wildcard_used: boolean;
  wildcard_used_on_round: number | null;
  tiebreaker_rank: number | null;
  place: number;
}

export type GameStatus = "setup" | "active" | "paused" | "stopped" | "completed";

export interface Game {
  id: string;
  venue_id: string;
  status: GameStatus;
  game_date: string;
  start_time: string | null;
}

export interface Round {
  id: string;
  round_number: number;
  round_type: string;
  is_complete: boolean;
  round_name: string | null;
}

export type BoardStage = "qr" | "scoring" | "standings" | "final";

export interface DisplayState {
  current_round_id: string | null;
  is_display_active: boolean | null;
  show_game_over: boolean | null;
  board_stage: BoardStage | null;
}

// Which non-completed game the public display resolves to, highest priority first.
// Mirrors the legacy resolver (active → paused → stopped → setup) but in one query.
const STATUS_PRIORITY: GameStatus[] = ["active", "paused", "stopped", "setup"];

/**
 * Resolve the game to display. A `?game=<id>` override renders that specific game
 * regardless of status (History "view", calibration, and future signage targeting);
 * otherwise the current non-completed game for this venue, by status priority.
 */
export function useCurrentGame(overrideGameId: string | null) {
  const query = useQuery({
    queryKey: ["leaderboard", "game", overrideGameId ?? "current"],
    queryFn: async (): Promise<Game | null> => {
      if (overrideGameId) {
        const { data, error } = await supabase
          .from("games")
          .select("id, venue_id, status, game_date, start_time")
          .eq("id", overrideGameId)
          .maybeSingle();
        if (error) throw error;
        log("[Leaderboard] override game", data);
        return data as Game | null;
      }
      const { data, error } = await supabase
        .from("games")
        .select("id, venue_id, status, game_date, start_time")
        .eq("venue_id", VENUE_ID)
        .in("status", STATUS_PRIORITY);
      if (error) throw error;
      const games = (data ?? []) as Game[];
      games.sort(
        (a, b) => STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status),
      );
      log("[Leaderboard] current game", games[0] ?? null);
      return games[0] ?? null;
    },
  });

  // Realtime: a game flipping status (host starts/pauses/ends) re-resolves the display.
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("leaderboard:games")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["leaderboard", "game"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

/**
 * Standings + rounds + display-state for one game, kept live by a single realtime
 * channel. Returns nothing meaningful until `gameId` is set.
 */
export function useLeaderboardData(gameId: string | null) {
  const qc = useQueryClient();

  const scoreboard = useQuery({
    queryKey: ["leaderboard", "scoreboard", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<ScoreboardRow[]> => {
      const { data, error } = await supabase.rpc("game_scoreboard", { p_game_id: gameId });
      if (error) throw error;
      return (data ?? []) as ScoreboardRow[];
    },
  });

  const rounds = useQuery({
    queryKey: ["leaderboard", "rounds", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<Round[]> => {
      const { data, error } = await supabase
        .from("rounds")
        .select("id, round_number, round_type, is_complete, round_name")
        .eq("game_id", gameId)
        .order("round_number");
      if (error) throw error;
      return (data ?? []) as Round[];
    },
  });

  const displayState = useQuery({
    queryKey: ["leaderboard", "display", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<DisplayState | null> => {
      const { data, error } = await supabase
        .from("game_display_state")
        .select("current_round_id, is_display_active, show_game_over, board_stage")
        .eq("game_id", gameId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DisplayState | null;
    },
  });

  // ONE channel per game (ARCH-1): each table's change invalidates only what it affects.
  useEffect(() => {
    if (!gameId) return;
    const invalidate = (key: string) =>
      qc.invalidateQueries({ queryKey: ["leaderboard", key, gameId] });
    const channel = supabase
      .channel(`leaderboard:game:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores", filter: `game_id=eq.${gameId}` },
        () => invalidate("scoreboard"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_teams", filter: `game_id=eq.${gameId}` },
        () => invalidate("scoreboard"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rounds", filter: `game_id=eq.${gameId}` },
        () => {
          invalidate("rounds");
          invalidate("scoreboard"); // round completion / wildcard rounds change totals context
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_display_state", filter: `game_id=eq.${gameId}` },
        () => invalidate("display"),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, qc]);

  return { scoreboard, rounds, displayState };
}

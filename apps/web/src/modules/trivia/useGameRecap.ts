import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";

/**
 * Read-only data layer for the Game Recap modal (host tool, opened from /game/history).
 *
 * This is a *browse* surface, not a live console: completed games don't change, so —
 * unlike useLeaderboard / useScoring — there are NO realtime channels and NO mutations
 * here. All queries are gated on `enabled` so nothing runs until the modal opens.
 *
 * Standings reuse the SAME source the public Leaderboard uses — the game_scoreboard()
 * RPC (docs/04 QUAL-4) — so the recap's "board" is byte-identical to the display board.
 * Rounds + questions are plain scoped reads (same shape useScoring/QuestionEntry read),
 * all under the existing host/staff RLS the /game/history route already gates.
 */

export interface RecapScoreRow {
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

export interface RecapRound {
  id: string;
  round_number: number;
  round_type: string; // 'regular' | 'final' | 'bonus'
  round_name: string | null;
  is_complete: boolean;
  picture_url: string | null;
  video_url: string | null;
  bonus_description: string | null;
  bonus_type: string | null;
}

export interface RecapQuestion {
  id: string;
  round_id: string;
  question_number: number;
  question_text: string;
  answer_text: string;
}

export function useGameRecap(gameId: string | null, open: boolean) {
  const enabled = open && !!gameId;

  const standings = useQuery({
    queryKey: ["recap", "standings", gameId],
    enabled,
    queryFn: async (): Promise<RecapScoreRow[]> => {
      const { data, error } = await supabase.rpc("game_scoreboard", { p_game_id: gameId });
      if (error) throw error;
      return (data ?? []) as RecapScoreRow[];
    },
  });

  const rounds = useQuery({
    queryKey: ["recap", "rounds", gameId],
    enabled,
    queryFn: async (): Promise<RecapRound[]> => {
      const { data, error } = await supabase
        .from("rounds")
        .select("id, round_number, round_type, round_name, is_complete, picture_url, video_url, bonus_description, bonus_type")
        .eq("game_id", gameId)
        .order("round_number");
      if (error) throw error;
      return (data ?? []) as RecapRound[];
    },
  });

  const questions = useQuery({
    queryKey: ["recap", "questions", gameId],
    enabled,
    queryFn: async (): Promise<RecapQuestion[]> => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, round_id, question_number, question_text, answer_text")
        .eq("game_id", gameId)
        .order("question_number");
      if (error) throw error;
      return (data ?? []) as RecapQuestion[];
    },
  });

  return {
    standings: standings.data ?? [],
    rounds: rounds.data ?? [],
    questions: questions.data ?? [],
    isPending: standings.isPending || rounds.isPending || questions.isPending,
    isError: standings.isError || rounds.isError || questions.isError,
  };
}

/** Round display label, matching QuestionEntry.roundLabel (BONUS / FINAL / ROUND N). */
export function recapRoundLabel(r: RecapRound): string {
  if (r.round_type === "bonus") return `BONUS: ${(r.bonus_description || "SPECIAL").toUpperCase()}`;
  if (r.round_type === "final") return "FINAL ROUND";
  return `ROUND ${r.round_number}`;
}

/** YouTube video id from a watch/embed/youtu.be URL, else null (for a trivial thumbnail). */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

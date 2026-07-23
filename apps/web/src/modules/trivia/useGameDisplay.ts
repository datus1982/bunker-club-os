import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { log } from "@/shared/log";

/**
 * GameDisplay data layer (docs/04 port, ARCH-1). The legacy GameDisplay ran three
 * overlapping sync mechanisms — realtime + a 1s poll + a 5s refetch. This replaces
 * them with one realtime channel per game (the display state changes on every host
 * action) and the 45s global safety-net poll. No sub-30s polling.
 */

/** Manual LANDSCAPE stage (migration 0060), driven by the Scoring DISPLAY control. */
export type DisplayStage = "qr" | "qa" | "video" | "upnext" | "thanks";

export interface DisplayState {
  game_id: string;
  current_round_id: string | null;
  current_question_index: number;
  show_answer: boolean;
  is_display_active: boolean;
  show_video: boolean;
  show_game_over: boolean;
  display_stage: DisplayStage;
}

export interface Round {
  id: string;
  round_number: number;
  round_type: string;
  round_name: string | null;
  is_complete: boolean;
  picture_url: string | null;
  video_url: string | null;
  bonus_description: string | null;
  bonus_type: string | null;
  bonus_round_numbers: number[] | null;
  after_round: number | null;
}

export interface Question {
  id: string;
  round_id: string;
  question_number: number;
  question_text: string;
  answer_text: string;
}

export interface Game {
  id: string;
  venue_id: string;
  status: string;
}

/** Resolve the game to display: ?game override (any status), else the active game. */
export function useDisplayGame(overrideGameId: string | null) {
  return useQuery({
    queryKey: ["gamedisplay", "game", overrideGameId ?? "active"],
    queryFn: async (): Promise<Game | null> => {
      if (overrideGameId) {
        const { data, error } = await supabase
          .from("games")
          .select("id, venue_id, status")
          .eq("id", overrideGameId)
          .maybeSingle();
        if (error) throw error;
        return data as Game | null;
      }
      const { data, error } = await supabase
        .from("games")
        .select("id, venue_id, status")
        .eq("venue_id", VENUE_ID)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data as Game | null;
    },
  });
}

export function useGameDisplayData(gameId: string | null) {
  const qc = useQueryClient();

  const displayState = useQuery({
    queryKey: ["gamedisplay", "state", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<DisplayState | null> => {
      const { data, error } = await supabase
        .from("game_display_state")
        .select("game_id, current_round_id, current_question_index, show_answer, is_display_active, show_video, show_game_over, display_stage")
        .eq("game_id", gameId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DisplayState | null;
    },
  });

  const rounds = useQuery({
    queryKey: ["gamedisplay", "rounds", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<Round[]> => {
      const { data, error } = await supabase
        .from("rounds")
        .select("id, round_number, round_type, round_name, is_complete, picture_url, video_url, bonus_description, bonus_type, bonus_round_numbers, after_round")
        .eq("game_id", gameId)
        .order("round_number");
      if (error) throw error;
      return (data ?? []) as Round[];
    },
  });

  const questions = useQuery({
    queryKey: ["gamedisplay", "questions", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, round_id, question_number, question_text, answer_text")
        .eq("game_id", gameId)
        .order("question_number");
      if (error) throw error;
      return (data ?? []) as Question[];
    },
  });

  // ONE channel per game. Display state changes on every host action → invalidate it
  // most; rounds/questions change rarely (setup/import) but still stay live.
  useEffect(() => {
    if (!gameId) return;
    const inv = (key: string) => qc.invalidateQueries({ queryKey: ["gamedisplay", key, gameId] });
    const channel = supabase
      .channel(`gamedisplay:${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_display_state", filter: `game_id=eq.${gameId}` }, (p) => {
        log("[GameDisplay] display_state change", p.eventType);
        inv("state");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `game_id=eq.${gameId}` }, () => inv("rounds"))
      .on("postgres_changes", { event: "*", schema: "public", table: "questions", filter: `game_id=eq.${gameId}` }, () => inv("questions"))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, qc]);

  // The LOADED round = the round current_round_id points at (manually selected in the
  // Scoring console). It is the single source for the Q&A question, the VIDEO source, and
  // the UP NEXT card — is_complete no longer drives round/video selection anywhere (owner
  // rewire 2026-07-22).
  const currentRound = useMemo(() => {
    const rid = displayState.data?.current_round_id;
    if (!rid) return null;
    return rounds.data?.find((r) => r.id === rid) ?? null;
  }, [displayState.data?.current_round_id, rounds.data]);

  // Main-round questions followed by any applicable bonus-round questions.
  // Ported verbatim from legacy GameDisplay: a 'standard' bonus attaches to the round
  // named by after_round; a 'three-chance' bonus contributes its one question that
  // maps to the current round via bonus_round_numbers.
  const displayQuestions = useMemo<Question[]>(() => {
    if (!currentRound || !rounds.data || !questions.data) return [];
    const all = questions.data;
    const main = all.filter((q) => q.round_id === currentRound.id);
    const bonusRounds = rounds.data.filter(
      (r) =>
        r.round_type === "bonus" &&
        ((r.bonus_type === "standard" && r.after_round === currentRound.round_number) ||
          (r.bonus_type === "three-chance" && r.bonus_round_numbers?.includes(currentRound.round_number))),
    );
    const bonus: Question[] = [];
    for (const br of bonusRounds) {
      const bq = all.filter((q) => q.round_id === br.id);
      if (br.bonus_type === "three-chance" && br.bonus_round_numbers) {
        const idx = br.bonus_round_numbers.indexOf(currentRound.round_number);
        if (idx !== -1 && bq[idx]) bonus.push(bq[idx]);
      } else {
        bonus.push(...bq);
      }
    }
    return [...main, ...bonus];
  }, [currentRound, rounds.data, questions.data]);

  // The UP NEXT card previews the NEXT scorable round AFTER the loaded one (owner: on round 1,
  // UP NEXT should say round 2). Nothing loaded yet → the first round is up next; on the last
  // round → null (the card shows STAND BY; the host uses the THANKS stage at the end).
  const upNextRound = useMemo(() => {
    const scorable = (rounds.data ?? [])
      .filter((r) => r.round_type !== "bonus")
      .sort((a, b) => a.round_number - b.round_number);
    if (scorable.length === 0) return null;
    if (!currentRound) return scorable[0];
    return scorable.find((r) => r.round_number > currentRound.round_number) ?? null;
  }, [rounds.data, currentRound]);

  return {
    displayState: displayState.data ?? null,
    rounds: rounds.data ?? [],
    currentRound,
    upNextRound,
    questions: displayQuestions,
    isPending: displayState.isPending,
  };
}

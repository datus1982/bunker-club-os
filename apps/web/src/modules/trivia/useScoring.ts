import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { log } from "@/shared/log";

/**
 * Scoring console data layer (docs/04 ARCH-2 decomposition). The legacy Scoring.tsx
 * held 30 useState + 29 inline queries/mutations in a 3,285-line god component. This
 * splits its data + behaviour into three hooks — useActiveGame, useGameScores,
 * useDisplayState — that the decomposed UI (RoundGrid / QuestionPanel / DisplayStageControl /
 * BoardStageControl / TeamEditorDialog) composes. Behaviour is preserved to the extent
 * our greenfield schema (docs/02) carries it; the DECISIONs below record the drops.
 *
 * DECISIONS (our schema vs legacy):
 *  - The "current round" is derived as the first incomplete non-bonus round, and the
 *    answer key shows the previous completed round. Scores are hidden during scoring
 *    deliberately via the manual board_stage 'scoring' stage (0038) — nothing auto-flips
 *    the board.
 *  - No `game_display_state.current_video_url`: GameDisplay reads the current round's
 *    rounds.video_url (see GameDisplay.tsx), so video writes only flip show_video +
 *    point current_round_id at the round whose video should play.
 *  - No `games.game_started_at / elapsed_time_seconds / end_time`: the legacy game clock,
 *    2-min autosave, and elapsed-time persistence are dropped. Game controls are pure
 *    status writes; "End Game" sets status='completed' (legacy used 'archived', absent
 *    from our enum) and show_game_over.
 *  - The 1s game_display_state poll (legacy) is dropped for the repo's realtime-first
 *    rule (ARCH-1): one channel per game + the 45s global fallback.
 *  - Team contact/PIN/notes columns don't exist here (SEC-1 — PINs are pin_hash only,
 *    Registration v2 owns them). Team editing is name / is_regular / logo only.
 */

export type GameStatus = "setup" | "active" | "paused" | "stopped" | "completed";

/** Manual public-leaderboard stage (migration 0038), driven ONLY by the Scoring BOARD
 *  segmented control. The PORTRAIT board (trivia/Leaderboard.tsx — also the signage
 *  portrait game-mode board) renders from this. */
export type BoardStage = "qr" | "scoring" | "standings" | "final";

/** Manual LANDSCAPE audience-board stage (migration 0060), driven ONLY by the Scoring
 *  DISPLAY segmented control — independent of BoardStage. The landscape board
 *  (trivia/GameDisplay) renders from this. 'video' plays the next-incomplete round's
 *  video decoupled from current_round_id so question nav never interrupts it. */
export type DisplayStage = "qr" | "qa" | "video" | "upnext" | "thanks";

export interface Game {
  id: string;
  venue_id: string;
  game_date: string;
  start_time: string | null;
  status: GameStatus;
  questions_per_round: number;
  is_playoff: boolean;
}

export interface Round {
  id: string;
  game_id: string;
  round_number: number;
  round_type: string; // 'regular' | 'final' | 'bonus'
  after_round: number | null;
  is_complete: boolean;
  max_points: number | null;
  bonus_description: string | null;
  bonus_type: string | null; // 'standard' | 'three-chance'
  bonus_round_numbers: number[] | null;
  bonus_points_per_round: number[] | null;
  round_name: string | null;
  picture_url: string | null;
  video_url: string | null;
}

export interface ScoreRow {
  id: string;
  game_id: string;
  round_id: string;
  team_id: string;
  points: number;
}

/** One participating team, flattened from game_teams ⨝ teams (Team.id === teams.id). */
export interface Team {
  id: string; // teams.id (== game_teams.team_id) — writes to game_teams filter on this
  name: string;
  is_regular: boolean;
  logo_url: string | null;
  archived: boolean;
  display_name: string | null;
  wildcard_used_on_round: number | null;
  tiebreaker_rank: number | null;
  created_at: string; // game_teams.created_at (stable tie-break)
}

export interface DisplayState {
  game_id: string;
  current_round_id: string | null;
  current_question_index: number;
  show_answer: boolean;
  is_display_active: boolean;
  show_video: boolean;
  show_game_over: boolean;
  board_stage: BoardStage;
  /** Manual LANDSCAPE stage (0060) — the DISPLAY control writes it; GameDisplay renders it. */
  display_stage: DisplayStage;
  /** When START was pressed (0060) — the host game clock ticks from this. null = stopped. */
  clock_started_at: string | null;
}

/* ── useActiveGame ─────────────────────────────────────────────────────────────
 * Resolves which game the host is scoring and exposes game-status controls.
 * Order mirrors the legacy Scoring resolver (active → setup → paused → stopped); a
 * `?game=<id>` override pins a specific game (used for fixtures / the parity run). */

const STATUS_PRIORITY: GameStatus[] = ["active", "setup", "paused", "stopped"];

export function useActiveGame(overrideGameId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["scoring", "activeGame", overrideGameId ?? "auto"],
    queryFn: async (): Promise<Game | null> => {
      const cols = "id, venue_id, game_date, start_time, status, questions_per_round, is_playoff";
      if (overrideGameId) {
        const { data, error } = await supabase.from("games").select(cols).eq("id", overrideGameId).maybeSingle();
        if (error) throw error;
        return data as Game | null;
      }
      const { data, error } = await supabase
        .from("games")
        .select(cols)
        .eq("venue_id", VENUE_ID)
        .in("status", STATUS_PRIORITY);
      if (error) throw error;
      const games = (data ?? []) as Game[];
      games.sort((a, b) => STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status));
      return games[0] ?? null;
    },
  });

  const game = query.data ?? null;

  // Realtime: the game flipping status (or a new game created) re-resolves the console.
  useEffect(() => {
    const channel = supabase
      .channel("scoring:games")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["scoring", "activeGame"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const setStatus = useMutation({
    mutationFn: async (status: GameStatus) => {
      if (!game) return;
      const { error } = await supabase.from("games").update({ status }).eq("id", game.id);
      if (error) throw error;
      log("[Scoring] game status →", status);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scoring", "activeGame"] }),
  });

  return { query, game, setStatus };
}

/* ── Scoring math (pure — ported verbatim from legacy JS; no RPC) ─────────────── */

export function getScore(scores: ScoreRow[], teamId: string, roundId: string): ScoreRow | undefined {
  return scores.find((s) => s.team_id === teamId && s.round_id === roundId);
}

/** Points a team earned in a round (0 if none), doubled on their wildcard round. */
export function roundPoints(team: Team, round: Round, scores: ScoreRow[]): number {
  const pts = getScore(scores, team.id, round.id)?.points ?? 0;
  return team.wildcard_used_on_round === round.round_number ? pts * 2 : pts;
}

/** Team grand total across every round (bonus rounds included, wildcard doubled). */
export function getTeamTotal(team: Team, rounds: Round[], scores: ScoreRow[]): number {
  return rounds.reduce((sum, r) => sum + roundPoints(team, r, scores), 0);
}

/** Bonus rounds that attach to a given regular/final round (standard + three-chance). */
export function applicableBonusRounds(round: Round, rounds: Round[]): Round[] {
  return rounds.filter(
    (r) =>
      r.round_type === "bonus" &&
      ((r.bonus_type !== "three-chance" && r.after_round === round.round_number) ||
        (r.bonus_type === "three-chance" && (r.bonus_round_numbers ?? []).includes(round.round_number))),
  );
}

/** The regular round_number a three-chance bonus score is attributed to (legacy rule:
 *  match points against bonus_points_per_round; a 0/incorrect guess sticks to round[0]). */
export function threeChanceAnsweredRound(bonus: Round, points: number): number | null {
  const nums = bonus.bonus_round_numbers ?? [];
  const pts = bonus.bonus_points_per_round ?? [];
  if (nums.length === 0) return null;
  if (points === 0) return nums[0];
  const idx = pts.indexOf(points);
  return idx >= 0 ? nums[idx] : nums[0];
}

/** Points a team scored on the bonus attached to this regular round (for the ⭐ badge). */
export function getTeamBonusForRound(team: Team, round: Round, rounds: Round[], scores: ScoreRow[]): number {
  let total = 0;
  for (const bonus of applicableBonusRounds(round, rounds)) {
    const s = getScore(scores, team.id, bonus.id);
    if (!s) continue;
    if (bonus.bonus_type === "three-chance") {
      if (threeChanceAnsweredRound(bonus, s.points) === round.round_number) total += s.points;
    } else {
      total += s.points;
    }
  }
  return total;
}

/** Non-bonus rounds, ordered — the grid's score columns. */
export function scoringRounds(rounds: Round[]): Round[] {
  return rounds.filter((r) => r.round_type !== "bonus").sort((a, b) => a.round_number - b.round_number);
}

/** The last non-bonus round (final if present, else highest regular). */
export function lastScoringRound(rounds: Round[]): Round | null {
  const sr = scoringRounds(rounds);
  const final = sr.find((r) => r.round_type === "final");
  return final ?? sr[sr.length - 1] ?? null;
}

/** Every team has a score in the final (or last regular) round → game is decided. */
export function isFinalRoundComplete(teams: Team[], rounds: Round[], scores: ScoreRow[]): boolean {
  const last = lastScoringRound(rounds);
  if (!last || teams.length === 0) return false;
  return teams.every((t) => getScore(scores, t.id, last.id) !== undefined);
}

/** Round N (>first) is locked until every team has a score in the previous scoring round. */
export function isRoundLocked(round: Round, teams: Team[], rounds: Round[], scores: ScoreRow[]): boolean {
  const sr = scoringRounds(rounds);
  const idx = sr.findIndex((r) => r.id === round.id);
  if (idx <= 0) return false;
  const prev = sr[idx - 1];
  return !teams.every((t) => getScore(scores, t.id, prev.id) !== undefined);
}

export interface Ranked {
  team: Team;
  total: number;
  rank: number; // display rank
}

/** Standings ordering identical to game_scoreboard(): total desc → teams with a manual
 *  tiebreaker_rank ahead of those without → tiebreaker_rank asc → created_at asc. */
export function getTeamRankings(teams: Team[], rounds: Round[], scores: ScoreRow[]): Ranked[] {
  const withTotals = teams.map((team) => ({ team, total: getTeamTotal(team, rounds, scores) }));
  withTotals.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const aHas = a.team.tiebreaker_rank != null;
    const bHas = b.team.tiebreaker_rank != null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.team.tiebreaker_rank !== b.team.tiebreaker_rank) {
      return (a.team.tiebreaker_rank ?? 0) - (b.team.tiebreaker_rank ?? 0);
    }
    return a.team.created_at.localeCompare(b.team.created_at);
  });
  return withTotals.map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface TieInfo {
  hasTies: boolean;
  /** team.id → the shared starting ordinal for its visible tie group (top-3 only). */
  tiedPosition: Map<string, number>;
  /** team.id → the ranks a tied team may be assigned in the tiebreaker column. */
  availableRanks: Map<string, number[]>;
}

/** Top-3 ties among teams without a manual tiebreaker_rank (mirrors legacy getTop3Ties). */
export function getTop3Ties(ranked: Ranked[]): TieInfo {
  const tiedPosition = new Map<string, number>();
  const availableRanks = new Map<string, number[]>();
  let hasTies = false;
  if (ranked.length === 0 || ranked.every((r) => r.total === 0)) {
    return { hasTies, tiedPosition, availableRanks };
  }
  const byScore = new Map<number, Ranked[]>();
  for (const r of ranked) {
    const g = byScore.get(r.total);
    if (g) g.push(r);
    else byScore.set(r.total, [r]);
  }
  for (const group of byScore.values()) {
    if (group.length < 2) continue;
    const noRank = group.filter((g) => g.team.tiebreaker_rank == null);
    if (noRank.length < 2) continue;
    const startPos = Math.min(...group.map((g) => g.rank));
    if (startPos > 3) continue; // only surface ties affecting the podium
    hasTies = true;
    const ranks = noRank.map((g) => g.rank).sort((a, b) => a - b);
    for (const g of noRank) {
      tiedPosition.set(g.team.id, startPos);
      availableRanks.set(g.team.id, ranks);
    }
  }
  return { hasTies, tiedPosition, availableRanks };
}

export function getOrdinal(rank: number): string {
  const j = rank % 10;
  const k = rank % 100;
  if (j === 1 && k !== 11) return `${rank}st`;
  if (j === 2 && k !== 12) return `${rank}nd`;
  if (j === 3 && k !== 13) return `${rank}rd`;
  return `${rank}th`;
}

/* ── useGameScores ─────────────────────────────────────────────────────────────
 * Loads teams / rounds / scores for a game + all regular teams, kept live by one
 * realtime channel, and exposes every scoring mutation. */

export function useGameScores(gameId: string | null) {
  const qc = useQueryClient();

  const teams = useQuery({
    queryKey: ["scoring", "teams", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase
        .from("game_teams")
        .select("team_id, display_name, wildcard_used_on_round, tiebreaker_rank, created_at, teams(id, name, is_regular, logo_url, archived)")
        .eq("game_id", gameId)
        .order("created_at");
      if (error) throw error;
      type Joined = {
        team_id: string;
        display_name: string | null;
        wildcard_used_on_round: number | null;
        tiebreaker_rank: number | null;
        created_at: string;
        teams: { id: string; name: string; is_regular: boolean; logo_url: string | null; archived: boolean } | null;
      };
      return ((data ?? []) as unknown as Joined[]).map((g) => ({
        id: g.teams?.id ?? g.team_id,
        name: g.display_name || g.teams?.name || "—",
        is_regular: g.teams?.is_regular ?? false,
        logo_url: g.teams?.logo_url ?? null,
        archived: g.teams?.archived ?? false,
        display_name: g.display_name,
        wildcard_used_on_round: g.wildcard_used_on_round,
        tiebreaker_rank: g.tiebreaker_rank,
        created_at: g.created_at,
      }));
    },
  });

  const rounds = useQuery({
    queryKey: ["scoring", "rounds", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<Round[]> => {
      const { data, error } = await supabase.from("rounds").select("*").eq("game_id", gameId).order("round_number");
      if (error) throw error;
      return (data ?? []) as Round[];
    },
  });

  const scores = useQuery({
    queryKey: ["scoring", "scores", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<ScoreRow[]> => {
      const { data, error } = await supabase.from("scores").select("id, game_id, round_id, team_id, points").eq("game_id", gameId);
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    },
  });

  const regularTeams = useQuery({
    queryKey: ["scoring", "regularTeams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, is_regular, logo_url")
        .eq("venue_id", VENUE_ID)
        .eq("is_regular", true)
        .eq("archived", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; is_regular: boolean; logo_url: string | null }[];
    },
  });

  // ONE channel per game (ARCH-1): each table's change invalidates only what it feeds.
  useEffect(() => {
    if (!gameId) return;
    const inv = (key: string) => qc.invalidateQueries({ queryKey: ["scoring", key, gameId] });
    const channel = supabase
      .channel(`scoring:game:${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scores", filter: `game_id=eq.${gameId}` }, () => inv("scores"))
      .on("postgres_changes", { event: "*", schema: "public", table: "game_teams", filter: `game_id=eq.${gameId}` }, () => inv("teams"))
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `game_id=eq.${gameId}` }, () => inv("rounds"))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, qc]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["scoring", "scores", gameId] });
    qc.invalidateQueries({ queryKey: ["scoring", "teams", gameId] });
    qc.invalidateQueries({ queryKey: ["scoring", "rounds", gameId] });
  };

  /** Save a team's main-round score (+ optional wildcard) and its attached bonuses. */
  const saveScore = useMutation({
    mutationFn: async (args: {
      teamId: string;
      round: Round;
      points: number;
      wildcard: boolean | undefined; // undefined = leave wildcard unchanged
      bonus: { round: Round; points: number | null }[]; // points=null → clear that bonus
    }) => {
      if (!gameId) return;
      const { teamId, round, points, wildcard, bonus } = args;

      const { error: e1 } = await supabase
        .from("scores")
        .upsert({ game_id: gameId, team_id: teamId, round_id: round.id, points }, { onConflict: "game_id,team_id,round_id" });
      if (e1) throw e1;

      if (wildcard !== undefined) {
        const { error: e2 } = await supabase
          .from("game_teams")
          .update({ wildcard_used_on_round: wildcard ? round.round_number : null })
          .eq("game_id", gameId)
          .eq("team_id", teamId);
        if (e2) throw e2;
      }

      for (const b of bonus) {
        if (b.points === null) {
          const { error } = await supabase.from("scores").delete().eq("game_id", gameId).eq("team_id", teamId).eq("round_id", b.round.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("scores")
            .upsert({ game_id: gameId, team_id: teamId, round_id: b.round.id, points: b.points }, { onConflict: "game_id,team_id,round_id" });
          if (error) throw error;
        }
      }
    },
    onSuccess: invalidateAll,
  });

  /** Clear a team's score for a round (main + attached bonuses + wildcard if it was here). */
  const deleteScore = useMutation({
    mutationFn: async (args: { teamId: string; round: Round; wasWildcard: boolean }) => {
      if (!gameId) return;
      const { teamId, round, wasWildcard } = args;
      const { error } = await supabase.from("scores").delete().eq("game_id", gameId).eq("team_id", teamId).eq("round_id", round.id);
      if (error) throw error;
      if (wasWildcard) {
        await supabase.from("game_teams").update({ wildcard_used_on_round: null }).eq("game_id", gameId).eq("team_id", teamId);
      }
      for (const b of applicableBonusRounds(round, rounds.data ?? [])) {
        await supabase.from("scores").delete().eq("game_id", gameId).eq("team_id", teamId).eq("round_id", b.id);
      }
    },
    onSuccess: invalidateAll,
  });

  const clearAllScores = useMutation({
    mutationFn: async () => {
      if (!gameId) return;
      const { error } = await supabase.from("scores").delete().eq("game_id", gameId);
      if (error) throw error;
      await supabase.from("game_teams").update({ wildcard_used_on_round: null }).eq("game_id", gameId);
    },
    onSuccess: invalidateAll,
  });

  const setTiebreaker = useMutation({
    mutationFn: async (args: { teamId: string; rank: number | null }) => {
      if (!gameId) return;
      const { error } = await supabase.from("game_teams").update({ tiebreaker_rank: args.rank }).eq("game_id", gameId).eq("team_id", args.teamId);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  /** Toggle rounds.is_complete. Marking complete zero-fills missing team scores and, on
   *  the final round, raises game_display_state.show_game_over (audience GAME OVER). */
  const toggleRoundComplete = useMutation({
    mutationFn: async (round: Round) => {
      if (!gameId) return;
      const nextComplete = !round.is_complete;
      if (nextComplete) {
        const existing = new Set((scores.data ?? []).filter((s) => s.round_id === round.id).map((s) => s.team_id));
        const fill = (teams.data ?? []).filter((t) => !existing.has(t.id)).map((t) => ({ game_id: gameId, team_id: t.id, round_id: round.id, points: 0 }));
        if (fill.length > 0) {
          const { error } = await supabase.from("scores").insert(fill);
          if (error) throw error;
        }
      }
      const { error } = await supabase.from("rounds").update({ is_complete: nextComplete }).eq("id", round.id);
      if (error) throw error;

      if (round.round_type === "final") {
        // Completing the final round raises GAME OVER + drops the question display;
        // un-completing it just clears GAME OVER (leaves the display where it was).
        const patch = nextComplete ? { show_game_over: true, is_display_active: false } : { show_game_over: false };
        await supabase.from("game_display_state").update(patch).eq("game_id", gameId);
      }
    },
    onSuccess: invalidateAll,
  });

  /** Add an existing regular team to the game, zero-filling already-complete rounds. */
  const addExistingTeam = useMutation({
    mutationFn: async (args: { teamId: string; displayName: string | null }) => {
      if (!gameId) return;
      const { error } = await supabase.from("game_teams").insert({ game_id: gameId, team_id: args.teamId, display_name: args.displayName });
      if (error) throw error;
      await zeroFillCompletedRounds(gameId, args.teamId, rounds.data ?? [], scores.data ?? []);
    },
    onSuccess: invalidateAll,
  });

  /** Remove a team from the game (its scores go with it). */
  const removeTeam = useMutation({
    mutationFn: async (teamId: string) => {
      if (!gameId) return;
      await supabase.from("scores").delete().eq("game_id", gameId).eq("team_id", teamId);
      const { error } = await supabase.from("game_teams").delete().eq("game_id", gameId).eq("team_id", teamId);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  return {
    teams: teams.data ?? [],
    rounds: rounds.data ?? [],
    scores: scores.data ?? [],
    regularTeams: regularTeams.data ?? [],
    isPending: teams.isPending || rounds.isPending || scores.isPending,
    saveScore,
    deleteScore,
    clearAllScores,
    setTiebreaker,
    toggleRoundComplete,
    addExistingTeam,
    removeTeam,
    invalidateAll,
  };
}

async function zeroFillCompletedRounds(gameId: string, teamId: string, rounds: Round[], scores: ScoreRow[]) {
  const done = rounds.filter((r) => r.round_type !== "bonus" && r.is_complete);
  const has = new Set(scores.filter((s) => s.team_id === teamId).map((s) => s.round_id));
  const fill = done.filter((r) => !has.has(r.id)).map((r) => ({ game_id: gameId, team_id: teamId, round_id: r.id, points: 0 }));
  if (fill.length > 0) await supabase.from("scores").insert(fill);
}

/* ── useDisplayState ───────────────────────────────────────────────────────────
 * Owns game_display_state: the single row the audience GameDisplay + Leaderboard
 * render from. Kept live by one realtime channel (no 1s poll — ARCH-1). */

export function useDisplayState(gameId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["scoring", "display", gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<DisplayState | null> => {
      const { data, error } = await supabase
        .from("game_display_state")
        .select("game_id, current_round_id, current_question_index, show_answer, is_display_active, show_video, show_game_over, board_stage, display_stage, clock_started_at")
        .eq("game_id", gameId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DisplayState | null;
    },
  });

  useEffect(() => {
    if (!gameId) return;
    const channel = supabase
      .channel(`scoring:display:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_display_state", filter: `game_id=eq.${gameId}` },
        () => qc.invalidateQueries({ queryKey: ["scoring", "display", gameId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, qc]);

  const state = query.data ?? null;

  // Ensure a row exists (GameSetup seeds one; fixtures / older games may lack it).
  useEffect(() => {
    if (!gameId || query.isPending || query.data) return;
    supabase
      .from("game_display_state")
      .upsert({ game_id: gameId, is_display_active: false }, { onConflict: "game_id" })
      .then(() => qc.invalidateQueries({ queryKey: ["scoring", "display", gameId] }));
  }, [gameId, query.isPending, query.data, qc]);

  const write = useMutation({
    mutationFn: async (patch: Partial<Omit<DisplayState, "game_id">>) => {
      if (!gameId) return;
      const { error } = await supabase
        .from("game_display_state")
        .upsert({ game_id: gameId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "game_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scoring", "display", gameId] }),
  });

  // (The old toggleVideo mutation was retired in the 2026-07-22 rebuild: video is now a
  // LANDSCAPE display_stage — the DISPLAY control writes display_stage='video' via `write`,
  // and GameDisplay resolves the round's video itself, decoupled from current_round_id.)

  return { query, state, write };
}

/** Load a round's projected questions (main + attached bonuses) for QuestionPanel —
 *  same assembly the audience GameDisplay uses (docs/04 useGameDisplay). */
export function useRoundQuestions(gameId: string | null, round: Round | null, rounds: Round[]) {
  const questions = useQuery({
    queryKey: ["scoring", "questions", gameId, round?.id],
    enabled: !!gameId && !!round,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, round_id, question_number, question_text, answer_text")
        .eq("game_id", gameId)
        .order("question_number");
      if (error) throw error;
      return (data ?? []) as { id: string; round_id: string; question_number: number; question_text: string; answer_text: string }[];
    },
  });

  return useMemo(() => {
    if (!round || !questions.data) return [] as typeof questions.data & [];
    const all = questions.data;
    const main = all.filter((q) => q.round_id === round.id);
    const bonus: typeof all = [];
    for (const br of applicableBonusRounds(round, rounds)) {
      const bq = all.filter((q) => q.round_id === br.id);
      if (br.bonus_type === "three-chance" && br.bonus_round_numbers) {
        const idx = br.bonus_round_numbers.indexOf(round.round_number);
        if (idx !== -1 && bq[idx]) bonus.push(bq[idx]);
      } else {
        bonus.push(...bq);
      }
    }
    return [...main, ...bonus];
  }, [round, questions.data, rounds]);
}

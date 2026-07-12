import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

// Admin seasons data layer (docs/06). Standings ALWAYS via season_leaderboard() —
// the single source of truth the portal + display + finals qualification share.

export interface Season {
  id: string; name: string; starts_on: string; ends_on: string;
  scoring_mode: "cumulative" | "placement" | "best_n";
  best_n: number | null; placement_points: number[] | null; playoff_size: number | null;
  finals_game_id: string | null; status: "upcoming" | "active" | "completed";
}
export interface StandingRow { team_id: string; team_name: string; games_played: number; total_points: number; wins: number; score: number; rank: number; }

export function useSeasons() {
  return useQuery({
    queryKey: ["seasons", "list"],
    queryFn: async (): Promise<Season[]> => {
      const { data, error } = await supabase.from("seasons").select("*").eq("venue_id", VENUE_ID).order("starts_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Season[];
    },
  });
}

export function useSeasonDetail(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["seasons", "detail", seasonId],
    enabled: !!seasonId,
    queryFn: async () => {
      const { data: season } = await supabase.from("seasons").select("*").eq("id", seasonId).maybeSingle();
      // Standings via the one function; join team names.
      const { data: lb, error } = await supabase.rpc("season_leaderboard", { p_season_id: seasonId });
      if (error) throw error;
      const rows = (lb ?? []) as Omit<StandingRow, "team_name">[];
      const teamIds = rows.map((r) => r.team_id);
      const names = new Map<string, string>();
      if (teamIds.length) {
        const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
        for (const t of teams ?? []) names.set(t.id as string, t.name as string);
      }
      const standings: StandingRow[] = rows
        .map((r) => ({ ...r, team_name: names.get(r.team_id) ?? r.team_id.slice(0, 8) }))
        .sort((a, b) => a.rank - b.rank);

      const { data: games } = await supabase.from("games").select("id, game_date, status, is_playoff").eq("season_id", seasonId).order("game_date", { ascending: false });

      return { season: season as Season | null, standings, games: games ?? [] };
    },
  });
}

export async function createSeason(input: {
  name: string; starts_on: string; ends_on: string; scoring_mode: string;
  best_n: number | null; placement_points: number[] | null; playoff_size: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("seasons").insert({
    venue_id: VENUE_ID, ...input,
    status: input.starts_on <= new Date().toISOString().slice(0, 10) && input.ends_on >= new Date().toISOString().slice(0, 10) ? "active" : "upcoming",
  });
  if (error) {
    if (error.code === "23P01" || /overlap|exclusion/i.test(error.message)) return { ok: false, error: "Dates overlap an existing season for this venue." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Create the finals game, pre-check-in the top N (via check_in_team), stamp finals_game_id. */
export async function createFinalsNight(season: Season, standings: StandingRow[]): Promise<{ ok: boolean; error?: string; gameId?: string }> {
  const n = season.playoff_size ?? 0;
  if (n <= 0) return { ok: false, error: "This season has no playoff size set." };
  const topN = standings.filter((s) => s.rank <= n);
  if (topN.length === 0) return { ok: false, error: "No qualifying teams yet — standings are empty." };

  // Finals game dated at season end (inside the window → trigger stamps this season).
  const { data: game, error: gErr } = await supabase.from("games")
    .insert({ venue_id: VENUE_ID, game_date: season.ends_on, status: "setup", is_playoff: true })
    .select("id").single();
  if (gErr) return { ok: false, error: gErr.message };
  const gameId = game.id as string;

  // Pre-check-in the qualifiers (check_in_team authorizes via staff/host bypass for admin).
  for (const t of topN) {
    const { error } = await supabase.rpc("check_in_team", { p_game_id: gameId, p_team_id: t.team_id, p_display_name: null });
    if (error) return { ok: false, error: `Check-in failed for ${t.team_name}: ${error.message}` };
  }

  const { error: sErr } = await supabase.from("seasons").update({ finals_game_id: gameId }).eq("id", season.id);
  if (sErr) return { ok: false, error: sErr.message };
  return { ok: true, gameId };
}

export async function completeSeason(seasonId: string) {
  const { error } = await supabase.from("seasons").update({ status: "completed" }).eq("id", seasonId);
  if (error) throw error;
}

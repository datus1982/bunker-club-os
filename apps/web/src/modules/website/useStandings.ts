import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Public season standings for the marketing /trivia page (docs/14). Reads the ONE
 * scoring function `season_leaderboard()` (never a second path — CLAUDE.md rule) plus
 * `teams_public` for names (anon-safe view; anon has no privilege on the base teams
 * table). anon EXECUTE on season_leaderboard was granted in 0011. No active season →
 * null (the page shows a friendly empty state).
 */

export interface StandingRow {
  team_id: string;
  team_name: string;
  score: number;
  wins: number;
  rank: number;
}

export interface Standings {
  seasonName: string;
  endsOn: string;
  rows: StandingRow[];
}

export function useStandings(limit = 10) {
  return useQuery({
    queryKey: ["site-standings", VENUE_ID, limit],
    staleTime: 60_000,
    queryFn: async (): Promise<Standings | null> => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: season } = await supabase
        .from("seasons")
        .select("id, name, ends_on")
        .eq("venue_id", VENUE_ID)
        .eq("status", "active")
        .lte("starts_on", today)
        .gte("ends_on", today)
        .order("starts_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!season) return null;

      const { data: lb } = await supabase.rpc("season_leaderboard", { p_season_id: season.id });
      const rows = ((lb ?? []) as Array<{ team_id: string; score: number; wins: number; rank: number }>)
        .filter((r) => r.rank <= limit)
        .sort((a, b) => a.rank - b.rank);

      const names = new Map<string, string>();
      if (rows.length) {
        const { data: teams } = await supabase
          .from("teams_public")
          .select("id, name")
          .in("id", rows.map((r) => r.team_id));
        for (const t of teams ?? []) names.set(t.id as string, t.name as string);
      }

      return {
        seasonName: season.name as string,
        endsOn: season.ends_on as string,
        rows: rows.map((r) => ({
          team_id: r.team_id,
          team_name: names.get(r.team_id) ?? "—",
          score: Math.round(Number(r.score)),
          wins: r.wins,
          rank: r.rank,
        })),
      };
    },
  });
}

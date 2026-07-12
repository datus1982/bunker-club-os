import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

// Season standings panel for the trivia leaderboard display (docs/06). Reads the ONE
// season_leaderboard() function (never a second scoring path) + teams_public for names
// (anon-safe). Realtime on scores so standings refresh as tonight's game is scored — no
// sub-30s polling (ARCH-1 / perf rules).

export interface SeasonStanding { team_id: string; team_name: string; score: number; wins: number; rank: number; }
export interface SeasonPanelData { seasonName: string; endsOn: string; rows: SeasonStanding[]; }

export function useSeasonPanel() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["leaderboard", "seasonPanel"],
    queryFn: async (): Promise<SeasonPanelData | null> => {
      const { data: season } = await supabase
        .from("seasons")
        .select("id, name, ends_on")
        .eq("venue_id", VENUE_ID)
        .eq("status", "active")
        .lte("starts_on", new Date().toISOString().slice(0, 10))
        .gte("ends_on", new Date().toISOString().slice(0, 10))
        .maybeSingle();
      if (!season) return null;

      const { data: lb } = await supabase.rpc("season_leaderboard", { p_season_id: season.id });
      const rows = ((lb ?? []) as Array<{ team_id: string; score: number; wins: number; rank: number }>)
        .filter((r) => r.rank <= 5)
        .sort((a, b) => a.rank - b.rank);
      if (rows.length === 0) return { seasonName: season.name as string, endsOn: season.ends_on as string, rows: [] };

      const { data: teams } = await supabase.from("teams_public").select("id, name").in("id", rows.map((r) => r.team_id));
      const names = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
      return {
        seasonName: season.name as string,
        endsOn: season.ends_on as string,
        rows: rows.map((r) => ({ team_id: r.team_id, team_name: names.get(r.team_id) ?? "—", score: Math.round(Number(r.score)), wins: r.wins, rank: r.rank })),
      };
    },
    staleTime: 20_000,
  });

  useEffect(() => {
    const ch = supabase.channel("leaderboard:seasonPanel")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, () => qc.invalidateQueries({ queryKey: ["leaderboard", "seasonPanel"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return query;
}

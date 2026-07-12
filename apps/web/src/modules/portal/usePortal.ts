import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

// Portal data layer (docs/07). ALL season/standings numbers come from SQL RPCs
// (team_season_summary → season_leaderboard, team_history, team_streaks) — no score
// math in TypeScript. The Tonight card reuses game_scoreboard + realtime (Phase 1).

export interface SeasonSummary {
  season_id: string | null; season_name: string | null; scoring_mode: string | null;
  best_n: number | null; ends_on: string | null; rank: number | null; score: number | null;
  wins: number | null; games_played: number | null; games_counted: number | null;
  total_teams: number | null; points_behind_next: number | null; leader_score: number | null;
}
export interface MyTeam {
  id: string; name: string; logo_url: string | null; members: number;
  currentStreak: number | null; summary: SeasonSummary | null;
}

async function seasonSummary(teamId: string): Promise<SeasonSummary | null> {
  const { data } = await supabase.rpc("team_season_summary", { p_team_id: teamId });
  return (data?.[0] as SeasonSummary) ?? null;
}
async function currentStreak(teamId: string): Promise<number | null> {
  const { data } = await supabase.from("team_streaks").select("current_streak").eq("team_id", teamId).order("current_streak", { ascending: false }).limit(1).maybeSingle();
  return (data?.current_streak as number | null) ?? null;
}

/** My teams with member count, season rank, and streak (home cards). */
export function useMyTeams(uid: string | undefined) {
  return useQuery({
    queryKey: ["portal", "myTeams", uid],
    enabled: !!uid,
    queryFn: async (): Promise<MyTeam[]> => {
      const { data: memberships } = await supabase.from("team_members").select("team_id").eq("profile_id", uid!);
      const teamIds = (memberships ?? []).map((m) => m.team_id as string);
      if (teamIds.length === 0) return [];
      const { data: teams } = await supabase.from("teams").select("id, name, logo_url").in("id", teamIds).eq("archived", false);
      const { data: allMembers } = await supabase.from("team_members").select("team_id").in("team_id", teamIds);
      const count = new Map<string, number>();
      for (const r of allMembers ?? []) count.set(r.team_id as string, (count.get(r.team_id as string) ?? 0) + 1);

      const result = await Promise.all((teams ?? []).map(async (t) => ({
        id: t.id as string, name: t.name as string, logo_url: (t.logo_url as string | null) ?? null,
        members: count.get(t.id as string) ?? 1,
        currentStreak: await currentStreak(t.id as string),
        summary: await seasonSummary(t.id as string),
      })));
      // Most relevant first: teams with a season rank, best rank first.
      result.sort((a, b) => (a.summary?.rank ?? 999) - (b.summary?.rank ?? 999));
      return result;
    },
  });
}

export interface TonightLive {
  gameId: string; teamId: string; teamName: string; score: number; place: number; gapToLead: number; round: string | null;
}

/** The live "Tonight" card — only when one of my teams is checked into an active game. */
export function useTonight(uid: string | undefined, teamIds: string[]) {
  const qc = useQueryClient();
  const key = ["portal", "tonight", uid, teamIds.join(",")];
  const query = useQuery({
    queryKey: key,
    enabled: !!uid && teamIds.length > 0,
    queryFn: async (): Promise<TonightLive | null> => {
      // Find the ACTIVE game one of my teams is actually checked into (there may be several
      // active games; the Tonight card is about the one I'm playing).
      const { data: games } = await supabase.from("games").select("id").eq("venue_id", VENUE_ID).eq("status", "active");
      const activeIds = (games ?? []).map((g) => g.id as string);
      if (activeIds.length === 0) return null;
      const { data: myGt } = await supabase.from("game_teams").select("game_id, team_id").in("game_id", activeIds).in("team_id", teamIds);
      const mineGt = (myGt ?? [])[0];
      if (!mineGt) return null;
      const active = { id: mineGt.game_id as string };
      const { data: board } = await supabase.rpc("game_scoreboard", { p_game_id: active.id });
      const rows = (board ?? []) as Array<{ team_id: string; team_name: string; total_score: number; place: number }>;
      const mine = rows.find((r) => teamIds.includes(r.team_id));
      if (!mine) return null;
      const leader = rows.reduce((m, r) => Math.max(m, r.total_score), 0);
      // current round label from display state
      const { data: ds } = await supabase.from("game_display_state").select("current_round_id").eq("game_id", active.id).maybeSingle();
      let round: string | null = null;
      if (ds?.current_round_id) {
        const { data: r } = await supabase.from("rounds").select("round_number").eq("id", ds.current_round_id).maybeSingle();
        round = r ? `R${r.round_number}` : null;
      }
      return { gameId: active.id, teamId: mine.team_id, teamName: mine.team_name, score: mine.total_score, place: mine.place, gapToLead: leader - mine.total_score, round };
    },
  });

  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel("portal:tonight")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, () => qc.invalidateQueries({ queryKey: ["portal", "tonight"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "game_teams" }, () => qc.invalidateQueries({ queryKey: ["portal", "tonight"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `venue_id=eq.${VENUE_ID}` }, () => qc.invalidateQueries({ queryKey: ["portal", "tonight"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);

  return query;
}

export interface RosterMember { profile_id: string; display_name: string | null; email: string | null; role: string; }
export interface HistoryRow { game_id: string; game_date: string; points: number; place: number; counts_toward: boolean; }
export interface JoinRequest { id: string; profile_id: string; display_name: string | null; }

export function useTeamDetail(teamId: string | undefined, uid: string | undefined) {
  return useQuery({
    queryKey: ["portal", "team", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const [summaryRes, historyRes, rosterRes, streakRes] = await Promise.all([
        supabase.rpc("team_season_summary", { p_team_id: teamId }),
        supabase.rpc("team_history", { p_team_id: teamId }),
        supabase.rpc("team_roster", { p_team_id: teamId }),
        supabase.from("team_streaks").select("current_streak").eq("team_id", teamId).order("current_streak", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const roster = (rosterRes.data ?? []) as RosterMember[];
      const isCaptain = roster.some((m) => m.profile_id === uid && m.role === "captain");

      // Pending join requests (visible to all members via RLS). Resolve names via roster fallback / profiles.
      const { data: reqs } = await supabase.from("team_join_requests").select("id, profile_id").eq("team_id", teamId).eq("status", "pending");
      const requests: JoinRequest[] = [];
      for (const r of reqs ?? []) {
        // display_name best-effort: the requester isn't a member yet, so profiles RLS blocks it;
        // show a short id. (Approving reveals them in the roster.)
        requests.push({ id: r.id as string, profile_id: r.profile_id as string, display_name: null });
      }

      const team = await supabase.from("teams").select("name, logo_url").eq("id", teamId).maybeSingle();

      return {
        name: (team.data?.name as string) ?? "TEAM",
        logo_url: (team.data?.logo_url as string | null) ?? null,
        summary: (summaryRes.data?.[0] as SeasonSummary) ?? null,
        history: (historyRes.data ?? []) as HistoryRow[],
        roster,
        requests,
        currentStreak: (streakRes.data?.current_streak as number | null) ?? null,
        isCaptain,
      };
    },
  });
}

export interface Profile { display_name: string | null; email: string | null; phone: string | null; marketing_opt_in: boolean; created_at: string | null; }

export function useProfile(uid: string | undefined) {
  return useQuery({
    queryKey: ["portal", "profile", uid],
    enabled: !!uid,
    queryFn: async (): Promise<Profile | null> => {
      const { data } = await supabase.from("profiles").select("display_name, email, phone, marketing_opt_in, created_at").eq("id", uid!).maybeSingle();
      return (data as Profile) ?? null;
    },
  });
}

// ── mutations ─────────────────────────────────────────────────────────────────
export async function approveJoin(requestId: string) {
  const { error } = await supabase.rpc("approve_join_request", { p_request_id: requestId });
  if (error) throw error;
}
export async function removeMember(teamId: string, profileId: string) {
  const { error } = await supabase.rpc("remove_team_member", { p_team_id: teamId, p_profile_id: profileId });
  if (error) throw error;
}
export async function inviteMember(teamId: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("invite-team-member", { body: { team_id: teamId, email } });
  if (error) return { ok: false, error: "Could not send invite" };
  if (data?.invited) return { ok: true };
  return { ok: false, error: data?.error ?? "Invite failed" };
}
export async function setTeamPin(teamId: string, pin: string | null) {
  const { error } = await supabase.rpc("set_team_pin", { p_team_id: teamId, p_pin: pin });
  if (error) throw error;
}
export async function updateProfile(uid: string, patch: Partial<Profile>) {
  const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
  if (error) throw error;
}

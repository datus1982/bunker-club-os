import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { TRIVIA_SCREENS_ARMED_KEY } from "@/modules/signage/useSignage";

// Data layer for the patron check-in flow (docs/05). Everything that mutates the
// teams graph goes through the SECURITY DEFINER RPCs in migration 0019 / the
// verify-team-pin edge fn — the client never writes teams/team_members directly.

export type GameStatus = "setup" | "active" | "paused" | "stopped" | "completed";
// A game is "tonight's game" if it's the highest-priority non-completed venue game.
// Same resolution the Scoring console uses (useScoring.STATUS_PRIORITY).
const STATUS_PRIORITY: GameStatus[] = ["active", "setup", "paused", "stopped"];

export interface TonightGame {
  id: string;
  game_date: string;
  status: GameStatus;
}

export interface MyTeam {
  id: string;
  name: string;
  logo_url: string | null;
  is_regular: boolean;
  role: string;
  members: number;
  lastPlayed: string | null; // game_date of most recent appearance
  alreadyCheckedIn: boolean; // already on tonight's game_teams
  rank: number | null; // season rank teaser (best-effort)
  seasonName: string | null;
}

/** Tonight's game (or null → "no game running" screen).
 *
 *  Patron self-check-in is GATED on the trivia arm (0056): the /checkin flow is CLOSED
 *  until the host arms trivia onto the screens ("PUT TRIVIA ON SCREENS" on the Scoring
 *  console). While disarmed, this returns null so the flow falls through to its existing
 *  "no game running — check-in opens on trivia night" state. The arm is the single switch
 *  that both opens check-in AND raises the holding QR. NOTE: this does NOT gate the host
 *  walk-up check-in (check_in_team RPC) — the host can still add teams from Scoring during
 *  setup regardless of the arm. The flag is read anon-safe, the same key the resolver uses;
 *  a patron scanning the (armed) QR loads fresh, and the flag also rides react-query refetch. */
export function useTonightGame() {
  return useQuery({
    queryKey: ["checkin", "tonightGame"],
    queryFn: async (): Promise<TonightGame | null> => {
      // Gate: check-in is closed unless trivia is explicitly armed (default OFF, fail-closed).
      const { data: armedRow } = await supabase
        .from("venue_settings")
        .select("value")
        .eq("venue_id", VENUE_ID)
        .eq("key", TRIVIA_SCREENS_ARMED_KEY)
        .maybeSingle();
      if ((armedRow as { value?: unknown } | null)?.value !== true) return null;

      const { data, error } = await supabase
        .from("games")
        .select("id, game_date, status")
        .eq("venue_id", VENUE_ID)
        .in("status", STATUS_PRIORITY);
      if (error) throw error;
      const games = (data ?? []) as TonightGame[];
      // Highest-priority status first; among equal statuses, the most recent date
      // (so "tonight" is the latest open game, not an older one left non-completed).
      games.sort((a, b) =>
        STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status) ||
        b.game_date.localeCompare(a.game_date),
      );
      return games[0] ?? null;
    },
  });
}

/** The signed-in player's teams, most-recently-played first, with check-in state. */
export function useMyTeams(uid: string | undefined, gameId: string | undefined) {
  return useQuery({
    queryKey: ["checkin", "myTeams", uid, gameId],
    enabled: !!uid,
    queryFn: async (): Promise<MyTeam[]> => {
      // 1. My memberships → team ids + my role on each.
      const { data: memberships, error: mErr } = await supabase
        .from("team_members")
        .select("team_id, role")
        .eq("profile_id", uid!);
      if (mErr) throw mErr;
      const teamIds = (memberships ?? []).map((m) => m.team_id as string);
      if (teamIds.length === 0) return [];
      const roleByTeam = new Map((memberships ?? []).map((m) => [m.team_id as string, m.role as string]));

      // 2. Team records (RLS: I can read teams I'm a member of).
      const { data: teams, error: tErr } = await supabase
        .from("teams")
        .select("id, name, logo_url, is_regular")
        .in("id", teamIds)
        .eq("archived", false);
      if (tErr) throw tErr;

      // 3. Member counts across my teams (one query, tallied client-side).
      const { data: allMembers } = await supabase
        .from("team_members")
        .select("team_id")
        .in("team_id", teamIds);
      const memberCount = new Map<string, number>();
      for (const row of allMembers ?? []) {
        memberCount.set(row.team_id as string, (memberCount.get(row.team_id as string) ?? 0) + 1);
      }

      // 4. Last-played date per team (max game_date via game_teams → games).
      const { data: appearances } = await supabase
        .from("game_teams")
        .select("team_id, game:games(game_date)")
        .in("team_id", teamIds);
      const lastPlayed = new Map<string, string>();
      // PostgREST types the to-one embed loosely; normalize to a single game date.
      for (const row of (appearances ?? []) as unknown as Array<{ team_id: string; game: { game_date: string } | { game_date: string }[] | null }>) {
        const g = Array.isArray(row.game) ? row.game[0] : row.game;
        const d = g?.game_date;
        if (!d) continue;
        const prev = lastPlayed.get(row.team_id);
        if (!prev || d > prev) lastPlayed.set(row.team_id, d);
      }

      // 5. Which of my teams are already on tonight's game.
      const checkedIn = new Set<string>();
      if (gameId) {
        const { data: gt } = await supabase
          .from("game_teams")
          .select("team_id")
          .eq("game_id", gameId)
          .in("team_id", teamIds);
        for (const row of gt ?? []) checkedIn.add(row.team_id as string);
      }

      // 6. Best-effort season rank teaser (active season only; never blocks).
      const rankByTeam = new Map<string, number>();
      let seasonName: string | null = null;
      try {
        const { data: season } = await supabase
          .from("seasons")
          .select("id, name")
          .eq("venue_id", VENUE_ID)
          .eq("status", "active")
          .maybeSingle();
        if (season?.id) {
          seasonName = season.name as string;
          const { data: board } = await supabase.rpc("season_leaderboard", { p_season_id: season.id });
          for (const row of (board ?? []) as Array<{ team_id: string; rank: number }>) {
            rankByTeam.set(row.team_id, row.rank);
          }
        }
      } catch {
        /* teaser is optional */
      }

      const result: MyTeam[] = (teams ?? []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        logo_url: (t.logo_url as string | null) ?? null,
        is_regular: t.is_regular as boolean,
        role: roleByTeam.get(t.id as string) ?? "member",
        members: memberCount.get(t.id as string) ?? 1,
        lastPlayed: lastPlayed.get(t.id as string) ?? null,
        alreadyCheckedIn: checkedIn.has(t.id as string),
        rank: rankByTeam.get(t.id as string) ?? null,
        seasonName,
      }));

      // Most-recently-played first; never-played teams sink to the bottom.
      result.sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""));
      return result;
    },
  });
}

// ── mutations / actions ───────────────────────────────────────────────────────

/** Send a 6-digit email OTP (creates the auth user + profile on first use). */
export async function sendEmailOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/** Verify the 6-digit code; on success the session persists (device remembers you). */
export async function verifyEmailOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  return data;
}

/** Check a team into tonight's game with an optional editable table name. */
export async function checkInTeam(gameId: string, teamId: string, displayName?: string) {
  const { data, error } = await supabase.rpc("check_in_team", {
    p_game_id: gameId,
    p_team_id: teamId,
    p_display_name: displayName ?? null,
  });
  if (error) throw error;
  return data as string; // game_teams id
}

/** Found a new team; caller becomes captain. Returns the new team id. */
export async function createTeam(name: string) {
  const { data, error } = await supabase.rpc("create_team_with_captain", {
    p_venue_id: VENUE_ID,
    p_name: name,
  });
  if (error) throw error;
  return data as string;
}

export interface TeamHit { id: string; name: string; is_regular: boolean; }

/** Search teams by name for the join flow (reads the safe teams_public view). */
export async function searchTeams(q: string): Promise<TeamHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from("teams_public")
    .select("id, name, is_regular")
    .eq("venue_id", VENUE_ID)
    .ilike("name", `%${term}%`)
    .order("name")
    .limit(12);
  if (error) throw error;
  return (data ?? []) as TeamHit[];
}

export type PinResult = "joined" | "invalid_pin" | "too_many_attempts" | "error";

/** Join a team by PIN via the rate-limited edge fn (bcrypt compare stays server-side). */
export async function joinByPin(teamId: string, pin: string): Promise<PinResult> {
  const { data, error } = await supabase.functions.invoke("verify-team-pin", {
    body: { team_id: teamId, pin },
  });
  if (error) {
    // The edge fn returns 429 with a body on rate-limit; supabase-js surfaces it as an error.
    const ctx = (error as { context?: Response }).context;
    if (ctx?.status === 429) return "too_many_attempts";
    return "error";
  }
  if (data?.joined === true) return "joined";
  if (data?.reason === "too_many_attempts") return "too_many_attempts";
  return "invalid_pin";
}

/** Ask an existing member to approve joining (portal approves — docs/07, Phase 4). */
export async function requestJoin(teamId: string) {
  const { error } = await supabase.rpc("request_team_join", { p_team_id: teamId });
  if (error) throw error;
}

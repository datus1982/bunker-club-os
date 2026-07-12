import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Game History — host tool (docs/01 route map, host+). A normal scrolling admin
 * page in the terminal theme (NOT a fixed display canvas).
 *
 * Ported from the legacy History.tsx. Kept to the READ-ONLY surface for this phase:
 * list past games and open any game's final board (reuses the ported Leaderboard via
 * ?game=<id>, which reads game_scoreboard). The legacy write actions — Load Game,
 * Duplicate, Delete — depend on Scoring/GameSetup (not yet ported) and are deferred
 * to the host-tools sub-phase.
 *
 * DECISION: our games table (docs/02) dropped legacy-only name / num_rounds /
 * elapsed_time_seconds; the card is keyed on game_date + derived round/team counts.
 * There is no 'archived' status in our schema.
 */

interface HistoryGame {
  id: string;
  game_date: string;
  status: string;
  is_playoff: boolean;
  season_id: string | null;
  created_at: string;
}

export function History() {
  const games = useQuery({
    queryKey: ["history", "games"],
    queryFn: async (): Promise<HistoryGame[]> => {
      const { data, error } = await supabase
        .from("games")
        .select("id, game_date, status, is_playoff, season_id, created_at")
        .eq("venue_id", VENUE_ID)
        .order("game_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HistoryGame[];
    },
  });

  // Team + round counts tallied from two light list reads (cheaper than N per-game
  // count queries, which is what the legacy did with Promise.all head:true counts).
  const teamCounts = useQuery({
    queryKey: ["history", "teamCounts"],
    queryFn: async () => tally("game_teams"),
  });
  const roundCounts = useQuery({
    queryKey: ["history", "roundCounts"],
    queryFn: async () => tally("rounds"),
  });

  const rows = games.data ?? [];

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: 40, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: 2 }}>GAME HISTORY</h1>
          <Link to="/dashboard" style={{ fontSize: 24, opacity: 0.8 }}>← DASHBOARD</Link>
        </div>
        <div className="terminal-separator" style={{ marginBottom: 24 }} />

        {games.isPending ? (
          <p style={{ fontSize: 28, opacity: 0.7 }}>LOADING GAMES…</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 28, opacity: 0.7 }}>NO GAMES YET.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {rows.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                teams={teamCounts.data?.[g.id] ?? null}
                rounds={roundCounts.data?.[g.id] ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GameCard({ game, teams, rounds }: { game: HistoryGame; teams: number | null; rounds: number | null }) {
  const active = game.status === "active";
  return (
    <div
      className="terminal-border"
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, boxShadow: active ? "0 0 16px var(--terminal-glow)" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{formatGameDate(game.game_date)}</div>
        <div style={{ fontSize: 22, opacity: 0.85 }}>[{game.status.toUpperCase()}]</div>
      </div>
      <div style={{ fontSize: 22, opacity: 0.8, display: "flex", flexWrap: "wrap", gap: 16 }}>
        <span>{rounds ?? "–"} ROUNDS</span>
        <span>{teams ?? "–"} TEAMS</span>
        {game.is_playoff && <span>★ PLAYOFF</span>}
      </div>
      <Link
        to={`/leaderboard?game=${game.id}`}
        className="terminal-border"
        style={{ marginTop: 6, padding: "8px 12px", textAlign: "center", fontSize: 24, textDecoration: "none" }}
      >
        VIEW BOARD →
      </Link>
    </div>
  );
}

/** Tally rows-per-game from a single list read of a game-scoped table. */
async function tally(table: "game_teams" | "rounds"): Promise<Record<string, number>> {
  const { data, error } = await supabase.from(table).select("game_id");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { game_id: string }[]) {
    counts[row.game_id] = (counts[row.game_id] ?? 0) + 1;
  }
  return counts;
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** 'YYYY-MM-DD' → 'YYYY-MM-DD · WED' (game_date is a plain date; parse as UTC). */
function formatGameDate(d: string): string {
  const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? "";
  return `${d} · ${wd}`;
}

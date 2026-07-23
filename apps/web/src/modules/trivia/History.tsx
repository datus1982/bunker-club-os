import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { useRole } from "@/shared/useRole";
import { GameRecap } from "./GameRecap";
import { Modal, btnGhost, btnDanger } from "./ui";

/**
 * Game History — host tool (docs/01 route map, host+). A normal scrolling admin
 * page in the terminal theme (NOT a fixed display canvas).
 *
 * Ported from the legacy History.tsx. List past games and open any game's GAME RECAP —
 * an in-app modal (GameRecap.tsx) with SUMMARY / QUESTIONS / VIDEOS tabs, so the host can
 * browse standings, click through the Q&A, and see the videos WITHOUT navigating away to a
 * display surface. This replaces the old "VIEW BOARD →" link; the recap's SUMMARY tab
 * renders the same game_scoreboard() standings as a read-only board, subsuming it.
 *
 * DELETE (2026-07-21): the old system loaded historical games into an active state, leaving
 * junk/test rows in history with no way to remove them. Each card gets a secondary, hard-to-
 * misfire ✕ DELETE that opens a destructive confirm (game details + irreversible warning),
 * then calls delete_game(uuid) (migration 0058, SECURITY DEFINER, has_module('trivia')
 * gated) which hard-deletes the game and cascades every child (rounds/questions/scores/
 * game_teams/game_display_state). The control is trivia-module-gated in the UI; the RPC
 * enforces the same server-side regardless.
 *
 * WORK GUARD (2026-07-22, migration 0059): a game that still holds work can no longer be
 * deleted — the RPC allows it only when status = 'completed' OR the game is provably empty
 * (zero questions, zero scores, zero game_teams AND no round carrying an attached
 * video_url / picture_url). This mirrors that condition in the UI so DELETE is never
 * offered for a game the server would refuse; the reason shows inline on the card.
 * The EXISTENCE of rounds is excluded on both sides (GameSetup seeds them at creation, so
 * counting rows would make every new game undeletable) — but a round video or picture-round
 * image is real host work (the prep order is create → attach videos → import the deck), so
 * those two columns count. round_name is deliberately not counted; see 0059's header.
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
  const qc = useQueryClient();
  const { can } = useRole();
  const canDelete = can("trivia");
  const [recapGame, setRecapGame] = useState<HistoryGame | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HistoryGame | null>(null);
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

  // Guard mirror (0059): only a non-completed game can be blocked, so the work reads are
  // scoped to those ids — normally one or two rows, which also keeps the result well
  // under PostgREST's row cap (a truncated read would misreport a game as empty).
  const openIds = rows.filter((g) => g.status !== "completed").map((g) => g.id);
  const openKey = openIds.join(",");
  const hasWork = useQuery({
    queryKey: ["history", "hasWork", openKey],
    enabled: openIds.length > 0,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const flags: Record<string, boolean> = {};
      for (const table of ["questions", "scores", "game_teams"] as const) {
        const { data, error } = await supabase.from(table).select("game_id").in("game_id", openIds);
        if (error) throw error;
        for (const row of (data ?? []) as { game_id: string }[]) flags[row.game_id] = true;
      }
      // Rounds count only when they carry attached work — an inter-round video or a
      // picture-round image. Column-aware, so the seeded-at-creation rows stay invisible.
      const { data: workRounds, error: roundsError } = await supabase
        .from("rounds")
        .select("game_id")
        .in("game_id", openIds)
        .or("video_url.not.is.null,picture_url.not.is.null");
      if (roundsError) throw roundsError;
      for (const row of (workRounds ?? []) as { game_id: string }[]) flags[row.game_id] = true;
      return flags;
    },
  });

  const del = useMutation({
    mutationFn: async (gameId: string) => {
      const { error } = await supabase.rpc("delete_game", { p_game_id: gameId });
      if (error) throw error;
    },
    onSuccess: () => {
      // The game + its rows are gone; refresh the list and both count reads.
      qc.invalidateQueries({ queryKey: ["history"] });
      setPendingDelete(null);
    },
  });

  const workReady = openIds.length === 0 || hasWork.isSuccess;
  /** null ⇒ delete_game will accept this game; otherwise the terse reason it won't. */
  const deleteBlock = (g: HistoryGame): string | null => {
    if (g.status === "completed") return null;
    if (hasWork.isError) return "CAN'T CHECK — RELOAD";
    if (!workReady) return "CHECKING…";
    return hasWork.data?.[g.id] ? "END GAME TO DELETE" : null;
  };

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 40px)", fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: "clamp(28px, 7vw, 48px)", fontWeight: 700, letterSpacing: 2 }}>GAME HISTORY</h1>
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
                canDelete={canDelete}
                deleteBlocked={deleteBlock(g)}
                onOpen={() => setRecapGame(g)}
                onDelete={() => setPendingDelete(g)}
              />
            ))}
          </div>
        )}
      </div>

      {recapGame && <GameRecap game={recapGame} onClose={() => setRecapGame(null)} />}

      {pendingDelete && (
        <DeleteConfirm
          game={pendingDelete}
          teams={teamCounts.data?.[pendingDelete.id] ?? null}
          rounds={roundCounts.data?.[pendingDelete.id] ?? null}
          pending={del.isPending}
          // The server's own message (e.g. the 0059 work guard) — never a generic failure.
          error={del.isError ? (del.error as { message?: string })?.message ?? "UNKNOWN ERROR" : null}
          onCancel={() => {
            del.reset();
            setPendingDelete(null);
          }}
          onConfirm={() => del.mutate(pendingDelete.id)}
        />
      )}
    </div>
  );
}

function GameCard({
  game,
  teams,
  rounds,
  canDelete,
  deleteBlocked,
  onOpen,
  onDelete,
}: {
  game: HistoryGame;
  teams: number | null;
  rounds: number | null;
  canDelete: boolean;
  deleteBlocked: string | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
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
      <div style={{ display: "flex", alignItems: "stretch", gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={onOpen}
          className="terminal-border"
          style={{ flex: "1 1 auto", padding: "8px 12px", textAlign: "center", fontSize: 24, background: "transparent", cursor: "pointer", fontFamily: "inherit" }}
        >
          VIEW RECAP →
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={!!deleteBlocked}
            aria-label={`Delete game ${game.game_date}`}
            title={deleteBlocked ?? "Delete this game"}
            style={{
              ...btnDanger,
              flex: "0 0 auto",
              padding: "8px 14px",
              minHeight: 0,
              fontSize: 22,
              fontFamily: "inherit",
              opacity: deleteBlocked ? 0.35 : undefined,
              cursor: deleteBlocked ? "not-allowed" : "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>
      {/* Why DELETE is unavailable — the same condition the RPC enforces (0059). */}
      {canDelete && deleteBlocked && (
        <div style={{ fontSize: 20, opacity: 0.7, letterSpacing: 1 }}>{deleteBlocked}</div>
      )}
    </div>
  );
}

function DeleteConfirm({
  game,
  teams,
  rounds,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  game: HistoryGame;
  teams: number | null;
  rounds: number | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="DELETE GAME"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} style={{ ...btnGhost, fontFamily: "inherit" }} disabled={pending}>
            CANCEL
          </button>
          <button type="button" onClick={onConfirm} style={{ ...btnDanger, fontFamily: "inherit" }} disabled={pending}>
            {pending ? "DELETING…" : "DELETE"}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>{formatGameDate(game.game_date)}</div>
      <div style={{ fontSize: 22, opacity: 0.8, display: "flex", flexWrap: "wrap", gap: 16 }}>
        <span>[{game.status.toUpperCase()}]</span>
        <span>{rounds ?? "–"} ROUNDS</span>
        <span>{teams ?? "–"} TEAMS</span>
        {game.is_playoff && <span>★ PLAYOFF</span>}
      </div>
      <p style={{ fontSize: 22, lineHeight: 1.4, color: "var(--terminal-amber, #ffb000)" }}>
        This permanently deletes the game and all its rounds, scores, and questions. This can't be
        undone.
      </p>
      {error && (
        <p style={{ fontSize: 20, color: "var(--terminal-amber, #ffb000)", opacity: 0.9 }}>
          DELETE FAILED: {error}
        </p>
      )}
    </Modal>
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

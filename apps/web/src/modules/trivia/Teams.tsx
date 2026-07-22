import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { TeamEditorDialog, type EditableTeam } from "./TeamEditorDialog";
import { Modal, input, btnGhost, btnPrimary, btnActive, btnDanger } from "./ui";

/**
 * Team roster — host tool (docs/01 /teams, host+). Manages the venue's teams using the
 * SAME TeamEditorDialog the Scoring console uses (docs/04 ARCH-2 — no duplicated
 * team-edit UI).
 *
 * VIEWS (owner ask 2026-07-22): the page used to hard-filter `is_regular = true AND
 * archived = false`, so a walk-up team created inside a game (or anything archived at the
 * board clear) was unreachable from every surface in the app. Three views now share one
 * fetch: REGULARS (the default — opens exactly as before), ONE-OFFS (walk-ups still on
 * the board), ARCHIVED (everything hidden, with the inverse UN-ARCHIVE action).
 *
 * PRUNING: archive is the prune mechanism and it is reversible — nothing here deletes a
 * team. To judge whether a row is junk each card carries GAMES PLAYED / LAST PLAYED,
 * aggregated from ONE paginated game_teams+games read (never per-row queries), plus a
 * loud NEVER PLAYED chip for teams that were created and never checked into a game.
 *
 * DECISIONS: no contact/PIN columns in our schema (SEC-1 — Registration v2 owns player
 * data), so cards show name + logo + play stats only. "Archive" sets teams.archived
 * rather than hard-deleting, because scores/game_teams reference the row (legacy
 * hard-deleted; ours preserves history and satisfies the FKs). Hard delete stays out of
 * scope deliberately.
 */

interface RosterTeam {
  id: string;
  name: string;
  is_regular: boolean;
  logo_url: string | null;
  archived: boolean;
  created_at: string;
}

interface PlayStat {
  games: number;
  /** ISO date (YYYY-MM-DD) of the most recent game the team was in, or null. */
  last: string | null;
}

type View = "regulars" | "oneoffs" | "archived";

const VIEWS: { key: View; label: string }[] = [
  { key: "regulars", label: "REGULARS" },
  { key: "oneoffs", label: "ONE-OFFS" },
  { key: "archived", label: "ARCHIVED" },
];

const BLURB: Record<View, string> = {
  regulars: "Regular teams kept across weeks. Walk-ups are added inside a game.",
  oneoffs: "Walk-up teams still on the board. Tick REGULAR in the editor to keep one across weeks.",
  archived: "Hidden from every board and check-in surface. Un-archive to bring one back — history was never deleted.",
};

const PAGE = 1000;

/**
 * PostgREST caps a select at 1000 rows and truncates SILENTLY (the PR #38 mis-ranked
 * champion came from exactly that). Every table read on this page pages explicitly so a
 * busy season can never quietly hide teams or under-count games played.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** "2026-07-08" → "JUL 8, 2026" without constructing a Date (no TZ shift on date-only values). */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function fmtGameDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// DECISION: "ADDED" renders in the viewer's browser timezone, not the venue timezone. It's
// an at-a-glance pruning hint (is this row from tonight?), never a scoring input, and the
// venue is US-Central like every staff device — not worth a venue-TZ round trip here.
function fmtCreated(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : `${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}`;
}

export function Teams() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("regulars");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditableTeam | null>(null);
  const [archiving, setArchiving] = useState<RosterTeam | null>(null);
  const [restoring, setRestoring] = useState<RosterTeam | null>(null);

  // One fetch feeds all three views, so switching is instant and the tab counts are real.
  const teams = useQuery({
    queryKey: ["teams", "roster"],
    queryFn: (): Promise<RosterTeam[]> =>
      fetchAllPages<RosterTeam>((from, to) =>
        supabase
          .from("teams")
          .select("id, name, is_regular, logo_url, archived, created_at")
          .eq("venue_id", VENUE_ID)
          .order("name")
          .range(from, to),
      ),
  });

  // Play stats for EVERY team in one pass: game_teams rows with their game's date embedded.
  // Aggregated in memory into a Map — no per-row (N+1) query, and no new migration/RPC.
  const stats = useQuery({
    queryKey: ["teams", "playStats"],
    queryFn: async (): Promise<Record<string, PlayStat>> => {
      type GameRef = { game_date: string | null } | { game_date: string | null }[] | null;
      const rows = await fetchAllPages<{ team_id: string; games: GameRef }>((from, to) =>
        supabase
          .from("game_teams")
          .select("team_id, games(game_date)")
          .order("id")
          .range(from, to),
      );
      const map: Record<string, PlayStat> = {};
      for (const r of rows) {
        const cur = (map[r.team_id] ??= { games: 0, last: null });
        cur.games += 1;
        // PostgREST returns a to-one embed as an object; tolerate the array shape too.
        const g = Array.isArray(r.games) ? r.games[0] : r.games;
        const d = g?.game_date ?? null;
        if (d && (cur.last === null || d > cur.last)) cur.last = d;
      }
      return map;
    },
  });

  const setArchived = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from("teams").update({ archived }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams", "roster"] });
      setArchiving(null);
      setRestoring(null);
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["teams", "roster"] });

  const all = useMemo(() => teams.data ?? [], [teams.data]);
  const counts = useMemo(
    () => ({
      regulars: all.filter((t) => t.is_regular && !t.archived).length,
      oneoffs: all.filter((t) => !t.is_regular && !t.archived).length,
      archived: all.filter((t) => t.archived).length,
    }),
    [all],
  );

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return all.filter((t) => {
      const inView =
        view === "archived" ? t.archived : !t.archived && (view === "regulars" ? t.is_regular : !t.is_regular);
      return inView && (q === "" || t.name.toLowerCase().includes(q));
    });
  }, [all, view, filter]);

  const empty: Record<View, string> = {
    regulars: "NO REGULAR TEAMS YET.",
    oneoffs: "NO ONE-OFF TEAMS ON THE BOARD.",
    archived: "NOTHING ARCHIVED.",
  };

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 40px)", fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: "clamp(28px, 7vw, 48px)", fontWeight: 700, letterSpacing: 2 }}>TEAM ROSTER</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button type="button" onClick={() => setAdding(true)} style={btnPrimary}>+ ADD TEAM</button>
            <Link to="/dashboard" style={{ fontSize: 24, opacity: 0.8 }}>← DASHBOARD</Link>
          </div>
        </div>
        <div style={{ fontSize: 20, opacity: 0.6, marginBottom: 16 }}>{BLURB[view]}</div>

        {/* View filter — wraps to one button per line at 390px; counts come from the shared fetch. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
              // The theme forces `background: transparent !important` on buttons, so
              // btnActive's inline fill is flattened; `u-fill u-ink` (0,2,0) is the
              // codebase's documented way to get the black-on-green selected state.
              className={view === v.key ? "u-fill u-ink" : undefined}
              style={{ ...(view === v.key ? btnActive : btnGhost), padding: "8px 14px", fontSize: 18 }}
            >
              {v.label} · {teams.isPending ? "…" : counts[v.key]}
            </button>
          ))}
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="FILTER BY NAME…"
          aria-label="Filter teams by name"
          style={{ ...input, width: "100%", minHeight: 44, marginBottom: 16 }}
        />

        <div className="terminal-separator" style={{ marginBottom: 24 }} />

        {teams.isPending ? (
          <p style={{ fontSize: 28, opacity: 0.7 }}>LOADING TEAMS…</p>
        ) : teams.isError ? (
          <p className="u-amber" style={{ fontSize: 24 }}>⚠ COULD NOT LOAD TEAMS.</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 28, opacity: 0.7 }}>{filter.trim() ? "NO TEAMS MATCH THAT FILTER." : empty[view]}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {rows.map((t) => {
              const s = stats.data?.[t.id];
              const played = s?.games ?? 0;
              return (
                <div key={t.id} className="terminal-border" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {t.logo_url ? (
                      <img src={t.logo_url} alt="" style={{ width: 48, height: 48, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />
                    ) : (
                      <div style={{ width: 48, height: 48, border: "1px solid var(--terminal-green)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>★</div>
                    )}
                    <div style={{ fontSize: 28, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>{t.name}</div>
                  </div>

                  {/* Pruning evidence: how much has this team actually shown up? */}
                  <div style={{ fontSize: 19, opacity: 0.75, display: "flex", flexDirection: "column", gap: 2 }}>
                    {stats.isPending ? (
                      <span>PLAY HISTORY…</span>
                    ) : played === 0 ? (
                      <span className="u-amber" style={{ fontWeight: 700, opacity: 1 }}>NEVER PLAYED</span>
                    ) : (
                      <span>
                        {played} GAME{played === 1 ? "" : "S"}
                        {s?.last ? ` · LAST ${fmtGameDate(s.last)}` : ""}
                      </span>
                    )}
                    <span style={{ opacity: 0.7 }}>
                      ADDED {fmtCreated(t.created_at)}
                      {t.is_regular ? " · REGULAR" : " · ONE-OFF"}
                      {t.archived ? " · ARCHIVED" : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => setEditing(t)} style={{ ...btnGhost, flex: 1, minWidth: 120 }}>✎ EDIT</button>
                    {t.archived ? (
                      <button type="button" onClick={() => setRestoring(t)} style={btnGhost}>UN-ARCHIVE</button>
                    ) : (
                      <button type="button" onClick={() => setArchiving(t)} style={btnDanger}>ARCHIVE</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {adding && <TeamEditorDialog mode="add" onClose={() => setAdding(false)} onSaved={() => { refresh(); setAdding(false); }} />}
      {editing && <TeamEditorDialog mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />}

      {archiving && (
        <Modal
          title="ARCHIVE TEAM"
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button type="button" onClick={() => setArchiving(null)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={() => setArchived.mutate({ id: archiving.id, archived: true })} style={btnDanger}>ARCHIVE</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>Archive <strong>{archiving.name}</strong>? They'll be hidden from the roster but their game history is preserved. You can un-archive them from the ARCHIVED view.</p>
        </Modal>
      )}

      {restoring && (
        <Modal
          title="UN-ARCHIVE TEAM"
          onClose={() => setRestoring(null)}
          footer={
            <>
              <button type="button" onClick={() => setRestoring(null)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={() => setArchived.mutate({ id: restoring.id, archived: false })} style={btnPrimary}>UN-ARCHIVE</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>
            Bring <strong>{restoring.name}</strong> back? They'll be visible to hosts and on check-in again
            {restoring.is_regular ? " in the REGULARS view." : " in the ONE-OFFS view."}
          </p>
        </Modal>
      )}
    </div>
  );
}

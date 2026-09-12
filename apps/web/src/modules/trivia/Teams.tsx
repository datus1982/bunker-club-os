import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { ConfirmDialog, StaffPageHeader } from "@/shared/ui";
import { TeamEditorDialog, type EditableTeam } from "./TeamEditorDialog";
import { cx, useTriviaV2 } from "./triviaV2";
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
const MAX_PAGES = 50;

/**
 * PostgREST caps a select at 1000 rows and truncates SILENTLY (the PR #38 mis-ranked
 * champion came from exactly that). Every table read on this page pages explicitly so a
 * busy season can never quietly hide teams or under-count games played.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  // Exhausting the cap means the read IS truncated — the same silent truncation this
  // helper exists to prevent. Fail loudly rather than hand back a partial roster.
  throw new Error(`fetchAllPages: hit the ${MAX_PAGES}-page cap at ${out.length} rows — result would be truncated`);
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
  const v2 = useTriviaV2();
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
    <div
      {...(v2 ? { "data-st-page": "" } : { className: "terminal-theme" })}
      style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 40px)", ...(v2 ? null : { fontFamily: "'VT323','Share Tech Mono',monospace" }) }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {v2 ? (
          <StaffPageHeader
            eyebrow="GAMES ▸ TRIVIA ▸ TEAMS"
            title="Team roster"
            right={
              <>
                <button type="button" onClick={() => setAdding(true)} className="st-btn-primary st-body" style={{ ...btnPrimary, minHeight: 44 }}>+ Add team</button>
                <Link to="/dashboard" className="st-body st-t2" style={{ textDecoration: "none" }}>← Dashboard</Link>
              </>
            }
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: "clamp(28px, 7vw, 48px)", fontWeight: 700, letterSpacing: 2 }}>TEAM ROSTER</h1>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button type="button" onClick={() => setAdding(true)} style={btnPrimary}>+ ADD TEAM</button>
              <Link to="/dashboard" style={{ fontSize: 24, opacity: 0.8 }}>← DASHBOARD</Link>
            </div>
          </div>
        )}
        <div className={cx(v2 && "st-body st-t2")} style={{ fontSize: 20, opacity: v2 ? 1 : 0.6, marginBottom: 16 }}>{BLURB[view]}</div>

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
              className={cx(view === v.key && (v2 ? "st-btn-primary" : "u-fill u-ink"), v2 && "st-body")}
              style={{ ...(view === v.key ? btnActive : btnGhost), padding: "8px 14px", fontSize: 18, ...(v2 ? { minHeight: 44 } : null) }}
            >
              {v.label} · {teams.isPending ? "…" : counts[v.key]}
            </button>
          ))}
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={v2 ? "Filter by name…" : "FILTER BY NAME…"}
          aria-label="Filter teams by name"
          className={cx(v2 && "st-body")}
          style={{ ...input, width: "100%", minHeight: 44, marginBottom: 16 }}
        />

        <div className="terminal-separator" style={{ marginBottom: 24 }} />

        {teams.isPending ? (
          <p className={cx(v2 && "st-body st-t2")} style={{ fontSize: 28, opacity: v2 ? 1 : 0.7 }}>{v2 ? "Loading teams…" : "LOADING TEAMS…"}</p>
        ) : teams.isError ? (
          <p className={cx("u-amber", v2 && "st-body")} style={{ fontSize: 24 }}>{v2 ? "⚠ Could not load teams." : "⚠ COULD NOT LOAD TEAMS."}</p>
        ) : rows.length === 0 ? (
          <p className={cx(v2 && "st-body st-t2")} style={{ fontSize: 28, opacity: v2 ? 1 : 0.7 }}>{filter.trim() ? (v2 ? "No teams match that filter." : "NO TEAMS MATCH THAT FILTER.") : empty[view]}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {rows.map((t) => {
              const s = stats.data?.[t.id];
              const played = s?.games ?? 0;
              return (
                <div key={t.id} className={cx("terminal-border", v2 && "st-card")} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {t.logo_url ? (
                      <img src={t.logo_url} alt="" style={{ width: 48, height: 48, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />
                    ) : (
                      <div className={cx(v2 && "st-t3")} style={{ width: 48, height: 48, border: "1px solid var(--terminal-green)", display: "flex", alignItems: "center", justifyContent: "center", opacity: v2 ? 1 : 0.5 }}>★</div>
                    )}
                    <div className={cx(v2 && "st-heading st-t1")} style={{ fontSize: 28, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>{t.name}</div>
                  </div>

                  {/* Pruning evidence: how much has this team actually shown up? */}
                  {/* Every span below carries its own `st-body`: a class on this wrapper
                      sets only the wrapper's size, because `.terminal-theme *` sizes every
                      element and inheritance never beats a class rule (PR #89). */}
                  <div className={cx(v2 && "st-body st-t2")} style={{ fontSize: 19, opacity: v2 ? 1 : 0.75, display: "flex", flexDirection: "column", gap: 2 }}>
                    {stats.isPending ? (
                      <span className={cx(v2 && "st-body st-t2")}>{v2 ? "Play history…" : "PLAY HISTORY…"}</span>
                    ) : stats.isError ? (
                      // A failed stats read must never read as a verdict: without this every
                      // card falls through to played === 0 and wears the loud NEVER PLAYED
                      // chip — the exact signal that invites archiving, false for the whole
                      // roster. Neutral, dimmed, clearly not an answer.
                      <span className={cx(v2 && "st-body st-t3")} style={{ opacity: v2 ? 1 : 0.7 }}>{v2 ? "Play history unavailable" : "PLAY HISTORY UNAVAILABLE"}</span>
                    ) : played === 0 ? (
                      <span className={cx("u-amber", v2 && "st-chip st-label")} style={{ fontWeight: 700, opacity: 1, ...(v2 ? { alignSelf: "flex-start", padding: "3px 10px" } : null) }}>NEVER PLAYED</span>
                    ) : (
                      // Each look gets its own complete child list rather than one list
                      // with `{v2 ? …}` spliced into the middle of a sentence: identical
                      // text split across a different number of text nodes measures a
                      // fraction of a pixel differently, and classic must not move.
                      <span className={cx(v2 && "st-body st-t2")}>
                        {v2 ? (
                          <>
                            {played} {played === 1 ? "game" : "games"}
                            {s?.last ? ` · last ${fmtGameDate(s.last)}` : ""}
                          </>
                        ) : (
                          <>
                            {played} GAME{played === 1 ? "" : "S"}
                            {s?.last ? ` · LAST ${fmtGameDate(s.last)}` : ""}
                          </>
                        )}
                      </span>
                    )}
                    <span className={cx(v2 && "st-body st-t3")} style={{ opacity: v2 ? 1 : 0.7 }}>
                      {v2 ? (
                        <>
                          Added {fmtCreated(t.created_at)}
                          {t.is_regular ? " · regular" : " · one-off"}
                          {t.archived ? " · archived" : ""}
                        </>
                      ) : (
                        <>
                          ADDED {fmtCreated(t.created_at)}
                          {t.is_regular ? " · REGULAR" : " · ONE-OFF"}
                          {t.archived ? " · ARCHIVED" : ""}
                        </>
                      )}
                    </span>
                  </div>

                  {/* ARCHIVE is the destructive control on this card, so in v2 it gets its
                      own row under a hairline — the D1 pattern already shipped for Users
                      ("Remove access") — instead of sitting shoulder to shoulder with EDIT. */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", ...(v2 ? { flexDirection: "column", alignItems: "stretch" } : null) }}>
                    <button type="button" onClick={() => setEditing(t)} className={cx(v2 && "st-body")} style={{ ...btnGhost, flex: 1, minWidth: 120, ...(v2 ? { minHeight: 44 } : null) }}>{v2 ? "✎ Edit" : "✎ EDIT"}</button>
                    {t.archived ? (
                      <button type="button" onClick={() => setRestoring(t)} className={cx(v2 && "st-body")} style={{ ...btnGhost, ...(v2 ? { minHeight: 44 } : null) }}>{v2 ? "Un-archive" : "UN-ARCHIVE"}</button>
                    ) : v2 ? (
                      // The hairline strip that sets the destructive control apart exists in
                      // v2 ONLY. An unconditional wrapper here would add a <div> to the
                      // classic DOM — caught by the byte-identity gate, which is what it is
                      // for. Classic renders the bare button exactly as it always has.
                      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, display: "flex" }}>
                        <button type="button" onClick={() => setArchiving(t)} className="st-btn-danger st-body" style={{ ...btnDanger, minHeight: 44, flex: 1 }}>Archive team</button>
                      </div>
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

      {/* v2 routes both confirms through the shared ConfirmDialog — verb-named buttons,
          CANCEL focused on mount, red spent only on the destructive half (D1). Classic
          keeps its own Modal confirms untouched. */}
      {archiving && v2 && (
        <ConfirmDialog
          danger
          busy={setArchived.isPending}
          title={`Archive ${archiving.name}?`}
          confirmLabel="Archive team"
          cancelLabel="Keep team"
          onCancel={() => setArchiving(null)}
          onConfirm={() => setArchived.mutate({ id: archiving.id, archived: true })}
          body="They'll be hidden from the roster, from every board and from check-in. Their game history is preserved, and you can un-archive them from the ARCHIVED view."
        />
      )}

      {restoring && v2 && (
        <ConfirmDialog
          busy={setArchived.isPending}
          title={`Bring ${restoring.name} back?`}
          confirmLabel="Un-archive team"
          cancelLabel="Leave archived"
          onCancel={() => setRestoring(null)}
          onConfirm={() => setArchived.mutate({ id: restoring.id, archived: false })}
          body={`They'll be visible to hosts and on check-in again${restoring.is_regular ? ", in the REGULARS view." : ", in the ONE-OFFS view."}`}
        />
      )}

      {archiving && !v2 && (
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

      {restoring && !v2 && (
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

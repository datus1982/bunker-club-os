import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useToastCache } from "./useSignageAdmin";
import { useEventsList, schedulePhrase, statusInfo, pauseEvent, resumeEvent, type EventRow } from "./useEventsAdmin";
import { EventKindBadge } from "./signageAdminShared";
import { EventEditor } from "./EventEditor";
import type { EventKind } from "./useSignage";
import "./signage.css";

/**
 * /signage/events — EVENTS & PROMOS (docs/13 · ux-refinement-mockup.html view 5).
 * First-class scheduled objects (WINDOW / MESSAGE / MOMENT) a manager schedules in minutes.
 * Two panes (split desktop, stacked mobile): LIST of every event + an inline EDITOR.
 *
 * Gated RequireModule('events') in App.tsx. Mobile-first — the owner runs this from his
 * phone at the bar. Reads ?new / ?new=message to open a fresh draft (hub quick action).
 */

const MONO = "'VT323','Share Tech Mono',monospace";

/** Post-event lift readout written by toast-sync (eventCounter.ts FinalStats). */
interface FinalStats {
  units: number;
  window_minutes: number;
  vs_avg_pct: number | null;
  computed_at: string;
}

/**
 * Format the post-run readout. toast-sync writes an OBJECT (not a string), so the old
 * `typeof === "string"` guard never rendered. Returns null when stats are absent/malformed.
 * "{units} sold" always; " · +N% vs avg night" only when vs_avg_pct is non-null.
 */
function finalStatsReadout(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const fs = raw as Partial<FinalStats>;
  if (typeof fs.units !== "number") return null;
  let out = `${fs.units} sold`;
  if (typeof fs.vs_avg_pct === "number") {
    out += ` · ${fs.vs_avg_pct > 0 ? "+" : ""}${fs.vs_avg_pct}% vs avg night`;
  }
  return out;
}

export function EventsAdmin() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const eventsQ = useEventsList();
  const toastQ = useToastCache();
  const toastRows = toastQ.data ?? [];
  const events = eventsQ.data ?? [];

  // Editor state: null = closed; { editing:null } = new draft; { editing:row } = edit.
  const newParam = params.get("new");
  const [editorFor, setEditorFor] = useState<{ editing: EventRow | null; presetKind?: EventKind } | undefined>(
    newParam != null
      ? { editing: null, presetKind: newParam === "message" || newParam === "moment" || newParam === "window" ? (newParam as EventKind) : "window" }
      : undefined,
  );

  const clearNewParam = () => {
    if (params.has("new")) { params.delete("new"); setParams(params, { replace: true }); }
  };
  const openNew = (presetKind?: EventKind) => { setEditorFor({ editing: null, presetKind }); };
  const openEdit = (row: EventRow) => { setEditorFor({ editing: row }); clearNewParam(); };
  const closeEditor = () => { setEditorFor(undefined); clearNewParam(); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ["events-admin", "list"] });

  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BAR OPS ▸ EVENTS &amp; PROMOS</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: "clamp(26px,6vw,40px)", fontWeight: 700, letterSpacing: 2 }}>EVENTS &amp; PROMOS</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <Link to="/signage" style={{ ...ghost, textDecoration: "none", fontSize: 15 }}>← SIGNAGE HUB</Link>
            <button type="button" onClick={() => openNew()} className="u-fill u-ink" style={primary}>+ NEW</button>
          </div>
        </div>
        <div style={{ fontSize: 14, opacity: 0.55, letterSpacing: 1, marginTop: 2 }}>
          First-class scheduled objects — schedule once, they run themselves. Recurrence re-arms server-side.
        </div>
        <div className="terminal-separator" style={{ margin: "14px 0 18px" }} />

        <div className="events-split">
          {/* LIST */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {eventsQ.isLoading ? (
              <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING…</div>
            ) : events.length === 0 ? (
              <div className="terminal-border" style={{ padding: "20px 16px", opacity: 0.8, fontSize: 17, lineHeight: 1.5, textAlign: "center" }}>
                NOTHING SCHEDULED YET.<br />
                <button type="button" onClick={() => openNew()} className="u-fill u-ink" style={{ ...primary, marginTop: 12 }}>+ NEW EVENT</button>
              </div>
            ) : (
              events.map((ev) => (
                <EventListRow key={ev.id} row={ev} selected={editorFor?.editing?.id === ev.id} onEdit={() => openEdit(ev)} onChanged={invalidate} />
              ))
            )}
          </div>

          {/* EDITOR */}
          <div style={{ minWidth: 0 }}>
            {editorFor ? (
              <EventEditor
                key={editorFor.editing?.id ?? `new-${editorFor.presetKind ?? "window"}`}
                editing={editorFor.editing}
                presetKind={editorFor.presetKind}
                toastRows={toastRows}
                onSaved={() => { invalidate(); closeEditor(); }}
                onCancel={closeEditor}
                onDeleted={() => { invalidate(); closeEditor(); }}
              />
            ) : (
              <div className="terminal-border" style={{ padding: "22px 18px", opacity: 0.55, fontSize: 16, lineHeight: 1.5, textAlign: "center" }}>
                Pick an event to edit, or <button type="button" onClick={() => openNew()} style={{ ...linkBtn }}>+ NEW</button> to schedule one.
              </div>
            )}
          </div>
        </div>

        <div className="terminal-separator" style={{ margin: "22px 0 12px" }} />
        <div style={{ fontSize: 14, opacity: 0.55, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6 }}>
          <div><b style={{ opacity: 0.8 }}>WINDOW</b> — a calm card + ticker line that quietly joins the rotation during the window, then vanishes. Never takes over a game.</div>
          <div><b style={{ opacity: 0.8 }}>MESSAGE</b> — a one-time bulletin styled card (birthday, shout-out). Same calm rotation path as WINDOW.</div>
          <div><b style={{ opacity: 0.8 }}>MOMENT</b> — the full choreography: tease → alert → payoff → live counter → all-clear. Fires the stage engine.</div>
        </div>
      </div>
    </div>
  );
}

/* ── list row ────────────────────────────────────────────────────────────── */
function EventListRow({ row, selected, onEdit, onChanged }: { row: EventRow; selected: boolean; onEdit: () => void; onChanged: () => void }) {
  const phrase = useMemo(() => schedulePhrase(row), [row]);
  const st = statusInfo(row);
  const finalStats = finalStatsReadout(row.fields?.final_stats);
  const done = row.status === "completed" || row.status === "aborted";
  const paused = row.status === "disabled";
  // Pause/resume applies to a live/scheduled promo. Completed/aborted rows are terminal —
  // no toggle (edit re-schedules them instead).
  const canToggle = !done;

  const toggle = useMutation({ mutationFn: () => (paused ? resumeEvent(row) : pauseEvent(row.id)), onSuccess: onChanged });

  return (
    <div
      className="terminal-border"
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        fontFamily: MONO, color: "var(--terminal-green)",
        background: selected ? "rgba(0,255,65,0.08)" : "transparent",
        borderColor: selected ? "var(--terminal-green)" : undefined,
        opacity: done ? 0.72 : 1, flexWrap: "wrap",
      }}
    >
      <button type="button" onClick={onEdit} style={{ flex: "1 1 180px", minWidth: 0, textAlign: "left", background: "transparent", border: "none", color: "inherit", fontFamily: MONO, cursor: "pointer", padding: 0 }}>
        <div style={{ fontSize: 21, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{phrase}</div>
        {done && finalStats && <div className="u-amber" style={{ fontSize: 12, letterSpacing: 1, marginTop: 3 }}>LAST RUN: {finalStats}</div>}
      </button>
      <EventKindBadge kind={row.kind} />
      <span className={st.tone === "one" ? "u-amber" : undefined} style={{ fontSize: 13, whiteSpace: "nowrap", letterSpacing: 1, opacity: st.tone === "up" || st.tone === "done" ? 0.7 : 1 }}>{st.label}</span>
      {canToggle && (
        <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending}
          className={paused ? "" : "u-fill u-ink"}
          title={paused ? "Resume — put it back on the schedule" : "Pause — take it off every screen"}
          style={{ ...toggleBtn, ...(paused ? null : { fontWeight: 700 }) }}>
          {paused ? "▶ RESUME" : "❚❚ PAUSE"}
        </button>
      )}
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */
const primary: CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "8px 16px", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: MONO, minHeight: 44, letterSpacing: 1 };
const ghost: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 12px", fontSize: 15, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const linkBtn: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "none", borderBottom: "1px solid var(--terminal-green)", padding: 0, fontSize: 16, cursor: "pointer", fontFamily: MONO };
const toggleBtn: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "6px 10px", fontSize: 13, letterSpacing: 1, cursor: "pointer", fontFamily: MONO, minHeight: 44, whiteSpace: "nowrap" };

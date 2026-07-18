import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SlideOver } from "./SlideOver";
import { MONO } from "./signageAdminShared";
import {
  useSlotScheduleAdmin, createScheduleRow, deleteScheduleRow, useMediaPlaylists,
  type ScheduleRowRaw,
} from "./useMediaAdmin";
import {
  rowCovers, venueLocalParts, minuteLabel, schedulePhrase,
  type ScheduleProgram,
} from "./scheduleResolve";
import type { AdminSlot } from "./useSignageAdmin";

/**
 * SCHEDULE builder (docs/15 M3 — D3/D4) — a slot's plain-phrase dayparts. Mirrors the events
 * recurrence builder: day chips (NEVER cron), a FROM/TO time (or TILL CLOSE), a program to run,
 * and a live phrase. The TV derives the active program client-side from these rows; a manual flip
 * (SWITCH PROGRAM) still wins until its hold expires (D4). This first M3 cut schedules ROTATION /
 * PLAYLIST / LIVE INPUT dayparts; a MULTIVIEW daypart is driven manually from SWITCH PROGRAM for
 * now (the schema stores any program jsonb — a MULTIVIEW schedule option is a UI backlog item).
 */

/** The bar's close time as venue-local minutes past midnight (02:00) — TILL CLOSE targets it, and
 *  a daypart ending here renders "close". DECISION: a constant for this single-venue 4PM–2AM bar;
 *  a future venue could read it from venue_settings.drinks_sync_window. */
const CLOSE_MINUTE = 120;

const DAYS: { tok: string; label: string }[] = [
  { tok: "MO", label: "MON" }, { tok: "TU", label: "TUE" }, { tok: "WE", label: "WED" },
  { tok: "TH", label: "THU" }, { tok: "FR", label: "FRI" }, { tok: "SA", label: "SAT" }, { tok: "SU", label: "SUN" },
];

type ProgKind = "rotation" | "playlist" | "capture";

export function ScheduleEditor({ slot, timezone, onClose }: { slot: AdminSlot; timezone: string; onClose: () => void }) {
  const rowsQ = useSlotScheduleAdmin(slot.id);
  const rows = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  const playlistsQ = useMediaPlaylists();
  const playlists = playlistsQ.data ?? [];

  // Draft daypart state.
  const [days, setDays] = useState<Set<string>>(new Set());
  const [start, setStart] = useState(960); // 4:00 PM
  const [tillClose, setTillClose] = useState(true);
  const [end, setEnd] = useState(1320); // 10:00 PM (used when not till close)
  const [progKind, setProgKind] = useState<ProgKind>("playlist");
  const [playlistId, setPlaylistId] = useState<string>("");

  const effEnd = tillClose ? CLOSE_MINUTE : end;
  const draftDays = [...days];
  const draftProgram: ScheduleProgram =
    progKind === "rotation" ? { kind: "rotation" }
    : progKind === "capture" ? { kind: "capture" }
    : { kind: "playlist", playlist_id: playlistId };
  const canAdd = progKind !== "playlist" || !!playlistId;

  const phrase = schedulePhrase({ daysOfWeek: draftDays, startMinute: start, endMinute: effEnd }, CLOSE_MINUTE);

  const nextPosition = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;

  const add = useMutation({
    mutationFn: () =>
      createScheduleRow({
        slot_id: slot.id, program: draftProgram, days_of_week: draftDays,
        start_minute: start, end_minute: effEnd, position: nextPosition,
      }),
  });
  const del = useMutation({ mutationFn: (id: string) => deleteScheduleRow(id) });

  // Which row is active right now (highest position among rows covering "now").
  const activeId = useMemo(() => {
    const { dow, minute } = venueLocalParts(new Date(), timezone);
    const covering = rows
      .map(toScheduleRow)
      .filter((r) => rowCovers(r, dow, minute));
    if (!covering.length) return null;
    return covering.reduce((a, b) => (b.position > a.position || (b.position === a.position && b.id > a.id) ? b : a)).id;
  }, [rows, timezone]);

  return (
    <SlideOver eyebrow={`${slot.name} ▸ SCHEDULE`} title="SCHEDULE — DAYPARTS" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.5 }}>
          Programs that flip themselves by time of day. A manual SWITCH PROGRAM still wins until the next daypart (or the 4 AM rollover for a SPECIAL EVENT). Any time no daypart covers falls to ROTATION.
          {" "}<span className="u-amber">When two dayparts overlap, the one at the TOP of the list wins.</span>
        </div>

        {/* existing dayparts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {rowsQ.isLoading ? (
            <div style={{ opacity: 0.6, fontSize: 15 }}>LOADING…</div>
          ) : rows.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 15 }}>No dayparts yet — build one below. Until then this screen is always ROTATION (or a manual program).</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="terminal-border" style={{ padding: "9px 11px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontSize: 18, letterSpacing: 1 }}>{programLabel(r, playlists)}</div>
                  <div style={{ fontSize: 13, opacity: 0.6 }}>{schedulePhrase({ daysOfWeek: r.days_of_week, startMinute: r.start_minute, endMinute: r.end_minute }, CLOSE_MINUTE)}</div>
                </div>
                {r.id === activeId && <span className="sig-live" style={{ fontSize: 12, letterSpacing: 1 }}>● ACTIVE NOW</span>}
                <button type="button" onClick={() => del.mutate(r.id)} disabled={del.isPending} className="u-amber" style={{ ...miniBtn, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)" }}>✕ REMOVE</button>
              </div>
            ))
          )}
        </div>

        <div className="terminal-separator" />

        {/* new daypart */}
        <div style={{ fontSize: 13, letterSpacing: 2, opacity: 0.6 }}>◆ NEW DAYPART</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={fl}>ON THESE DAYS <span style={{ opacity: 0.5 }}>(none = daily)</span></label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {DAYS.map((d) => {
              const on = days.has(d.tok);
              return (
                <button key={d.tok} type="button" onClick={() => setDays((s) => { const n = new Set(s); n.has(d.tok) ? n.delete(d.tok) : n.add(d.tok); return n; })}
                  className={on ? "u-fill u-ink" : ""}
                  style={{ ...chip, background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400 }}>{d.label}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={fl}>FROM</label>
            <input type="time" value={minutesToTime(start)} onChange={(e) => setStart(timeToMinutes(e.target.value))} style={timeInput} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={fl}>TO</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => setTillClose((v) => !v)} className={tillClose ? "u-amber" : ""} style={{ ...miniBtn, color: tillClose ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)", borderColor: tillClose ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)" }}>{tillClose ? "◉ TILL CLOSE" : "◦ TILL CLOSE"}</button>
              {!tillClose && <input type="time" value={minutesToTime(end)} onChange={(e) => setEnd(timeToMinutes(e.target.value))} style={timeInput} />}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={fl}>RUN THIS PROGRAM</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["rotation", "playlist", "capture"] as ProgKind[]).map((k) => {
              const on = progKind === k;
              const label = k === "rotation" ? "ROTATION" : k === "playlist" ? "PLAYLIST" : "LIVE INPUT";
              return (
                <button key={k} type="button" onClick={() => setProgKind(k)} className={on ? "u-fill u-ink" : ""}
                  style={{ ...seg, background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400 }}>{label}</button>
              );
            })}
          </div>
          {progKind === "playlist" && (
            <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} style={{ ...timeInput, marginTop: 6 }}>
              <option value="">— pick a playlist —</option>
              {playlists.map((p) => <option key={p.playlist.id} value={p.playlist.id}>{p.playlist.name}</option>)}
            </select>
          )}
        </div>

        <div className="terminal-border" style={{ padding: "9px 12px", fontSize: 15, lineHeight: 1.5 }}>
          <span style={{ opacity: 0.6 }}>Reads as: </span>
          <span className="u-amber">{phrase} → {progKind === "rotation" ? "ROTATION" : progKind === "capture" ? "LIVE INPUT" : playlistId ? (playlists.find((p) => p.playlist.id === playlistId)?.playlist.name ?? "PLAYLIST") : "PLAYLIST…"}</span>
        </div>

        <button type="button" disabled={!canAdd || add.isPending} onClick={() => { add.mutate(); }} className="u-fill u-ink"
          style={{ ...seg, background: "var(--terminal-green)", color: "#000", fontWeight: 700, minHeight: 48, opacity: canAdd ? 1 : 0.5 }}>
          + ADD DAYPART
        </button>
      </div>
    </SlideOver>
  );
}

function toScheduleRow(r: ScheduleRowRaw) {
  return { id: r.id, program: r.program, daysOfWeek: r.days_of_week, startMinute: r.start_minute, endMinute: r.end_minute, position: r.position, active: r.active };
}

function programLabel(r: ScheduleRowRaw, playlists: { playlist: { id: string; name: string } }[]): string {
  const p = r.program;
  if (p.kind === "rotation") return "ROTATION";
  if (p.kind === "capture") return "LIVE INPUT";
  if (p.kind === "playlist") return `PLAYLIST '${playlists.find((x) => x.playlist.id === p.playlist_id)?.playlist.name ?? "…"}'`;
  if (p.kind === "multiview") return "MULTIVIEW";
  return "PROGRAM";
}

function minutesToTime(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}
function timeToMinutes(v: string): number {
  const [h, m] = v.split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// (minuteLabel is imported for potential reuse; the phrase helper already covers display.)
void minuteLabel;

const fl = { fontSize: 12, letterSpacing: 2, opacity: 0.6 } as const;
const chip = { fontFamily: MONO, fontSize: 13, letterSpacing: 1, minWidth: 46, minHeight: 40, padding: "6px 8px", border: "1px solid var(--terminal-green)", cursor: "pointer" } as const;
const seg = { fontFamily: MONO, fontSize: 14, letterSpacing: 1, padding: "10px 14px", minHeight: 44, border: "1px solid var(--terminal-green)", cursor: "pointer" } as const;
const miniBtn = { fontFamily: MONO, fontSize: 13, letterSpacing: 1, padding: "8px 11px", minHeight: 40, border: "1px solid var(--terminal-green)", background: "transparent", color: "var(--terminal-green)", cursor: "pointer" } as const;
const timeInput = { fontFamily: MONO, fontSize: 15, padding: "9px 11px", minHeight: 44, background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.35)" } as const;

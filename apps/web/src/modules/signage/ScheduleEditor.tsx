import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import { SlideOver } from "./SlideOver";
import { MONO } from "./signageAdminShared";
import {
  useSlotScheduleAdmin, createScheduleRow, updateScheduleRow, deleteScheduleRow, useMediaPlaylists,
  type ScheduleRowRaw,
} from "./useMediaAdmin";
import {
  rowCovers, venueLocalParts, minuteLabel, schedulePhrase,
  type ScheduleProgram,
} from "./scheduleResolve";
import { ALL_MEDIA_PLAYLIST_ID, ALL_MEDIA_NAME, isAllMedia, type CarouselOrder } from "./mediaProgram";
import type { AdminSlot } from "./useSignageAdmin";
import { ConfirmDialog } from "@/shared/ui";
import { TAP } from "@/shared/ui/tokens";

/**
 * SCHEDULE builder (docs/15 M3 — D3/D4) — a slot's plain-phrase dayparts. Mirrors the events
 * recurrence builder: day chips (NEVER cron), a FROM/TO time (or TILL CLOSE), a program to run,
 * and a live phrase. The TV derives the active program client-side from these rows; a manual flip
 * (SWITCH PROGRAM) still wins until its hold expires (D4). This first M3 cut schedules ROTATION /
 * PLAYLIST / LIVE INPUT dayparts; a MULTIVIEW daypart is driven manually from SWITCH PROGRAM for
 * now (the schema stores any program jsonb — a MULTIVIEW schedule option is a UI backlog item).
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 2) — `variant`, the other half of Stephen's bug ("I clicked to open the
 * schedule modal and the old style was still present"). Same shape as ProgramPanel:
 * `variant="v2"` from a v2 caller tokens the frame (PR 1's `.st-sheet` drawer) and the
 * leaves; the default is the shipped classic drawer, so the classic hub is byte-identical.
 * Every branched `style` is a WHOLE-OBJECT ternary whose classic arm is the shipped object
 * literal, key for key — merging a v2 key in would reorder the serialised `style` attribute
 * and break the innerHTML hash the harness compares, without changing a pixel.
 *
 * The one BEHAVIOURAL addition, and only on the v2 leg: REMOVING a daypart is data loss
 * (the row and its position are gone), so v2 routes it through the ratified `ConfirmDialog`
 * in the danger ink. Classic keeps its immediate delete — the PR #103 precedent for a
 * write-PREVENTING addition, which cannot regress a classic flow. Everything else — the
 * mutations, the edit-in-place position preservation, `activeId`, the phrase — is untouched.
 * ──────────────────────────────────────────────────────────────────────────────────── */

/** The bar's close time as venue-local minutes past midnight (02:00) — TILL CLOSE targets it, and
 *  a daypart ending here renders "close". DECISION: a constant for this single-venue 4PM–2AM bar;
 *  a future venue could read it from venue_settings.drinks_sync_window. */
const CLOSE_MINUTE = 120;

const DAYS: { tok: string; label: string }[] = [
  { tok: "MO", label: "MON" }, { tok: "TU", label: "TUE" }, { tok: "WE", label: "WED" },
  { tok: "TH", label: "THU" }, { tok: "FR", label: "FRI" }, { tok: "SA", label: "SAT" }, { tok: "SU", label: "SUN" },
];

type ProgKind = "rotation" | "playlist" | "capture" | "carousel";

export function ScheduleEditor({ slot, timezone, onClose, variant = "classic", openKey }: {
  slot: AdminSlot;
  timezone: string;
  onClose: () => void;
  /** "v2" renders the tokened sheet (Beat 8 PR 2). Defaults to the shipped classic drawer. */
  variant?: "classic" | "v2";
  /** Identity of the open request — forwarded to SlideOver's phase machine. */
  openKey?: unknown;
}) {
  const v2 = variant === "v2";
  const rowsQ = useSlotScheduleAdmin(slot.id);
  const rows = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  const playlistsQ = useMediaPlaylists();
  const playlists = playlistsQ.data ?? [];

  // Draft daypart state. `editingId` non-null ⇒ the form is editing that existing row in place
  // (SAVE updates it, keeping its position + overlap rank); null ⇒ building a NEW daypart.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [days, setDays] = useState<Set<string>>(new Set());
  const [start, setStart] = useState(960); // 4:00 PM
  const [tillClose, setTillClose] = useState(true);
  const [end, setEnd] = useState(1320); // 10:00 PM (used when not till close)
  const [progKind, setProgKind] = useState<ProgKind>("playlist");
  const [playlistId, setPlaylistId] = useState<string>("");
  const [carouselOrder, setCarouselOrder] = useState<CarouselOrder>("ordered");
  // v2 only — the daypart the ConfirmDialog is asking about (null = no dialog).
  const [confirmRemove, setConfirmRemove] = useState<ScheduleRowRaw | null>(null);

  const effEnd = tillClose ? CLOSE_MINUTE : end;
  const draftDays = [...days];
  const draftProgram: ScheduleProgram =
    progKind === "rotation" ? { kind: "rotation" }
    : progKind === "capture" ? { kind: "capture" }
    : progKind === "carousel" ? { kind: "carousel", order: carouselOrder }
    : { kind: "playlist", playlist_id: playlistId };
  const canSubmit = progKind !== "playlist" || !!playlistId;

  const phrase = schedulePhrase({ daysOfWeek: draftDays, startMinute: start, endMinute: effEnd }, CLOSE_MINUTE);

  const nextPosition = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;

  // Reset the form back to NEW-daypart defaults (matches the useState seeds).
  const resetForm = useCallback(() => {
    setEditingId(null);
    setDays(new Set());
    setStart(960);
    setTillClose(true);
    setEnd(1320);
    setProgKind("playlist");
    setPlaylistId("");
    setCarouselOrder("ordered");
  }, []);

  // Load an existing row into the form for editing (mirrors the events recurrence-builder feel:
  // day chips, FROM/TO, program picker). Only rotation/playlist/capture rows reach here (multiview
  // rows aren't buildable in this editor — see the row render; DECISION there).
  const loadRow = useCallback((r: ScheduleRowRaw) => {
    setEditingId(r.id);
    setDays(new Set(r.days_of_week));
    setStart(r.start_minute);
    const isClose = r.end_minute === CLOSE_MINUTE;
    setTillClose(isClose);
    // Always set the end draft (NOTE-2) — chaining EDIT A (custom end) → EDIT B (TILL CLOSE) must
    // not leave A's end in state, so unchecking TILL CLOSE on B would show A's stale minute. A
    // TILL-CLOSE row seeds the sensible default (10:00 PM) so unchecking reveals a fresh value.
    setEnd(isClose ? 1320 : r.end_minute);
    setProgKind(r.program.kind === "playlist" ? "playlist" : r.program.kind === "capture" ? "capture" : r.program.kind === "carousel" ? "carousel" : "rotation");
    setPlaylistId(r.program.kind === "playlist" ? r.program.playlist_id : "");
    setCarouselOrder(r.program.kind === "carousel" ? r.program.order : "ordered");
  }, []);

  const add = useMutation({
    mutationFn: () =>
      createScheduleRow({
        slot_id: slot.id, program: draftProgram, days_of_week: draftDays,
        start_minute: start, end_minute: effEnd, position: nextPosition,
      }),
    onSuccess: resetForm,
  });
  // SAVE an edit: UPDATE the same row id, keeping its position (don't re-number — the top-of-list
  // overlap rank must not silently shuffle just because a daypart was edited).
  const save = useMutation({
    mutationFn: () =>
      updateScheduleRow(editingId as string, {
        program: draftProgram, days_of_week: draftDays, start_minute: start, end_minute: effEnd,
      }),
    onSuccess: resetForm,
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteScheduleRow(id),
    // If the row being edited is removed, drop back to NEW mode so the form isn't stranded on it.
    onSuccess: (_data, id) => { if (id === editingId) resetForm(); },
  });

  // Which row is active right now (highest position among rows covering "now").
  const activeId = useMemo(() => {
    const { dow, minute } = venueLocalParts(new Date(), timezone);
    const covering = rows
      .map(toScheduleRow)
      .filter((r) => rowCovers(r, dow, minute));
    if (!covering.length) return null;
    return covering.reduce((a, b) => (b.position > a.position || (b.position === a.position && b.id > a.id) ? b : a)).id;
  }, [rows, timezone]);

  // v2 leaf kit. GEOMETRY only — ink/face/size come from the classes, because an inline
  // colour loses to `.terminal-theme * { color: green !important }` (PR #89).
  const miniS: CSSProperties = v2 ? miniV2 : miniBtn;
  const timeS: CSSProperties = v2 ? timeInputV2 : timeInput;
  /** `u-ink` rides the ON state so a primary control's child spans take the ground ink
   *  too (`.st-sheet .u-ink *`); the blanket text tier would otherwise leave them white. */
  const segCls = (on: boolean) => (v2 ? (on ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (on ? "u-fill u-ink" : ""));
  const pressed = (on: boolean) => (v2 ? { "aria-pressed": on } : null);

  return (
    <SlideOver eyebrow={`${slot.name} ▸ SCHEDULE`} title={v2 ? "Schedule — dayparts" : "SCHEDULE — DAYPARTS"} onClose={onClose} variant={variant} openKey={openKey}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { lineHeight: 1.5 } : { fontSize: 14, opacity: 0.7, lineHeight: 1.5 }}>
          Programs that flip themselves by time of day. A manual SWITCH PROGRAM still wins until the next daypart (or the 4 AM rollover for a SPECIAL EVENT). Any time no daypart covers falls to ROTATION.
          {" "}<span className={v2 ? "st-body st-amber" : "u-amber"}>When two dayparts overlap, the one at the TOP of the list wins.</span>
        </div>

        {/* existing dayparts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {rowsQ.isLoading ? (
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.6, fontSize: 15 }}>{v2 ? "Loading…" : "LOADING…"}</div>
          ) : rows.length === 0 ? (
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.6, fontSize: 15 }}>No dayparts yet — build one below. Until then this screen is always ROTATION (or a manual program).</div>
          ) : (
            rows.map((r) => {
              // DECISION: a MULTIVIEW daypart isn't buildable in this editor (only rotation /
              // playlist / capture) — such a row (only creatable via media-control / a manual
              // multiview) stays REMOVE-only so editing can't silently downgrade it.
              const editable = r.program.kind === "rotation" || r.program.kind === "playlist" || r.program.kind === "capture" || r.program.kind === "carousel";
              const isEditing = r.id === editingId;
              return (
                <div key={r.id}
                  // v2: `st-callout-warn` is the "being edited" state — the amber wash the
                  // classic leg drew with a borderColor literal, as a role instead.
                  className={v2 ? (isEditing ? "st-card st-callout-warn" : "st-card") : "terminal-border"}
                  style={v2
                    ? { padding: "9px 11px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }
                    : { padding: "9px 11px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", ...(isEditing ? { borderColor: "var(--terminal-amber, #ffb000)" } : null) }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? undefined : { fontSize: 18, letterSpacing: 1 }}>{programLabel(r, playlists)}</div>
                    <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 13, opacity: 0.6 }}>{schedulePhrase({ daysOfWeek: r.days_of_week, startMinute: r.start_minute, endMinute: r.end_minute }, CLOSE_MINUTE)}</div>
                  </div>
                  {r.id === activeId && <span className={v2 ? "st-live st-label" : "sig-live"} style={v2 ? undefined : { fontSize: 12, letterSpacing: 1 }}>● ACTIVE NOW</span>}
                  {editable && (
                    <button type="button" onClick={() => loadRow(r)} {...pressed(isEditing)} className={v2 ? segCls(isEditing) : (isEditing ? "u-fill u-ink" : "")} style={v2 ? miniV2 : { ...miniBtn, ...(isEditing ? { background: "var(--terminal-green)", color: "#000", fontWeight: 700 } : null) }}>{v2 ? (isEditing ? "● Editing" : "✎ Edit") : (isEditing ? "● EDITING" : "✎ EDIT")}</button>
                  )}
                  {/* Removing a daypart is data loss, so v2 asks first and wears the danger
                      ink. Classic keeps its immediate delete (write-preventing addition only). */}
                  <button type="button" onClick={() => { if (v2) { setConfirmRemove(r); return; } del.mutate(r.id); }} disabled={del.isPending} className={v2 ? "st-btn st-btn-danger st-body" : "u-amber"} style={v2 ? miniV2 : { ...miniBtn, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)" }}>{v2 ? "✕ Remove" : "✕ REMOVE"}</button>
                </div>
              );
            })
          )}
        </div>

        <div className="terminal-separator" />

        {/* new / edit daypart */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div className={v2 ? (editingId ? "st-label st-amber" : "st-label st-t2") : (editingId ? "u-amber" : "")} style={v2 ? undefined : { fontSize: 13, letterSpacing: 2, opacity: editingId ? 1 : 0.6, ...(editingId ? { color: "var(--terminal-amber, #ffb000)" } : null) }}>{editingId ? "◆ EDIT DAYPART" : "◆ NEW DAYPART"}</div>
          {editingId && <button type="button" onClick={resetForm} className={v2 ? "st-btn st-body" : undefined} style={miniS}>{v2 ? "✕ Cancel" : "✕ CANCEL"}</button>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {/* v2 splits the Label role from its hint: `.st-label` is the all-caps role by
              definition and would shout the lowercase parenthetical. */}
          <label className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : fl}>{v2 ? "ON THESE DAYS" : <>ON THESE DAYS <span style={{ opacity: 0.5 }}>(none = daily)</span></>}</label>
          {v2 && <div className="st-body st-t3">None picked = every day</div>}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {DAYS.map((d) => {
              const on = days.has(d.tok);
              return (
                <button key={d.tok} type="button" onClick={() => setDays((s) => { const n = new Set(s); n.has(d.tok) ? n.delete(d.tok) : n.add(d.tok); return n; })}
                  {...pressed(on)}
                  className={segCls(on)}
                  style={v2 ? { ...chipV2, fontWeight: on ? 700 : 400 } : { ...chip, background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400 }}>{d.label}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : fl}>FROM</label>
            <input type="time" value={minutesToTime(start)} onChange={(e) => setStart(timeToMinutes(e.target.value))} className={v2 ? "st-body" : undefined} style={timeS} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : fl}>TO</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => setTillClose((v) => !v)} {...pressed(tillClose)} className={v2 ? (tillClose ? "st-btn st-amber st-body" : "st-btn st-body") : (tillClose ? "u-amber" : "")} style={v2 ? miniV2 : { ...miniBtn, color: tillClose ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)", borderColor: tillClose ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)" }}>{v2 ? (tillClose ? "◉ Till close" : "◦ Till close") : (tillClose ? "◉ TILL CLOSE" : "◦ TILL CLOSE")}</button>
              {!tillClose && <input type="time" value={minutesToTime(end)} onChange={(e) => setEnd(timeToMinutes(e.target.value))} className={v2 ? "st-body" : undefined} style={timeS} />}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : fl}>RUN THIS PROGRAM</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["rotation", "playlist", "carousel", "capture"] as ProgKind[]).map((k) => {
              const on = progKind === k;
              const label = v2
                ? (k === "rotation" ? "Rotation" : k === "playlist" ? "Playlist" : k === "carousel" ? "Carousel" : "Live input")
                : (k === "rotation" ? "ROTATION" : k === "playlist" ? "PLAYLIST" : k === "carousel" ? "CAROUSEL" : "LIVE INPUT");
              return (
                <button key={k} type="button" onClick={() => setProgKind(k)} {...pressed(on)} className={segCls(on)}
                  style={v2 ? { ...segV2, fontWeight: on ? 700 : 400 } : { ...seg, background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400 }}>{label}</button>
              );
            })}
          </div>
          {progKind === "playlist" && (
            <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} className={v2 ? "st-body" : undefined} style={{ ...timeS, marginTop: 6 }}>
              <option value="">— pick a playlist —</option>
              <option value={ALL_MEDIA_PLAYLIST_ID}>{ALL_MEDIA_NAME}</option>
              {playlists.map((p) => <option key={p.playlist.id} value={p.playlist.id}>{p.playlist.name}</option>)}
            </select>
          )}
          {progKind === "carousel" && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {(["ordered", "random"] as CarouselOrder[]).map((o) => {
                const on = carouselOrder === o;
                return (
                  <button key={o} type="button" onClick={() => setCarouselOrder(o)} {...pressed(on)} className={segCls(on)}
                    style={v2 ? { ...segV2, flex: 1, fontWeight: on ? 700 : 400 } : { ...seg, flex: 1, background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400 }}>{v2 ? (o === "ordered" ? "Ordered (A→Z)" : "Random") : (o === "ordered" ? "ORDERED (A→Z)" : "RANDOM")}</button>
                );
              })}
            </div>
          )}
        </div>

        <div className={v2 ? "st-card st-body" : "terminal-border"} style={v2 ? { padding: "9px 12px", lineHeight: 1.5 } : { padding: "9px 12px", fontSize: 15, lineHeight: 1.5 }}>
          <span className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.6 }}>Reads as: </span>
          <span className={v2 ? "st-body st-amber" : "u-amber"}>{phrase} → {
            progKind === "rotation" ? "ROTATION"
            : progKind === "capture" ? "LIVE INPUT"
            : progKind === "carousel" ? `CAROUSEL (${carouselOrder === "random" ? "random" : "ordered"})`
            : playlistId ? (isAllMedia(playlistId) ? ALL_MEDIA_NAME : (playlists.find((p) => p.playlist.id === playlistId)?.playlist.name ?? "PLAYLIST")) : "PLAYLIST…"
          }</span>
        </div>

        <button type="button" disabled={!canSubmit || add.isPending || save.isPending} onClick={() => { editingId ? save.mutate() : add.mutate(); }} className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"}
          style={v2 ? { ...segV2, fontWeight: 700, minHeight: 48, opacity: canSubmit ? 1 : 0.5 } : { ...seg, background: "var(--terminal-green)", color: "#000", fontWeight: 700, minHeight: 48, opacity: canSubmit ? 1 : 0.5 }}>
          {v2 ? (editingId ? "✓ Save daypart" : "+ Add daypart") : (editingId ? "✓ SAVE DAYPART" : "+ ADD DAYPART")}
        </button>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove daypart?"
          body={`${programLabel(confirmRemove, playlists)} — ${schedulePhrase({ daysOfWeek: confirmRemove.days_of_week, startMinute: confirmRemove.start_minute, endMinute: confirmRemove.end_minute }, CLOSE_MINUTE)}. The screen falls back to whatever daypart covers that time, or to ROTATION.`}
          confirmLabel="Remove daypart"
          cancelLabel="Keep daypart"
          danger
          busy={del.isPending}
          onConfirm={() => { const id = confirmRemove.id; setConfirmRemove(null); del.mutate(id); }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
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
  if (p.kind === "playlist") return isAllMedia(p.playlist_id) ? ALL_MEDIA_NAME : `PLAYLIST '${playlists.find((x) => x.playlist.id === p.playlist_id)?.playlist.name ?? "…"}'`;
  if (p.kind === "carousel") return `CAROUSEL · ${p.order === "random" ? "random" : "ordered"}`;
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

/* v2 twins: geometry only. No face (the role classes own it), no colour (an inline colour
 * loses to the theme's !important green — the classes are what paint), and `border:
 * "1px solid"` with no colour so the token blanket paints the hairline. Every control
 * clears the 44px floor on BOTH axes: the day chip was 46×40 and the mini buttons 40 high,
 * which a height-only harness would have passed (#103 NOTE-6). */
const chipV2 = { fontSize: 15, minWidth: TAP, minHeight: TAP, padding: "6px 8px", border: "1px solid", cursor: "pointer" } as const;
const segV2 = { fontSize: 15, padding: "10px 14px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer" } as const;
const miniV2 = { fontSize: 15, padding: "8px 11px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer" } as const;
const timeInputV2 = { fontSize: 15, padding: "9px 11px", minHeight: TAP, border: "1px solid" } as const;

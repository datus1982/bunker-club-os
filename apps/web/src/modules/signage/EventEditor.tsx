import { useMemo, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ToastCacheRow, EventKind, EventFlavor } from "./useSignage";
import { flavorOf } from "./useSignage";
import { ToastSourcePicker, ImageUploadField, FormatControls } from "./signageAdminShared";
import { alignOf, type Align } from "./richText";
import { ConfirmDialog, ToggleSwitch } from "@/shared/ui";
import { TAP } from "@/shared/ui/tokens";
import {
  DOW, DOW_LABEL, VENUE_TZ,
  saveEvent, fireNowEvent, abortEvent, deleteEvent,
  schedulePhrase, statusInfo, venueLocalParts, venueLocalToUtc, nextOccurrence,
  type EventRow, type EventDraft,
} from "./useEventsAdmin";

/**
 * EVENTS & PROMOS editor pane (docs/13 Controls · ux-refinement-mockup.html view 5).
 * The right pane of /signage/events — a manager names it, picks a kind, builds a schedule
 * with a live plain-language preview (NEVER cron), says what shows, optionally links a
 * drink, and (for MOMENTs) tunes the choreography. Mobile-first, ≥44px controls.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 4) — `variant`.
 *
 * A v2 page opens this editor outside the `[data-st-page]` token scope (it is SHARED with
 * the classic hub), so it arrived green. `variant="v2"` is the caller saying "token this
 * one": the frame is PR 1's `.st-sheet` drawer (mounted by HubOverlays), and the leaves
 * below swap their green literals for the token roles — the PR 2 template, leaf for leaf.
 *
 * ONE component, one tree, a `v2` branch at each LEAF — not a v2 twin of the editor. Two
 * copies of the form that writes `scheduled_events` is how the hub and a future page would
 * start disagreeing about what an event IS. Every branched `style` is a WHOLE-OBJECT
 * ternary whose classic arm is the shipped object literal, key for key, so classic's
 * serialised `style` attribute does not even reorder.
 *
 * BEHAVIOUR IS BYTE-IDENTICAL: same `draft`, same `saveEvent` / `fireNowEvent` /
 * `abortEvent` / `deleteEvent` calls with the same args, same `canSave` / `isLive` / `busy`
 * gating. The ONE addition is v2-only and write-PREVENTING: the three `window.confirm`
 * guards become the ratified `ConfirmDialog` — FIRE NOW and ABORT on the plain tier (they
 * change the bar TVs but are not data loss), DELETE on the danger tier (owner rulings,
 * 2026-09-12). Classic keeps all three `confirm()`s.
 * ──────────────────────────────────────────────────────────────────────────────────── */

const MONO = "'VT323','Share Tech Mono',monospace";

const KINDS: { key: EventKind; label: string; v2Label: string; blurb: string }[] = [
  { key: "window", label: "WINDOW", v2Label: "Window", blurb: "Calm recurring promo — a card + ticker line during the window." },
  { key: "message", label: "MESSAGE", v2Label: "Message", blurb: "One-time message — a birthday, a shout-out, a notice." },
  { key: "moment", label: "MOMENT", v2Label: "Moment", blurb: "Full choreography — tease → alert → payoff, with a live counter." },
];
const SKINS: { key: string; label: string; v2Label: string }[] = [
  { key: "launch", label: "LAUNCH", v2Label: "Launch" },
  { key: "infestation", label: "INFESTATION", v2Label: "Infestation" },
  { key: "generic", label: "GENERIC", v2Label: "Generic" },
];
const DURATIONS: { label: string; minutes: number }[] = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
];

type ScheduleMode = "oneshot" | "recurring";

function todayLocal(): string {
  const p = venueLocalParts(new Date().toISOString(), VENUE_TZ);
  return p.date;
}
/** Minutes from a venue-local HH:MM start to the 2:00 AM venue close (docs/14 hours). */
function minutesToClose(time: string): number {
  const [h, m] = time.split(":").map(Number);
  const start = h * 60 + m;
  const close = 26 * 60; // 2:00 AM next day
  const mins = close - start;
  return mins > 0 ? mins : 60; // guard a post-2AM start
}

/** Content-only duplicate of a past event for RE-RUN (item 6): everything that defines WHAT the
 *  event is, none of its old timing. The editor treats it as a brand-new event (no id) pre-filled
 *  with this content, so the owner just sets a new date/time/length and saves. */
export type EventSeed = Pick<EventRow, "name" | "kind" | "skin" | "fields" | "toast_guid" | "show_on_website" | "interrupt_game">;

export function EventEditor({
  editing, seed, presetKind, toastRows, onSaved, onCancel, onDeleted, variant = "classic",
}: {
  editing: EventRow | null;
  /** RE-RUN pre-fill (item 6). Ignored when `editing` is set. Content only — schedule stays fresh. */
  seed?: EventSeed | null;
  presetKind?: EventKind;
  toastRows: ToastCacheRow[];
  onSaved: (id: string) => void;
  onCancel: () => void;
  onDeleted: () => void;
  /** "v2" renders the tokened leaves (Beat 8 PR 4). Defaults to the shipped classic editor. */
  variant?: "classic" | "v2";
}) {
  const v2 = variant === "v2";
  // CONTENT (name/kind/skin/fields/toast/website/interrupt) comes from the row being edited OR,
  // for a RE-RUN, from the seed. SCHEDULE (fire_at/window/recurrence/status/id) reads from
  // `editing` ONLY — a RE-RUN opens as a NEW event with a fresh, un-scheduled schedule so the
  // owner picks the new date/time/length. `editing` always wins over `seed`.
  const src = editing ?? seed ?? null;
  const f = src?.fields ?? {};
  const initParts = editing?.fire_at ? venueLocalParts(editing.fire_at) : null;
  const initRecurring = !!editing?.recurrence?.daysOfWeek?.length;
  const initKind: EventKind = src?.kind ?? presetKind ?? "window";
  const initWindow = editing?.window_minutes ?? 180;

  // For an existing one-shot WINDOW/MESSAGE, derive the end date/time from start + window so a
  // long (multi-day) window round-trips into the ENDS ON inputs instead of a huge minute count.
  const initStartMs = initParts ? new Date(venueLocalToUtc(initParts.date, initParts.time)).getTime() : null;
  const initEndParts = initStartMs != null ? venueLocalParts(new Date(initStartMs + initWindow * 60_000).toISOString()) : null;
  const initSpanKind = (initKind === "window" || initKind === "message") && !initRecurring;
  const initCrossDay = !!(initParts && initEndParts && initEndParts.date !== initParts.date);

  const [name, setName] = useState(src?.name ?? "");
  const [kind, setKind] = useState<EventKind>(initKind);
  // PROMO/BULLETIN flavor (owner beat). null = follow the kind default (window → promo,
  // message → bulletin) so switching KIND updates the default until a manager picks one.
  const initFlavor = src?.fields?.flavor;
  const [flavor, setFlavor] = useState<EventFlavor | null>(
    initFlavor === "promo" || initFlavor === "bulletin" ? initFlavor : null,
  );
  const effectiveFlavor: EventFlavor = flavor ?? flavorOf(undefined, kind);
  const [skin, setSkin] = useState(src?.skin ?? "launch");
  const [toastGuid, setToastGuid] = useState<string | null>(src?.toast_guid ?? null);

  const [mode, setMode] = useState<ScheduleMode>(initRecurring ? "recurring" : "oneshot");
  const [date, setDate] = useState(initParts?.date ?? todayLocal());
  const [time, setTime] = useState((initRecurring ? editing?.recurrence?.time : initParts?.time) ?? "16:00");
  const [days, setDays] = useState<string[]>(editing?.recurrence?.daysOfWeek ?? []);
  // Recurring end date (0041) — inclusive venue-local "YYYY-MM-DD"; "" = runs forever.
  const [until, setUntil] = useState<string>(editing?.recurrence?.until ?? "");

  const [windowMinutes, setWindowMinutes] = useState(initWindow);
  // One-shot WINDOW/MESSAGE length can be set two ways (same window_minutes state): short via
  // the chips/number ("LENGTH"), or long via an explicit end date+time ("ENDS ON", 0041).
  const [durationMode, setDurationMode] = useState<"chips" | "endson">(initSpanKind && initCrossDay ? "endson" : "chips");
  const [endDate, setEndDate] = useState(initEndParts?.date ?? initParts?.date ?? todayLocal());
  const [endTime, setEndTime] = useState(initEndParts?.time ?? "23:59");
  const [teaseMinutes, setTeaseMinutes] = useState(editing?.tease_minutes ?? 60);
  const [alertMinutes, setAlertMinutes] = useState(editing?.alert_minutes ?? 5);
  const [interruptGame, setInterruptGame] = useState(src?.interrupt_game ?? false);

  const [showOnWebsite, setShowOnWebsite] = useState(src?.show_on_website ?? false);

  const [title, setTitle] = useState(str(f.title));
  const [body, setBody] = useState(str(f.body) || str(f.directive) || str(f.message));
  const [cta, setCta] = useState(str(f.cta));
  const [imageUrl, setImageUrl] = useState<string>(str(f.image_url));
  const [align, setAlign] = useState<Align>(alignOf(f));

  const [err, setErr] = useState<string | null>(null);
  // v2 only — which ConfirmDialog is open (null = none). Classic never sets this.
  const [confirming, setConfirming] = useState<"fire" | "abort" | "delete" | null>(null);

  // ENDS ON is offered only for a one-shot WINDOW/MESSAGE (moments keep the choreography
  // chips; recurring uses `until` for its stop date, not an end instant).
  const isSpanKind = (kind === "window" || kind === "message") && mode === "oneshot";
  const endsOnActive = isSpanKind && durationMode === "endson";
  // Minutes from the venue-local start to the venue-local end (may be ≤ 0 if end precedes start).
  const spanMinutes = useMemo(() => {
    const s = new Date(venueLocalToUtc(date, time, VENUE_TZ)).getTime();
    const e = new Date(venueLocalToUtc(endDate, endTime, VENUE_TZ)).getTime();
    return Math.round((e - s) / 60_000);
  }, [date, time, endDate, endTime]);
  const YEAR_MIN = 366 * 24 * 60;
  const effectiveWindow = endsOnActive ? spanMinutes : windowMinutes;
  const windowError = endsOnActive
    ? (!endDate || !endTime ? "set an end date and time"
      : spanMinutes < 1 ? "the end must be after the start"
      : spanMinutes > YEAR_MIN ? "keep the window under a year"
      : null)
    : null;

  const recurrenceDraft = mode === "recurring"
    ? { daysOfWeek: days, time, ...(until.trim() ? { until: until.trim() } : {}) }
    : null;

  // WARN-1 guard: a NEW recurring event whose `until` precedes its first occurrence would
  // save with fire_at null and never run (a dead row). Block it. An EDIT keeps its existing
  // fire_at as a fallback (draftFireAt) so it retires naturally — allowed.
  const scheduleError = useMemo(() => {
    if (mode !== "recurring" || !days.length || !time) return null;
    const next = nextOccurrence(days, time, new Date(), VENUE_TZ, until.trim() || undefined);
    if (!next && !editing?.fire_at) return "this ends before it ever runs — pick a later end date";
    return null;
  }, [mode, days, time, until, editing]);

  // Seed the ENDS ON inputs from the current length when switching in, and back the other way,
  // so the actual window never jumps when a manager flips between the two input styles.
  const switchToEndsOn = () => {
    const startMs = new Date(venueLocalToUtc(date, time, VENUE_TZ)).getTime();
    const p = venueLocalParts(new Date(startMs + Math.max(1, windowMinutes) * 60_000).toISOString());
    setEndDate(p.date); setEndTime(p.time);
    setDurationMode("endson");
  };
  // NOTE-2: clamp when copying the span into windowMinutes so a >1yr ENDS ON span can't
  // slip past the under-a-year rule by toggling back to LENGTH.
  const switchToLength = () => { setWindowMinutes(Math.min(YEAR_MIN, Math.max(1, spanMinutes))); setDurationMode("chips"); };

  const draft: EventDraft = useMemo(() => ({
    id: editing?.id,
    name,
    kind,
    skin,
    toast_guid: toastGuid,
    oneShot: mode === "oneshot" ? { date, time } : null,
    recurrence: recurrenceDraft,
    window_minutes: Math.max(1, effectiveWindow),
    tease_minutes: teaseMinutes,
    alert_minutes: alertMinutes,
    interrupt_game: interruptGame,
    flavor: kind === "moment" ? null : effectiveFlavor,
    title, body, cta,
    imageUrl,
    align,
    showOnWebsite,
    // RE-RUN inherits the seed's fields (image_url, duration_seconds, flavor, …) so buildFields
    // preserves keys the form doesn't surface; an insert (no id) drops the old counters via a
    // fresh row anyway. `editing` still wins for an edit.
    baseFields: src?.fields,
    status: editing?.status,
    existingFireAt: editing?.fire_at ?? null,
  }), [editing, src, name, kind, skin, toastGuid, mode, date, time, days, until, effectiveWindow, teaseMinutes, alertMinutes, interruptGame, flavor, title, body, cta, imageUrl, align, showOnWebsite]);

  // Live plain-language preview of exactly what the manager just built (no cron, ever).
  const preview = useMemo(() => {
    if (mode === "recurring" && !days.length) return "pick at least one day";
    if (scheduleError) return scheduleError;
    if (windowError) return windowError;
    const base = schedulePhrase(
      { kind, fire_at: mode === "oneshot" ? isoFor(date, time) : null, recurrence: recurrenceDraft, window_minutes: effectiveWindow },
      VENUE_TZ,
    );
    // Make "no stop date" explicit for a recurring promo so the manager sees it will run forever.
    if (mode === "recurring" && days.length && !until.trim()) return `${base} · no end date`;
    return base;
  }, [mode, days, kind, date, time, effectiveWindow, until, windowError, scheduleError]);

  const save = useMutation({
    mutationFn: () => saveEvent(draft),
    onSuccess: (id) => onSaved(id),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Save failed."),
  });
  const fire = useMutation({
    mutationFn: () => fireNowEvent(editing!),
    onSuccess: () => onSaved(editing!.id),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fire failed."),
  });
  const abort = useMutation({
    mutationFn: () => abortEvent(editing!.id),
    onSuccess: () => onSaved(editing!.id),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Abort failed."),
  });
  const del = useMutation({
    mutationFn: () => deleteEvent(editing!.id),
    onSuccess: onDeleted,
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Delete failed."),
  });

  const canSave =
    name.trim().length > 0 &&
    (mode === "oneshot" ? !!date && !!time : days.length > 0 && !!time) &&
    !windowError && !scheduleError;
  // Live-on-screen = abortable now. A window fired seconds ago is still `scheduled` until
  // the minute tick promotes it to `running`, but it is already on the TVs — so gate ABORT
  // on the actual display window, not just the status column.
  const isLive = !!editing && statusInfo(editing).tone === "now";
  const busy = save.isPending || fire.isPending || abort.isPending || del.isPending;

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  // v2 leaf kit (the PR 2 idiom). `inpS`/`chipS` carry GEOMETRY only — ink, face and size
  // come from the classes (an inline colour loses to `.terminal-theme * { color: green
  // !important }`, so a token value spent here would render green and quietly lie).
  const inpS: CSSProperties = v2 ? inpV2 : inp;
  const chipS: CSSProperties = v2 ? chipV2 : chip;
  /** A segmented/toggle control: primary fill when on, plain when off. `u-ink` rides along
   *  on the ON state — `.st-sheet .st-btn-primary` paints the BUTTON, a child <span> would
   *  otherwise stay white-on-accent under the `.st-sheet *` text tier. */
  const segCls = (on: boolean) => (v2 ? (on ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (on ? "u-fill u-ink" : ""));
  /** v2 only — a pressed state a screen reader can read. Classic markup stays frozen. */
  const pressed = (on: boolean) => (v2 ? { "aria-pressed": on } : null);
  const mini = (text: string) => <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : miniLabel}>{text}</span>;

  return (
    // v2: no frame of its own — the sheet IS the container (§B addendum: sheet contents
    // separate by hairline, never by a nested box around the whole form).
    <div className={v2 ? undefined : "terminal-border"} style={v2 ? { display: "flex", flexDirection: "column", gap: 14 } : { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className={v2 ? "st-label st-t3" : undefined} style={v2 ? undefined : { fontSize: 12, letterSpacing: 4, opacity: 0.5 }}>{editing ? "EDITING" : "NEW EVENT"}</div>

      {/* NAME */}
      <Labeled v2={v2} label="NAME">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Happy Hour" className={v2 ? "st-body" : undefined} style={inpS} />
      </Labeled>

      {/* KIND */}
      <Labeled v2={v2} label="KIND">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {KINDS.map((k) => {
            const on = kind === k.key;
            return (
              <button key={k.key} type="button" onClick={() => setKind(k.key)} {...pressed(on)} className={segCls(on)}
                style={v2 ? { ...kindTileV2, ...(on ? { fontWeight: 700 } : null) } : { ...kindTile, ...(on ? { fontWeight: 700 } : null) }}>
                {/* No tier class on either span in v2: inside a PRIMARY tile the ink is
                    `u-ink`'s ground, and `st-t2` would paint the blurb secondary-white on
                    the accent fill. */}
                <span className={v2 ? "st-heading" : undefined} style={v2 ? { fontWeight: on ? 700 : 600 } : { fontSize: 18, letterSpacing: 1 }}>{v2 ? k.v2Label : k.label}</span>
                <span className={v2 ? "st-body" : undefined} style={v2 ? { opacity: on ? 0.85 : 0.8 } : { fontSize: 14, opacity: on ? 0.85 : 0.6, letterSpacing: 0 }}>{k.blurb}</span>
              </button>
            );
          })}
        </div>
      </Labeled>

      {/* FLAVOR — PROMO vs BULLETIN voice (owner beat). MOMENTs are full choreography, no toggle. */}
      {kind !== "moment" && (
        <Labeled v2={v2} label="FLAVOR">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setFlavor("promo")} {...pressed(effectiveFlavor === "promo")} className={segCls(effectiveFlavor === "promo")} style={{ ...chipS, ...(effectiveFlavor === "promo" ? bold : null) }}>{v2 ? "▸ Promo" : "▸ PROMO"}</button>
            <button type="button" onClick={() => setFlavor("bulletin")} {...pressed(effectiveFlavor === "bulletin")} className={segCls(effectiveFlavor === "bulletin")} style={{ ...chipS, ...(effectiveFlavor === "bulletin" ? bold : null) }}>{v2 ? "◈ Bulletin" : "◈ BULLETIN"}</button>
          </div>
          <span className={v2 ? "st-body st-t3" : undefined} style={v2 ? { marginTop: 4 } : { fontSize: 14, opacity: 0.55, marginTop: 4 }}>
            {effectiveFlavor === "bulletin"
              ? "Information — Best of OKC, a local event, a PSA. Calm, no “ON NOW” sale framing."
              : "A sale — happy hour, free hot dog Mondays, a firesale. Keeps the “ON NOW” urgency."}
          </span>
        </Labeled>
      )}

      {/* SCHEDULE */}
      <Labeled v2={v2} label="SCHEDULE">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setMode("oneshot")} {...pressed(mode === "oneshot")} className={segCls(mode === "oneshot")} style={{ ...chipS, ...(mode === "oneshot" ? bold : null) }}>{v2 ? "One-shot" : "ONE-SHOT"}</button>
          <button type="button" onClick={() => setMode("recurring")} {...pressed(mode === "recurring")} className={segCls(mode === "recurring")} style={{ ...chipS, ...(mode === "recurring" ? bold : null) }}>{v2 ? "Recurring" : "RECURRING"}</button>
        </div>

        {mode === "oneshot" ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {mini("DATE")}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={v2 ? "st-body" : undefined} style={inpS} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {mini("START")}
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={v2 ? "st-body" : undefined} style={inpS} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {mini("DAYS")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DOW.map((d) => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)} {...pressed(on)} className={segCls(on)}
                    title={DOW_LABEL[d]} style={v2 ? { ...dayChipV2, ...(on ? bold : null) } : { ...dayChip, ...(on ? bold : null) }}>{d}</button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {mini("START TIME")}
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={v2 ? "st-body" : undefined} style={{ ...inpS, maxWidth: 160 }} />
              </div>
              {/* ENDS — optional recurring stop date (0041). Empty = runs forever. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {mini(v2 ? "ENDS" : "ENDS (optional)")}
                {v2 && <span className="st-body st-t3">Optional — leave blank to run forever</span>}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="date" min={todayLocal()} value={until} onChange={(e) => setUntil(e.target.value)} className={v2 ? "st-body" : undefined} style={{ ...inpS, maxWidth: 180 }} />
                  {until
                    ? <button type="button" onClick={() => setUntil("")} className={v2 ? "st-btn st-accent st-body" : undefined} style={v2 ? clearLinkV2 : clearLink}>{v2 ? "Run forever" : "run forever"}</button>
                    : <span className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 13, opacity: 0.5 }}>{v2 ? "No end date" : "no end date"}</span>}
                </div>
                {scheduleError && <div className={v2 ? "st-body st-danger" : "u-red"} style={v2 ? { marginTop: 2 } : { fontSize: 14, marginTop: 2 }}>⚠ {scheduleError}</div>}
              </div>
            </div>
          </div>
        )}

        {/* DURATION — short windows via LENGTH chips; long (multi-day) via ENDS ON (0041). */}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {mini("DURATION")}
            {isSpanKind && (
              <div style={{ display: "flex", gap: 6 }}>
                {/* v2 lifts these off the classic 32px mini-chip onto the 44px floor. */}
                <button type="button" onClick={switchToLength} {...pressed(!endsOnActive)} className={segCls(!endsOnActive)} style={v2 ? { ...miniChipV2, ...(!endsOnActive ? bold : null) } : { ...miniChip, ...(!endsOnActive ? bold : null) }}>{v2 ? "Length" : "LENGTH"}</button>
                <button type="button" onClick={switchToEndsOn} {...pressed(endsOnActive)} className={segCls(endsOnActive)} style={v2 ? { ...miniChipV2, ...(endsOnActive ? bold : null) } : { ...miniChip, ...(endsOnActive ? bold : null) }}>{v2 ? "Ends on" : "ENDS ON"}</button>
              </div>
            )}
          </div>

          {!endsOnActive ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {DURATIONS.map((d) => {
                const on = windowMinutes === d.minutes;
                return (
                  <button key={d.label} type="button" onClick={() => setWindowMinutes(d.minutes)} {...pressed(on)} className={segCls(on)} style={{ ...chipS, ...(on ? bold : null) }}>{d.label}</button>
                );
              })}
              <button type="button" onClick={() => setWindowMinutes(minutesToClose(time))} {...pressed(windowMinutes === minutesToClose(time))} className={segCls(windowMinutes === minutesToClose(time))} style={{ ...chipS, ...(windowMinutes === minutesToClose(time) ? bold : null) }}>{v2 ? "Till close" : "TILL CLOSE"}</button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input type="number" min={1} value={windowMinutes} onChange={(e) => setWindowMinutes(Math.max(1, Number(e.target.value) || 1))} className={v2 ? "st-body" : undefined} style={v2 ? { ...inpV2, width: 96, padding: "8px 8px" } : { ...inp, width: 84, padding: "8px 8px" }} />
                <span className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>min</span>
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {mini("END DATE")}
                <input type="date" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={v2 ? "st-body" : undefined} style={{ ...inpS, maxWidth: 180 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {mini("END TIME")}
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={v2 ? "st-body" : undefined} style={{ ...inpS, maxWidth: 140 }} />
              </div>
            </div>
          )}
          {windowError && <div className={v2 ? "st-body st-danger" : "u-red"} style={v2 ? { marginTop: 6 } : { fontSize: 14, marginTop: 6 }}>⚠ {windowError}</div>}
        </div>

        {/* live plain-phrase preview */}
        <div className={v2 ? "st-body" : undefined} style={v2 ? { marginTop: 10 } : { marginTop: 10, fontSize: 16, letterSpacing: 1 }}>
          <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : { opacity: 0.5 }}>WILL RUN: </span>
          <span className={v2 ? "st-body st-amber" : "u-amber"}>{preview}</span>
        </div>
      </Labeled>

      {/* WHAT SHOWS */}
      <Labeled v2={v2} label="WHAT SHOWS">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Headline (defaults to the name)" className={v2 ? "st-body" : undefined} style={inpS} />
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "moment" ? "Directive / body line" : "Body line"} className={v2 ? "st-body" : undefined} style={{ ...inpS, resize: "vertical" }} />
          <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Call to action (optional)" className={v2 ? "st-body" : undefined} style={inpS} />
          <FormatControls align={align} onAlign={setAlign} variant={variant} />
        </div>
      </Labeled>

      {/* CUSTOM IMAGE — shown in the card's square (wins over a linked drink photo). */}
      <ImageUploadField
        url={imageUrl || undefined}
        onChange={(u) => setImageUrl(u)}
        label="IMAGE (optional)"
        note="Shows in the card's square. A custom image overrides a linked drink photo."
        variant={variant}
      />

      {/* DRINK LINK */}
      <ToastSourcePicker rows={toastRows} selected={toastGuid} onSelect={setToastGuid} variant={variant} />

      {/* WEBSITE — advertise this promo ahead of time (window/message only; MOMENTs are
          in-room theatre and never leave the room). */}
      {kind !== "moment" && (v2 ? (
        // v2: the shared ToggleSwitch (the Users page's on/off idiom) — a native `role=switch`
        // checkbox with a readable ON/OFF word, on the 44px row. Same state, same setter.
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ToggleSwitch checked={showOnWebsite} onChange={setShowOnWebsite} label="🌐 Advertise on the website" />
          {/* The hint sits UNDER the switch row (not inside its label) so the row stays one
              line at 390 with the ON/OFF word and track beside it. */}
          <span className="st-body st-t3" style={{ padding: "0 12px" }}>
            {kind === "message"
              ? "Messages reach the website ONLY when on (they run on the bar TVs regardless) — name + copy become public."
              : "Shows on the What's-On feed ahead of time — and while a window is running, the live feed shows it automatically."}
          </span>
        </div>
      ) : (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 16 }}>
          <input
            type="checkbox"
            checked={showOnWebsite}
            onChange={(e) => setShowOnWebsite(e.target.checked)}
            style={{ width: 22, height: 22, accentColor: "var(--terminal-green)", marginTop: 2, cursor: "pointer" }}
          />
          <span>
            🌐 ADVERTISE ON THE WEBSITE
            <span style={{ display: "block", fontSize: 14, opacity: 0.55 }}>
              {kind === "message"
                ? "messages reach the website ONLY when checked (they run on the bar TVs regardless) — name + copy become public."
                : "shows on the What's-On feed ahead of time — and while a window is running, the live feed shows it automatically."}
            </span>
          </span>
        </label>
      ))}

      {/* MOMENT extras */}
      {kind === "moment" && (
        <Labeled v2={v2} label="CHOREOGRAPHY (MOMENT)">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              {mini("SKIN")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {SKINS.map((s) => {
                  const on = skin === s.key;
                  return <button key={s.key} type="button" onClick={() => setSkin(s.key)} {...pressed(on)} className={segCls(on)} style={{ ...chipS, ...(on ? bold : null) }}>{v2 ? s.v2Label : s.label}</button>;
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {mini(v2 ? "TEASE" : "TEASE (min before)")}
                {v2 && <span className="st-body st-t3">Minutes before</span>}
                <input type="number" min={0} value={teaseMinutes} onChange={(e) => setTeaseMinutes(Math.max(0, Number(e.target.value) || 0))} className={v2 ? "st-body" : undefined} style={{ ...inpS, width: 100 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {mini(v2 ? "ALERT" : "ALERT (min before)")}
                {v2 && <span className="st-body st-t3">Minutes before</span>}
                <input type="number" min={0} value={alertMinutes} onChange={(e) => setAlertMinutes(Math.max(0, Number(e.target.value) || 0))} className={v2 ? "st-body" : undefined} style={{ ...inpS, width: 100 }} />
              </div>
            </div>
            {v2 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <ToggleSwitch checked={interruptGame} onChange={setInterruptGame} label="Interrupt a live trivia game?" />
                <span className="st-body st-t3" style={{ padding: "0 12px" }}>Trivia is sacred — leave OFF unless this moment must take the screens mid-game.</span>
              </div>
            ) : (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 16 }}>
                <input type="checkbox" checked={interruptGame} onChange={(e) => setInterruptGame(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--terminal-green)", marginTop: 2, cursor: "pointer" }} />
                <span>interrupt a live trivia game?<span style={{ display: "block", fontSize: 14, opacity: 0.55 }}>trivia is sacred — leave OFF unless this moment must take the screens mid-game.</span></span>
              </label>
            )}
          </div>
        </Labeled>
      )}

      {err && <div className={v2 ? "st-body st-danger" : "u-red"} style={v2 ? undefined : { fontSize: 16 }}>⚠ {err}</div>}

      {/* ACTIONS */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" disabled={!canSave || busy} onClick={() => save.mutate()} className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"} style={v2 ? { ...primaryV2, opacity: !canSave || busy ? 0.5 : 1 } : { ...primary, opacity: !canSave || busy ? 0.5 : 1 }}>
          {v2 ? (save.isPending ? "Saving…" : editing ? "Save changes" : "Create event") : (save.isPending ? "SAVING…" : editing ? "SAVE CHANGES" : "CREATE EVENT")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={v2 ? "st-btn st-body" : undefined} style={v2 ? ghostV2 : ghost}>{v2 ? "Cancel" : "CANCEL"}</button>

        {/* v2 asks through the ratified ConfirmDialog (below); classic keeps its confirm()s.
            The mutation each path fires is the same call with the same args. */}
        {editing && (
          isLive ? (
            <button type="button" disabled={busy} onClick={() => { if (v2) { setConfirming("abort"); return; } if (confirm("Abort this event? Screens drop it within ~30 seconds.")) abort.mutate(); }} className={v2 ? "st-btn st-amber st-body" : "u-amber"} style={v2 ? ghostV2 : { ...ghost, borderColor: "currentColor" }}>{v2 ? "■ Abort" : "■ ABORT"}</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => { if (v2) { setConfirming("fire"); return; } if (confirm(kind === "moment" ? "Fire this MOMENT now? It skips the tease and lands in ALERT." : "Put this on the screens now?")) fire.mutate(); }} className={v2 ? "st-btn st-amber st-body" : undefined} style={v2 ? ghostV2 : { ...ghost }}>{v2 ? "▶ Fire now" : "▶ FIRE NOW"}</button>
          )
        )}
        {editing && (
          // v2: DELETE is data loss — the danger ink (Beat 6 #111 pattern), pushed to the far edge.
          <button type="button" disabled={busy} onClick={() => { if (v2) { setConfirming("delete"); return; } if (confirm("Delete this event permanently?")) del.mutate(); }} className={v2 ? "st-btn st-btn-danger st-body" : "u-amber"} style={v2 ? { ...ghostV2, marginLeft: "auto" } : { ...ghost, marginLeft: "auto" }}>{v2 ? "Delete" : "DELETE"}</button>
        )}
      </div>

      {/* v2-only dialogs. Tiers per the owner's rulings (2026-09-12): FIRE NOW and ABORT are
          PLAIN — they change what the bar TVs show but destroy nothing; DELETE is DANGER.
          The FIRE NOW title/body is the v2 hub row's dialog copy, verbatim (SignageHubV2). */}
      {confirming === "fire" && editing && (
        <ConfirmDialog
          title={kind === "moment" ? "Fire this moment now?" : "Put this on the screens now?"}
          body={kind === "moment" ? "It skips the tease and lands in ALERT." : `“${editing.name}” goes onto the bar screens immediately.`}
          confirmLabel="Fire now"
          cancelLabel="Keep scheduled"
          busy={fire.isPending}
          onConfirm={() => { setConfirming(null); fire.mutate(); }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "abort" && editing && (
        <ConfirmDialog
          title="Abort this event?"
          // The classic confirm() sentence, kept — it is the line the owner reads.
          body="Screens drop it within ~30 seconds."
          confirmLabel="Abort event"
          cancelLabel="Keep it running"
          busy={abort.isPending}
          onConfirm={() => { setConfirming(null); abort.mutate(); }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "delete" && editing && (
        <ConfirmDialog
          title="Delete this event permanently?"
          // DECISION: the classic confirm() question is the TITLE; the body names the row so
          // the manager sees WHICH event the red button is about (the #111 danger pattern).
          body={`“${editing.name}” and its schedule are removed for good.`}
          confirmLabel="Delete event"
          cancelLabel="Keep event"
          danger
          busy={del.isPending}
          onConfirm={() => { setConfirming(null); del.mutate(); }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

function Labeled({ label, children, v2 = false }: { label: string; children: React.ReactNode; v2?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : { fontSize: 13, letterSpacing: 2, opacity: 0.6 }}>{label}</span>
      {children}
    </div>
  );
}

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
/** Preview-only venue-TZ conversion (same path the save uses). null when incomplete. */
function isoFor(date: string, time: string): string | null {
  if (!date || !time) return null;
  return venueLocalToUtc(date, time, VENUE_TZ);
}

/* ── styles ─────────────────────────────────────────────────────────────── */
const inp: CSSProperties = { background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", fontSize: 18, fontFamily: MONO, minHeight: 44, width: "100%", boxSizing: "border-box" };
const chip: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 14px", fontSize: 15, cursor: "pointer", fontFamily: MONO, minHeight: 44, letterSpacing: 1 };
const dayChip: CSSProperties = { ...chip, minWidth: 46, padding: "8px 6px", textAlign: "center" };
const miniChip: CSSProperties = { ...chip, padding: "4px 12px", fontSize: 13, minHeight: 32, letterSpacing: 1 };
const clearLink: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "none", borderBottom: "1px solid var(--terminal-green)", padding: 0, fontSize: 13, cursor: "pointer", fontFamily: MONO, opacity: 0.7 };
const bold: CSSProperties = { fontWeight: 700 };
const kindTile: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", textAlign: "left", background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const primary: CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 18px", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const ghost: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 14px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const miniLabel: CSSProperties = { fontSize: 12, letterSpacing: 2, opacity: 0.55 };

/* v2 twins: the same boxes, geometry only. No `fontFamily` (the role classes own the
 * face), no `background`/`color` (an inline colour cannot beat the theme's !important
 * green — the classes are what actually paint), and `border: "1px solid"` with no colour
 * so the token blanket paints the hairline (the ConfirmDialog idiom). `minWidth: TAP`
 * joins `minHeight` because the 44px floor is measured on BOTH axes (#103 NOTE-6) — which
 * is also why `miniChipV2` is not a 32px chip any more. */
const inpV2: CSSProperties = { border: "1px solid", padding: "10px 12px", minHeight: TAP, width: "100%", boxSizing: "border-box" };
const chipV2: CSSProperties = { border: "1px solid", padding: "8px 14px", cursor: "pointer", minWidth: TAP, minHeight: TAP };
const dayChipV2: CSSProperties = { ...chipV2, padding: "8px 6px", textAlign: "center" };
const miniChipV2: CSSProperties = { ...chipV2, padding: "4px 12px" };
const clearLinkV2: CSSProperties = { border: "1px solid", padding: "4px 12px", cursor: "pointer", minWidth: TAP, minHeight: TAP };
const kindTileV2: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", textAlign: "left", border: "1px solid", padding: "10px 12px", cursor: "pointer", minWidth: TAP, minHeight: TAP };
const primaryV2: CSSProperties = { border: "1px solid", padding: "10px 18px", fontWeight: 700, cursor: "pointer", minWidth: TAP, minHeight: TAP };
const ghostV2: CSSProperties = { border: "1px solid", padding: "10px 14px", cursor: "pointer", minWidth: TAP, minHeight: TAP };

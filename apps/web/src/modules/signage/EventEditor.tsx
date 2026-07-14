import { useMemo, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ToastCacheRow, EventKind } from "./useSignage";
import { ToastSourcePicker, ImageUploadField, FormatControls } from "./signageAdminShared";
import { alignOf, type Align } from "./richText";
import {
  DOW, DOW_LABEL, VENUE_TZ,
  saveEvent, fireNowEvent, abortEvent, deleteEvent,
  schedulePhrase, statusInfo, venueLocalParts, venueLocalToUtc,
  type EventRow, type EventDraft,
} from "./useEventsAdmin";

/**
 * EVENTS & PROMOS editor pane (docs/13 Controls · ux-refinement-mockup.html view 5).
 * The right pane of /signage/events — a manager names it, picks a kind, builds a schedule
 * with a live plain-language preview (NEVER cron), says what shows, optionally links a
 * drink, and (for MOMENTs) tunes the choreography. Mobile-first, ≥44px controls.
 */

const MONO = "'VT323','Share Tech Mono',monospace";

const KINDS: { key: EventKind; label: string; blurb: string }[] = [
  { key: "window", label: "WINDOW", blurb: "Calm recurring promo — a card + ticker line during the window." },
  { key: "message", label: "MESSAGE", blurb: "One-time message — a birthday, a shout-out, a notice." },
  { key: "moment", label: "MOMENT", blurb: "Full choreography — tease → alert → payoff, with a live counter." },
];
const SKINS: { key: string; label: string }[] = [
  { key: "launch", label: "LAUNCH" },
  { key: "infestation", label: "INFESTATION" },
  { key: "generic", label: "GENERIC" },
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

export function EventEditor({
  editing, presetKind, toastRows, onSaved, onCancel, onDeleted,
}: {
  editing: EventRow | null;
  presetKind?: EventKind;
  toastRows: ToastCacheRow[];
  onSaved: (id: string) => void;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const f = editing?.fields ?? {};
  const initParts = editing?.fire_at ? venueLocalParts(editing.fire_at) : null;
  const initRecurring = !!editing?.recurrence?.daysOfWeek?.length;

  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<EventKind>(editing?.kind ?? presetKind ?? "window");
  const [skin, setSkin] = useState(editing?.skin ?? "launch");
  const [toastGuid, setToastGuid] = useState<string | null>(editing?.toast_guid ?? null);

  const [mode, setMode] = useState<ScheduleMode>(initRecurring ? "recurring" : "oneshot");
  const [date, setDate] = useState(initParts?.date ?? todayLocal());
  const [time, setTime] = useState((initRecurring ? editing?.recurrence?.time : initParts?.time) ?? "16:00");
  const [days, setDays] = useState<string[]>(editing?.recurrence?.daysOfWeek ?? []);

  const [windowMinutes, setWindowMinutes] = useState(editing?.window_minutes ?? 180);
  const [teaseMinutes, setTeaseMinutes] = useState(editing?.tease_minutes ?? 60);
  const [alertMinutes, setAlertMinutes] = useState(editing?.alert_minutes ?? 5);
  const [interruptGame, setInterruptGame] = useState(editing?.interrupt_game ?? false);

  const [showOnWebsite, setShowOnWebsite] = useState(editing?.show_on_website ?? false);

  const [title, setTitle] = useState(str(f.title));
  const [body, setBody] = useState(str(f.body) || str(f.directive) || str(f.message));
  const [cta, setCta] = useState(str(f.cta));
  const [imageUrl, setImageUrl] = useState<string>(str(f.image_url));
  const [align, setAlign] = useState<Align>(alignOf(f));

  const [err, setErr] = useState<string | null>(null);

  const draft: EventDraft = useMemo(() => ({
    id: editing?.id,
    name,
    kind,
    skin,
    toast_guid: toastGuid,
    oneShot: mode === "oneshot" ? { date, time } : null,
    recurrence: mode === "recurring" ? { daysOfWeek: days, time } : null,
    window_minutes: windowMinutes,
    tease_minutes: teaseMinutes,
    alert_minutes: alertMinutes,
    interrupt_game: interruptGame,
    title, body, cta,
    imageUrl,
    align,
    showOnWebsite,
    baseFields: editing?.fields,
    status: editing?.status,
  }), [editing, name, kind, skin, toastGuid, mode, date, time, days, windowMinutes, teaseMinutes, alertMinutes, interruptGame, title, body, cta, imageUrl, align, showOnWebsite]);

  // Live plain-language preview of exactly what the manager just built (no cron, ever).
  const preview = useMemo(() => {
    if (mode === "recurring" && !days.length) return "pick at least one day";
    return schedulePhrase(
      { kind, fire_at: mode === "oneshot" ? isoFor(date, time) : null, recurrence: mode === "recurring" ? { daysOfWeek: days, time } : null, window_minutes: windowMinutes },
      VENUE_TZ,
    );
  }, [mode, days, kind, date, time, windowMinutes]);

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
    (mode === "oneshot" ? !!date && !!time : days.length > 0 && !!time);
  // Live-on-screen = abortable now. A window fired seconds ago is still `scheduled` until
  // the minute tick promotes it to `running`, but it is already on the TVs — so gate ABORT
  // on the actual display window, not just the status column.
  const isLive = !!editing && statusInfo(editing).tone === "now";
  const busy = save.isPending || fire.isPending || abort.isPending || del.isPending;

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.5 }}>{editing ? "EDITING" : "NEW EVENT"}</div>

      {/* NAME */}
      <Labeled label="NAME">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Happy Hour" style={inp} />
      </Labeled>

      {/* KIND */}
      <Labeled label="KIND">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {KINDS.map((k) => {
            const on = kind === k.key;
            return (
              <button key={k.key} type="button" onClick={() => setKind(k.key)} className={on ? "u-fill u-ink" : ""}
                style={{ ...kindTile, ...(on ? { fontWeight: 700 } : null) }}>
                <span style={{ fontSize: 18, letterSpacing: 1 }}>{k.label}</span>
                <span style={{ fontSize: 14, opacity: on ? 0.85 : 0.6, letterSpacing: 0 }}>{k.blurb}</span>
              </button>
            );
          })}
        </div>
      </Labeled>

      {/* SCHEDULE */}
      <Labeled label="SCHEDULE">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setMode("oneshot")} className={mode === "oneshot" ? "u-fill u-ink" : ""} style={{ ...chip, ...(mode === "oneshot" ? bold : null) }}>ONE-SHOT</button>
          <button type="button" onClick={() => setMode("recurring")} className={mode === "recurring" ? "u-fill u-ink" : ""} style={{ ...chip, ...(mode === "recurring" ? bold : null) }}>RECURRING</button>
        </div>

        {mode === "oneshot" ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={miniLabel}>DATE</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={miniLabel}>START</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inp} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <span style={miniLabel}>DAYS</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DOW.map((d) => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)} className={on ? "u-fill u-ink" : ""}
                    title={DOW_LABEL[d]} style={{ ...dayChip, ...(on ? bold : null) }}>{d}</button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={miniLabel}>START TIME</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inp, maxWidth: 160 }} />
            </div>
          </div>
        )}

        {/* DURATION */}
        <div style={{ marginTop: 10 }}>
          <span style={miniLabel}>DURATION</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {DURATIONS.map((d) => {
              const on = windowMinutes === d.minutes;
              return (
                <button key={d.label} type="button" onClick={() => setWindowMinutes(d.minutes)} className={on ? "u-fill u-ink" : ""} style={{ ...chip, ...(on ? bold : null) }}>{d.label}</button>
              );
            })}
            <button type="button" onClick={() => setWindowMinutes(minutesToClose(time))} className={windowMinutes === minutesToClose(time) ? "u-fill u-ink" : ""} style={{ ...chip, ...(windowMinutes === minutesToClose(time) ? bold : null) }}>TILL CLOSE</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input type="number" min={1} value={windowMinutes} onChange={(e) => setWindowMinutes(Math.max(1, Number(e.target.value) || 1))} style={{ ...inp, width: 84, padding: "8px 8px" }} />
              <span style={{ fontSize: 14, opacity: 0.6 }}>min</span>
            </span>
          </div>
        </div>

        {/* live plain-phrase preview */}
        <div style={{ marginTop: 10, fontSize: 16, letterSpacing: 1 }}>
          <span style={{ opacity: 0.5 }}>WILL RUN: </span>
          <span className="u-amber">{preview}</span>
        </div>
      </Labeled>

      {/* WHAT SHOWS */}
      <Labeled label="WHAT SHOWS">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Headline (defaults to the name)" style={inp} />
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "moment" ? "Directive / body line" : "Body line"} style={{ ...inp, resize: "vertical" }} />
          <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Call to action (optional)" style={inp} />
          <FormatControls align={align} onAlign={setAlign} />
        </div>
      </Labeled>

      {/* CUSTOM IMAGE — shown in the card's square (wins over a linked drink photo). */}
      <ImageUploadField
        url={imageUrl || undefined}
        onChange={(u) => setImageUrl(u)}
        label="IMAGE (optional)"
        note="Shows in the card's square. A custom image overrides a linked drink photo."
      />

      {/* DRINK LINK */}
      <ToastSourcePicker rows={toastRows} selected={toastGuid} onSelect={setToastGuid} />

      {/* WEBSITE — advertise this promo ahead of time (window/message only; MOMENTs are
          in-room theatre and never leave the room). */}
      {kind !== "moment" && (
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
      )}

      {/* MOMENT extras */}
      {kind === "moment" && (
        <Labeled label="CHOREOGRAPHY (MOMENT)">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <span style={miniLabel}>SKIN</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {SKINS.map((s) => {
                  const on = skin === s.key;
                  return <button key={s.key} type="button" onClick={() => setSkin(s.key)} className={on ? "u-fill u-ink" : ""} style={{ ...chip, ...(on ? bold : null) }}>{s.label}</button>;
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={miniLabel}>TEASE (min before)</span>
                <input type="number" min={0} value={teaseMinutes} onChange={(e) => setTeaseMinutes(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 100 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={miniLabel}>ALERT (min before)</span>
                <input type="number" min={0} value={alertMinutes} onChange={(e) => setAlertMinutes(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 100 }} />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 16 }}>
              <input type="checkbox" checked={interruptGame} onChange={(e) => setInterruptGame(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--terminal-green)", marginTop: 2, cursor: "pointer" }} />
              <span>interrupt a live trivia game?<span style={{ display: "block", fontSize: 14, opacity: 0.55 }}>trivia is sacred — leave OFF unless this moment must take the screens mid-game.</span></span>
            </label>
          </div>
        </Labeled>
      )}

      {err && <div className="u-red" style={{ fontSize: 16 }}>⚠ {err}</div>}

      {/* ACTIONS */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" disabled={!canSave || busy} onClick={() => save.mutate()} className="u-fill u-ink" style={{ ...primary, opacity: !canSave || busy ? 0.5 : 1 }}>
          {save.isPending ? "SAVING…" : editing ? "SAVE CHANGES" : "CREATE EVENT"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={ghost}>CANCEL</button>

        {editing && (
          isLive ? (
            <button type="button" disabled={busy} onClick={() => { if (confirm("Abort this event? Screens drop it within ~30 seconds.")) abort.mutate(); }} className="u-amber" style={{ ...ghost, borderColor: "currentColor" }}>■ ABORT</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => { if (confirm(kind === "moment" ? "Fire this MOMENT now? It skips the tease and lands in ALERT." : "Put this on the screens now?")) fire.mutate(); }} style={{ ...ghost }}>▶ FIRE NOW</button>
          )
        )}
        {editing && (
          <button type="button" disabled={busy} onClick={() => { if (confirm("Delete this event permanently?")) del.mutate(); }} className="u-amber" style={{ ...ghost, marginLeft: "auto" }}>DELETE</button>
        )}
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, letterSpacing: 2, opacity: 0.6 }}>{label}</span>
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
const bold: CSSProperties = { fontWeight: 700 };
const kindTile: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", textAlign: "left", background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const primary: CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 18px", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const ghost: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 14px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const miniLabel: CSSProperties = { fontSize: 12, letterSpacing: 2, opacity: 0.55 };

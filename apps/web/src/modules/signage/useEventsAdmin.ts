import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import type { EventKind, EventFlavor } from "./eventStage";

/**
 * Data + logic layer for the STAFF events console (/signage/events — docs/13).
 *
 * Writer counterpart to useSignage's anon `signage_events_live` reader. Every write to
 * scheduled_events requires has_module('events') (RLS 0035 / 0024) — the app never bypasses
 * RLS. The self-running tick (pg_cron `scheduled-events-tick-1m`, migration 0035) flips
 * status and re-arms recurrence server-side; this layer only creates/edits rows and nudges
 * status (pause/resume/fire-now/abort). Toast is READ-ONLY (a picker source only).
 *
 * All schedule math is venue-local (America/Chicago) and mirrors 0035's SQL
 * (next_scheduled_occurrence) so the row a manager builds here lands with the exact
 * recurrence shape + venue-TZ fire_at the tick expects.
 */

// DECISION: the venue is single-timezone and every display surface (useTicker.ts,
// migration 0035's tick) already hardcodes America/Chicago rather than round-tripping
// venues.timezone. Match that precedent here — one constant, no fetch. If the platform
// ever goes multi-venue this becomes a venue_settings read in one place.
export const VENUE_TZ = "America/Chicago";

export const DOW = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Dow = (typeof DOW)[number];
export const DOW_LABEL: Record<Dow, string> = {
  MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};
// SU=0 … SA=6 (JS getUTCDay / Postgres extract(dow)).
const DOW_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export type EventStatus = "scheduled" | "running" | "completed" | "aborted" | "disabled";

export interface EventRecurrence {
  daysOfWeek: string[];
  time: string; // "HH:MM" venue-local
  // Optional inclusive end date, venue-local "YYYY-MM-DD" (0041). Empty/absent = runs
  // forever. DECISION: stored inside the recurrence jsonb (not a new column) — it's part
  // of the schedule shape the tick reads; next_scheduled_occurrence() enforces it (returns
  // null once the next occurrence falls after `until`), so this client math just mirrors it.
  until?: string;
}

export interface EventRow {
  id: string;
  name: string;
  kind: EventKind;
  skin: string;
  fields: Record<string, unknown>;
  toast_guid: string | null;
  fire_at: string | null;
  recurrence: EventRecurrence | null;
  tease_minutes: number;
  alert_minutes: number;
  window_minutes: number;
  interrupt_game: boolean;
  status: EventStatus;
  show_on_website: boolean;
  created_at: string | null;
}

/* ── query ───────────────────────────────────────────────────────────────── */

const SELECT =
  "id, name, kind, skin, fields, toast_guid, fire_at, recurrence, tease_minutes, alert_minutes, window_minutes, interrupt_game, status, show_on_website, created_at";

export function useEventsList() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["events-admin", "list"],
    // Status labels (ACTIVE NOW windows, next-occurrence) drift with the clock and the
    // server tick; a slow re-poll keeps the console honest without a manual refresh (this
    // is admin, not a display — the sub-30s display rule governs /signage/s, not here).
    refetchInterval: 30_000,
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase
        .from("scheduled_events")
        .select(SELECT)
        .eq("venue_id", VENUE_ID)
        .order("created_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("events-admin:list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_events", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["events-admin", "list"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/* ── venue-TZ time math (mirrors 0035 next_scheduled_occurrence) ──────────── */

function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** Offset (ms) of `tz` at the instant `utcMs`: (venue wall-clock) − (UTC). DST-correct. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUTC - utcMs;
}

/** A venue-local wall time (Y-M-D + HH:MM) → the UTC instant, as an ISO string. */
export function venueLocalToUtc(dateStr: string, timeStr: string, tz: string = VENUE_TZ): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  const off = tzOffsetMs(asUTC, tz);
  return new Date(asUTC - off).toISOString();
}

/** A stored instant → venue-local form values { date:"YYYY-MM-DD", time:"HH:MM" } for the
 *  editor's date/time inputs. Inverse of venueLocalToUtc. */
export function venueLocalParts(iso: string, tz: string = VENUE_TZ): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(iso))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Venue-local Y-M-D of an instant. */
function ymdInTz(at: Date, tz: string): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
  return { y: +p.year, mo: +p.month, d: +p.day };
}

/**
 * Earliest instant strictly AFTER `after` whose venue-local weekday ∈ daysOfWeek and
 * venue-local time is `time`. Byte-for-byte the SQL scan in 0035 (today..+7 local days),
 * so the row the manager creates matches what the tick will recompute. null = no schedule.
 */
export function nextOccurrence(
  daysOfWeek: string[] | undefined,
  time: string | undefined,
  after: Date,
  tz: string = VENUE_TZ,
  until?: string, // inclusive venue-local "YYYY-MM-DD"; occurrences after it → null (0041)
): Date | null {
  if (!daysOfWeek?.length || !time) return null;
  const allowed = new Set(daysOfWeek.map((d) => DOW_INDEX[d.toUpperCase()]).filter((x) => x != null));
  if (!allowed.size) return null;
  const untilDate = until && until.trim() ? until.trim() : null;

  const { y, mo, d } = ymdInTz(after, tz);
  for (let i = 0; i <= 7; i++) {
    const base = new Date(Date.UTC(y, mo - 1, d));
    base.setUTCDate(base.getUTCDate() + i);
    if (allowed.has(base.getUTCDay())) {
      const candLocalDate = `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
      const iso = venueLocalToUtc(candLocalDate, time, tz);
      if (new Date(iso).getTime() > after.getTime()) {
        // Inclusive cutoff (mirrors 0041 SQL): fires ON `until`, retires strictly after.
        // Lexicographic compare on YYYY-MM-DD is chronological.
        if (untilDate && candLocalDate > untilDate) return null;
        return new Date(iso);
      }
    }
  }
  return null;
}

/* ── plain-language phrasing (a manager never reads cron, docs/13 guardrail) ─ */

function fmtTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(new Date(ms))
    .replace(":00", "");
}
function fmtDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(ms));
}
function fmtWeekday(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms)).toUpperCase();
}

/** "Every day" when all seven are picked; else "Mon · Wed"; else "Mondays" for a single day. */
function daysPhrase(days: string[]): string {
  const norm = days.map((d) => d.toUpperCase());
  if (norm.length === 7) return "daily";
  if (norm.length === 1) {
    const one = DOW_LABEL[norm[0] as Dow] ?? norm[0];
    return `${one}s`;
  }
  return DOW.filter((d) => norm.includes(d)).map((d) => DOW_LABEL[d]).join(" · ");
}

/** Is a venue-local wall time exactly 2:00 AM (the venue close, docs/14 hours 4PM–2AM)? */
function isCloseTime(ms: number, tz: string): boolean {
  const t = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return t === "02:00";
}

/** Recurrence as read off a row can have optional keys (loose select shapes); the phrase +
 *  status helpers guard for presence, so accept the permissive form. */
type LooseRecurrence = { daysOfWeek?: string[]; time?: string; until?: string } | null;

interface SchedulableShape {
  kind: EventKind;
  fire_at: string | null;
  recurrence: LooseRecurrence;
  window_minutes: number;
}

/**
 * The manager-facing schedule phrase for a row:
 *   recurring window → "daily · 4–7 PM" / "Mondays 4 PM–close"
 *   one-shot         → "Jul 26 · 4–6 PM · one-shot"
 * MOMENTs read the same (they just also run the stage arc). Never any cron text.
 */
export function schedulePhrase(row: SchedulableShape, tz: string = VENUE_TZ): string {
  const rec = row.recurrence;
  if (rec?.daysOfWeek?.length && rec.time) {
    // Anchor an arbitrary matching occurrence to format the wall times (any works — the
    // wall-clock start/end are recurrence-defined, not date-specific). Anchor at epoch 0 so
    // `until` never suppresses the sample occurrence used only for phrasing.
    const start = nextOccurrence(rec.daysOfWeek, rec.time, new Date(0), tz) ?? new Date();
    const startMs = start.getTime();
    const endMs = startMs + row.window_minutes * 60_000;
    const end = isCloseTime(endMs, tz) ? "close" : fmtTime(endMs, tz);
    let phrase = `${daysPhrase(rec.daysOfWeek)} · ${fmtTime(startMs, tz)}–${end}`;
    // Recurring end date (0041) — "… until Sep 1". Surfaced everywhere the phrase renders
    // (editor WILL RUN preview + the events list) so long-runners are auditable at a glance.
    if (rec.until && rec.until.trim()) {
      const uMs = new Date(venueLocalToUtc(rec.until.trim(), "12:00", tz)).getTime();
      phrase += ` until ${fmtDate(uMs, tz)}`;
    }
    return phrase;
  }
  if (row.fire_at) {
    const startMs = new Date(row.fire_at).getTime();
    const endMs = startMs + row.window_minutes * 60_000;
    // A long one-shot window can span days/months (0041) — show both dates so the end time
    // alone isn't ambiguous: "Jul 14 4 PM → Sep 1 11:59 PM · one-shot".
    if (venueLocalParts(new Date(endMs).toISOString(), tz).date !== venueLocalParts(row.fire_at, tz).date) {
      return `${fmtDate(startMs, tz)} ${fmtTime(startMs, tz)} → ${fmtDate(endMs, tz)} ${fmtTime(endMs, tz)} · one-shot`;
    }
    const end = isCloseTime(endMs, tz) ? "close" : fmtTime(endMs, tz);
    return `${fmtDate(startMs, tz)} · ${fmtTime(startMs, tz)}–${end} · one-shot`;
  }
  return "not scheduled";
}

/* ── status resolution (mirrors the display horizon) ─────────────────────── */

export type StatusTone = "now" | "up" | "one" | "done";
export interface StatusInfo { label: string; tone: StatusTone }

interface StatusShape {
  kind: EventKind;
  status: EventStatus;
  fire_at: string | null;
  recurrence: LooseRecurrence;
  window_minutes: number;
}

/** True when `now` is inside the row's active on-screen window (same bounds as the
 *  display: window/message = [fire, fire+window); moment = [fire, fire+window)). */
function inActiveWindow(row: StatusShape, now: number): boolean {
  if (!row.fire_at) return false;
  const F = new Date(row.fire_at).getTime();
  return now >= F && now < F + row.window_minutes * 60_000;
}

export function statusInfo(row: StatusShape, now: number = Date.now(), tz: string = VENUE_TZ): StatusInfo {
  if (row.status === "completed") return { label: "DONE", tone: "done" };
  if (row.status === "aborted") return { label: "ABORTED", tone: "done" };
  if (row.status === "disabled") return { label: "○ PAUSED", tone: "done" };
  if (row.status === "running" || inActiveWindow(row, now)) return { label: "● ACTIVE NOW", tone: "now" };
  // scheduled, not yet in-window:
  if (row.fire_at && new Date(row.fire_at).getTime() > now) {
    if (row.recurrence?.daysOfWeek?.length) return { label: `next ${fmtWeekday(new Date(row.fire_at).getTime(), tz)}`, tone: "up" };
    return { label: "one-shot", tone: "one" };
  }
  // fire_at missing or in the past — the tick re-arms it on its next pass.
  return { label: "queued", tone: "up" };
}

/* ── draft + mutations ───────────────────────────────────────────────────── */

export interface EventDraft {
  id?: string;
  name: string;
  kind: EventKind;
  skin: string;
  toast_guid: string | null;
  // schedule: exactly one of one-shot vs recurring is meaningful
  oneShot: { date: string; time: string } | null; // venue-local
  recurrence: EventRecurrence | null;
  window_minutes: number;
  tease_minutes: number;
  alert_minutes: number;
  interrupt_game: boolean;
  // PROMO vs BULLETIN voice (owner beat) — window/message only; null = follow the kind
  // default (window → promo, message → bulletin). Persisted onto fields.flavor.
  flavor?: EventFlavor | null;
  // what shows
  title: string;
  body: string;
  cta: string;
  // custom image (public URL) + basic formatting (Phase 8). null/"" clears.
  imageUrl?: string | null;
  align?: "left" | "center";
  // 🌐 advertise this event on the public website's What's-On feed ahead of time
  // (scheduled_events.show_on_website — column from 0015, opt-in per PR #13 F6).
  showOnWebsite?: boolean;
  // preserve existing fields on edit (live_count, final_stats, skin overrides)
  baseFields?: Record<string, unknown>;
  status?: EventStatus;
  // The row's current fire_at (edit only). WARN-1 fallback: when a recurring `until`
  // kills the next occurrence, keep this instant so the tick completes the row at the
  // current/last window's end instead of nulling fire_at and stranding it.
  existingFireAt?: string | null;
}

/** Build the fields jsonb, preserving any counter/stats/skin keys already on the row. */
function buildFields(draft: EventDraft): Record<string, unknown> {
  const f: Record<string, unknown> = { ...(draft.baseFields ?? {}) };
  const set = (k: string, v: string) => { const t = v.trim(); if (t) f[k] = t; else delete f[k]; };
  set("title", draft.title);
  set("body", draft.body);
  set("cta", draft.cta);
  // MOMENT alert/all-clear read `directive`; mirror body into it so one field drives both
  // render paths (window card reads body-or-directive, alert reads directive).
  if (draft.kind === "moment") set("directive", draft.body);
  else delete f.directive;
  // Custom image URL (Phase 8) — the display cards prefer it over a linked drink photo.
  if (draft.imageUrl && draft.imageUrl.trim()) f.image_url = draft.imageUrl.trim();
  else delete f.image_url;
  // Basic formatting — only persist a non-default alignment; center is the board default.
  if (draft.align === "left") f.align = "left";
  else delete f.align;
  // PROMO/BULLETIN flavor (owner beat). MOMENTs have no flavor toggle (full choreography),
  // so only persist for window/message; null/undefined leaves the field off → the renderer's
  // kind-based default applies (window → promo, message → bulletin), preserving back-compat.
  if ((draft.kind === "window" || draft.kind === "message") && (draft.flavor === "promo" || draft.flavor === "bulletin")) {
    f.flavor = draft.flavor;
  } else {
    delete f.flavor;
  }
  return f;
}

/** Resolve the fire_at a draft should store (venue-TZ). Recurring → next occurrence. */
export function draftFireAt(draft: EventDraft, now: Date = new Date()): string | null {
  if (draft.recurrence?.daysOfWeek?.length && draft.recurrence.time) {
    const next = nextOccurrence(draft.recurrence.daysOfWeek, draft.recurrence.time, now, VENUE_TZ, draft.recurrence.until)?.toISOString();
    // WARN-1: an `until` that kills the next occurrence must NOT null out fire_at — a row
    // with fire_at null drops out of both the tick and signage_events_live (they filter
    // `fire_at is not null`), so a running row would zombie forever. Fall back to the row's
    // existing fire_at (same pattern as resumeEvent) so the tick completes it naturally at
    // the current/last window's end. A brand-new row with no existing fire_at whose `until`
    // precedes the first occurrence is blocked in the editor (scheduleError), never inserted.
    return next ?? draft.existingFireAt ?? null;
  }
  if (draft.oneShot?.date && draft.oneShot.time) {
    return venueLocalToUtc(draft.oneShot.date, draft.oneShot.time, VENUE_TZ);
  }
  return null;
}

export async function saveEvent(draft: EventDraft): Promise<string> {
  const fire_at = draftFireAt(draft);
  const payload = {
    name: draft.name.trim(),
    kind: draft.kind,
    skin: draft.skin,
    toast_guid: draft.toast_guid,
    fire_at,
    recurrence: draft.recurrence,
    window_minutes: draft.window_minutes,
    // WINDOW/MESSAGE have no tease/alert lead-in (they never take over); keep 0 so the
    // horizon view + tick treat them as pure rotation cards (docs/13).
    tease_minutes: draft.kind === "moment" ? draft.tease_minutes : 0,
    alert_minutes: draft.kind === "moment" ? draft.alert_minutes : 0,
    interrupt_game: draft.kind === "moment" ? draft.interrupt_game : false,
    // Owner opt-in — advertise ahead of time on the public site. Only WINDOW/MESSAGE
    // events are surfaced there (public_events + the What's-On feed); MOMENTs are
    // in-room theatre, so never flag them (the editor hides the toggle for moments).
    show_on_website: draft.kind === "moment" ? false : !!draft.showOnWebsite,
    fields: buildFields(draft),
  };

  if (draft.id) {
    // Preserve the current status (pause/resume is a separate control) — only refresh
    // schedule + content here.
    const { error } = await supabase.from("scheduled_events").update(payload).eq("id", draft.id);
    if (error) throw error;
    return draft.id;
  }
  const { data, error } = await supabase
    .from("scheduled_events")
    .insert({ venue_id: VENUE_ID, status: "scheduled", ...payload })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Pause = status disabled (drops out of the horizon view → off every screen). */
export async function pauseEvent(id: string): Promise<void> {
  const { error } = await supabase.from("scheduled_events").update({ status: "disabled" }).eq("id", id);
  if (error) throw error;
}

/** Resume = back to scheduled; re-arm fire_at to the next future occurrence for a
 *  recurring event so a long-paused promo doesn't wake up stuck in the past. */
export async function resumeEvent(row: EventRow): Promise<void> {
  const patch: { status: EventStatus; fire_at?: string | null } = { status: "scheduled" };
  if (row.recurrence?.daysOfWeek?.length && row.recurrence.time) {
    patch.fire_at = nextOccurrence(row.recurrence.daysOfWeek, row.recurrence.time, new Date(), VENUE_TZ, row.recurrence.until)?.toISOString() ?? row.fire_at;
  }
  const { error } = await supabase.from("scheduled_events").update(patch).eq("id", row.id);
  if (error) throw error;
}

/**
 * FIRE NOW — put it on the screens immediately (docs/13 Controls).
 *   moment      : fire_at = now + alert_minutes (skips the tease, lands straight in ALERT)
 *   window/msg  : fire_at = now (card materializes on the next display poll)
 * Always status=scheduled; the tick promotes it to running within the minute, but the
 * horizon view already exposes a scheduled in-window row so screens don't wait for the tick.
 */
export async function fireNowEvent(row: EventRow): Promise<void> {
  const now = Date.now();
  const fire = row.kind === "moment" ? now + row.alert_minutes * 60_000 : now;
  const { error } = await supabase
    .from("scheduled_events")
    .update({ fire_at: new Date(fire).toISOString(), status: "scheduled" })
    .eq("id", row.id);
  if (error) throw error;
}

/** ABORT — status aborted; the horizon view drops it, screens return to normal within a
 *  display poll (~30s). A recurring event will re-arm on the tick's next completion pass. */
export async function abortEvent(id: string): Promise<void> {
  const { error } = await supabase.from("scheduled_events").update({ status: "aborted" }).eq("id", id);
  if (error) throw error;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from("scheduled_events").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Patch a few keys of an event's `fields` jsonb WITHOUT touching schedule/status/content
 * (used by the EDIT ROTATION live-queue editor to write fields.rotation_sort and
 * fields.duration_seconds when a manager reorders/retimes an active WINDOW/MESSAGE card).
 *
 * Read-modify-write against a FRESH select (not the possibly-stale display copy) so a
 * concurrent toast-sync counter write (fields.live_count) isn't clobbered by an old
 * snapshot. Requires has_module('events') for both the select and the update (RLS 0035) —
 * the caller gates the controls on that, so a signage-only user never reaches here.
 */
export async function setEventFields(id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from("scheduled_events").select("fields").eq("id", id).single();
  if (error) throw error;
  const merged = { ...((data?.fields as Record<string, unknown> | null) ?? {}), ...patch };
  const { error: uerr } = await supabase.from("scheduled_events").update({ fields: merged }).eq("id", id);
  if (uerr) throw uerr;
}

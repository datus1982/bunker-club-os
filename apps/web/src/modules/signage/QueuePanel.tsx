import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  activeTakeoverForSlot, DURATION_CHOICES,
  type AdminItem, type AdminSlot, type AdminTakeover,
} from "./useSignageAdmin";
import {
  resolveRotation, eventStage, compareRotation, useVenueClock, itemAirsToday,
  type SignageItem, type LiveEvent, type EventStage, type ToastCacheRow,
} from "./useSignage";
import { setEventFields, VENUE_TZ } from "./useEventsAdmin";
import { removeFromQueue } from "./slotQueue";
import {
  SectionLabel, ItemRow, EventKindBadge, sourceHideReason,
  MONO, primary, iconBtn, badge, caption,
} from "./signageAdminShared";
import { TAP, staffSurface } from "@/shared/ui/tokens";

/**
 * QUEUE slide-over (docs/signage-hub-consolidation-mockup.html view 4) — the PR #29 live-queue
 * editor, unchanged in feel, now over library assets on a junction (slot_queue).
 *
 * It renders the EXACT ordered list the TV resolves right now (resolveRotation on the same
 * inputs — the hub/TV parity invariant, PR #12), interleaving:
 *   • authored assets queued on this screen (▲/▼/SECS write slot_queue.position/duration; ✕
 *     unqueues from THIS screen only — D4; DELETE lives in the asset editor),
 *   • active WINDOW/MESSAGE event cards as venue-wide "ALL SCREENS" rows (reordering one writes
 *     scheduled_events.fields.rotation_sort → moves it on every screen, as today), and
 *   • read-only ★ SCREENS Toast trailers (managed at the POS).
 * A MOMENT / takeover / live game that pre-empts the screen surfaces as a read-only banner.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 3) — `variant`.
 *
 * This panel is SHARED with the classic hub, so every v2 page mounts it OUTSIDE the
 * `[data-st-page]` token scope on purpose — and it arrived green. `variant="v2"` is how a
 * v2 caller says "token this one": the frame is PR 1's `.st-sheet` drawer (threaded by
 * HubOverlays into `SlideOver`) and the leaves below swap their green literals for the
 * token roles. ONE component, one tree, a `v2` branch at each LEAF — not a v2 twin. Two
 * copies of the list the TV resolves is how the hub and the TV would start disagreeing
 * (the hub/TV parity invariant).
 *
 * CLASSIC IS BYTE-IDENTICAL: every branched `style` is a WHOLE-OBJECT ternary whose
 * classic arm is the shipped literal, key for key, so the serialised attribute does not
 * even reorder. NOTHING ABOUT BEHAVIOUR MOVES: same `resolveRotation` inputs, same
 * `moveEvent` / `setEventSecs` / `remove` mutations with the same args, same `ItemRow`
 * (which gets `variant` too — its ✕ becomes a plain ConfirmDialog on v2 only).
 * Rows are `st-row` (hairline, no fill — the §B addendum: sheet contents separate by
 * hairline, never a fill tier); the pre-empt banners are `st-callout-warn` /
 * `st-callout-danger`; `● NOW` is `st-live`, the app's true-LIVE ink.
 * ──────────────────────────────────────────────────────────────────────────────────── */
export function QueuePanel({
  slot, slotItems, toastRows, liveEvents, gameOn, takeovers, canEvents,
  onAdd, onEditAsset, onChanged, onEventsChanged, onTakeover, variant = "classic",
}: {
  slot: AdminSlot;
  /** THIS slot's authored items (active AND paused), sorted by sort_order (= position). */
  slotItems: AdminItem[];
  toastRows: ToastCacheRow[];
  liveEvents: LiveEvent[];
  gameOn: boolean;
  takeovers: AdminTakeover[];
  canEvents: boolean;
  onAdd: () => void;
  onEditAsset: (item: AdminItem) => void;
  onChanged: () => void;
  onEventsChanged: () => void;
  onTakeover: () => void;
  /** "v2" renders the tokened leaves (Beat 8 PR 3). Defaults to the shipped classic panel. */
  variant?: "classic" | "v2";
}) {
  const v2 = variant === "v2";
  // 30s tick so time-windows + event stages re-evaluate without a manual refresh.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);

  const tmap = useMemo(() => {
    const m = new Map<string, ToastCacheRow>();
    for (const r of toastRows) m.set(r.guid, r);
    return m;
  }, [toastRows]);

  // THE LIVE QUEUE — resolveRotation on the same inputs the TV gets (ACTIVE authored items,
  // the Toast map, now, the live events). Ground truth for what's on screen this minute.
  const activeAuthored = useMemo(() => slotItems.filter((it) => it.active) as SignageItem[], [slotItems]);
  // The venue clock the weekday gate reasons in — passed so this list matches the TV's exactly
  // (hub/TV parity: an off-today asset must be dimmed here, never shown as ● NOW).
  const venueClock = useVenueClock();
  const liveQueue = useMemo(
    () => resolveRotation(activeAuthored, tmap, now, liveEvents, { venue: venueClock }),
    [activeAuthored, tmap, now, liveEvents, venueClock],
  );
  const liveIds = useMemo(() => new Set(liveQueue.map((r) => r.id)), [liveQueue]);
  const eventCards = useMemo(() => liveQueue.filter((r) => r.id.startsWith("event:")), [liveQueue]);
  const screensCards = useMemo(() => liveQueue.filter((r) => r.id.startsWith("screens:")), [liveQueue]);

  // Combined display list, ordered by the SAME comparator resolveRotation sorts by
  // (compareRotation = sort_order then id) — never a hand-rolled concat — so the editor and TV
  // agree even on ties (WARN-1).
  type Row =
    | { kind: "authored"; id: string; item: AdminItem; order: number }
    | { kind: "event"; id: string; card: SignageItem; ev: LiveEvent; order: number }
    | { kind: "screens"; id: string; card: SignageItem; order: number };
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [
      ...slotItems.map((it) => ({ kind: "authored" as const, id: it.id, item: it, order: it.sort_order })),
      ...eventCards.map((c) => ({ kind: "event" as const, id: c.id, card: c, ev: c.event as LiveEvent, order: c.sort_order })),
      ...screensCards.map((c) => ({ kind: "screens" as const, id: c.id, card: c, order: c.sort_order })),
    ];
    return list.sort((a, b) => compareRotation({ sort_order: a.order, id: a.id }, { sort_order: b.order, id: b.id }));
  }, [slotItems, eventCards, screensCards]);

  const momentBanners = useMemo(
    () =>
      liveEvents
        .filter((ev) => ev.kind === "moment")
        .map((ev) => ({ ev, stage: eventStage(ev, now) }))
        .filter((x): x is { ev: LiveEvent; stage: EventStage } => x.stage !== null),
    [liveEvents, now],
  );
  const takeover = activeTakeoverForSlot(takeovers, slot.id, now.getTime());

  // Reorder an active event card by writing rotation_sort as the midpoint of its neighbours.
  // rotation_sort lives on the VENUE-WIDE event row — reordering here moves it on every screen
  // (surfaced via the ALL SCREENS tag + the caveat line), as in PR #29.
  const moveEvent = useMutation({
    mutationFn: async ({ idx, dir }: { idx: number; dir: -1 | 1 }) => {
      const entry = rows[idx];
      if (entry.kind !== "event") return;
      let order: number;
      if (dir === -1) {
        const below = rows[idx - 1].order;
        const above = idx - 2 >= 0 ? rows[idx - 2].order : below - 2;
        order = (above + below) / 2;
      } else {
        const above = rows[idx + 1].order;
        const below = idx + 2 < rows.length ? rows[idx + 2].order : above + 2;
        order = (above + below) / 2;
      }
      await setEventFields(entry.ev.id, { rotation_sort: order });
    },
    onSuccess: onEventsChanged,
  });
  const setEventSecs = useMutation({
    mutationFn: ({ id, secs }: { id: string; secs: number }) => setEventFields(id, { duration_seconds: secs }),
    onSuccess: onEventsChanged,
  });
  // ✕ REMOVE — unqueue an authored asset from THIS screen only (D4). The asset + its other
  // placements survive; DELETE-the-asset is in the asset editor.
  const remove = useMutation({
    mutationFn: (itemId: string) => removeFromQueue(slot.id, itemId),
    onSuccess: onChanged,
  });

  // Authored-item neighbours for ▲/▼ are the adjacent AUTHORED rows (event/★ rows skipped).
  const authoredNeighbour = (item: AdminItem) => {
    const i = slotItems.findIndex((x) => x.id === item.id);
    return { first: i === 0, last: i === slotItems.length - 1, prev: slotItems[i - 1], next: slotItems[i + 1] };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* v2: the slot identity line is a Label (all-caps by role definition — the words are
          already the classic ones, so nothing is newly shouted). */}
      <div className={v2 ? "st-label st-t2" : undefined} style={v2 ? { lineHeight: 1.5 } : { fontSize: 14, opacity: 0.6, lineHeight: 1.5 }}>
        {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
      </div>

      {/* read-only state banners (game / takeover / moment all pre-empt the queue) */}
      {gameOn && <Banner v2={v2} tone="amber" head="🎮 LIVE GAME" body="this screen is in game mode — the rotation resumes when the game ends" />}
      {takeover && <Banner v2={v2} tone="red" head="■ TAKEOVER HOLDS THIS SCREEN" body={takeover.message} cta={v2 ? "Manage from Takeover →" : "manage from TAKEOVER →"} onClick={onTakeover} />}
      {momentBanners.map(({ ev, stage }) => (
        <Banner key={ev.id} v2={v2} tone="amber" head="⚡ MOMENT" body={momentBannerBody(ev, stage, now)} />
      ))}

      {/* the live queue */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
        {v2 ? <div className="st-label st-t2" style={{ margin: 0 }}>LIVE QUEUE</div> : <SectionLabel style={{ margin: 0 }}>LIVE QUEUE</SectionLabel>}
        {/* `u-ink` rides with `st-btn-primary` (the PR 2 note: the class paints the BUTTON,
            a child text node is caught by the blanket and would stay white-on-accent). */}
        <button type="button" onClick={onAdd} className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"} style={v2 ? primaryV2 : primary}>{v2 ? "+ Add" : "+ ADD"}</button>
      </div>
      <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { margin: "2px 0 10px" } : { fontSize: 14, opacity: 0.6, margin: "2px 0 10px" }}>
        The exact order the TV resolves right now. <span className={v2 ? "st-live st-body" : "sig-live"}>● NOW</span> = on screen this minute; dimmed = off, out of its window, or 86’d. Per-screen <b className={v2 ? "st-body" : undefined}>SECS</b> is this screen’s dwell.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.6, fontSize: 18 }}>{v2 ? "Nothing queued — + Add to build this screen’s rotation." : "Nothing queued — + ADD to build this screen’s rotation."}</div>}
        {rows.map((row, idx) => {
          if (row.kind === "authored") {
            const nb = authoredNeighbour(row.item);
            return (
              <ItemRow
                key={row.item.id}
                item={row.item}
                first={nb.first}
                last={nb.last}
                prev={nb.prev}
                next={nb.next}
                live={liveIds.has(row.item.id)}
                windowReason={windowReason(row.item, now)}
                // Why an in-window, in-stock asset still isn't on screen: its weekday rule
                // excludes TODAY'S business day (itemSchedule). Without this the row would just
                // dim with no reason given — the same gap the POS-HIDDEN chip fills for an 86.
                offToday={row.item.active && !itemAirsToday(row.item, now, venueClock)}
                hideReason={sourceHideReason(row.item, toastRows)}
                onEdit={() => onEditAsset(row.item)}
                onRemove={() => remove.mutate(row.item.id)}
                onChanged={onChanged}
                toastRows={toastRows}
                variant={variant}
              />
            );
          }
          if (row.kind === "event") {
            return (
              <EventQueueRow
                key={row.card.id}
                v2={v2}
                ev={row.ev}
                card={row.card}
                now={now}
                canEvents={canEvents}
                first={idx === 0}
                last={idx === rows.length - 1}
                busy={moveEvent.isPending || setEventSecs.isPending}
                onUp={() => moveEvent.mutate({ idx, dir: -1 })}
                onDown={() => moveEvent.mutate({ idx, dir: 1 })}
                onSecs={(secs) => setEventSecs.mutate({ id: row.ev.id, secs })}
              />
            );
          }
          return <ScreensQueueRow key={row.card.id} v2={v2} card={row.card} tmap={tmap} />;
        })}
      </div>

      {/* v2: EVERY text-bearing element carries its own role class — nothing inherits
          font-size in this app (`.terminal-theme *` sets 24px on every element; PR #89), so
          the inner lines and the <b> would render at the theme default without one. */}
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? { marginTop: 14, display: "flex", flexDirection: "column", gap: 4 } : { fontSize: 13, opacity: 0.55, marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={v2 ? "st-body" : undefined}>✕ removes an asset from THIS screen only — it stays in the library and on any other screen. To delete an asset everywhere, open it and use DELETE.</div>
        <div className={v2 ? "st-body" : undefined}>★ SCREENS items flipped In-Stock at the POS rotate here automatically — manage those at the register.</div>
        <div className={v2 ? "st-body" : undefined}>Event cards (WINDOW / MESSAGE) show on <b className={v2 ? "st-body" : undefined}>every</b> screen; reordering one moves it everywhere.</div>
      </div>
    </div>
  );
}

/* ── active WINDOW/MESSAGE event row (venue-wide, reorderable like an authored item) ── */
function EventQueueRow({
  ev, card, now, canEvents, first, last, busy, onUp, onDown, onSecs, v2 = false,
}: {
  ev: LiveEvent; card: SignageItem; now: Date; canEvents: boolean;
  first: boolean; last: boolean; busy: boolean;
  onUp: () => void; onDown: () => void; onSecs: (secs: number) => void;
  v2?: boolean;
}) {
  const title = eventTitle(ev);
  const secs = card.duration_seconds;
  const inChoices = (DURATION_CHOICES as readonly number[]).includes(secs);
  const lockNote = canEvents ? undefined : "needs the EVENTS module";
  return (
    <div className={v2 ? "st-row" : "terminal-border"} style={v2 ? { padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } : { padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(0,255,65,0.04)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <EventKindBadge kind={ev.kind} />
          <span className={v2 ? "st-live st-label" : "sig-live"} style={v2 ? { whiteSpace: "nowrap" } : { fontSize: 13, letterSpacing: 1, whiteSpace: "nowrap" }} title="On the TV rotation right now">● NOW</span>
          <span className={v2 ? "st-chip st-label st-t2" : undefined} style={v2 ? { padding: "2px 8px", whiteSpace: "nowrap" } : { ...badge, opacity: 0.7 }} title="Events show on every screen — reordering affects all of them">ALL SCREENS</span>
        </div>
        <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>{endsLabel(ev, now, v2)} · {secs}{v2 ? "s on screen · venue-wide event" : "s ON SCREEN · venue-wide event"}</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "1 1 auto", minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {/* NOTE-5 (PR 3 review): dim tier on the SECS word only, never on the <label> — the
            `.st-t2 *` descendant leg would ink the <select>'s value at 0.6α. */}
        <label className={v2 ? "st-label" : undefined} style={v2 ? { display: "flex", alignItems: "center", gap: 4 } : { display: "flex", alignItems: "center", gap: 4, fontSize: 13, opacity: 0.85 }}>
          <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : { letterSpacing: 1 }} title="How long this card stays on screen">SECS</span>
          <select
            value={inChoices ? secs : "custom"}
            disabled={!canEvents}
            title={lockNote}
            onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) onSecs(n); }}
            aria-label="Seconds on screen"
            className={v2 ? "st-mono" : undefined}
            style={v2 ? { ...selectV2, cursor: canEvents ? "pointer" : "not-allowed", opacity: canEvents ? 1 : 0.5 } : { background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", fontFamily: MONO, fontSize: 15, minHeight: 44, padding: "0 6px", cursor: canEvents ? "pointer" : "not-allowed", opacity: canEvents ? 1 : 0.5 }}
          >
            {!inChoices && <option value="custom" className={v2 ? "st-mono" : undefined} style={v2 ? optionV2 : { background: "#000" }}>{secs}s</option>}
            {DURATION_CHOICES.map((sc) => (
              <option key={sc} value={sc} className={v2 ? "st-mono" : undefined} style={v2 ? optionV2 : { background: "#000" }}>{sc}s</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onUp} disabled={first || busy || !canEvents} title={lockNote} className={v2 ? "st-btn st-body" : undefined} style={v2 ? { ...iconBtnV2, opacity: canEvents ? undefined : 0.5 } : { ...iconBtn, opacity: canEvents ? undefined : 0.5 }} aria-label="Move up">▲</button>
        <button type="button" onClick={onDown} disabled={last || busy || !canEvents} title={lockNote} className={v2 ? "st-btn st-body" : undefined} style={v2 ? { ...iconBtnV2, opacity: canEvents ? undefined : 0.5 } : { ...iconBtn, opacity: canEvents ? undefined : 0.5 }} aria-label="Move down">▼</button>
      </div>
    </div>
  );
}

/* ── read-only ★ SCREENS trailer (managed at the POS, not here) ── */
function ScreensQueueRow({ card, tmap, v2 = false }: { card: SignageItem; tmap: Map<string, ToastCacheRow>; v2?: boolean }) {
  const guid = typeof card.fields?.source_toast_guid === "string" ? (card.fields.source_toast_guid as string) : "";
  const row = guid ? tmap.get(guid) : undefined;
  return (
    <div className={v2 ? "st-row" : "terminal-border"} style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", opacity: 0.85 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={v2 ? "st-chip st-label st-t2" : undefined} style={v2 ? { padding: "2px 8px", whiteSpace: "nowrap" } : badge}>★ SCREENS</span>
          <span className={v2 ? "st-live st-label" : "sig-live"} style={v2 ? { whiteSpace: "nowrap" } : { fontSize: 13, letterSpacing: 1, whiteSpace: "nowrap" }} title="On the TV rotation right now">● NOW</span>
        </div>
        <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row?.name ?? "Featured drink"}</div>
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>Auto — flipped in at the POS · {card.duration_seconds}{v2 ? "s on screen" : "s ON SCREEN"}</div>
      </div>
      <span className={v2 ? "st-label st-t3" : undefined} style={v2 ? { whiteSpace: "nowrap" } : { ...caption, fontSize: 13, whiteSpace: "nowrap" }}>MANAGE AT POS</span>
    </div>
  );
}

/* ── read-only state banner (game / takeover / moment) ── */
// v2: the box is the callout role for the tone (`st-callout-warn` amber / `st-callout-danger`
// red — the same pair PR 2 spent on "being edited" and on the remove confirm), the head is a
// Label in the tone ink, the body is Body. The TAKEOVER case is a button (opens the takeover
// panel as today) and clears the 44px floor on both axes.
function Banner({ tone, head, body, cta, onClick, v2 = false }: { tone: "red" | "amber"; head: string; body: string; cta?: string; onClick?: () => void; v2?: boolean }) {
  const cls = v2
    ? `st-card ${tone === "red" ? "st-callout-danger" : "st-callout-warn"}`
    : `terminal-border ${tone === "red" ? "u-red" : "u-amber"}`;
  const style = v2
    ? { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginTop: 10, width: "100%", textAlign: "left" } as const
    : { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginTop: 10, background: "rgba(0,255,65,0.03)", color: "var(--terminal-green)", width: "100%", textAlign: "left" } as const;
  const inner = (
    <>
      <span className={v2 ? `st-label ${tone === "red" ? "st-danger" : "st-amber"}` : undefined} style={v2 ? { whiteSpace: "nowrap" } : { fontSize: 14, letterSpacing: 2, whiteSpace: "nowrap" }}>{head}</span>
      <span className={v2 ? "st-body" : undefined} style={v2 ? { flex: "1 1 200px", minWidth: 0 } : { flex: "1 1 200px", minWidth: 0, fontSize: 18 }}>{body}</span>
      {cta && <span className={v2 ? "st-body st-t2" : undefined} style={v2 ? { textDecoration: "underline", whiteSpace: "nowrap" } : { fontSize: 13, opacity: 0.8, textDecoration: "underline", whiteSpace: "nowrap" }}>{cta}</span>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={cls} style={v2 ? { ...style, cursor: "pointer", minHeight: TAP, minWidth: TAP, border: "1px solid" } : { ...style, cursor: "pointer", fontFamily: MONO }}>{inner}</button>
    : <div className={cls} style={style}>{inner}</div>;
}

/* v2 twins (geometry only — see ItemRow's note in signageAdminShared.tsx): the classic
 * `primary` / `iconBtn` / SECS `<select>` boxes without their colour, face or the theme's
 * green literals. `border: "1px solid"` carries no colour so the sheet blanket paints the
 * hairline; `minWidth: TAP` joins `minHeight` because the 44px floor is both axes. */
const primaryV2 = { padding: "10px 18px", fontSize: 15, fontWeight: 700, cursor: "pointer", minHeight: TAP, minWidth: TAP, border: "1px solid" } as const;
const iconBtnV2 = { padding: "0 10px", fontSize: 15, cursor: "pointer", minHeight: TAP, minWidth: TAP, border: "1px solid" } as const;
const selectV2 = { fontSize: 15, minHeight: TAP, minWidth: TAP, padding: "0 6px", border: "1px solid" } as const;
const optionV2 = { background: staffSurface.surface2 } as const;

/* ── helpers (venue-TZ formatting) ── */
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function sameDay(a: number, b: number): boolean {
  return DAY.format(new Date(a)) === DAY.format(new Date(b));
}
function endsLabel(ev: LiveEvent, now: Date, v2 = false): string {
  if (!ev.fire_at) return "one-shot";
  const end = new Date(ev.fire_at).getTime() + ev.window_minutes * 60_000;
  // v2 is Body-role copy (sentence case); classic keeps the shouted token byte for byte.
  return `${v2 ? "Ends" : "ENDS"} ${sameDay(end, now.getTime()) ? TIME.format(new Date(end)) : WHEN.format(new Date(end))}`;
}
function windowReason(item: AdminItem, now: Date): string | null {
  if (!item.active) return null;
  const t = now.getTime();
  const startsMs = item.starts_at ? new Date(item.starts_at).getTime() : null;
  const endsMs = item.ends_at ? new Date(item.ends_at).getTime() : null;
  if (startsMs != null && startsMs > t) return `STARTS ${sameDay(startsMs, t) ? TIME.format(new Date(startsMs)) : WHEN.format(new Date(startsMs))}`;
  if (endsMs != null && endsMs <= t) return "ENDED";
  return null;
}
function eventTitle(ev: LiveEvent): string {
  const f = ev.fields ?? {};
  const title = typeof f.title === "string" ? f.title.trim() : "";
  return title || ev.name;
}
function momentBannerBody(ev: LiveEvent, stage: EventStage, now: Date): string {
  if (stage === "tease") return `${ev.name} — teasing in the rotation, takes the screens at ${fireLabel(ev, now)}`;
  return `${ev.name} — holds all screens ${stagePhrase(stage)}`;
}
function fireLabel(ev: LiveEvent, now: Date): string {
  if (!ev.fire_at) return "its scheduled time";
  const f = new Date(ev.fire_at).getTime();
  return sameDay(f, now.getTime()) ? TIME.format(new Date(f)) : WHEN.format(new Date(f));
}
function stagePhrase(stage: EventStage): string {
  switch (stage) {
    case "alert": return "— counting down";
    case "moment": return "— LIVE NOW";
    case "event": return "— in progress";
    case "allclear": return "— wrapping up";
    default: return "";
  }
}

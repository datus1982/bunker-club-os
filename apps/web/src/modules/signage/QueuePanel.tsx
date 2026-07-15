import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  activeTakeoverForSlot, DURATION_CHOICES,
  type AdminItem, type AdminSlot, type AdminTakeover,
} from "./useSignageAdmin";
import {
  resolveRotation, eventStage, compareRotation,
  type SignageItem, type LiveEvent, type EventStage, type ToastCacheRow,
} from "./useSignage";
import { setEventFields, VENUE_TZ } from "./useEventsAdmin";
import { removeFromQueue } from "./slotQueue";
import {
  SectionLabel, ItemRow, EventKindBadge, sourceHideReason,
  MONO, primary, iconBtn, badge, caption,
} from "./signageAdminShared";

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
 */
export function QueuePanel({
  slot, slotItems, toastRows, liveEvents, gameOn, takeovers, canEvents,
  onAdd, onEditAsset, onChanged, onEventsChanged, onTakeover,
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
}) {
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
  const liveQueue = useMemo(
    () => resolveRotation(activeAuthored, tmap, now, liveEvents),
    [activeAuthored, tmap, now, liveEvents],
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
      <div style={{ fontSize: 14, opacity: 0.6, lineHeight: 1.5 }}>
        {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
      </div>

      {/* read-only state banners (game / takeover / moment all pre-empt the queue) */}
      {gameOn && <Banner tone="amber" head="🎮 LIVE GAME" body="this screen is in game mode — the rotation resumes when the game ends" />}
      {takeover && <Banner tone="red" head="■ TAKEOVER HOLDS THIS SCREEN" body={takeover.message} cta="manage from TAKEOVER →" onClick={onTakeover} />}
      {momentBanners.map(({ ev, stage }) => (
        <Banner key={ev.id} tone="amber" head="⚡ MOMENT" body={momentBannerBody(ev, stage, now)} />
      ))}

      {/* the live queue */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
        <SectionLabel style={{ margin: 0 }}>LIVE QUEUE</SectionLabel>
        <button type="button" onClick={onAdd} className="u-fill u-ink" style={primary}>+ ADD</button>
      </div>
      <div style={{ fontSize: 14, opacity: 0.6, margin: "2px 0 10px" }}>
        The exact order the TV resolves right now. <span className="sig-live">● NOW</span> = on screen this minute; dimmed = off, out of its window, or 86’d. Per-screen <b>SECS</b> is this screen’s dwell.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && <div style={{ opacity: 0.6, fontSize: 18 }}>Nothing queued — + ADD to build this screen’s rotation.</div>}
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
                hideReason={sourceHideReason(row.item, toastRows)}
                onEdit={() => onEditAsset(row.item)}
                onRemove={() => remove.mutate(row.item.id)}
                onChanged={onChanged}
                toastRows={toastRows}
              />
            );
          }
          if (row.kind === "event") {
            return (
              <EventQueueRow
                key={row.card.id}
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
          return <ScreensQueueRow key={row.card.id} card={row.card} tmap={tmap} />;
        })}
      </div>

      <div style={{ fontSize: 13, opacity: 0.55, marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>✕ removes an asset from THIS screen only — it stays in the library and on any other screen. To delete an asset everywhere, open it and use DELETE.</div>
        <div>★ SCREENS items flipped In-Stock at the POS rotate here automatically — manage those at the register.</div>
        <div>Event cards (WINDOW / MESSAGE) show on <b>every</b> screen; reordering one moves it everywhere.</div>
      </div>
    </div>
  );
}

/* ── active WINDOW/MESSAGE event row (venue-wide, reorderable like an authored item) ── */
function EventQueueRow({
  ev, card, now, canEvents, first, last, busy, onUp, onDown, onSecs,
}: {
  ev: LiveEvent; card: SignageItem; now: Date; canEvents: boolean;
  first: boolean; last: boolean; busy: boolean;
  onUp: () => void; onDown: () => void; onSecs: (secs: number) => void;
}) {
  const title = eventTitle(ev);
  const secs = card.duration_seconds;
  const inChoices = (DURATION_CHOICES as readonly number[]).includes(secs);
  const lockNote = canEvents ? undefined : "needs the EVENTS module";
  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(0,255,65,0.04)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <EventKindBadge kind={ev.kind} />
          <span className="sig-live" style={{ fontSize: 13, letterSpacing: 1, whiteSpace: "nowrap" }} title="On the TV rotation right now">● NOW</span>
          <span style={{ ...badge, opacity: 0.7 }} title="Events show on every screen — reordering affects all of them">ALL SCREENS</span>
        </div>
        <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>{endsLabel(ev, now)} · {secs}s ON SCREEN · venue-wide event</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "1 1 auto", minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, opacity: 0.85 }}>
          <span style={{ letterSpacing: 1 }} title="How long this card stays on screen">SECS</span>
          <select
            value={inChoices ? secs : "custom"}
            disabled={!canEvents}
            title={lockNote}
            onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) onSecs(n); }}
            aria-label="Seconds on screen"
            style={{ background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", fontFamily: MONO, fontSize: 15, minHeight: 44, padding: "0 6px", cursor: canEvents ? "pointer" : "not-allowed", opacity: canEvents ? 1 : 0.5 }}
          >
            {!inChoices && <option value="custom" style={{ background: "#000" }}>{secs}s</option>}
            {DURATION_CHOICES.map((sc) => (
              <option key={sc} value={sc} style={{ background: "#000" }}>{sc}s</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onUp} disabled={first || busy || !canEvents} title={lockNote} style={{ ...iconBtn, opacity: canEvents ? undefined : 0.5 }} aria-label="Move up">▲</button>
        <button type="button" onClick={onDown} disabled={last || busy || !canEvents} title={lockNote} style={{ ...iconBtn, opacity: canEvents ? undefined : 0.5 }} aria-label="Move down">▼</button>
      </div>
    </div>
  );
}

/* ── read-only ★ SCREENS trailer (managed at the POS, not here) ── */
function ScreensQueueRow({ card, tmap }: { card: SignageItem; tmap: Map<string, ToastCacheRow> }) {
  const guid = typeof card.fields?.source_toast_guid === "string" ? (card.fields.source_toast_guid as string) : "";
  const row = guid ? tmap.get(guid) : undefined;
  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", opacity: 0.85 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={badge}>★ SCREENS</span>
          <span className="sig-live" style={{ fontSize: 13, letterSpacing: 1, whiteSpace: "nowrap" }} title="On the TV rotation right now">● NOW</span>
        </div>
        <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row?.name ?? "Featured drink"}</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>Auto — flipped in at the POS · {card.duration_seconds}s ON SCREEN</div>
      </div>
      <span style={{ ...caption, fontSize: 13, whiteSpace: "nowrap" }}>MANAGE AT POS</span>
    </div>
  );
}

/* ── read-only state banner (game / takeover / moment) ── */
function Banner({ tone, head, body, cta, onClick }: { tone: "red" | "amber"; head: string; body: string; cta?: string; onClick?: () => void }) {
  const cls = `terminal-border ${tone === "red" ? "u-red" : "u-amber"}`;
  const style = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginTop: 10, background: "rgba(0,255,65,0.03)", color: "var(--terminal-green)", width: "100%", textAlign: "left" } as const;
  const inner = (
    <>
      <span style={{ fontSize: 14, letterSpacing: 2, whiteSpace: "nowrap" }}>{head}</span>
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 18 }}>{body}</span>
      {cta && <span style={{ fontSize: 13, opacity: 0.8, textDecoration: "underline", whiteSpace: "nowrap" }}>{cta}</span>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={cls} style={{ ...style, cursor: "pointer", fontFamily: MONO }}>{inner}</button>
    : <div className={cls} style={style}>{inner}</div>;
}

/* ── helpers (venue-TZ formatting) ── */
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function sameDay(a: number, b: number): boolean {
  return DAY.format(new Date(a)) === DAY.format(new Date(b));
}
function endsLabel(ev: LiveEvent, now: Date): string {
  if (!ev.fire_at) return "one-shot";
  const end = new Date(ev.fire_at).getTime() + ev.window_minutes * 60_000;
  return `ENDS ${sameDay(end, now.getTime()) ? TIME.format(new Date(end)) : WHEN.format(new Date(end))}`;
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

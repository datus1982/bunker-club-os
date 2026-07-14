import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  useAdminSlots, useAllItems, useToastCache, useTakeovers, useLiveGame,
  screenHealth, activeTakeover, toastMap,
  DURATION_CHOICES,
  type AdminItem,
} from "./useSignageAdmin";
import {
  useLiveEvents, resolveRotation, eventStage, compareRotation,
  type SignageItem, type LiveEvent, type EventStage, type ToastCacheRow,
} from "./useSignage";
import { setEventFields, VENUE_TZ } from "./useEventsAdmin";
import { useRole } from "@/shared/useRole";
import {
  MONO, SectionLabel, HealthDot, KioskUrl, ItemRow, EventKindBadge,
  sourceHideReason, ghost, primary, iconBtn, badge, caption,
} from "./signageAdminShared";
import { ItemEditor } from "./ItemEditor";
import "./signage.css";

/**
 * /signage/screens/:slug — EDIT ROTATION for a single screen.
 *
 * This renders the LIVE QUEUE — the exact ordered list the TV resolves right now — by
 * reusing resolveRotation() (+ useLiveEvents + the Toast cache), the SAME derivation the
 * public SlotDisplay uses (the hub/TV parity invariant, PR #12). The list interleaves:
 *   • authored signage_items (add / edit / delete / reorder / seconds — unchanged behaviour),
 *   • active WINDOW/MESSAGE event cards (materialized at render time, docs/13), and
 *   • ★ SCREENS Toast trailers (read-only; managed at the POS).
 * A MOMENT in its takeover horizon can't be reordered (it holds every screen), so it shows
 * as a read-only banner above the queue rather than a row.
 *
 * Event cards are venue-wide (they show on EVERY screen), so a card carries an ALL SCREENS
 * tag and reordering it (writes scheduled_events.fields.rotation_sort) affects its position
 * everywhere. Because each slot has its own authored sort range, the same card can interleave
 * at a different spot per slot — accepted (docs/13 amendment; orchestrator decision 3).
 */
export function EditRotation() {
  const { slug = "" } = useParams();
  const qc = useQueryClient();
  const slotsQ = useAdminSlots();
  const itemsQ = useAllItems();
  const toastQ = useToastCache();
  const eventsQ = useLiveEvents();
  const takeoversQ = useTakeovers();
  const liveGameQ = useLiveGame();
  const { can } = useRole();
  const canEvents = can("events");

  const slot = (slotsQ.data ?? []).find((s) => s.slug === slug) ?? null;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminItem | null>(null);

  // 30s tick so time-windows + event stages re-evaluate without a manual refresh (matches
  // SlotDisplay's cadence; well above the sub-30s display floor — this is an admin page).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);

  const tmap = useMemo(() => toastMap(toastQ.data), [toastQ.data]);
  const liveEvents = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);

  // Authored items for this slot (all — active AND inactive — so a paused/out-of-window row
  // is still editable), sorted by sort_order exactly as the reorder buttons expect.
  const slotItems = useMemo(() => {
    if (!slot) return [] as AdminItem[];
    return (itemsQ.data ?? [])
      .filter((it) => it.slot_id === slot.id)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [itemsQ.data, slot]);

  // THE LIVE QUEUE — resolveRotation() on the same inputs the TV gets (ACTIVE authored items,
  // the Toast map, now, the live events). Its output is the ground truth for what is on screen
  // this minute; every ● NOW marker + the event/★ rows are derived straight from it so the
  // editor can never disagree with the TV.
  const activeAuthored = useMemo(
    () => slotItems.filter((it) => it.active) as SignageItem[],
    [slotItems],
  );
  const liveQueue = useMemo(
    () => resolveRotation(activeAuthored, tmap, now, liveEvents),
    [activeAuthored, tmap, now, liveEvents],
  );
  const liveIds = useMemo(() => new Set(liveQueue.map((r) => r.id)), [liveQueue]);

  // The materialized rows straight out of resolveRotation (preserving its order so equal-key
  // ties resolve identically to the TV): active WINDOW/MESSAGE cards + ★ SCREENS trailers.
  const eventCards = useMemo(() => liveQueue.filter((r) => r.id.startsWith("event:")), [liveQueue]);
  const screensCards = useMemo(() => liveQueue.filter((r) => r.id.startsWith("screens:")), [liveQueue]);

  // Combined display list, ordered by the SAME comparator resolveRotation sorts by
  // (compareRotation = sort_order then id). Sorting the merged list with the shared
  // comparator — never a hand-rolled events-first concat — is what guarantees the editor
  // and the TV agree even on sort_order ties (WARN-1). Each row carries its id (the exact
  // id resolveRotation uses: authored uuid / `event:…` / `screens:…`) so the tiebreak
  // matches. A non-live authored row (off / out-of-window / hidden) sits at its own
  // sort_order — exactly where it slots in once it goes live.
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

  // MOMENTs in their takeover horizon (tease→allclear) hold every screen — surfaced as a
  // read-only banner, never a reorderable row.
  const momentBanners = useMemo(
    () =>
      liveEvents
        .filter((ev) => ev.kind === "moment")
        .map((ev) => ({ ev, stage: eventStage(ev, now) }))
        .filter((x): x is { ev: LiveEvent; stage: EventStage } => x.stage !== null),
    [liveEvents, now],
  );
  const takeover = activeTakeover(takeoversQ.data ?? [], now.getTime());
  // When a trivia game is active/paused the slot is in GAME MODE — the rotation isn't on
  // screen at all (the ● NOW rows describe what WOULD rotate, not what's showing). Surfaced
  // as a read-only banner using the same hook the hub/TV resolve game-mode from (WARN-3).
  const gameOn = !!liveGameQ.data;

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["signage-admin", "items"] }); };
  const invalidateEvents = () => { qc.invalidateQueries({ queryKey: ["signage", "events"] }); };
  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (it: AdminItem) => { setEditing(it); setEditorOpen(true); };

  // Move an active event card one step in the combined queue by writing rotation_sort as the
  // midpoint of the neighbours it lands between (floats are fine — it lives in the jsonb;
  // authored items keep their integer positions untouched when a card moves).
  // DECISION: rotation_sort is stored on the event row, which is VENUE-WIDE — reordering a
  // card here moves it on every screen, and because each slot has its own authored int range
  // the same card can interleave at a different spot per slot. Accepted (orchestrator
  // decision 3); surfaced to staff via the ALL SCREENS tag + the caveat line under the queue.
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
    onSuccess: invalidateEvents,
  });
  const setEventSecs = useMutation({
    mutationFn: ({ id, secs }: { id: string; secs: number }) => setEventFields(id, { duration_seconds: secs }),
    onSuccess: invalidateEvents,
  });

  // Authored-item neighbours for the ▲/▼ reorder are the adjacent AUTHORED rows (event/★ rows
  // in between are skipped) so authored reordering stays byte-identical to before.
  const authoredNeighbour = (item: AdminItem) => {
    const i = slotItems.findIndex((x) => x.id === item.id);
    return { first: i === 0, last: i === slotItems.length - 1, prev: slotItems[i - 1], next: slotItems[i + 1] };
  };

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <Link to="/signage" style={{ ...ghost, textDecoration: "none", fontSize: 16, display: "inline-block", marginBottom: 12 }}>← SIGNAGE HUB</Link>

        {slotsQ.isLoading ? (
          <div style={{ fontSize: 20 }}>LOADING SLOT…</div>
        ) : !slot ? (
          <div style={{ opacity: 0.7, fontSize: 20 }}>
            No slot with slug “{slug}”. <Link to="/signage" style={{ textDecoration: "underline" }}>Back to the hub.</Link>
          </div>
        ) : (
          <>
            {/* ── slot header: name · health · kiosk URL ── */}
            <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BAR OPS · SIGNAGE ▸ EDIT ROTATION</div>
            <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "clamp(26px,5vw,38px)", fontWeight: 700, letterSpacing: 2 }}>{slot.name}</h1>
                <HealthDot health={screenHealth(slot.last_seen)} />
              </div>
              <div style={{ fontSize: 14, opacity: 0.65 }}>
                {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
              </div>
              <KioskUrl slug={slot.slug} />
              <a href={`/signage/s/${slot.slug}?preview=1`} target="_blank" rel="noreferrer" title="Staff preview only — NEVER point a TV at a ?preview=1 URL (it never shows takeovers or game mode)." style={{ ...ghost, textDecoration: "none", fontSize: 15, padding: "6px 10px", alignSelf: "flex-start" }}>
                PREVIEW (rotation only) →
              </a>
            </div>

            {/* ── read-only state banners (game / takeover / moment all pre-empt the queue) ── */}
            {gameOn && (
              <BannerRow
                tone="amber"
                head="🎮 LIVE GAME"
                body="screens are in game mode — the rotation resumes when the game ends"
              />
            )}
            {takeover && (
              <BannerRow
                tone="red"
                head="■ TAKEOVER HOLDS ALL SCREENS"
                body={takeover.message}
                to="/signage/broadcast"
                cta="broadcast console →"
              />
            )}
            {momentBanners.map(({ ev, stage }) => (
              <BannerRow
                key={ev.id}
                tone="amber"
                head="⚡ MOMENT"
                body={momentBannerBody(ev, stage, now)}
                to="/signage/events"
                cta="events & promos →"
              />
            ))}

            {/* ── the live queue ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 26 }}>
              <SectionLabel style={{ margin: 0 }}>LIVE QUEUE</SectionLabel>
              <button type="button" onClick={openNew} className="u-fill u-ink" style={primary}>+ ADD ITEM</button>
            </div>
            <div style={{ fontSize: 14, opacity: 0.6, margin: "2px 0 10px" }}>
              The exact order the TV resolves right now. <span className="sig-live">● NOW</span> = on screen this minute; dimmed = off, out of its window, or 86’d.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.length === 0 && <div style={{ opacity: 0.6, fontSize: 18 }}>Nothing queued — ADD ITEM to build this screen’s rotation.</div>}
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
                      hideReason={sourceHideReason(row.item, toastQ.data)}
                      onEdit={() => openEdit(row.item)}
                      onChanged={invalidate}
                      toastRows={toastQ.data}
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

            <div style={{ fontSize: 14, opacity: 0.55, marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              <div>★ SCREENS items flipped In-Stock at the POS rotate here automatically — manage those at the register, not here.</div>
              <div>Event cards (WINDOW / MESSAGE) show on <b>every</b> screen; reordering one moves it everywhere. Create &amp; schedule them in <Link to="/signage/events" style={{ textDecoration: "underline", color: "var(--terminal-green)" }}>EVENTS &amp; PROMOS</Link>.</div>
            </div>
          </>
        )}
      </div>

      {editorOpen && slot && (
        <ItemEditor
          slots={slotsQ.data ?? []}
          toastRows={toastQ.data ?? []}
          defaultSlotId={slot.id}
          editing={editing}
          nextSortOrder={(targetSlotId) => {
            // Append after the target slot's current max sort_order (not the row count —
            // a count collides once a delete has left a gap). The editor's SLOT dropdown
            // can reassign, so compute against the chosen slot, not just this page's slot.
            const inTarget = (itemsQ.data ?? []).filter((i) => i.slot_id === targetSlotId);
            return inTarget.length ? Math.max(...inTarget.map((i) => i.sort_order)) + 1 : 0;
          }}
          onClose={() => setEditorOpen(false)}
          onSaved={invalidate}
        />
      )}
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
        <div style={{ fontSize: 14, opacity: 0.6 }}>
          {endsLabel(ev, now)} · {secs}s ON SCREEN · <Link to="/signage/events" style={{ textDecoration: "underline", color: "var(--terminal-green)" }}>manage in EVENTS &amp; PROMOS →</Link>
        </div>
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

/* ── read-only state banner (game / takeover / moment). A `to` makes it a link with a cta;
   without one it's a plain notice (the LIVE GAME banner has nowhere to send you). ── */
function BannerRow({ tone, head, body, to, cta }: { tone: "red" | "amber"; head: string; body: string; to?: string; cta?: string }) {
  const cls = `terminal-border ${tone === "red" ? "u-red" : "u-amber"}`;
  const style = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginTop: 10, textDecoration: "none", background: "rgba(0,255,65,0.03)", color: "var(--terminal-green)" } as const;
  const inner = (
    <>
      <span style={{ fontSize: 14, letterSpacing: 2, whiteSpace: "nowrap" }}>{head}</span>
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 18 }}>{body}</span>
      {cta && <span style={{ fontSize: 13, opacity: 0.8, textDecoration: "underline", whiteSpace: "nowrap" }}>{cta}</span>}
    </>
  );
  return to ? <Link to={to} className={cls} style={style}>{inner}</Link> : <div className={cls} style={style}>{inner}</div>;
}

/* ── helpers ── */
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Same venue-local calendar day? (decides date-vs-time-only formatting). */
function sameDay(a: number, b: number): boolean {
  return DAY.format(new Date(a)) === DAY.format(new Date(b));
}

/** "ENDS 7:00 PM" (today) or "ENDS 7/21 7:00 PM" for an active event's window end. */
function endsLabel(ev: LiveEvent, now: Date): string {
  if (!ev.fire_at) return "one-shot";
  const end = new Date(ev.fire_at).getTime() + ev.window_minutes * 60_000;
  return `ENDS ${sameDay(end, now.getTime()) ? TIME.format(new Date(end)) : WHEN.format(new Date(end))}`;
}

/** Why an active authored item is out of its time window (so it's dimmed, not ● NOW). null
 *  when it's inside its window (or OFF, which the ○ OFF toggle already conveys). */
function windowReason(item: AdminItem, now: Date): string | null {
  if (!item.active) return null;
  const t = now.getTime();
  const startsMs = item.starts_at ? new Date(item.starts_at).getTime() : null;
  const endsMs = item.ends_at ? new Date(item.ends_at).getTime() : null;
  if (startsMs != null && startsMs > t) return `STARTS ${sameDay(startsMs, t) ? TIME.format(new Date(startsMs)) : WHEN.format(new Date(startsMs))}`;
  if (endsMs != null && endsMs <= t) return "ENDED";
  return null;
}

/** The manager-facing title for an event card (title field → name). */
function eventTitle(ev: LiveEvent): string {
  const f = ev.fields ?? {};
  const title = typeof f.title === "string" ? f.title.trim() : "";
  return title || ev.name;
}

/** The MOMENT banner body. TEASE is a rotation-level interstitial — it does NOT hold the
 *  screens yet — so it reads differently from the takeover stages (NOTE-6). */
function momentBannerBody(ev: LiveEvent, stage: EventStage, now: Date): string {
  if (stage === "tease") return `${ev.name} — teasing in the rotation, takes the screens at ${fireLabel(ev, now)}`;
  return `${ev.name} — holds all screens ${stagePhrase(stage)}`;
}

/** fire_at formatted venue-local (time only if today, else date + time). */
function fireLabel(ev: LiveEvent, now: Date): string {
  if (!ev.fire_at) return "its scheduled time";
  const f = new Date(ev.fire_at).getTime();
  return sameDay(f, now.getTime()) ? TIME.format(new Date(f)) : WHEN.format(new Date(f));
}

/** Plain phrase for the MOMENT banner's takeover stages (tease is handled separately). */
function stagePhrase(stage: EventStage): string {
  switch (stage) {
    case "alert": return "— counting down";
    case "moment": return "— LIVE NOW";
    case "event": return "— in progress";
    case "allclear": return "— wrapping up";
    default: return "";
  }
}

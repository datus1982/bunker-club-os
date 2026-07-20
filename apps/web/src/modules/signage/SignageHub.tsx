import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  useAdminSlots, useAllItems, useSignageAssets, useTakeovers, useToastCache, useLiveGame,
  useSlotsRealtime,
  screenHealth, activeTakeoverForSlot, featuredItems, toastMap,
  type AdminItem, type AdminSlot, type AssetWithPlacements,
} from "./useSignageAdmin";
import {
  resolveRotation, resolveSlotMode, useLiveEvents, activeMoment, useVenue,
  useCloseoutHour, mapScheduleRow,
  type SlotMode, type SignageItem, type ToastCacheRow, type Template,
} from "./useSignage";
import { resolveEffectiveProgramWithSource, type ProgramHold } from "./scheduleResolve";
import {
  useEventsList, schedulePhrase, statusInfo, pauseEvent, resumeEvent, fireNowEvent, type EventRow,
} from "./useEventsAdmin";
import {
  MONO, SectionLabel, CollapsibleSection, HealthDot, CopyKioskButton, EventKindBadge,
  ghost, summarize, templateIcon, templateBadge, isSmartTemplate,
} from "./signageAdminShared";
import { addToQueue } from "./slotQueue";
import { ItemEditor } from "./ItemEditor";
import { EventEditor, type EventSeed } from "./EventEditor";
import { QueuePanel } from "./QueuePanel";
import { AddAssetPicker } from "./AddAssetPicker";
import { TakeoverPanel } from "./TakeoverPanel";
import { SlideOver } from "./SlideOver";
import { MediaSection } from "./MediaSection";
import { ProgramPanel } from "./ProgramPanel";
import { ScheduleEditor } from "./ScheduleEditor";
import { useMediaPlaylists, useAllScheduleRows } from "./useMediaAdmin";
import { sendTransportCommand, type TransportCmd } from "./mediaTransport";
import { useRole } from "@/shared/useRole";
import "./signage.css";

/**
 * /signage — THE SIGNAGE HUB (docs/signage-hub-consolidation-mockup.html, owner-ratified).
 *
 * ONE page for all of bar-ops signage. No Events tab, no Broadcast tab, no routed sub-pages:
 *   • ON AIR NOW — screen cards, each with exactly three buttons + ADD · QUEUE · TAKEOVER and
 *     a ⋯ overflow (KIOSK URL / PREVIEW / health) (D1).
 *   • ASSET LIBRARY — every venue-wide asset ONCE, as a thumbnail grid with a type badge +
 *     P/L chips showing which screens it runs on; click one to edit it (D3/D5/D7).
 *   • RUNNING & UPCOMING — events, live and scheduled, with + NEW EVENT inline and click-to-
 *     edit; this retires the EVENTS & PROMOS tab (D8).
 *   • ★ FEATURED ON POS — read-only (Toast is read-only).
 * Everything below opens as a slide-over OVER the hub. Mobile-first — the owner runs this
 * from his phone at the bar.
 */

/** Which screen a slot's P/L chip abbreviates. Single-letter orientation code matches the
 *  ratified mockup (P / L) for this venue's one-portrait-one-landscape setup.
 *  DECISION: two same-orientation screens would both read "P"; the chip carries the slot name
 *  as a tooltip, and a 3+-screen venue can graduate this to a terminal-number code later. */
function slotCode(slot: AdminSlot): string {
  return (slot.orientation[0] ?? "?").toUpperCase();
}

type Overlay =
  | { kind: "add"; slot: AdminSlot }
  | { kind: "queue"; slot: AdminSlot }
  | { kind: "takeover"; slot: AdminSlot }
  | { kind: "event"; editing: EventRow | null; seed?: EventSeed | null }
  | { kind: "asset"; editing: AdminItem | null; preset: Template | null; queueOnSlotId: string | null }
  | { kind: "program"; slot: AdminSlot }
  | { kind: "schedule"; slot: AdminSlot };

export function SignageHub({ openQueueSlug }: { openQueueSlug?: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const canEvents = can("events");

  useSlotsRealtime();
  const slotsQ = useAdminSlots();
  const schedulesQ = useAllScheduleRows();
  const closeoutQ = useCloseoutHour();
  const playlistsQ = useMediaPlaylists();
  const itemsQ = useAllItems();
  const assetsQ = useSignageAssets();
  const takeoversQ = useTakeovers();
  const toastQ = useToastCache();
  const liveGameQ = useLiveGame();
  const liveEventsQ = useLiveEvents();
  const eventsQ = useEventsList();
  const venueQ = useVenue();

  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  // M3 (D2/D3): per-slot dayparts, and the portrait/panel slots a multiview PANEL can point at.
  const scheduleBySlot = useMemo(() => schedulesQ.data ?? new Map(), [schedulesQ.data]);
  const timezone = venueQ.data?.timezone ?? "America/Chicago";
  const rolloverHour = closeoutQ.data ?? 4;
  const panelChoices = useMemo(() => slots.filter((s) => s.orientation === "portrait"), [slots]);

  // WARN-1 (hub/TV parity): the card chip + ProgramPanel must show what the TV is ACTUALLY playing —
  // run the SAME resolver the display runs (schedule rows + hold), never the raw slot.program row (an
  // active daypart would read ROTATION, and an EXPIRED override would read PROGRAM: X forever). now()
  // at render is fine — the hub re-renders on realtime + the 60s slot poll (it is not a TV).
  const effFor = (slot: AdminSlot) =>
    resolveEffectiveProgramWithSource(
      { program: slot.program, program_hold: slot.program_hold, program_set_at: slot.program_set_at },
      (scheduleBySlot.get(slot.id) ?? []).map(mapScheduleRow),
      new Date(), timezone, rolloverHour,
    );
  const items = itemsQ.data ?? [];
  const assets = assetsQ.data ?? [];
  const toastRows = useMemo(() => toastQ.data ?? [], [toastQ.data]);
  const takeovers = takeoversQ.data ?? [];
  const liveEvents = useMemo(() => liveEventsQ.data ?? [], [liveEventsQ.data]);
  const allEvents = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  // Split the flat list into exact complements: RUNNING & UPCOMING holds everything still in play
  // (running, scheduled, paused, aborted); PAST archives every COMPLETED event so a finished promo
  // is findable + re-runnable (item 6). This includes completed RECURRING events: 0041 marks a
  // recurring row `completed` once its `until` retires it, and tick_scheduled_events only touches
  // scheduled/running rows — so a completed recurring event is terminal too (it would otherwise
  // strand in RUNNING & UPCOMING as DONE forever). RE-RUN seeds a fresh un-scheduled schedule, so
  // resurrecting either kind is coherent.
  const isPast = (ev: EventRow) => ev.status === "completed";
  const events = useMemo(() => allEvents.filter((ev) => !isPast(ev)), [allEvents]);
  const pastEvents = useMemo(
    () =>
      allEvents
        .filter(isPast)
        // Most recent run first — fire_at is the last-armed occurrence; created_at is the tiebreak.
        .sort((a, b) => (b.fire_at ?? b.created_at ?? "").localeCompare(a.fire_at ?? a.created_at ?? ""))
        .slice(0, 10),
    [allEvents],
  );
  const tmap = useMemo(() => toastMap(toastRows), [toastRows]);

  // Playlist names for the screen-card PROGRAM chip (hub/TV parity: a landscape card must read
  // what the TV shows — PLAYLIST '{name}', not the underlying ROTATION mode).
  const playlistNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playlistsQ.data ?? []) m.set(p.playlist.id, p.playlist.name);
    return m;
  }, [playlistsQ.data]);
  // The EFFECTIVE program label + its source suffix (parity — matches the TV, WARN-1). null = rotation.
  const programLabelFor = (slot: AdminSlot): string | null => {
    const { program, source } = effFor(slot);
    if (!program) return null; // rotation (no override, no active daypart)
    const base =
      program.kind === "playlist" ? `PLAYLIST '${playlistNameById.get(program.playlist_id) ?? "…"}'`
      : program.kind === "capture" ? "LIVE INPUT"
      : "MULTIVIEW";
    const suffix = source === "scheduled" ? " · scheduled" : source === "override" ? " · override" : source === "pinned" ? " · pinned" : "";
    return base + suffix;
  };
  // The hold tier of an ACTIVE override (for the ⧗ chip); null when no override is live (following a
  // schedule / rotation — even if a stale override row lingers in the DB, DECISION-1).
  const overrideHoldFor = (slot: AdminSlot): ProgramHold | null => {
    const { source } = effFor(slot);
    return source === "override" || source === "pinned" ? (slot.program_hold ?? "pin") : null;
  };

  // Venue-wide mode inputs (a live game + a moment each hold EVERY screen); the takeover is now
  // per-screen (0045), resolved per card. Same ladder the public SlotDisplay renders.
  const liveGame = liveGameQ.data ?? null;
  const moment = activeMoment(liveEvents);
  const eventLabel = moment ? `${moment.event.name.toUpperCase()} · ${moment.stage.toUpperCase()}` : null;
  const staleGameDate =
    liveGame?.game_date && liveGame.game_date !== new Date().toLocaleDateString("en-CA")
      ? liveGame.game_date
      : null;

  const itemsBySlot = useMemo(() => {
    const m = new Map<string, AdminItem[]>();
    for (const it of items) {
      if (!it.slot_id) continue;
      if (!m.has(it.slot_id)) m.set(it.slot_id, []);
      m.get(it.slot_id)!.push(it);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [items]);

  const nextPosition = (slotId: string) => {
    const list = itemsBySlot.get(slotId) ?? [];
    return list.length ? Math.max(...list.map((i) => i.sort_order)) + 1 : 0;
  };

  const invalidateItems = () => {
    qc.invalidateQueries({ queryKey: ["signage-admin", "items"] });
    qc.invalidateQueries({ queryKey: ["signage-admin", "assets"] });
  };
  const invalidateTakeovers = () => qc.invalidateQueries({ queryKey: ["signage-admin", "takeovers"] });
  const invalidateEvents = () => {
    qc.invalidateQueries({ queryKey: ["events-admin", "list"] });
    qc.invalidateQueries({ queryKey: ["signage", "events"] });
  };

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [overflowSlot, setOverflowSlot] = useState<string | null>(null);
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null);

  // Legacy bookmark /signage/screens/:slug → open that screen's queue, then normalize the URL.
  // The URL is rewritten with history.replaceState (NOT react-router navigate): navigate would
  // unmount this component (the /signage/screens/:slug route) and remount the bare /signage
  // route, discarding the just-opened overlay. replaceState only rewrites the address bar, so
  // the slide-over stays open and the manager lands exactly where the bookmark pointed.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    if (bootstrapped || !openQueueSlug) return;
    if (slots.length) {
      const s = slots.find((x) => x.slug === openQueueSlug);
      if (s) setOverlay({ kind: "queue", slot: s });
      setBootstrapped(true);
      window.history.replaceState(null, "", "/signage");
    } else if (!slotsQ.isLoading) {
      setBootstrapped(true);
      window.history.replaceState(null, "", "/signage");
    }
  }, [openQueueSlug, slots, slotsQ.isLoading, bootstrapped]);

  // Queue an existing library asset onto a screen (AddPicker FROM LIBRARY, D6).
  const queueExisting = useMutation({
    mutationFn: async ({ slot, a }: { slot: AdminSlot; a: AssetWithPlacements }) => {
      setBusyQueueId(a.asset.id);
      await addToQueue(slot.id, a.asset.id, nextPosition(slot.id), 12);
    },
    onSettled: () => setBusyQueueId(null),
    onSuccess: invalidateItems,
  });

  const openAsset = (a: AssetWithPlacements) =>
    setOverlay({ kind: "asset", editing: a.asset as unknown as AdminItem, preset: null, queueOnSlotId: null });

  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BAR OPS ▸ SIGNAGE HUB</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: "clamp(28px,6vw,44px)", fontWeight: 700, letterSpacing: 2 }}>SIGNAGE HUB <span style={{ fontSize: 14, opacity: 0.5, letterSpacing: 2 }}>ONE PAGE — SCREENS · ASSETS · EVENTS</span></h1>
          <Link to="/dashboard" style={{ ...ghost, textDecoration: "none", fontSize: 16 }}>← DASHBOARD</Link>
        </div>
        <div className="terminal-separator" style={{ margin: "12px 0 20px" }} />

        {/* ── A · ON AIR NOW ─────────────────────────────────────────────── */}
        <SectionLabel>◉ ON AIR NOW · what each screen is showing this second</SectionLabel>
        {slotsQ.isLoading ? (
          <div style={{ fontSize: 20 }}>LOADING SCREENS…</div>
        ) : slots.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No screens provisioned. Seed one in signage_slots.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,320px),1fr))", gap: 14 }}>
            {slots.map((s) => {
              const takeover = activeTakeoverForSlot(takeovers, s.id);
              const mode = resolveSlotMode({
                takeover: !!takeover,
                liveGame: !!liveGame,
                moment: moment ? { stage: moment.stage, interruptGame: moment.event.interrupt_game } : null,
              });
              return (
                <ScreenCard
                  key={s.id}
                  slot={s}
                  mode={mode}
                  takeoverMessage={takeover?.message ?? null}
                  staleGameDate={staleGameDate}
                  eventLabel={eventLabel}
                  slotItems={itemsBySlot.get(s.id) ?? []}
                  tmap={tmap}
                  overflowOpen={overflowSlot === s.id}
                  onToggleOverflow={() => setOverflowSlot((cur) => (cur === s.id ? null : s.id))}
                  programLabel={programLabelFor(s)}
                  onAdd={() => setOverlay({ kind: "add", slot: s })}
                  onQueue={() => setOverlay({ kind: "queue", slot: s })}
                  onTakeover={() => setOverlay({ kind: "takeover", slot: s })}
                  // Media programs + schedules are landscape-only (portrait slots stay pure rotation).
                  onProgram={s.orientation === "landscape" ? () => setOverlay({ kind: "program", slot: s }) : undefined}
                  onSchedule={s.orientation === "landscape" ? () => setOverlay({ kind: "schedule", slot: s }) : undefined}
                  scheduleCount={(scheduleBySlot.get(s.id)?.length ?? 0)}
                  overrideHold={overrideHoldFor(s)}
                  isPanel={s.kind === "panel"}
                  // Beat 4: transport row shows only when the EFFECTIVE program (M3 resolver, not the
                  // raw row — WARN-1) is a live playlist the TV is actually looping.
                  transportPlaylist={mode === "rotation" && effFor(s).program?.kind === "playlist"}
                />
              );
            })}
          </div>
        )}

        {/* ── B · ASSET LIBRARY (collapsible — owner beat 2026-07-20) ──────── */}
        {/* + NEW ASSET moved from the grid's first tile to the section header so it stays reachable
            while the section is collapsed (matches PLAYLISTS' header + NEW pattern). */}
        <CollapsibleSection
          style={{ marginTop: 32 }}
          sectionKey="assets"
          title="ASSET LIBRARY"
          summary={assetsQ.isLoading ? "…" : `${assets.length} asset${assets.length === 1 ? "" : "s"}`}
          defaultOpen={true}
          headerRight={
            <button type="button" onClick={() => setOverlay({ kind: "asset", editing: null, preset: null, queueOnSlotId: null })} style={{ ...ghost, fontWeight: 700 }}>+ NEW ASSET</button>
          }
        >
          {assetsQ.isLoading ? (
            <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING ASSETS…</div>
          ) : assets.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 16 }}>No assets yet — + NEW ASSET to build one.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))", gap: 12 }}>
              {assets.map((a) => (
                <AssetCard key={a.asset.id} a={a} slots={slots} toastRows={toastRows} tmap={tmap} onOpen={() => openAsset(a)} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* ── B2 · MEDIA LIBRARY (docs/15 M1) ────────────────────────────── */}
        <MediaSection />

        {/* ── C · RUNNING & UPCOMING (events, D8) ────────────────────────── */}
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <SectionLabel style={{ margin: 0 }}>RUNNING &amp; UPCOMING · promos &amp; events, live and scheduled</SectionLabel>
            {canEvents && (
              <button type="button" onClick={() => setOverlay({ kind: "event", editing: null })} className="u-fill u-ink" style={{ ...ghost, fontWeight: 700, background: "var(--terminal-green)", color: "#000" }}>+ NEW EVENT</button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            {eventsQ.isLoading ? (
              <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING…</div>
            ) : events.length === 0 ? (
              <div className="terminal-border" style={{ padding: "18px 16px", opacity: 0.85, fontSize: 17, lineHeight: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>NOTHING SCHEDULED.</span>
                {canEvents && <button type="button" onClick={() => setOverlay({ kind: "event", editing: null })} className="u-fill u-ink" style={{ ...ghost, fontWeight: 700, background: "var(--terminal-green)", color: "#000" }}>+ NEW EVENT</button>}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {events.map((ev) => (
                  <EventRowCard key={ev.id} row={ev} canEvents={canEvents} onEdit={() => setOverlay({ kind: "event", editing: ev })} onChanged={invalidateEvents} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── C2 · PAST (completed events, re-runnable) — item 6 ─────────── */}
        {pastEvents.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <SectionLabel style={{ margin: 0, opacity: 0.55 }}>PAST · finished events — RE-RUN to schedule again</SectionLabel>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {pastEvents.map((ev) => (
                <PastEventRow
                  key={ev.id}
                  row={ev}
                  canEvents={canEvents}
                  onReRun={() => setOverlay({ kind: "event", editing: null, seed: seedFromEvent(ev) })}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── D · ★ FEATURED ON POS (read-only) ──────────────────────────── */}
        <div style={{ marginTop: 32 }}>
          <FeaturedPanel featured={featuredItems(toastRows)} />
        </div>
      </div>

      {/* ── slide-overs ─────────────────────────────────────────────────── */}
      {overlay?.kind === "add" && (
        <SlideOver eyebrow={`${overlay.slot.name} ▸ + ADD`} title={`ADD TO ${overlay.slot.name}`} onClose={() => setOverlay(null)}>
          <AddAssetPicker
            slot={overlay.slot}
            assets={assets}
            toastRows={toastRows}
            busyItemId={busyQueueId}
            onPickTemplate={(t) => setOverlay({ kind: "asset", editing: null, preset: t, queueOnSlotId: overlay.slot.id })}
            onQueueExisting={(a) => queueExisting.mutate({ slot: overlay.slot, a })}
          />
        </SlideOver>
      )}

      {overlay?.kind === "queue" && (
        <SlideOver eyebrow={`${overlay.slot.name} ▸ QUEUE`} title={`${overlay.slot.name} QUEUE`} onClose={() => setOverlay(null)}>
          <QueuePanel
            slot={overlay.slot}
            slotItems={itemsBySlot.get(overlay.slot.id) ?? []}
            toastRows={toastRows}
            liveEvents={liveEvents}
            gameOn={!!liveGame}
            takeovers={takeovers}
            canEvents={canEvents}
            onAdd={() => setOverlay({ kind: "add", slot: overlay.slot })}
            onEditAsset={(item) => setOverlay({ kind: "asset", editing: item, preset: null, queueOnSlotId: null })}
            onChanged={invalidateItems}
            onEventsChanged={invalidateEvents}
            onTakeover={() => setOverlay({ kind: "takeover", slot: overlay.slot })}
          />
        </SlideOver>
      )}

      {overlay?.kind === "takeover" && (
        <SlideOver eyebrow={`${overlay.slot.name} ▸ TAKEOVER`} title="SEND A TAKEOVER" onClose={() => setOverlay(null)}>
          <TakeoverPanel slot={overlay.slot} takeovers={takeovers} onChanged={invalidateTakeovers} />
        </SlideOver>
      )}

      {overlay?.kind === "event" && (
        <SlideOver eyebrow="RUNNING & UPCOMING" title={overlay.editing ? "EDIT EVENT" : overlay.seed ? "RE-RUN EVENT" : "NEW EVENT"} onClose={() => setOverlay(null)}>
          <EventEditor
            editing={overlay.editing}
            seed={overlay.seed ?? null}
            toastRows={toastRows}
            onSaved={() => { invalidateEvents(); setOverlay(null); }}
            onCancel={() => setOverlay(null)}
            onDeleted={() => { invalidateEvents(); setOverlay(null); }}
          />
        </SlideOver>
      )}

      {overlay?.kind === "program" && (
        <ProgramPanel
          slot={overlay.slot}
          hasSchedule={(scheduleBySlot.get(overlay.slot.id)?.length ?? 0) > 0}
          overrideActive={overrideHoldFor(overlay.slot) !== null}
          panelChoices={panelChoices}
          onClose={() => setOverlay(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["signage-admin", "slots"] })}
        />
      )}

      {overlay?.kind === "schedule" && (
        <ScheduleEditor slot={overlay.slot} timezone={timezone} onClose={() => setOverlay(null)} />
      )}

      {overlay?.kind === "asset" && (
        <ItemEditor
          slots={slots}
          toastRows={toastRows}
          editing={overlay.editing}
          presetTemplate={overlay.preset}
          venueName={venueQ.data?.name}
          queueOnSlotId={overlay.queueOnSlotId}
          placementSlotIds={overlay.editing ? placementsFor(assets, overlay.editing.id) : undefined}
          nextPosition={nextPosition}
          onClose={() => setOverlay(null)}
          onSaved={invalidateItems}
          onDeleted={invalidateItems}
        />
      )}
    </div>
  );
}

/** Slot ids an asset is queued on (for the editor's read-only "ON: …" line). */
function placementsFor(assets: AssetWithPlacements[], itemId: string): string[] {
  return assets.find((a) => a.asset.id === itemId)?.placements.map((p) => p.slot_id) ?? [];
}

/* ── A · screen card (D1: three buttons + ⋯ overflow) ───────────────────────── */
function ScreenCard({
  slot, mode, takeoverMessage, staleGameDate, eventLabel, slotItems, tmap,
  overflowOpen, onToggleOverflow, onAdd, onQueue, onTakeover, programLabel, onProgram,
  onSchedule, scheduleCount, overrideHold, isPanel, transportPlaylist,
}: {
  slot: AdminSlot;
  mode: SlotMode;
  takeoverMessage: string | null;
  staleGameDate: string | null;
  eventLabel: string | null;
  slotItems: AdminItem[];
  tmap: Map<string, ToastCacheRow>;
  overflowOpen: boolean;
  onToggleOverflow: () => void;
  onAdd: () => void;
  onQueue: () => void;
  onTakeover: () => void;
  /** EFFECTIVE program label + source suffix (parity — matches the TV); null = ROTATION. */
  programLabel: string | null;
  /** Landscape-only: open the SWITCH PROGRAM slide-over. undefined = portrait (no control). */
  onProgram?: () => void;
  /** Landscape-only: open the SCHEDULE (dayparts) slide-over (M3, D3). */
  onSchedule?: () => void;
  /** How many dayparts this slot has (M3). >0 shows the SCHEDULE chip. */
  scheduleCount: number;
  /** The hold tier of a LIVE override (WARN-1 parity); null = following schedule/rotation. */
  overrideHold: ProgramHold | null;
  /** M3 (D2): a multiview PANEL slot — badge, no health/takeover/program, "follows its host". */
  isPanel: boolean;
  /** Beat 4: the effective program is a live playlist → show the ⏸/▶/⏭ transport row. */
  transportPlaylist: boolean;
}) {
  const health = screenHealth(slot.last_seen);
  const summary = useMemo(() => rotationSummary(slotItems, tmap), [slotItems, tmap]);
  // In rotation mode a set program is what the TV actually plays — surface it (parity).
  const programActive = mode === "rotation" && !!programLabel;

  // ── PANEL slot (D2): a portrait sidebar that runs inside a landscape multiview. No health dot
  //    (health belongs to the host screen), no takeover ("follows its host"), no program control. ──
  if (isPanel) {
    return (
      <div className="terminal-border" style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.name}</span>
          <span className="u-amber" style={{ fontSize: 11, letterSpacing: 2, border: "1px solid var(--terminal-amber, #ffb000)", color: "var(--terminal-amber, #ffb000)", padding: "2px 7px", flexShrink: 0 }}>PANEL</span>
        </div>
        <div style={{ fontSize: 13, opacity: 0.55 }}>PORTRAIT PANEL · runs inside a landscape MULTIVIEW · no TV of its own</div>
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>{summary}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 2 }}>
          <button type="button" onClick={onAdd} className="u-fill u-ink" style={{ ...cardBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700 }}>+ ADD</button>
          <button type="button" onClick={onQueue} style={cardBtn}>QUEUE</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.45, letterSpacing: 1 }}>no takeover — follows its host screen</div>
      </div>
    );
  }

  return (
    <div className="terminal-border" style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.name}</span>
        <HealthDot health={health} />
      </div>
      <div style={{ fontSize: 13, opacity: 0.55 }}>
        {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <ModeChip mode={mode} eventLabel={eventLabel} programLabel={programActive ? programLabel : null} />
        {scheduleCount > 0 && (
          <span className={overrideHold ? "u-amber" : ""} style={{ fontSize: 11, letterSpacing: 1, border: "1px solid currentColor", padding: "2px 7px", opacity: 0.85, color: overrideHold ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)" }}>
            {overrideHold ? (overrideHold === "event" ? "⧗ SPECIAL EVENT" : "⧗ OVERRIDE") : `⧗ ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}`}
          </span>
        )}
      </div>

      {mode === "rotation" && programActive ? (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>
          <span className="u-amber">Playing {programLabel}.</span> Rotation resumes when the program is set back to ROTATION (a game/takeover still preempts it).
        </div>
      ) : mode === "rotation" ? (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>{summary}</div>
      ) : mode === "event" ? (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>
          <span className="u-amber">Scheduled event holding the screens{eventLabel ? `: ${eventLabel}` : ""}.</span> Returns to rotation when the window ends.
        </div>
      ) : mode === "game" ? (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>
          <span className="u-amber">Showing the game display.</span> Returns to rotation automatically when the game ends.
          {staleGameDate ? <span className="u-amber"> · game dated {staleGameDate}</span> : null}
        </div>
      ) : (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>
          <span className="u-red">Priority takeover on this screen</span>{takeoverMessage ? `: “${takeoverMessage}”` : ""}. Dismiss from TAKEOVER.
        </div>
      )}

      {/* the three clean buttons + ⋯ overflow (D1) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 7, marginTop: 2 }}>
        <button type="button" onClick={onAdd} className="u-fill u-ink" style={{ ...cardBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700 }}>+ ADD</button>
        <button type="button" onClick={onQueue} style={cardBtn}>QUEUE</button>
        <button type="button" onClick={onTakeover} className="u-amber" style={{ ...cardBtn, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)" }}>TAKEOVER</button>
        <button type="button" onClick={onToggleOverflow} aria-label="More" title="KIOSK URL · PREVIEW · health" style={{ ...cardBtn, padding: "9px 10px", fontSize: 20, opacity: 0.75 }}>⋯</button>
      </div>

      {/* PROGRAM control — landscape (media-capable) screens only (docs/15). Shows the current
          program + opens SWITCH PROGRAM. Portrait slots stay pure rotation (no control). */}
      {onProgram && (
        <button type="button" onClick={onProgram} className={programActive ? "u-amber" : ""} style={{ ...cardBtn, gridColumn: "1 / -1", justifyContent: "space-between", padding: "9px 12px", ...(programActive ? { color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)" } : null) }}>
          <span style={{ letterSpacing: 1 }}>▶ PROGRAM: {programActive ? programLabel : "ROTATION"}</span>
          <span style={{ opacity: 0.7 }}>SWITCH ▸</span>
        </button>
      )}

      {/* TRANSPORT — skip/pause a live playlist without curl/Q-SYS (Beat 4). Fire-and-forget
          broadcast; no state tracking (transport is ephemeral by design). */}
      {transportPlaylist && <TransportRow slug={slot.slug} />}

      {/* SCHEDULE — dayparts that flip the program by time of day (M3, landscape only). */}
      {onSchedule && (
        <button type="button" onClick={onSchedule} style={{ ...cardBtn, gridColumn: "1 / -1", justifyContent: "space-between", padding: "9px 12px" }}>
          <span style={{ letterSpacing: 1 }}>⧗ SCHEDULE{scheduleCount > 0 ? `: ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}` : ""}</span>
          <span style={{ opacity: 0.7 }}>{scheduleCount > 0 ? "EDIT ▸" : "SET UP ▸"}</span>
        </button>
      )}

      {overflowOpen && (
        <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
          <div style={{ fontSize: 13, opacity: 0.6 }}>
            SCREEN HEALTH: <HealthDot health={health} />{slot.last_seen ? ` · last seen ${new Date(slot.last_seen).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "numeric", day: "numeric" })}` : " · never checked in"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href={`/signage/s/${slot.slug}?preview=1`}
              target="_blank"
              rel="noreferrer"
              title="Staff preview only — NEVER point a TV at a ?preview=1 URL (it never shows takeovers or game mode)."
              style={{ ...miniBtn, textDecoration: "none" }}
            >PREVIEW ↗</a>
            <CopyKioskButton slug={slot.slug} style={miniBtn} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Playlist transport row (Beat 4) — ⏸ PAUSE / ▶ RESUME / ⏭ NEXT, broadcast to the TV playing this
 * slug. Fire-and-forget: a brief pressed flash is the only feedback (transport is ephemeral — the
 * hub tracks NO play/pause state; a paused TV self-heals at the 04:00 reload or the next program
 * write). The channel is torn down per send inside sendTransportCommand.
 */
function TransportRow({ slug }: { slug: string }) {
  const [pressed, setPressed] = useState<TransportCmd | null>(null);
  const send = (cmd: TransportCmd) => {
    setPressed(cmd);
    window.setTimeout(() => setPressed((c) => (c === cmd ? null : c)), 260);
    void sendTransportCommand(slug, cmd).catch(() => {});
  };
  const btns: { cmd: TransportCmd; label: string }[] = [
    { cmd: "pause", label: "⏸ PAUSE" },
    { cmd: "resume", label: "▶ RESUME" },
    { cmd: "next", label: "⏭ NEXT" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, gridColumn: "1 / -1" }}>
      {btns.map(({ cmd, label }) => {
        const on = pressed === cmd;
        return (
          <button key={cmd} type="button" onClick={() => send(cmd)} className={on ? "u-fill u-ink" : ""}
            style={{ ...cardBtn, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400 }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ModeChip({ mode, eventLabel, programLabel }: { mode: SlotMode; eventLabel?: string | null; programLabel?: string | null }) {
  const label =
    mode === "rotation" && programLabel ? `PROGRAM: ${programLabel}`
    : mode === "rotation" ? "MODE: ROTATION"
    : mode === "game" ? "MODE: LIVE GAME"
    : mode === "event" ? `EVENT: ${eventLabel ?? "SCHEDULED"}`
    : "MODE: TAKEOVER";
  const cls = mode === "game" || mode === "event" || (mode === "rotation" && programLabel) ? "u-amber" : mode === "takeover" ? "u-red" : "";
  return (
    <span className={cls} style={{ display: "inline-block", alignSelf: "flex-start", fontSize: 12, letterSpacing: 2, border: "1px solid currentColor", padding: "2px 8px", opacity: mode === "rotation" && !programLabel ? 0.7 : 1 }}>
      {label}
    </span>
  );
}

/** "N assets rotating: a · b · c · +K more" (+ ★ featured). Counts only currently-visible
 *  authored items — resolveRotation applies the exact in-window + OOS/POS-hide rules. */
function rotationSummary(slotItems: AdminItem[], tmap: Map<string, ToastCacheRow>): string {
  const activeItems = slotItems.filter((it) => it.active);
  const rotation = resolveRotation(activeItems as SignageItem[], tmap, new Date());
  const authored = rotation.filter((r) => !r.materialized);
  const hasFeatured = rotation.some((r) => r.materialized);
  const names = authored.map((it) => rotationName(it, tmap));

  if (authored.length === 0 && !hasFeatured) return "Nothing rotating yet — + ADD an asset.";
  if (authored.length === 0) return "★ featured items only (flipped in at the POS).";

  const shown = names.slice(0, 3).join(" · ");
  const more = authored.length > 3 ? ` · +${authored.length - 3} more` : "";
  const featured = hasFeatured ? " · + ★ featured" : "";
  return `${authored.length} asset${authored.length === 1 ? "" : "s"} rotating: ${shown}${more}${featured}`;
}

function rotationName(it: SignageItem, tmap: Map<string, ToastCacheRow>): string {
  const f = it.fields ?? {};
  const nm = typeof f.name === "string" && f.name.trim() ? (f.name as string).trim() : "";
  if (nm) return nm;
  const guid = typeof f.source_toast_guid === "string" ? (f.source_toast_guid as string) : "";
  if (guid) {
    const r = tmap.get(guid);
    if (r?.name) return r.name;
  }
  return summarize(it as AdminItem);
}

/* ── B · asset library card (D3) ────────────────────────────────────────────── */
function AssetCard({
  a, slots, toastRows, tmap, onOpen,
}: {
  a: AssetWithPlacements;
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  tmap: Map<string, ToastCacheRow>;
  onOpen: () => void;
}) {
  const item = a.asset as unknown as AdminItem;
  const name = summarize(item, toastRows);
  const image = assetImage(item, tmap);
  const smart = isSmartTemplate(item.template);
  const placedSlots = new Set(a.placements.map((p) => p.slot_id));
  const sub = assetSubtitle(item, tmap);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="terminal-border"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden", padding: 0, background: "transparent", color: "var(--terminal-green)", cursor: "pointer", fontFamily: MONO, textAlign: "left", minWidth: 0 }}
    >
      <div style={{ position: "relative", height: 96, borderBottom: "1px solid rgba(0,255,65,0.2)", display: "flex", alignItems: "center", justifyContent: "center", background: "#030803" }}>
        {image ? (
          <img src={image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: 34, opacity: 0.85 }}>{templateIcon(item.template)}</span>
        )}
        <span
          className={smart ? "u-amber" : ""}
          style={{ position: "absolute", top: 6, right: 6, fontSize: 10, letterSpacing: 1, padding: "2px 5px", background: "#020602", border: `1px solid ${smart ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)"}`, color: smart ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)" }}
        >{templateBadge(item.template)}</span>
      </div>
      <div style={{ padding: "9px 10px", display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <div style={{ fontSize: 20, letterSpacing: 1, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div style={{ fontSize: 12, opacity: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          {slots.map((s) => {
            const on = placedSlots.has(s.id);
            return (
              <span
                key={s.id}
                title={`${s.name} — ${on ? "queued" : "not queued"}`}
                className={on ? "u-fill u-ink" : ""}
                style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: on ? 700 : 400, border: "1px solid var(--terminal-green)", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "rgba(0,255,65,0.5)" }}
              >{slotCode(s)}</span>
            );
          })}
          {a.placements.length === 0 && <span style={{ fontSize: 11, opacity: 0.45, alignSelf: "center", letterSpacing: 1 }}>IDLE</span>}
        </div>
      </div>
    </button>
  );
}

/** Thumbnail image for a library asset (custom upload wins, else the linked Toast photo). */
function assetImage(item: AdminItem, tmap: Map<string, ToastCacheRow>): string | null {
  const f = item.fields ?? {};
  const url = typeof f.image_url === "string" && f.image_url.trim() ? (f.image_url as string) : null;
  if (url) return url;
  const guid = typeof f.source_toast_guid === "string" ? (f.source_toast_guid as string) : "";
  if (guid) return tmap.get(guid)?.image ?? null;
  return null;
}

function assetSubtitle(item: AdminItem, tmap: Map<string, ToastCacheRow>): string {
  const f = item.fields ?? {};
  const guid = typeof f.source_toast_guid === "string" ? (f.source_toast_guid as string) : "";
  const src = guid ? tmap.get(guid) : undefined;
  switch (item.template) {
    case "drink_special": {
      const price = typeof f.price === "number" ? `$${f.price}` : src?.price != null ? `$${src.price}` : "";
      const grp = (typeof f.category === "string" && f.category) || src?.menu_group || "";
      return [price, grp && grp.toString().toUpperCase(), src ? "live from Toast" : ""].filter(Boolean).join(" · ") || "drink special";
    }
    case "top_sellers": return "live top-5 from the POS · auto";
    case "instagram": return "recent posts · caption + QR";
    case "smart_toast": return `${(typeof f.smart_mode === "string" ? f.smart_mode : "underdogs")} · auto`;
    case "event": return typeof f.date === "string" ? `event · ${f.date}` : "event";
    case "celebration": return "celebration";
    case "image_only": return "full-frame photo";
    default: return templateBadge(item.template).toLowerCase();
  }
}

/* ── C · running & upcoming event row (D8) ──────────────────────────────────── */
function EventRowCard({ row, canEvents, onEdit, onChanged }: { row: EventRow; canEvents: boolean; onEdit: () => void; onChanged: () => void }) {
  const phrase = useMemo(() => schedulePhrase(row), [row]);
  const st = statusInfo(row);
  const done = row.status === "completed" || row.status === "aborted";
  const paused = row.status === "disabled";
  const isLive = st.tone === "now";

  const toggle = useMutation({ mutationFn: () => (paused ? resumeEvent(row) : pauseEvent(row.id)), onSuccess: onChanged });
  const fire = useMutation({ mutationFn: () => fireNowEvent(row), onSuccess: onChanged });

  return (
    <div className="terminal-border" style={{ padding: "10px 13px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", opacity: done ? 0.65 : 1 }}>
      <button type="button" onClick={onEdit} style={{ flex: "1 1 220px", minWidth: 0, textAlign: "left", background: "transparent", border: "none", color: "inherit", fontFamily: MONO, cursor: "pointer", padding: 0 }}>
        <div style={{ fontSize: 21, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{phrase}{row.interrupt_game ? " · interrupts game" : ""}{row.show_on_website ? " · 🌐" : ""}</div>
      </button>
      <EventKindBadge kind={row.kind} />
      <span className={st.tone === "one" ? "u-amber" : undefined} style={{ fontSize: 13, whiteSpace: "nowrap", letterSpacing: 1, opacity: st.tone === "up" || st.tone === "done" ? 0.7 : 1 }}>{st.label}</span>
      {canEvents && !done && (
        isLive || paused ? (
          <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending} className={paused ? "" : "u-fill u-ink"} style={{ ...rowBtn, ...(paused ? null : { fontWeight: 700, background: "var(--terminal-green)", color: "#000" }) }}>
            {paused ? "▶ RESUME" : "❚❚ PAUSE"}
          </button>
        ) : (
          <button type="button" onClick={() => { if (confirm(row.kind === "moment" ? "Fire this MOMENT now? It skips the tease and lands in ALERT." : "Put this on the screens now?")) fire.mutate(); }} disabled={fire.isPending} className="u-amber" style={{ ...rowBtn, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)" }}>▶ FIRE NOW</button>
        )
      )}
      {canEvents && <button type="button" onClick={onEdit} style={rowBtn}>EDIT</button>}
    </div>
  );
}

/* ── C2 · PAST event archive + RE-RUN (item 6) ──────────────────────────────── */
/** Content-only duplicate of a completed event for RE-RUN. Copies WHAT it is (name/kind/skin/
 *  fields/toast/website/interrupt) and drops the old TIMING (fire_at/window/recurrence/status/id
 *  never travel — the editor opens as a fresh NEW event). Per-run counter keys are stripped so a
 *  re-run doesn't inherit a stale tally. */
function seedFromEvent(row: EventRow): EventSeed {
  const { live_count: _lc, final_stats: _fs, ...fields } = row.fields ?? {};
  void _lc; void _fs;
  return {
    name: row.name,
    kind: row.kind,
    skin: row.skin,
    fields,
    toast_guid: row.toast_guid,
    show_on_website: row.show_on_website,
    interrupt_game: row.interrupt_game,
  };
}

/** A quiet archive row: what it was + when it ran + a RE-RUN affordance (gated on canEvents; the
 *  list itself renders read-only for signage-only users). RE-RUN only OPENS the editor pre-filled;
 *  nothing goes live until the owner saves a new schedule. */
function PastEventRow({ row, canEvents, onReRun }: { row: EventRow; canEvents: boolean; onReRun: () => void }) {
  const phrase = useMemo(() => schedulePhrase(row), [row]);
  return (
    <div className="terminal-border" style={{ padding: "8px 13px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", opacity: 0.6 }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 19, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>ran {phrase}{row.show_on_website ? " · 🌐" : ""}</div>
      </div>
      <EventKindBadge kind={row.kind} />
      <span style={{ fontSize: 13, letterSpacing: 1, opacity: 0.6 }}>DONE</span>
      {canEvents && <button type="button" onClick={onReRun} style={rowBtn}>↻ RE-RUN</button>}
    </div>
  );
}

/* ── D · ★ SCREENS featured (read-only) ─────────────────────────────────────── */
function FeaturedPanel({ featured }: { featured: ReturnType<typeof featuredItems> }) {
  return (
    <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>★ FEATURED ON POS <span style={{ fontSize: 13, opacity: 0.5, letterSpacing: 2 }}>read-only — flipped at the register</span></div>
      <div style={{ fontSize: 15, opacity: 0.65, marginTop: -4 }}>
        In-stock items in the Toast ★ SCREENS group auto-rotate onto every screen. Toggle these at the POS
        (Quick Edit → In/Out of Stock) — there is no button here (Toast access is read-only).
      </div>
      {featured.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 17 }}>Nothing featured right now. Mark an item In Stock in the POS ★ SCREENS group.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))", gap: 8 }}>
          {featured.map((f) => (
            <div key={f.guid} className="terminal-border" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", minWidth: 0 }}>
              {f.image
                ? <img src={f.image} alt="" style={{ width: 40, height: 40, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                : <span style={{ width: 40, height: 40, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
              <span className="sig-live" style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 18 }}>{f.name}</span>
              {f.price != null && <span className="sig-live" style={{ fontSize: 17 }}>${f.price}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────────── */
const cardBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 14, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "rgba(0,255,65,0.05)", padding: "9px 6px",
  minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", textAlign: "center",
};
const miniBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "8px 10px",
  minHeight: 44, cursor: "pointer", display: "inline-flex", alignItems: "center",
};
const rowBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "7px 11px",
  minHeight: 44, cursor: "pointer", whiteSpace: "nowrap",
};

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  useAdminSlots, useAllItems, useSignageAssets, useTakeovers, useToastCache,
  useSlotsRealtime,
  screenHealth, featuredItems, toastMap,
  type AdminItem, type AdminSlot, type AssetWithPlacements,
} from "./useSignageAdmin";
import {
  useLiveEvents, activeMoment, useVenue,
  useCloseoutHour,
  type SlotMode, type ToastCacheRow, type VenueClock,
} from "./useSignage";
import type { ProgramHold } from "./scheduleResolve";
import { useEventsList, schedulePhrase, type EventRow } from "./useEventsAdmin";
import {
  MONO, SectionLabel, CollapsibleSection, requestOpenHubSection, HealthDot, CopyKioskButton, EventKindBadge,
  ghost,
} from "./signageAdminShared";
// Hub internals shared with the v2 view + the slide-over host (Beat 3 — verbatim moves).
import {
  AssetCard, TransportRow, cardBtn, miniBtn, rotationSummary, seedFromEvent,
  groupItemsBySlot, makeNextPosition,
  makeEffFor, makeModeFor, makeOverrideHoldFor, makeProgramLabelFor, makeTakeoverMessageFor,
  makeTransportPlaylistFor, playlistNameMap,
  useEventRowActions, type Overlay, type SignageHubContext,
} from "./signageHubShared";
import { HubOverlays } from "./HubOverlays";
import { SignageHubV2 } from "./SignageHubV2";
import { useTriviaArmState } from "./triviaArm";
import { useUiVersion } from "@/shared/useUiVersion";
import { addToQueue } from "./slotQueue";
import { MediaSection } from "./MediaSection";
import { useMediaPlaylists, useAllScheduleRows } from "./useMediaAdmin";
import { useRole } from "@/shared/useRole";
import { useIsMobile } from "@/shared/useIsMobile";
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

/**
 * Hash anchor id → the CollapsibleSection key it must expand (null = a plain block that
 * only needs scrolling). These ids are rendered on the section roots below (Beat 1 — the
 * v2 nav pointed at /signage#… instead of new routes). `library` / `playlists` are now
 * BOOKMARK COMPATIBILITY in v2 only — Beat 4 gave them real /media/* pages and the effect
 * below forwards them there; classic still expands the section named here.
 *
 * DECISION (Beat 6 PR 4): BAR OPS ▸ SLIDES gets NO entry here. The asset section never had
 * an anchor — no nav link, no bookmark and no `#assets` key ever existed — so there is
 * nothing to forward to /signage/slides, and adding the key would give classic a behaviour
 * (expand-on-#assets) it does not have today.
 */
const HASH_SECTIONS: Record<string, string | null> = {
  screens: null,
  events: null,
  library: "media",
  playlists: "playlists",
};

export function SignageHub({ openQueueSlug }: { openQueueSlug?: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const canEvents = can("events");
  const [version] = useUiVersion();

  useSlotsRealtime();
  const slotsQ = useAdminSlots();
  const schedulesQ = useAllScheduleRows();
  const closeoutQ = useCloseoutHour();
  const playlistsQ = useMediaPlaylists();
  const itemsQ = useAllItems();
  const assetsQ = useSignageAssets();
  const takeoversQ = useTakeovers();
  const toastQ = useToastCache();
  const liveEventsQ = useLiveEvents();
  const eventsQ = useEventsList();
  const venueQ = useVenue();

  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  // M3 (D2/D3): per-slot dayparts, and the portrait/panel slots a multiview PANEL can point at.
  const scheduleBySlot = useMemo(() => schedulesQ.data ?? new Map(), [schedulesQ.data]);
  const timezone = venueQ.data?.timezone ?? "America/Chicago";
  const rolloverHour = closeoutQ.data ?? 4;
  // The same clock the TV resolves item weekday rules in (hub/TV parity — an ON AIR card must
  // not count a Tuesdays-only asset on a Wednesday).
  const venueClock = useMemo<VenueClock>(() => ({ timezone, closeoutHour: rolloverHour }), [timezone, rolloverHour]);

  // A slow render clock, at the 60s cadence the admin slot poll already runs on (this is a
  // console, not a display — the docs/01 sub-30s floor governs /signage/s). Time-derived reads
  // are memoised on their DATA, so without a ticking `now` in the deps a card computed before
  // the business-day rollover would keep asserting yesterday's rotation until something else
  // invalidated it.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);
  const panelChoices = useMemo(() => slots.filter((s) => s.orientation === "portrait"), [slots]);

  // WARN-1 (hub/TV parity): the card chip + ProgramPanel must show what the TV is ACTUALLY playing —
  // run the SAME resolver the display runs (schedule rows + hold), never the raw slot.program row (an
  // active daypart would read ROTATION, and an EXPIRED override would read PROGRAM: X forever). now()
  // at render is fine — the hub re-renders on realtime + the 60s slot poll (it is not a TV).
  // The expression itself now lives in signageHubShared (Beat 4) so the MEDIA ▸ SCREENS &
  // PROGRAMS page resolves a screen's program from the SAME definition this page does.
  const effFor = makeEffFor(scheduleBySlot, timezone, rolloverHour);
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
  const playlistNameById = useMemo(() => playlistNameMap(playlistsQ.data), [playlistsQ.data]);
  // The EFFECTIVE program label + its source suffix (parity — matches the TV, WARN-1). null = rotation.
  const programLabelFor = makeProgramLabelFor(effFor, playlistNameById);
  // The hold tier of an ACTIVE override (for the ⧗ chip); null when no override is live (following a
  // schedule / rotation — even if a stale override row lingers in the DB, DECISION-1).
  const overrideHoldFor = makeOverrideHoldFor(effFor);

  // "PUT TRIVIA ON SCREENS" arm (0056/0057): DEFAULT OFF, auto-expires nightly. Trivia only reaches
  // the bar TVs when EFFECTIVELY armed, so the hub must show ROTATION for an un-armed game (hub/TV
  // parity) — but staff still need to SEE the armed state, even with no game loaded, so we surface
  // banners below. The three sentences (+ the arm read that applies the nightly expiry, + the live
  // game resolved the TV's way) now live ONCE, in `triviaArm.ts`, because HOME's alert strip reports
  // the same fact (Beat 6 PR 2, code note N8) and two copies would be two answers. Byte-for-byte the
  // same arithmetic on the same inputs as before the hoist.
  const { liveGame, gameOnScreens, gameOffScreens, alertNotArmed, armedNoGame } = useTriviaArmState();
  const moment = activeMoment(liveEvents);
  const eventLabel = moment ? `${moment.event.name.toUpperCase()} · ${moment.stage.toUpperCase()}` : null;
  const staleGameDate =
    liveGame?.game_date && liveGame.game_date !== new Date().toLocaleDateString("en-CA")
      ? liveGame.game_date
      : null;

  // Both bodies moved VERBATIM into signageHubShared (Beat 6 PR 4) so BAR OPS ▸ SLIDES
  // computes a new slide's queue position from the same definition this page does.
  const itemsBySlot = useMemo(() => groupItemsBySlot(items), [items]);
  const nextPosition = makeNextPosition(itemsBySlot);

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

  // Hash anchors (UX overhaul Beat 1). The v2 nav points BAR OPS ▸ EVENTS & PROMOS and the
  // whole MEDIA section at /signage#<section> instead of new routes. On landing (and on any
  // later hash change) expand the named collapsible — the media library is default-collapsed,
  // so a link that only scrolled would land on a closed header — then scroll it into view
  // after paint. NO hash ⇒ nothing happens at all, so the hub behaves exactly as before.
  // `location.key` is in the deps so re-clicking the same link scrolls again.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (!Object.hasOwn(HASH_SECTIONS, id)) return;
    // Beat 4: in v2 the media surfaces are their own pages and this hub no longer renders
    // MediaSection at all — so an old #library / #playlists link (a Beat 1 nav bookmark, a
    // link someone pasted) has to go there instead of scrolling to a section that is gone.
    // CLASSIC never enters this branch: it still keeps both sections on this page.
    if (version === "v2" && (id === "library" || id === "playlists")) {
      navigate(id === "library" ? "/media/library" : "/media/playlists", { replace: true });
      return;
    }
    const collapseKey = HASH_SECTIONS[id];
    if (collapseKey) requestOpenHubSection(collapseKey);
    // The hub's sections fill in asynchronously (the media grid is hundreds of cards), so
    // the anchor MOVES after the first paint — one scroll lands on the wrong pixel (or gets
    // clamped to 0 while the page is still short). Re-assert it a few times and stop: a
    // bounded, finite sequence, never a polling loop. Offset by the sticky nav's height so
    // the section header isn't parked underneath it.
    const jump = () => {
      const el = document.getElementById(id);
      if (!el) return;
      const nav = document.querySelector("nav");
      const offset = nav ? nav.getBoundingClientRect().height + 8 : 0;
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset) });
    };
    const timers = [0, 150, 400, 900].map((d) => window.setTimeout(jump, d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [location.hash, location.key, version, navigate]);

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

  // ── per-slot derivation, ONE site (UX overhaul Beat 3) ────────────────────────────
  // The hub/TV parity invariant says an ON AIR card reports what the TV resolves. These
  // four closures are that single site: both presentations render what they return, and
  // neither re-derives. Each is the expression the classic map already inlined, moved up
  // here unchanged — same resolveSlotMode call, same effFor call, same arguments.
  const takeoverMessageFor = makeTakeoverMessageFor(takeovers);
  // liveGame: gameOnScreens — respects the screens-live gate (parity with the TV).
  const modeFor = makeModeFor(takeovers, gameOnScreens, moment);
  const scheduleCountFor = (slot: AdminSlot) => scheduleBySlot.get(slot.id)?.length ?? 0;
  // Transport shows only when the EFFECTIVE program (M3 resolver, not the raw row — WARN-1)
  // is a live playlist the TV is actually looping.
  const transportPlaylistFor = makeTransportPlaylistFor(modeFor, effFor);

  // The slide-overs render for BOTH presentations from this one set of props.
  const overlays = (
    <HubOverlays
      overlay={overlay}
      setOverlay={setOverlay}
      slots={slots}
      assets={assets}
      toastRows={toastRows}
      itemsBySlot={itemsBySlot}
      liveEvents={liveEvents}
      liveGame={liveGame}
      takeovers={takeovers}
      canEvents={canEvents}
      busyQueueId={busyQueueId}
      queueExisting={queueExisting}
      scheduleBySlot={scheduleBySlot}
      overrideHoldFor={overrideHoldFor}
      panelChoices={panelChoices}
      timezone={timezone}
      venueName={venueQ.data?.name}
      nextPosition={nextPosition}
      invalidateItems={invalidateItems}
      invalidateTakeovers={invalidateTakeovers}
      invalidateEvents={invalidateEvents}
      qc={qc}
      // Beat 8 PR 2: this node is built once and handed to whichever presentation renders
      // below, so the version is passed in rather than re-read inside the panels. "classic"
      // is the default value, so the classic hub's tree is unchanged.
      variant={version === "v2" ? "v2" : "classic"}
    />
  );

  // v2 presentation (Beat 3). Every hook above has already run, so the per-device switch can
  // flip at any time without changing hook order. Same queries, same mutations, same
  // slide-overs — only the markup below differs.
  if (version === "v2") {
    const ctx: SignageHubContext = {
      slots, slotsLoading: slotsQ.isLoading,
      assets, assetsLoading: assetsQ.isLoading,
      itemsBySlot, tmap, takeovers,
      events, pastEvents, eventsLoading: eventsQ.isLoading,
      featured: featuredItems(toastRows),
      now, venueClock, canEvents,
      gameOffScreens, alertNotArmed, armedNoGame, eventLabel, staleGameDate,
      modeFor, programLabelFor, overrideHoldFor, takeoverMessageFor, scheduleCountFor, transportPlaylistFor,
      overlay, setOverlay,
      overflowSlot,
      toggleOverflow: (slotId) => setOverflowSlot((cur) => (cur === slotId ? null : slotId)),
      invalidateEvents,
    };
    return <SignageHubV2 ctx={ctx} overlays={overlays} />;
  }

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
        {/* id: the v2 MEDIA nav's SCREENS & PROGRAMS link is /signage#screens (Beat 1). */}
        <div id="screens">
        <SectionLabel>◉ ON AIR NOW · what each screen is showing this second</SectionLabel>
        {gameOffScreens && (
          // A game exists but trivia is NOT armed onto the screens (0056, default OFF) — the TVs are
          // on rotation/media, NOT the game. Tell staff so the cards reading ROTATION make sense.
          <div className="u-amber" style={{ border: "1px solid var(--terminal-amber, #ffb000)", padding: "10px 14px", marginBottom: 12, fontSize: 16, lineHeight: 1.4 }}>
            ⚠ TRIVIA IS <strong>NOT ON THE SCREENS</strong> — a game exists but hasn't been armed. The bar TVs are on rotation.
            Arm it with “PUT TRIVIA ON SCREENS” from the Scoring page before game night.
          </div>
        )}
        {armedNoGame && (
          // Persistent armed indicator (WARN-1 #4): armed with NO game loaded must never be invisible.
          // The arm auto-expires at the nightly 04:00 rollover; until then the bar shows the holding
          // board the moment a game is created.
          <div style={{ border: "1px solid var(--terminal-green)", padding: "10px 14px", marginBottom: 12, fontSize: 16, lineHeight: 1.4 }}>
            ◐ TRIVIA IS <strong>ARMED</strong> — no game loaded yet. The bar TVs show the SCAN-TO-JOIN holding board
            as soon as a game is created, then the live board once it starts. Auto-clears at the nightly rollover.
          </div>
        )}
        {slotsQ.isLoading ? (
          <div style={{ fontSize: 20 }}>LOADING SCREENS…</div>
        ) : slots.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No screens provisioned. Seed one in signage_slots.</div>
        ) : (
          // Variant A (owner-ratified hub-layout-options.html): full-width control ROWS — a
          // vertical stack of wide cards, not a narrow auto-fill grid, so the desktop width is
          // used and each screen's controls sit on one legible row (collapses to a stacked column
          // on his phone). Card max-width comes from the page's 1100px wrapper above.
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {slots.map((s) => {
              const mode = modeFor(s);
              return (
                <ScreenCard
                  key={s.id}
                  slot={s}
                  mode={mode}
                  takeoverMessage={takeoverMessageFor(s)}
                  staleGameDate={staleGameDate}
                  eventLabel={eventLabel}
                  slotItems={itemsBySlot.get(s.id) ?? []}
                  tmap={tmap}
                  now={now}
                  venueClock={venueClock}
                  overflowOpen={overflowSlot === s.id}
                  onToggleOverflow={() => setOverflowSlot((cur) => (cur === s.id ? null : s.id))}
                  programLabel={programLabelFor(s)}
                  onAdd={() => setOverlay({ kind: "add", slot: s })}
                  onQueue={() => setOverlay({ kind: "queue", slot: s })}
                  onTakeover={() => setOverlay({ kind: "takeover", slot: s })}
                  // Media programs + schedules are landscape-only (portrait slots stay pure rotation).
                  onProgram={s.orientation === "landscape" ? () => setOverlay({ kind: "program", slot: s }) : undefined}
                  onSchedule={s.orientation === "landscape" ? () => setOverlay({ kind: "schedule", slot: s }) : undefined}
                  scheduleCount={scheduleCountFor(s)}
                  overrideHold={overrideHoldFor(s)}
                  isPanel={s.kind === "panel"}
                  transportPlaylist={transportPlaylistFor(s)}
                />
              );
            })}
          </div>
        )}
        </div>

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
                <AssetCard key={a.asset.id} a={a} slots={slots} toastRows={toastRows} tmap={tmap} now={now} venueClock={venueClock} onOpen={() => openAsset(a)} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* ── B2 · MEDIA LIBRARY (docs/15 M1) ────────────────────────────── */}
        <MediaSection />

        {/* ── C · RUNNING & UPCOMING (events, D8) ────────────────────────── */}
        {/* id: the v2 BAR OPS nav's EVENTS & PROMOS link is /signage#events (Beat 1). */}
        <div id="events" style={{ marginTop: 32 }}>
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

      {overlays}
    </div>
  );
}
/* ── A · screen card (D1: three buttons + ⋯ overflow) ───────────────────────── */
function ScreenCard({
  slot, mode, takeoverMessage, staleGameDate, eventLabel, slotItems, tmap, now, venueClock,
  overflowOpen, onToggleOverflow, onAdd, onQueue, onTakeover, programLabel, onProgram,
  onSchedule, scheduleCount, overrideHold, isPanel, transportPlaylist,
}: {
  slot: AdminSlot;
  /** The hub's 60s render clock — in the summary memo's deps so the ON AIR line re-resolves
   *  after a business-day rollover instead of freezing on the data it was first computed with. */
  now: Date;
  /** Venue TZ + closeout hour — the ON AIR summary resolves weekday rules exactly like the TV. */
  venueClock: VenueClock;
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
  const summary = useMemo(() => rotationSummary(slotItems, tmap, now, venueClock), [slotItems, tmap, now, venueClock]);
  // In rotation mode a set program is what the TV actually plays — surface it (parity).
  const programActive = mode === "rotation" && !!programLabel;
  // Variant A: below ~720px the wide control row degrades to the stacked column he has today
  // (idcol / status / actions stack, sub-strip wraps). Same idiom as the other staff surfaces
  // that flip an exact layout a CSS media query can't express.
  const narrow = useIsMobile(720);
  // Landscape (media-capable) screens get the PROGRAM/SCHEDULE/transport sub-strip. onProgram is
  // only defined for landscape slots, so its presence is the gate (matches the old render).
  const hasSubStrip = !!onProgram || !!onSchedule || transportPlaylist;

  // Plain-language status — EXACT wording preserved from the per-mode branches; only the sizing
  // and placement change (it now lives in the middle column at normal body size, no headline
  // treatment / minHeight). The u-amber/u-red emphasis is part of the wording, kept. NOTE the
  // global `.terminal-theme span{font-size:1.5rem}` rule hits any bare emphasis <span> directly
  // (the parent div's inline 14px doesn't cascade to it) — that's the 24px "oversized blurb" the
  // owner flagged. Pin the emphasis spans to inherit so they read at body size (this was already
  // the bug in the old stacked card; the redesign fixes it).
  const emph: CSSProperties = { fontSize: "inherit" };
  const statusNode =
    mode === "rotation" && programActive ? (
      <><span className="u-amber" style={emph}>Playing {programLabel}.</span> Rotation resumes when the program is set back to ROTATION (a game/takeover still preempts it).</>
    ) : mode === "rotation" ? (
      <>{summary}</>
    ) : mode === "event" ? (
      <><span className="u-amber" style={emph}>Scheduled event holding the screens{eventLabel ? `: ${eventLabel}` : ""}.</span> Returns to rotation when the window ends.</>
    ) : mode === "game" ? (
      <><span className="u-amber" style={emph}>Showing the game display.</span> Returns to rotation automatically when the game ends.{staleGameDate ? <span className="u-amber" style={emph}> · game dated {staleGameDate}</span> : null}</>
    ) : (
      <><span className="u-red" style={emph}>Priority takeover on this screen</span>{takeoverMessage ? `: “${takeoverMessage}”` : ""}. Dismiss from TAKEOVER.</>
    );

  // ── PANEL slot (D2): a portrait sidebar that runs inside a landscape multiview. No health dot
  //    (health belongs to the host screen), no takeover ("follows its host"), no program control. ──
  if (isPanel) {
    // PANEL slots keep their reduced treatment (no health / takeover / program / schedule —
    // "follows its host") but ride the same full-width row rhythm: identity + note on the left,
    // status in the middle, the two allowed actions (+ ADD · QUEUE) on the right.
    return (
      <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", gap: 20, alignItems: narrow ? "stretch" : "flex-start", flexWrap: "wrap", minWidth: 0 }}>
        <div style={{ flex: narrow ? "1 1 100%" : "0 0 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.name}</span>
            <span className="u-amber" style={{ fontSize: 11, letterSpacing: 2, border: "1px solid var(--terminal-amber, #ffb000)", color: "var(--terminal-amber, #ffb000)", padding: "2px 7px", flexShrink: 0 }}>PANEL</span>
          </div>
          <div style={{ fontSize: 13, opacity: 0.55 }}>PORTRAIT PANEL · runs inside a landscape MULTIVIEW · no TV of its own</div>
          <div style={{ fontSize: 12, opacity: 0.45, letterSpacing: 1 }}>no takeover — follows its host screen</div>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 0, alignSelf: narrow ? "auto" : "center", fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>{summary}</div>
        <div style={{ flex: "0 0 auto", marginLeft: narrow ? 0 : "auto", width: narrow ? "100%" : undefined }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <button type="button" onClick={onAdd} className="u-fill u-ink" style={{ ...cardBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700, padding: "9px 18px" }}>+ ADD</button>
            <button type="button" onClick={onQueue} style={{ ...cardBtn, padding: "9px 18px" }}>QUEUE</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {/* ── TOP ROW: identity (left) · status (middle, grows) · actions (right) ── */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* identity block — fixed on desktop, full-width on narrow */}
        <div style={{ flex: narrow ? "1 1 100%" : "0 0 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.name}</span>
          </div>
          <div style={{ fontSize: 13, opacity: 0.55 }}>
            {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <HealthDot health={health} />
            <ModeChip mode={mode} eventLabel={eventLabel} programLabel={programActive ? programLabel : null} />
            {scheduleCount > 0 && (
              <span className={overrideHold ? "u-amber" : ""} style={{ fontSize: 11, letterSpacing: 1, border: "1px solid currentColor", padding: "2px 7px", opacity: 0.85, color: overrideHold ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)" }}>
                {overrideHold ? (overrideHold === "event" ? "⧗ SPECIAL EVENT" : "⧗ OVERRIDE") : `⧗ ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}`}
              </span>
            )}
          </div>
        </div>

        {/* status block — grows; compact body size, no headline treatment/minHeight */}
        <div style={{ flex: "1 1 260px", minWidth: 0, alignSelf: narrow ? "auto" : "center", fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>
          {statusNode}
        </div>

        {/* action block — the three clean buttons + ⋯ overflow (D1). Right-aligned cluster on
            desktop; full-width grid on narrow (keeps ≥44px tap targets). */}
        <div style={{ flex: "0 0 auto", marginLeft: narrow ? 0 : "auto", width: narrow ? "100%" : undefined }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 7 }}>
            {/* Roomier padding only on desktop (natural-width cluster); on narrow keep the tight
                cardBtn padding so the 3-up + ⋯ grid fits within the card (no horizontal overflow). */}
            <button type="button" onClick={onAdd} className="u-fill u-ink" style={{ ...cardBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700, ...(narrow ? null : { padding: "9px 14px" }) }}>+ ADD</button>
            <button type="button" onClick={onQueue} style={{ ...cardBtn, ...(narrow ? null : { padding: "9px 14px" }) }}>QUEUE</button>
            <button type="button" onClick={onTakeover} className="u-amber" style={{ ...cardBtn, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)", ...(narrow ? null : { padding: "9px 14px" }) }}>TAKEOVER</button>
            <button type="button" onClick={onToggleOverflow} aria-label="More" title="KIOSK URL · PREVIEW · health" style={{ ...cardBtn, padding: "9px 10px", minWidth: 44 /* 44px floor: a lone glyph is ~34px wide otherwise */, fontSize: 20, opacity: 0.75 }}>⋯</button>
          </div>
        </div>
      </div>

      {/* ── SUB-STRIP: media-capable (landscape) controls in a horizontal strip that wraps on
          narrow. PROGRAM + SCHEDULE (landscape only) + the ⏸/▶/⏭ transport (only when the
          EFFECTIVE program is a live playlist). Same handlers/gating as before. ── */}
      {hasSubStrip && (
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "stretch", borderTop: "1px solid rgba(0,255,65,0.2)", paddingTop: 11 }}>
          {/* PROGRAM control — landscape (media-capable) screens only (docs/15). Shows the current
              program + opens SWITCH PROGRAM. Portrait slots stay pure rotation (no control). */}
          {onProgram && (
            <button type="button" onClick={onProgram} className={programActive ? "u-amber" : ""} style={{ ...cardBtn, flex: "1 1 220px", justifyContent: "space-between", padding: "9px 12px", ...(programActive ? { color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)" } : null) }}>
              <span style={{ letterSpacing: 1 }}>▶ PROGRAM: {programActive ? programLabel : "ROTATION"}</span>
              <span style={{ opacity: 0.7 }}>SWITCH ▸</span>
            </button>
          )}

          {/* SCHEDULE — dayparts that flip the program by time of day (M3, landscape only). */}
          {onSchedule && (
            <button type="button" onClick={onSchedule} style={{ ...cardBtn, flex: "1 1 220px", justifyContent: "space-between", padding: "9px 12px" }}>
              <span style={{ letterSpacing: 1 }}>⧗ SCHEDULE{scheduleCount > 0 ? `: ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}` : ""}</span>
              <span style={{ opacity: 0.7 }}>{scheduleCount > 0 ? "EDIT ▸" : "SET UP ▸"}</span>
            </button>
          )}

          {/* TRANSPORT — skip/pause a live playlist without curl/Q-SYS (Beat 4). Fire-and-forget
              broadcast; no state tracking (transport is ephemeral by design). */}
          {transportPlaylist && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}><TransportRow slug={slot.slug} /></div>
          )}
        </div>
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
/* ── C · running & upcoming event row (D8) ──────────────────────────────────── */
function EventRowCard({ row, canEvents, onEdit, onChanged }: { row: EventRow; canEvents: boolean; onEdit: () => void; onChanged: () => void }) {
  const phrase = useMemo(() => schedulePhrase(row), [row]);
  // Moved to signageHubShared so the v2 row fires the SAME mutations (Beat 3) — same calls,
  // same onChanged, same hook order as this component always had.
  const { toggle, fire, done, paused, isLive, st } = useEventRowActions(row, onChanged);

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
const rowBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "7px 11px",
  minHeight: 44, cursor: "pointer", whiteSpace: "nowrap",
};

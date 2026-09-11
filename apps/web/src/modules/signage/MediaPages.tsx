import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useUiVersion } from "@/shared/useUiVersion";
import { EmptyState, ScreenCard, StaffPageHeader, StatusChip } from "@/shared/ui";
import { useIsMobile } from "@/shared/useIsMobile";
import { screenHealth, useAdminSlots, useLiveGame, useSlotsRealtime, useTakeovers, type AdminSlot } from "./useSignageAdmin";
import { activeMoment, useCloseoutHour, useLiveEvents, useTriviaArmedEffective, useVenue, type SlotMode } from "./useSignage";
import { useAllScheduleRows, useMediaFiles, useMediaPlaylists, type PlaylistWithStats } from "./useMediaAdmin";
import {
  TransportRow, cardBtn, isMediaCapableSlot,
  makeEffFor, makeModeFor, makeOverrideHoldFor, makeProgramLabelFor, makeTransportPlaylistFor, playlistNameMap,
} from "./signageHubShared";
import { ProgramOverlay, ScheduleOverlay } from "./HubOverlays";
import { MediaLibraryPanel, MediaPlaylistsPanel, PlaylistEditor } from "./MediaPanels";
import { MONO, ghost } from "./signageAdminShared";
import "./signage.css";

/**
 * MEDIA ▸ LIBRARY · PLAYLISTS · SCREENS & PROGRAMS (UX overhaul Beat 4).
 *
 * ORGANISATION ONLY — audit finding #9: /signage carried the whole Signage Hub AND the
 * media library on one page. These three pages mount the SAME panels and the SAME
 * slide-overs the hub mounts; no media feature is added, removed or re-skinned here.
 *
 * v2 ONLY. A device still on the classic shell has no MEDIA nav section, so each page
 * redirects to where classic keeps that surface — the hub's own section anchor. Classic
 * therefore behaves exactly as it did before this beat (RULE #1), including for anyone
 * who follows a /media/* link someone sent them.
 *
 * DECISION: /media (bare) redirects to /media/library rather than becoming a fourth
 * landing page. The section has three real surfaces and a hub-of-a-hub is the thing this
 * beat exists to remove; LIBRARY is the one a manager opens most.
 *
 * DECISION: the routes are gated on has_module('signage'), not a new module key. MEDIA is
 * an organisational move — every page here reads and writes signage tables (signage_slots,
 * media_* under the same RLS family), so inventing a grant would hand someone a menu item
 * whose writes RLS then refuses.
 *
 * THE PARITY INVARIANT APPLIES HERE TOO: SCREENS & PROGRAMS renders what the hub's own
 * resolver closures return (signageHubShared's factories — the same definitions the hub
 * calls), never its own opinion of what a TV is playing.
 *
 * Sizes are inline px: nothing inherits font-size under `.terminal-theme` (PR #89).
 */

/**
 * v2-only route guard. CLASSIC has no MEDIA nav section — its media surfaces live in the
 * hub — so a classic device that lands on /media/* goes to the hub anchor that holds that
 * surface. The inverse of MovedRoute, and the reason classic is untouched by this beat.
 *
 * A wrapper, not an early return inside each page: flipping the switch while a page is
 * mounted must mount/unmount a child, never change one component's hook count.
 */
function V2Only({ classicTo, children }: { classicTo: string; children: ReactNode }) {
  const [version] = useUiVersion();
  if (version !== "v2") return <Navigate to={classicTo} replace />;
  return <>{children}</>;
}

/** The three route elements (App.tsx lazy-loads these; the pages themselves stay pure). */
export function MediaLibrary() {
  return <V2Only classicTo="/signage#library"><MediaLibraryPage /></V2Only>;
}
export function MediaPlaylists() {
  return <V2Only classicTo="/signage#playlists"><MediaPlaylistsPage /></V2Only>;
}
export function MediaScreens() {
  return <V2Only classicTo="/signage#screens"><MediaScreensPage /></V2Only>;
}

/* ── page shell (matches the hub's wrapper exactly) ─────────────────────────── */
function MediaPage({ title, tag, right, children }: {
  title: string;
  tag?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <StaffPageHeader eyebrow="MEDIA" title={title} tag={tag} right={right} />
        {children}
      </div>
    </div>
  );
}

/* ── MEDIA ▸ LIBRARY ───────────────────────────────────────────────────────── */
export function MediaLibraryPage() {
  const filesQ = useMediaFiles();
  const slotsQ = useAdminSlots();
  const schedulesQ = useAllScheduleRows();
  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);

  // PLAY ON targets — the hub's own media gate, so a library card offers the same screens
  // here as it does inside the hub section.
  const screens = useMemo(() => (slotsQ.data ?? []).filter(isMediaCapableSlot), [slotsQ.data]);
  const hasSchedule = (slotId: string) => ((schedulesQ.data?.get(slotId)?.length ?? 0) > 0);

  const present = files.filter((f) => f.status === "present").length;
  const missing = files.filter((f) => f.status === "missing").length;
  // The header tag never wraps (StaffPageHeader pins `nowrap` so a count can't split mid-phrase),
  // so the full three-part line pushes a 390px phone into horizontal scroll. Phones get the two
  // numbers that are not derivable from each other; PRESENT returns at tablet width and up.
  const narrow = useIsMobile();
  const tag = filesQ.isLoading
    ? "LOADING…"
    : narrow
      ? `${files.length} FILE${files.length === 1 ? "" : "S"} · ${missing} MISSING`
      : `${files.length} FILE${files.length === 1 ? "" : "S"} · ${present} PRESENT · ${missing} MISSING`;

  return (
    <MediaPage title="LIBRARY" tag={tag}>
      {/* DECISION: the grid is the hub section's grid, unbounded and unfiltered. Inside the
          hub it was DEFAULT-COLLAPSED, which is what kept 504 cards out of the way; on its
          own page nothing collapses it, so this is a long page (the header tag carries the
          counts). A search/filter box is the obvious next beat — it is a FEATURE, and this
          beat is organisation only, so it is not smuggled in here. */}
      {!filesQ.isLoading && files.length === 0 ? (
        // Same sentence the hub section shows — ingestion is folder-drop on the media PC,
        // there is no upload path on this page either.
        <EmptyState
          eyebrow="NO MEDIA SYNCED"
          message="Drop video files into the watched folder on the media PC (~/BunkerMedia by default) — the shell probes each file and reports it here. Subfolders become auto-playlists."
        />
      ) : (
        <MediaLibraryPanel files={files} loading={filesQ.isLoading} screens={screens} hasSchedule={hasSchedule} />
      )}
    </MediaPage>
  );
}

/* ── MEDIA ▸ PLAYLISTS ─────────────────────────────────────────────────────── */
export function MediaPlaylistsPage() {
  const playlistsQ = useMediaPlaylists();
  const filesQ = useMediaFiles();
  const playlists = useMemo(() => playlistsQ.data ?? [], [playlistsQ.data]);
  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);
  const [editing, setEditing] = useState<PlaylistWithStats | "new" | null>(null);

  const inCarousel = playlists.filter((p) => p.playlist.in_carousel).length;
  const tag = playlistsQ.isLoading
    ? "LOADING…"
    : `${playlists.length} PLAYLIST${playlists.length === 1 ? "" : "S"} · ${inCarousel} IN CAROUSEL`;

  const newPlaylist = <button type="button" onClick={() => setEditing("new")} style={{ ...ghost, fontWeight: 700 }}>+ NEW PLAYLIST</button>;

  return (
    <MediaPage title="PLAYLISTS" tag={tag} right={newPlaylist}>
      {!playlistsQ.isLoading && playlists.length === 0 ? (
        <EmptyState
          eyebrow="NO PLAYLISTS"
          message="A subfolder of the media folder becomes an auto-playlist. Or build a custom one from files already in the library."
          actionLabel="+ NEW PLAYLIST"
          onAction={() => setEditing("new")}
        />
      ) : (
        <MediaPlaylistsPanel playlists={playlists} loading={playlistsQ.isLoading} onEdit={setEditing} />
      )}

      {editing && (
        <PlaylistEditor
          initial={editing === "new" ? null : editing}
          files={files}
          onClose={() => setEditing(null)}
        />
      )}
    </MediaPage>
  );
}

/* ── MEDIA ▸ SCREENS & PROGRAMS ────────────────────────────────────────────── */
export function MediaScreensPage() {
  const qc = useQueryClient();
  useSlotsRealtime();
  const slotsQ = useAdminSlots();
  const schedulesQ = useAllScheduleRows();
  const playlistsQ = useMediaPlaylists();
  const venueQ = useVenue();
  const closeoutQ = useCloseoutHour();
  const takeoversQ = useTakeovers();
  const liveGameQ = useLiveGame();
  const liveEventsQ = useLiveEvents();
  const armed = useTriviaArmedEffective().armed;

  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  const scheduleBySlot = useMemo(() => schedulesQ.data ?? new Map(), [schedulesQ.data]);
  const timezone = venueQ.data?.timezone ?? "America/Chicago";
  const rolloverHour = closeoutQ.data ?? 4;
  const takeovers = takeoversQ.data ?? [];
  const liveEvents = useMemo(() => liveEventsQ.data ?? [], [liveEventsQ.data]);

  // The hub's slow render clock, same 60s cadence (this is a console, not a display). The
  // resolvers read the wall clock when they run, so without a ticking re-render a card would
  // keep asserting the daypart that was active when it mounted.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ── the hub's derivations, from the hub's definitions (parity invariant) ──
  const effFor = makeEffFor(scheduleBySlot, timezone, rolloverHour);
  const playlistNameById = useMemo(() => playlistNameMap(playlistsQ.data), [playlistsQ.data]);
  const programLabelFor = makeProgramLabelFor(effFor, playlistNameById);
  const overrideHoldFor = makeOverrideHoldFor(effFor);
  const modeFor = makeModeFor(takeovers, !!liveGameQ.data && armed, activeMoment(liveEvents));
  const transportPlaylistFor = makeTransportPlaylistFor(modeFor, effFor);
  const scheduleCountFor = (slot: AdminSlot) => scheduleBySlot.get(slot.id)?.length ?? 0;
  const panelChoices = useMemo(() => slots.filter((s) => s.orientation === "portrait"), [slots]);

  const screens = useMemo(() => slots.filter(isMediaCapableSlot), [slots]);
  const stacked = useIsMobile(720); // the hub's screen-card breakpoint, so both cards flip together
  const [panel, setPanel] = useState<{ kind: "program" | "schedule"; slot: AdminSlot } | null>(null);

  return (
    <MediaPage
      title="SCREENS & PROGRAMS"
      tag={slotsQ.isLoading ? "LOADING…" : `${screens.length} MEDIA SCREEN${screens.length === 1 ? "" : "S"}`}
    >
      {slotsQ.isLoading ? (
        <div style={{ fontSize: 20 }}>LOADING SCREENS…</div>
      ) : screens.length === 0 ? (
        <EmptyState
          eyebrow="NO MEDIA SCREENS"
          message="Media programs run on landscape screens. The portrait screens stay on the promo rotation — queue those from the SIGNAGE HUB."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {screens.map((slot) => (
            <MediaScreenCard
              key={slot.id}
              slot={slot}
              stacked={stacked}
              mode={modeFor(slot)}
              programLabel={programLabelFor(slot)}
              overrideHold={overrideHoldFor(slot) !== null}
              scheduleCount={scheduleCountFor(slot)}
              transportPlaylist={transportPlaylistFor(slot)}
              onProgram={() => setPanel({ kind: "program", slot })}
              onSchedule={() => setPanel({ kind: "schedule", slot })}
            />
          ))}
        </div>
      )}

      {/* The hub's own slide-overs, opened with the hub's own props (HubOverlays). */}
      {panel?.kind === "program" && (
        <ProgramOverlay
          slot={panel.slot}
          scheduleBySlot={scheduleBySlot}
          overrideHoldFor={overrideHoldFor}
          panelChoices={panelChoices}
          qc={qc}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === "schedule" && (
        <ScheduleOverlay slot={panel.slot} timezone={timezone} onClose={() => setPanel(null)} />
      )}
    </MediaPage>
  );
}

function MediaScreenCard({
  slot, stacked, mode, programLabel, overrideHold, scheduleCount, transportPlaylist, onProgram, onSchedule,
}: {
  slot: AdminSlot;
  stacked: boolean;
  mode: SlotMode;
  programLabel: string | null;
  overrideHold: boolean;
  scheduleCount: number;
  transportPlaylist: boolean;
  onProgram: () => void;
  onSchedule: () => void;
}) {
  const health = screenHealth(slot.last_seen);
  const programActive = mode === "rotation" && !!programLabel;
  const meta = `${slot.orientation.toUpperCase()} · TERMINAL ${String(slot.terminal_number ?? 0).padStart(2, "0")}${slot.location_label ? ` — ${slot.location_label}` : ""}`;

  // DECISION: this page states the MEDIA half of what a screen is doing and leaves the
  // promo-rotation contents to the hub (whose ON AIR card lists the queued assets). The
  // program-active and preempted sentences are the hub's own wording; the no-program line
  // is this page's, and points at the hub rather than repeating its asset summary here —
  // repeating it would mean re-running resolveRotation on a second surface.
  const status = programActive ? (
    <><span className="u-amber" style={{ fontSize: "inherit" }}>Playing {programLabel}.</span> Rotation resumes when the program is set back to ROTATION (a game/takeover still preempts it).</>
  ) : mode === "rotation" ? (
    <>On the promo rotation — no media program running. SWITCH PROGRAM to put a playlist or the live input on this screen.</>
  ) : mode === "event" ? (
    <><span className="u-amber" style={{ fontSize: "inherit" }}>A scheduled event is holding the screens.</span> Any program resumes when the window ends.</>
  ) : mode === "game" ? (
    <><span className="u-amber" style={{ fontSize: "inherit" }}>Showing the game display.</span> Any program resumes automatically when the game ends.</>
  ) : (
    <><span className="u-red" style={{ fontSize: "inherit" }}>A priority takeover is on this screen.</span> Dismiss it from the SIGNAGE HUB.</>
  );

  return (
    <ScreenCard
      stacked={stacked}
      name={slot.name}
      meta={meta}
      chips={
        <>
          <StatusChip
            tone={health === "online" ? "live" : health === "stale" ? "warn" : "alert"}
            dot={health === "online"}
            label={health === "online" ? "LIVE" : health === "stale" ? "STALE" : "DOWN"}
          />
          <StatusChip
            tone={programActive ? "warn" : mode === "rotation" ? "idle" : "warn"}
            label={programActive ? `PROGRAM: ${programLabel}` : mode === "rotation" ? "PROGRAM: ROTATION" : "PREEMPTED"}
            style={{ minWidth: 0 }}
          />
          {scheduleCount > 0 && (
            <StatusChip
              tone={overrideHold ? "warn" : "info"}
              label={overrideHold ? "⧗ OVERRIDE" : `⧗ ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}`}
            />
          )}
        </>
      }
      status={status}
      actions={
        <div style={{ display: "grid", gridTemplateColumns: stacked ? "1fr" : "1fr 1fr", gap: 7 }}>
          <button type="button" onClick={onProgram} className={programActive ? "u-amber" : ""} style={{ ...cardBtn, padding: "9px 14px", ...(programActive ? { borderColor: "var(--terminal-amber, #ffb000)" } : null) }}>
            SWITCH PROGRAM ▸
          </button>
          <button type="button" onClick={onSchedule} style={{ ...cardBtn, padding: "9px 14px" }}>
            {scheduleCount > 0 ? `SCHEDULE: ${scheduleCount} ▸` : "SCHEDULE ▸"}
          </button>
        </div>
      }
      subStrip={transportPlaylist ? <div style={{ flex: "1 1 300px", minWidth: 0 }}><TransportRow slug={slot.slug} /></div> : undefined}
    />
  );
}

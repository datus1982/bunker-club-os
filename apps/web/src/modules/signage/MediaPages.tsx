import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useUiVersion } from "@/shared/useUiVersion";
import { EmptyState, FormField, ScreenCard, StaffPageHeader, StatusChip } from "@/shared/ui";
import { useIsMobile } from "@/shared/useIsMobile";
import { screenHealth, useAdminSlots, useSlotsRealtime, useTakeovers, type AdminSlot } from "./useSignageAdmin";
import { activeMoment, useCloseoutHour, useLiveEvents, useVenue, type SlotMode } from "./useSignage";
import { useTriviaArmState } from "./triviaArm";
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
 *
 * Beat 5 gives LIBRARY the search/filter/paging it was promised (#104 NOTE-3 + NOTE-4) and
 * the v2 panels their 44px controls. Still no new media feature: nothing here reads, writes
 * or resolves anything the hub did not already.
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
function MediaPage({ title, tag, right, children, overlays }: {
  title: string;
  tag?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** Slide-overs that are SHARED with the classic hub — rendered OUTSIDE the token scope,
   *  so each one carries its own `variant` instead of inheriting the page's. Beat 8 PR 2
   *  flips PROGRAM and SCHEDULE to `variant="v2"` here (Stephen's bug: a v2 page opened a
   *  classic-green drawer); the rest still render classic until their PR. A v2-only editor
   *  (PlaylistEditor) belongs in `children` and may take the tokens. */
  overlays?: ReactNode;
}) {
  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100%", padding: "24px clamp(16px,4vw,40px) 48px", fontFamily: MONO }}>
      {/* `data-st-page` = the token sheet's opt-in hook, on the CONTENT wrapper only. */}
      <div data-st-page="" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <StaffPageHeader eyebrow="MEDIA" title={title} tag={tag} right={right} />
        {children}
      </div>
      {overlays}
    </div>
  );
}

/* ── MEDIA ▸ LIBRARY ───────────────────────────────────────────────────────── */

/**
 * How many cards render before the operator asks for more (Beat 5, closes #104 NOTE-4).
 * The unbounded grid was 118,799px tall at 390px — 504 cards, nothing collapsible, and the
 * card an operator actually wanted was somewhere in the middle of it.
 */
const PAGE_SIZE = 48;

type StatusFilter = "all" | "present" | "missing" | "unsupported";
const STATUS_FILTERS: StatusFilter[] = ["all", "present", "missing", "unsupported"];
function readStatus(raw: string | null): StatusFilter {
  return (STATUS_FILTERS as string[]).includes(raw ?? "") ? (raw as StatusFilter) : "all";
}

export function MediaLibraryPage() {
  const filesQ = useMediaFiles();
  const slotsQ = useAdminSlots();
  const schedulesQ = useAllScheduleRows();
  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);

  // PLAY ON targets — the hub's own media gate, so a library card offers the same screens
  // here as it does inside the hub section.
  const screens = useMemo(() => (slotsQ.data ?? []).filter(isMediaCapableSlot), [slotsQ.data]);
  const hasSchedule = (slotId: string) => ((schedulesQ.data?.get(slotId)?.length ?? 0) > 0);

  // ── the filter state lives in the URL ──────────────────────────────────────
  // DECISION: search text + chips are query params, not component state. A filtered library is
  // the thing worth sending someone ("the six missing files": /media/library?status=missing), and
  // it survives the reload a phone gives you when it reclaims a backgrounded tab. Written with
  // `replace`, so a search does not build a history stack the BACK button has to walk out of.
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const status = readStatus(params.get("status"));
  const noSubsOnly = params.get("subs") === "0";

  const setParam = useCallback((key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  }, [setParams]);

  // The input is LOCAL and the URL follows ~150ms behind it: a param write per keystroke would
  // re-run the 504-row filter (and a router navigation) on every character. Seeded from the URL
  // so a bookmark/reload restores the typed text.
  const [text, setText] = useState(urlQuery);
  // The last value THIS input wrote to the URL. When the URL changes to anything else (a nav tap
  // to bare /media/library, the /media redirect, back/forward) the URL is the source of truth
  // and the input follows it — otherwise the pending debounce would re-assert stale text over
  // the new URL (reviewer WARN-1).
  const lastWritten = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastWritten.current) { lastWritten.current = urlQuery; setText(urlQuery); }
  }, [urlQuery]);
  useEffect(() => {
    if (text === urlQuery) return;
    const id = window.setTimeout(() => {
      const next = text.trim();
      lastWritten.current = next;
      setParam("q", next === "" ? null : next);
    }, 150);
    return () => window.clearTimeout(id);
  }, [text, urlQuery, setParam]);

  // ── filtering (client-side over the already-fetched array — one query, no refetch) ──
  const needle = urlQuery.trim().toLowerCase();
  const searched = useMemo(() => {
    if (needle === "") return files;
    // Title AND file name: the title is what the hub renames a file to, the file name is what
    // the folder on the media PC still calls it, and an operator may know either one.
    return files.filter((f) => [f.title ?? "", f.filename].some((s) => s.toLowerCase().includes(needle)));
  }, [files, needle]);

  // Chip counts are totals FOR THE CURRENT SEARCH, so "star" + MISSING reads as a real answer
  // ("2 of the 9 Star files are gone") rather than a library-wide number next to a filtered grid.
  const counts = useMemo(() => ({
    all: searched.length,
    present: searched.filter((f) => f.status === "present").length,
    missing: searched.filter((f) => f.status === "missing").length,
    unsupported: searched.filter((f) => f.status === "unsupported").length,
    noSubs: searched.filter((f) => !f.has_subtitles).length,
  }), [searched]);

  const filtered = useMemo(
    () => searched.filter((f) => (status === "all" || f.status === status) && (!noSubsOnly || !f.has_subtitles)),
    [searched, status, noSubsOnly],
  );

  // ── paging ────────────────────────────────────────────────────────────────
  // DECISION: paging keeps the existing order and adds NO sort control. Order is whatever
  // useMediaFiles returns — media_files ordered by `filename`, then `id` as a stable tiebreak for
  // its range paging. A second ordering would change what "the first 48" means, and sorting is a
  // separate question from finding: search answers "where is X", a sort answers "show me the
  // newest/biggest", which nobody has asked for.
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => { setShown(PAGE_SIZE); }, [needle, status, noSubsOnly]);
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  const remaining = filtered.length - visible.length;

  const filterActive = needle !== "" || status !== "all" || noSubsOnly;
  const clearAll = () => {
    setText("");
    setParams(new URLSearchParams(), { replace: true });
  };

  const present = counts.present;
  const missing = files.filter((f) => f.status === "missing").length;
  // The header tag never wraps (StaffPageHeader pins `nowrap` so a count can't split mid-phrase),
  // so the full three-part line pushes a 390px phone into horizontal scroll. Phones get the two
  // numbers that are not derivable from each other; PRESENT returns at tablet width and up.
  const narrow = useIsMobile();
  const tag = filesQ.isLoading
    ? "LOADING…"
    : filterActive
      ? `${filtered.length} OF ${files.length} FILE${files.length === 1 ? "" : "S"}`
      : narrow
        ? `${files.length} FILE${files.length === 1 ? "" : "S"} · ${missing} MISSING`
        : `${files.length} FILE${files.length === 1 ? "" : "S"} · ${present} PRESENT · ${missing} MISSING`;

  return (
    <MediaPage title="Library" tag={tag}>
      {!filesQ.isLoading && files.length === 0 ? (
        // Same sentence the hub section shows — ingestion is folder-drop on the media PC,
        // there is no upload path on this page either.
        <EmptyState
          eyebrow="NO MEDIA SYNCED"
          message="Drop video files into the watched folder on the media PC (~/BunkerMedia by default) — the shell probes each file and reports it here. Subfolders become auto-playlists."
        />
      ) : (
        <>
          <LibraryFilters
            text={text}
            onText={setText}
            status={status}
            onStatus={(next) => setParam("status", next === "all" ? null : next)}
            counts={counts}
            noSubsOnly={noSubsOnly}
            onNoSubs={() => setParam("subs", noSubsOnly ? null : "0")}
          />

          {!filesQ.isLoading && filtered.length === 0 ? (
            <EmptyState
              eyebrow="NOTHING MATCHES"
              message="No file in the library matches that search and those filters."
              actionLabel="CLEAR FILTERS"
              onAction={clearAll}
            />
          ) : (
            <>
              <MediaLibraryPanel files={visible} loading={filesQ.isLoading} screens={screens} hasSchedule={hasSchedule} variant="v2" />
              {remaining > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} style={pageBtn}>
                    SHOW {Math.min(PAGE_SIZE, remaining)} MORE ({remaining} LEFT)
                  </button>
                  <button type="button" onClick={() => setShown(filtered.length)} style={pageBtn}>SHOW ALL</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </MediaPage>
  );
}

/** Search box + status chips. Dumb: the page owns every piece of state and the URL. */
function LibraryFilters({ text, onText, status, onStatus, counts, noSubsOnly, onNoSubs }: {
  text: string;
  onText: (v: string) => void;
  status: StatusFilter;
  onStatus: (next: StatusFilter) => void;
  counts: Record<StatusFilter | "noSubs", number>;
  noSubsOnly: boolean;
  onNoSubs: () => void;
}) {
  const label: Record<StatusFilter, string> = {
    all: "ALL", present: "PRESENT", missing: "MISSING", unsupported: "UNSUPPORTED",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "0 0 16px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <FormField label="SEARCH THE LIBRARY" style={{ flex: "1 1 260px" }}>
          <input
            type="text"
            inputMode="search"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="TITLE OR FILE NAME"
            aria-label="Search the library by title or file name"
            style={{ fontFamily: MONO }}
          />
        </FormField>
        {text !== "" && (
          <button type="button" onClick={() => onText("")} aria-label="Clear the search" style={{ ...chipBtn, alignSelf: "flex-end" }}>✕ CLEAR</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {STATUS_FILTERS.map((k) => {
          const on = status === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onStatus(k)}
              aria-pressed={on}
              className={on ? "u-fill u-ink" : ""}
              style={on ? { ...chipBtn, ...chipOn } : chipBtn}
            >{label[k]} ({counts[k]})</button>
          );
        })}
        {/* Subtitle coverage is a real standing question at the bar (351/361 films carry a
            sidecar .srt), so the one extra axis worth a chip is the gap itself. */}
        <button
          type="button"
          onClick={onNoSubs}
          aria-pressed={noSubsOnly}
          title="Only files with no sidecar subtitle track"
          className={noSubsOnly ? "u-fill u-ink" : ""}
          style={noSubsOnly ? { ...chipBtn, ...chipOn } : chipBtn}
        >NO SUBTITLES ({counts.noSubs})</button>
      </div>
    </div>
  );
}

/** Filter chip / clear button. No `fontSize`: `.staff-ui button` pins button text at 20px
 *  !important, so a size here would be a lie. Both axes carry the 44px floor. */
const chipBtn: CSSProperties = {
  fontFamily: MONO, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent",
  padding: "0 14px", minHeight: 44, minWidth: 44, cursor: "pointer", whiteSpace: "nowrap",
};
/** Selected chip. `u-fill u-ink` is what actually paints it — `.terminal-theme *` forces
 *  green on every element, so the inline colours alone would render green-on-green. */
const chipOn: CSSProperties = { background: "var(--terminal-green)", color: "#000", fontWeight: 700 };
const pageBtn: CSSProperties = { ...chipBtn, padding: "0 18px" };

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

  const newPlaylist = <button type="button" onClick={() => setEditing("new")} className="st-btn st-body st-t1" style={ghost}>+ New playlist</button>;

  return (
    <MediaPage title="Playlists" tag={tag} right={newPlaylist}>
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
          variant="v2"
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
  const liveEventsQ = useLiveEvents();
  // The same one definition the hub and HOME use (Beat 6 PR 2, code note N8) — this page
  // needs only `gameOnScreens`, which used to be spelled out here a third time.
  const { gameOnScreens } = useTriviaArmState();

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
  const modeFor = makeModeFor(takeovers, gameOnScreens, activeMoment(liveEvents));
  const transportPlaylistFor = makeTransportPlaylistFor(modeFor, effFor);
  const scheduleCountFor = (slot: AdminSlot) => scheduleBySlot.get(slot.id)?.length ?? 0;
  const panelChoices = useMemo(() => slots.filter((s) => s.orientation === "portrait"), [slots]);

  const screens = useMemo(() => slots.filter(isMediaCapableSlot), [slots]);
  const stacked = useIsMobile(720); // the hub's screen-card breakpoint, so both cards flip together
  const [panel, setPanel] = useState<{ kind: "program" | "schedule"; slot: AdminSlot } | null>(null);

  return (
    <MediaPage
      title="Screens & programs"
      tag={slotsQ.isLoading ? "LOADING…" : `${screens.length} MEDIA SCREEN${screens.length === 1 ? "" : "S"}`}
      overlays={
        <>
          {/* The hub's own slide-overs, opened with the hub's own props (HubOverlays).
              SHARED with the classic hub ⇒ rendered outside the token scope. */}
          {panel?.kind === "program" && (
            <ProgramOverlay
              slot={panel.slot}
              scheduleBySlot={scheduleBySlot}
              overrideHoldFor={overrideHoldFor}
              panelChoices={panelChoices}
              qc={qc}
              variant="v2"
              openKey={panel}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "schedule" && (
            <ScheduleOverlay slot={panel.slot} timezone={timezone} variant="v2" openKey={panel} onClose={() => setPanel(null)} />
          )}
        </>
      }
    >
      {slotsQ.isLoading ? (
        <div className="st-body st-t2">Loading screens…</div>
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
  // program-active sentence is the hub's own wording; the preempted sentences (event/game/
  // takeover) are this page's shorter forms — the MODE still comes from the shared resolver,
  // but the event name / takeover message / stale-game date the hub shows are deliberately
  // left to the hub (reviewer NOTE-1, #104). The no-program line points at the hub rather
  // than repeating its asset summary — that would mean re-running resolveRotation here.
  const status = programActive ? (
    <><span className="u-amber" style={{ fontSize: "inherit" }}>Playing {programLabel}.</span> Rotation resumes when the program is set back to ROTATION (a game/takeover still preempts it).</>
  ) : mode === "rotation" ? (
    <>On the promo rotation — no media program running. Switch program to put a playlist or the live input on this screen.</>
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
          <button type="button" onClick={onProgram} className={programActive ? "u-amber st-btn st-body" : "st-btn st-body"} style={{ ...cardBtn, padding: "9px 14px" }}>
            Switch program ▸
          </button>
          <button type="button" onClick={onSchedule} className="st-btn st-body" style={{ ...cardBtn, padding: "9px 14px" }}>
            {scheduleCount > 0 ? `Schedule: ${scheduleCount} ▸` : "Schedule ▸"}
          </button>
        </div>
      }
      subStrip={transportPlaylist ? <div style={{ flex: "1 1 300px", minWidth: 0 }}><TransportRow slug={slot.slug} /></div> : undefined}
    />
  );
}

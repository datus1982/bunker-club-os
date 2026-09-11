import { useState, type CSSProperties } from "react";
import {
  activeTakeoverForSlot, featuredItems,
  type AdminItem, type AdminSlot, type AdminTakeover, type AssetWithPlacements,
} from "./useSignageAdmin";
import {
  activeMoment, mapScheduleRow, resolveRotation, resolveSlotMode, itemAirsToday, recurrenceChipLabel,
  type SignageItem, type SlotMode, type ToastCacheRow, type Template, type VenueClock,
} from "./useSignage";
import { resolveEffectiveProgramWithSource, type ProgramHold } from "./scheduleResolve";
import { ALL_MEDIA_NAME, isAllMedia } from "./mediaProgram";
import type { PlaylistWithStats, ScheduleRowRaw } from "./useMediaAdmin";
import { MONO, summarize, templateIcon, templateBadge, isSmartTemplate } from "./signageAdminShared";
import { sendTransportCommand, type TransportCmd } from "./mediaTransport";
import { useMutation } from "@tanstack/react-query";
import { pauseEvent, resumeEvent, fireNowEvent, statusInfo, type EventRow } from "./useEventsAdmin";
import type { EventSeed } from "./EventEditor";

/**
 * Signage Hub internals shared by BOTH presentations (UX overhaul Beat 3).
 *
 * Everything here was LIFTED VERBATIM out of SignageHub.tsx — same code, same behaviour,
 * only relocated so `SignageHub` (classic) and `SignageHubV2` render from ONE definition
 * instead of two copies that could drift. In particular `rotationSummary` still calls
 * `resolveRotation` with exactly the arguments it always did: the hub/TV parity invariant
 * says an ON AIR card must report what the TV resolves, and a second copy of that call is
 * precisely how the two would stop agreeing.
 *
 * The only edits made while moving: `export` keywords, and nothing else.
 */

/* ── overlay routing (the slide-over the hub currently has open) ───────────── */
export type Overlay =
  | { kind: "add"; slot: AdminSlot }
  | { kind: "queue"; slot: AdminSlot }
  | { kind: "takeover"; slot: AdminSlot }
  | { kind: "event"; editing: EventRow | null; seed?: EventSeed | null }
  // returnTo: the overlay to reopen when the editor closes (save/delete/cancel all fire onClose).
  // Set when the editor is opened FROM a slide-over (QUEUE / ADD picker) so the manager lands back
  // where he was working; left null at the top-level entry points (library card, + NEW ASSET) so
  // those still close to the bare hub.
  | { kind: "asset"; editing: AdminItem | null; preset: Template | null; queueOnSlotId: string | null; returnTo?: Overlay | null }
  | { kind: "program"; slot: AdminSlot }
  | { kind: "schedule"; slot: AdminSlot };

/** Which screen a slot's P/L chip abbreviates. Single-letter orientation code matches the
 *  ratified mockup (P / L) for this venue's one-portrait-one-landscape setup.
 *  DECISION: two same-orientation screens would both read "P"; the chip carries the slot name
 *  as a tooltip, and a 3+-screen venue can graduate this to a terminal-number code later. */
export function slotCode(slot: AdminSlot): string {
  return (slot.orientation[0] ?? "?").toUpperCase();
}

/**
 * Every queued asset, grouped by the screen it runs on and ordered by its position in that
 * screen's queue.
 *
 * HOISTED VERBATIM out of SignageHub.tsx (UX overhaul Beat 6 PR 4) so the hub and the
 * BAR OPS ▸ SLIDES page build the same map from the same rows.
 */
export function groupItemsBySlot(items: AdminItem[]): Map<string, AdminItem[]> {
  const m = new Map<string, AdminItem[]>();
  for (const it of items) {
    if (!it.slot_id) continue;
    if (!m.has(it.slot_id)) m.set(it.slot_id, []);
    m.get(it.slot_id)!.push(it);
  }
  for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  return m;
}

/**
 * The next free position in one screen's queue — the number a NEW slide is written into
 * `slot_queue` with (ItemEditor's queue-on-save path).
 *
 * HOISTED VERBATIM with the map above, and for a sharper reason: two copies of this rule
 * drifting is two different rotation orders for the same action, so the hub and the SLIDES
 * page must answer "where does a newly created slide land" from ONE definition.
 */
export function makeNextPosition(itemsBySlot: Map<string, AdminItem[]>) {
  return (slotId: string) => {
    const list = itemsBySlot.get(slotId) ?? [];
    return list.length ? Math.max(...list.map((i) => i.sort_order)) + 1 : 0;
  };
}

/** Slot ids an asset is queued on (for the editor's read-only "ON: …" line). */
export function placementsFor(assets: AssetWithPlacements[], itemId: string): string[] {
  return assets.find((a) => a.asset.id === itemId)?.placements.map((p) => p.slot_id) ?? [];
}

/**
 * Playlist transport row (Beat 4) — ⏸ PAUSE / ▶ RESUME / ⏭ NEXT, broadcast to the TV playing this
 * slug. Fire-and-forget: a brief pressed flash is the only feedback (transport is ephemeral — the
 * hub tracks NO play/pause state; a paused TV self-heals at the 04:00 reload or the next program
 * write). The channel is torn down per send inside sendTransportCommand.
 */
export function TransportRow({ slug }: { slug: string }) {
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

/** "N assets rotating: a · b · c · +K more" (+ ★ featured). Counts only currently-visible
 *  authored items — resolveRotation applies the exact in-window + OOS/POS-hide rules. */
export function rotationSummary(slotItems: AdminItem[], tmap: Map<string, ToastCacheRow>, now: Date, venueClock: VenueClock): string {
  const activeItems = slotItems.filter((it) => it.active);
  const rotation = resolveRotation(activeItems as SignageItem[], tmap, now, [], { venue: venueClock });
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

export function rotationName(it: SignageItem, tmap: Map<string, ToastCacheRow>): string {
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
export function AssetCard({
  a, slots, toastRows, tmap, now, venueClock, onOpen,
}: {
  a: AssetWithPlacements;
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  tmap: Map<string, ToastCacheRow>;
  /** The hub's 60s render clock (see ScreenCard) — the OFF TODAY chip must flip at rollover. */
  now: Date;
  venueClock: VenueClock;
  onOpen: () => void;
}) {
  const item = a.asset as unknown as AdminItem;
  const name = summarize(item, toastRows);
  const image = assetImage(item, tmap);
  const smart = isSmartTemplate(item.template);
  const placedSlots = new Set(a.placements.map((p) => p.slot_id));
  const sub = assetSubtitle(item, tmap);
  // The asset's day rule, and whether it excludes today's BUSINESS day — the library card says
  // the same thing the queue row does, so an owner scanning the grid can see "TUESDAYS · OFF
  // TODAY" without opening anything.
  const dayLabel = recurrenceChipLabel(item.recurrence);
  const offToday = !!dayLabel && !itemAirsToday(item, now, venueClock);

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
        {/* `u-amber` / `u-green-edge` are CLASSES, not inline values, because under the
            v2 token scope the blanket `[data-st-page] * { border-color: … !important }`
            beats an inline border and the SMART TOAST badge stopped reading amber
            (classic is unaffected: both classes resolve to the same computed colour the
            inline values already produced). */}
        <span
          className={smart ? "u-amber" : ""}
          style={{ position: "absolute", top: 6, right: 6, fontSize: 10, letterSpacing: 1, padding: "2px 5px", background: "#020602", border: "1px solid currentColor", color: smart ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)" }}
        >{templateBadge(item.template)}</span>
      </div>
      <div style={{ padding: "9px 10px", display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <div style={{ fontSize: 20, letterSpacing: 1, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div style={{ fontSize: 12, opacity: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        {dayLabel && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            <span className="u-amber" style={{ fontSize: 11, letterSpacing: 1 }} title="This asset only runs on these days">↻ {dayLabel}</span>
            {offToday && (
              <span className="u-amber" style={{ fontSize: 11, letterSpacing: 1, opacity: 0.75 }} title="Its day rule excludes today — it returns on its next day">· OFF TODAY</span>
            )}
          </div>
        )}
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
export function assetImage(item: AdminItem, tmap: Map<string, ToastCacheRow>): string | null {
  const f = item.fields ?? {};
  const url = typeof f.image_url === "string" && f.image_url.trim() ? (f.image_url as string) : null;
  if (url) return url;
  const guid = typeof f.source_toast_guid === "string" ? (f.source_toast_guid as string) : "";
  if (guid) return tmap.get(guid)?.image ?? null;
  return null;
}

export function assetSubtitle(item: AdminItem, tmap: Map<string, ToastCacheRow>): string {
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
    case "menu_group": {
      const grp = typeof f.group === "string" && f.group.trim() ? f.group.trim() : "";
      return grp ? `${grp.toLowerCase()} · full section · live` : "no section picked · live";
    }
    case "event": return typeof f.date === "string" ? `event · ${f.date}` : "event";
    case "celebration": return "celebration";
    case "image_only": return "full-frame photo";
    default: return templateBadge(item.template).toLowerCase();
  }
}

/** Content-only duplicate of a completed event for RE-RUN. Copies WHAT it is (name/kind/skin/
 *  fields/toast/website/interrupt) and drops the old TIMING (fire_at/window/recurrence/status/id
 *  never travel — the editor opens as a fresh NEW event). Per-run counter keys are stripped so a
 *  re-run doesn't inherit a stale tally. */
export function seedFromEvent(row: EventRow): EventSeed {
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

/* ── shared control styles (moved verbatim) ────────────────────────────────── */
export const cardBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 14, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "rgba(0,255,65,0.05)", padding: "9px 6px",
  minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", textAlign: "center",
};
export const miniBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "8px 10px",
  minHeight: 44, cursor: "pointer", display: "inline-flex", alignItems: "center",
};

/* ── the hub's one data + mutation layer, handed to whichever view renders ──── */
/**
 * `SignageHub` owns every query, mutation and piece of derived state; both the classic
 * markup and `SignageHubV2` read from THIS object, and `HubOverlays` renders the
 * slide-overs for both. One context object rather than Beat 2's explicit prop list
 * because the hub is one page with ~30 inputs feeding five sections — spelling them out
 * twice (view + overlays) is how a prop quietly stops matching what the page computes.
 *
 * The resolver-backed fields — `programLabelFor`, `overrideHoldFor`, `modeFor`,
 * `rotationSummaryFor` — are CLOSURES OVER THE PAGE'S OWN CALLS. A view may render what
 * they return; it must never re-derive them, or the hub stops agreeing with the TV.
 */
export interface SignageHubContext {
  /* data */
  slots: AdminSlot[];
  slotsLoading: boolean;
  assets: AssetWithPlacements[];
  assetsLoading: boolean;
  itemsBySlot: Map<string, AdminItem[]>;
  // DECISION: `toastRows` / `openAsset` left the contract with the asset library (Beat 6
  // PR 4). Nothing in the hub view reads them once the slides are their own page — it no
  // longer summarises a slide or opens the editor — and a context field no consumer reads
  // is how the next reader learns the wrong thing about what this page does. The PAGE
  // still holds both; `HubOverlays` takes them as explicit props.
  tmap: Map<string, ToastCacheRow>;
  takeovers: AdminTakeover[];
  events: EventRow[];
  pastEvents: EventRow[];
  eventsLoading: boolean;
  featured: ReturnType<typeof featuredItems>;
  now: Date;
  venueClock: VenueClock;
  canEvents: boolean;

  /* venue-wide mode inputs (already gated exactly as the TV gates them) */
  gameOffScreens: boolean;
  armedNoGame: boolean;
  eventLabel: string | null;
  staleGameDate: string | null;

  /* per-slot resolution — the SAME resolver the TVs run (parity invariant) */
  modeFor: (slot: AdminSlot) => SlotMode;
  programLabelFor: (slot: AdminSlot) => string | null;
  overrideHoldFor: (slot: AdminSlot) => ProgramHold | null;
  takeoverMessageFor: (slot: AdminSlot) => string | null;
  scheduleCountFor: (slot: AdminSlot) => number;
  transportPlaylistFor: (slot: AdminSlot) => boolean;

  /* ui state + actions */
  overlay: Overlay | null;
  setOverlay: (o: Overlay | null) => void;
  overflowSlot: string | null;
  toggleOverflow: (slotId: string) => void;
  invalidateEvents: () => void;
}

/* ── event-row actions (moved verbatim out of the classic EventRowCard) ─────── */
/**
 * PAUSE/RESUME and FIRE NOW for one event row, plus the three derived flags both rows
 * read. Same mutations, same `onChanged` invalidation, same order of hooks as the classic
 * component had — lifted here so classic and v2 share ONE definition instead of two.
 */
export function useEventRowActions(row: EventRow, onChanged: () => void) {
  const st = statusInfo(row);
  const done = row.status === "completed" || row.status === "aborted";
  const paused = row.status === "disabled";
  const isLive = st.tone === "now";
  const toggle = useMutation({ mutationFn: () => (paused ? resumeEvent(row) : pauseEvent(row.id)), onSuccess: onChanged });
  const fire = useMutation({ mutationFn: () => fireNowEvent(row), onSuccess: onChanged });
  return { toggle, fire, done, paused, isLive, st };
}

/* ── per-slot program resolution, hoisted (UX overhaul Beat 4) ──────────────────
 *
 * These are the EXPRESSIONS `SignageHub` used to inline, moved up here UNCHANGED so the
 * hub and the MEDIA ▸ SCREENS & PROGRAMS page call ONE definition. The hub/TV parity
 * invariant is the whole reason: a second copy of "what is that screen playing" in the
 * media page is precisely how the two surfaces would start disagreeing.
 *
 * They are FACTORIES, not hooks — each takes the data it reads (already fetched by the
 * caller's queries) and returns the per-slot closure the caller had before. Nothing here
 * fetches, and nothing here is TV code: the TV runs `resolveEffectiveProgram` itself.
 */

/** The effective-program resolver for one page's slots (schedule rows + hold + venue clock). */
export type EffFor = (slot: AdminSlot) => ReturnType<typeof resolveEffectiveProgramWithSource>;

export function makeEffFor(
  scheduleBySlot: Map<string, ScheduleRowRaw[]>,
  timezone: string,
  rolloverHour: number,
): EffFor {
  return (slot: AdminSlot) =>
    resolveEffectiveProgramWithSource(
      { program: slot.program, program_hold: slot.program_hold, program_set_at: slot.program_set_at },
      (scheduleBySlot.get(slot.id) ?? []).map(mapScheduleRow),
      new Date(), timezone, rolloverHour,
    );
}

/** playlist id → name, for the PROGRAM chip (a TV shows the NAME, not the uuid). */
export function playlistNameMap(playlists: PlaylistWithStats[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of playlists ?? []) m.set(p.playlist.id, p.playlist.name);
  return m;
}

/** The EFFECTIVE program label + its source suffix (parity — matches the TV). null = rotation. */
export function makeProgramLabelFor(effFor: EffFor, playlistNameById: Map<string, string>) {
  return (slot: AdminSlot): string | null => {
    const { program, source } = effFor(slot);
    if (!program) return null; // rotation (no override, no active daypart)
    const base =
      program.kind === "playlist"
        ? (isAllMedia(program.playlist_id) ? ALL_MEDIA_NAME : `PLAYLIST '${playlistNameById.get(program.playlist_id) ?? "…"}'`)
      : program.kind === "capture" ? "LIVE INPUT"
      : program.kind === "carousel" ? `CAROUSEL · ${program.order === "random" ? "random" : "ordered"}`
      : "MULTIVIEW";
    const suffix = source === "scheduled" ? " · scheduled" : source === "override" ? " · override" : source === "pinned" ? " · pinned" : "";
    return base + suffix;
  };
}

/** The hold tier of an ACTIVE override (⧗ chip); null while following a schedule / rotation. */
export function makeOverrideHoldFor(effFor: EffFor) {
  return (slot: AdminSlot): ProgramHold | null => {
    const { source } = effFor(slot);
    return source === "override" || source === "pinned" ? (slot.program_hold ?? "pin") : null;
  };
}

export function makeTakeoverMessageFor(takeovers: AdminTakeover[]) {
  return (slot: AdminSlot) => activeTakeoverForSlot(takeovers, slot.id)?.message ?? null;
}

/** The venue-wide mode ladder, per slot (takeover > moment > game > rotation). */
export function makeModeFor(
  takeovers: AdminTakeover[],
  /** A live game that is ARMED onto the screens (parity with the TV's own gate). */
  gameOnScreens: boolean,
  moment: ReturnType<typeof activeMoment>,
) {
  return (slot: AdminSlot): SlotMode =>
    resolveSlotMode({
      takeover: !!activeTakeoverForSlot(takeovers, slot.id),
      liveGame: gameOnScreens,
      moment: moment ? { stage: moment.stage, interruptGame: moment.event.interrupt_game } : null,
    });
}

/** Transport shows only when the EFFECTIVE program is a playlist the TV is actually looping. */
export function makeTransportPlaylistFor(modeFor: (slot: AdminSlot) => SlotMode, effFor: EffFor) {
  return (slot: AdminSlot) =>
    modeFor(slot) === "rotation" && (effFor(slot).program?.kind === "playlist" || effFor(slot).program?.kind === "carousel");
}

/**
 * Is this slot one a media PROGRAM can be sent to?
 *
 * DECISION: PANEL slots are NOT listed on MEDIA ▸ SCREENS & PROGRAMS. A panel is the
 * portrait sidebar inside a landscape MULTIVIEW — it has no TV, no health and no program
 * of its own, and it is created and pointed at its host from inside the PROGRAM panel.
 * Listing one as a "screen" would offer controls that do not apply to it. This matches the
 * gate the hub already renders its PROGRAM / SCHEDULE controls behind.
 *
 * The hub's own gate, in one place: landscape screens only (portrait slots stay pure
 * rotation — that is where the promo queue lives), and never a multiview PANEL (it has no
 * TV of its own and follows its host). Same predicate `MediaSection`'s PLAY ON row uses
 * and the same one the hub's PROGRAM / SCHEDULE controls are rendered behind.
 */
export function isMediaCapableSlot(slot: AdminSlot): boolean {
  return slot.orientation === "landscape" && slot.kind !== "panel";
}

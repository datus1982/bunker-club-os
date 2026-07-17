import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { fetchSlotQueuePublic } from "./slotQueue";
import { eventStage, isTakeoverStage, type LiveEvent } from "./eventStage";
import type { SlotProgram } from "./mediaProgram";

// Re-export the pure events surface so the app imports it from one place. The pure
// module (no react/supabase) is what scripts/test-event-stage.ts imports directly.
export {
  eventStage,
  isTakeoverStage,
  secondsToFire,
  minutesToFire,
  formatTMinus,
  MOMENT_PAYOFF_MS,
  ALL_CLEAR_MS,
  ALERT_PULSE_MS,
  flavorOf,
} from "./eventStage";
export type { LiveEvent, EventStage, EventKind, EventFlavor } from "./eventStage";

/**
 * Data layer for the PUBLIC signage slot page (/signage/s/:slug — docs/09).
 *
 * Pure realtime READER of tables that other surfaces already write (signage_items
 * + screen_takeovers authored in the Phase-5 admin; games from Scoring; the Toast
 * mirror from toast-menu-sync; season/sales caches). The screen never writes,
 * except the narrow signage_heartbeat() health ping. Realtime-first per docs/01:
 * one channel invalidates the affected query keys; the only polling is the 45s
 * TanStack safety-net (queryClient) + the season/ticker staleTimes. No sub-30s poll.
 */

export type Orientation = "portrait" | "landscape";

export interface Slot {
  id: string;
  venue_id: string;
  name: string;
  orientation: Orientation;
  slug: string;
  terminal_number: number | null;
  location_label: string | null;
  overscan_inset_pct: number;
  scale_adjust: number;
  /** The programmable bottom tier of the mode ladder (docs/15). null = today's rotation.
   *  Only `playlist` renders in M1; capture/multiview are reserved (M2/M3). */
  program: SlotProgram | null;
}

export type Template =
  | "drink_special"
  | "event"
  | "announcement"
  | "image_only"
  | "celebration"
  // Phase 8 (ROTATION UNIFICATION): the whole-menu top sellers as ONE rotation slide, sourced
  // live from sales_cache (MAIN_MENU_ALL) at render time — carries no authored fields, only
  // slot + duration + active. Replaces pointing a TV at the standalone /drinks board.
  | "top_sellers"
  // Phase (IG card, 0042): recent @venue Instagram posts/stories as ONE rotation slide,
  // sourced live from instagram_cache at render time. Carries two authored settings
  // (fields.post_count, fields.include_stories); the images are the sync's mirror.
  | "instagram"
  // Smart Toast slides (0043): data-driven live slide sourced from sales_history at render
  // time. fields.smart_mode = "underdogs" (bottom N of a menu group over `days`) | "champion"
  // (top item over `days` + tonight's top 3). Carries fields.menu_group / days / count.
  | "smart_toast"
  // Phase 7 (docs/13): rotation-level cards materialized from a live scheduled_event.
  // Never authored, never DB rows — only produced by resolveRotation at render time.
  | "event_window"  // an active WINDOW promo card (title/body/cta + optional live price)
  | "event_message" // an active MESSAGE card (generic chrome, no price unless linked)
  | "event_tease";  // a MOMENT TEASE interstitial (12s, injected every ~4th rotation turn)

export interface SignageItem {
  id: string;
  slot_id: string | null;
  template: Template;
  fields: Record<string, unknown>;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  duration_seconds: number;
  active: boolean;
  /** Published to the public website /events page (0015 flag). */
  show_on_website?: boolean;
  /** True for presentation-layer ★ SCREENS entries materialized at render time
   *  (docs/09) — never a DB row. */
  materialized?: boolean;
  /** For event-sourced materialized cards (event_window/message/tease): the source
   *  live event, so the card can render live copy/price/skin (docs/13). */
  event?: LiveEvent;
}

export interface Takeover {
  id: string;
  message: string;
  sub_message: string | null;
  starts_at: string;
  ends_at: string | null;
}

export interface ToastCacheRow {
  guid: string;
  name: string | null;
  price: number | null;
  image: string | null; // mirrored (signage bucket) URL, else Toast CDN
  menu_group: string | null;
  out_of_stock: boolean;
  pos_visible: boolean; // active on the POS view = advertisable (0034 owner principle)
  public_blurb: string | null; // description-safe SHORT blurb (text before `---`), from public_menu
  long_blurb: string | null; // owner-authored long-form (after `--- recipe |`, recipe discarded) — 0048.
                             // Available for templates to read later; NO template renders it yet.
}

export interface LiveGame {
  id: string;
  status: "active" | "paused";
}

/** The modes a slot can resolve to, highest priority first. `event` = a MOMENT in a
 *  takeover-level stage (alert/moment/event/allclear) holding the surface (docs/13). */
export type SlotMode = "takeover" | "event" | "game" | "rotation";

/** A MOMENT that is currently in a takeover-level stage, for the resolver ladder. */
export interface ActiveMoment {
  stage: "alert" | "moment" | "event" | "allclear";
  interruptGame: boolean;
}

/**
 * The mode ladder EVERY slot resolves by (docs/09 + docs/13 amendment):
 *   manual takeover
 *     > MOMENT alert/moment/event/allclear stage  (UNLESS a game is live AND !interrupt_game)
 *       > live game (trivia board)
 *         > rotation (authored items + ★ SCREENS + active WINDOW/MESSAGE cards + TEASE)
 * TEASE never takes over — it is rotation-level. During a live game with interrupt_game
 * false, the moment is suppressed here and surfaces only as ticker lines (docs/13).
 *
 * Extracted so the staff Signage Hub reports the EXACT precedence the public SlotDisplay
 * renders — one source of truth, never a second copy of the ladder (PR #12 invariant).
 */
export function resolveSlotMode(opts: {
  takeover: boolean;
  liveGame: boolean;
  moment?: ActiveMoment | null;
}): SlotMode {
  if (opts.takeover) return "takeover";
  if (opts.moment && (!opts.liveGame || opts.moment.interruptGame)) return "event";
  if (opts.liveGame) return "game";
  return "rotation";
}

/**
 * Pick the single MOMENT that should preempt the surface right now, if any. At most one
 * moment runs per venue (0035 partial-unique index), but we defensively take the first
 * in a takeover-level stage. Returns null if no moment is in alert/moment/event/allclear.
 */
export function activeMoment(events: LiveEvent[], now: Date = new Date()): { event: LiveEvent; stage: "alert" | "moment" | "event" | "allclear" } | null {
  for (const ev of events) {
    if (ev.kind !== "moment") continue;
    const st = eventStage(ev, now);
    if (isTakeoverStage(st)) return { event: ev, stage: st };
  }
  return null;
}

/** The MOMENT currently in its TEASE lead-in (rotation-level interstitial), if any. */
export function teaseMoment(events: LiveEvent[], now: Date = new Date()): LiveEvent | null {
  return events.find((ev) => ev.kind === "moment" && eventStage(ev, now) === "tease") ?? null;
}

const SCREENS_GROUP = "★ SCREENS";

/**
 * The SINGLE ordering the rotation resolves by: sort_order, then id as a STABLE tiebreak.
 * Equal sort_order rows are reachable — two never-reordered event cards both sit at the
 * default -100, and integer midpoint math at the extremes can tie an event against an
 * authored item — and without a tiebreak the TV's fetch order (nondeterministic) and the
 * editor's row order could disagree. Both surfaces sort with THIS comparator (never a
 * hand-rolled concat order), so their queues are byte-identical (parity invariant, WARN-1).
 */
export function compareRotation(a: { sort_order: number; id: string }, b: { sort_order: number; id: string }): number {
  return a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Venue name/timezone — shared cache key so the board and the admin preview agree and
 *  nothing hardcodes 'Bunker Club' outside the fallback (venue-scope rule). */
export function useVenue() {
  return useQuery({
    queryKey: ["signage", "venue"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("venues").select("name, timezone").eq("id", VENUE_ID).maybeSingle();
      return {
        name: (data?.name as string | undefined) ?? "BUNKER CLUB",
        timezone: (data?.timezone as string | undefined) ?? "America/Chicago",
      };
    },
  });
}

/** Everything the slot page needs, keyed by slug. */
export function useSlot(slug: string) {
  const qc = useQueryClient();

  const venue = useVenue();

  const slot = useQuery({
    queryKey: ["signage", "slot", slug],
    queryFn: async (): Promise<Slot | null> => {
      const { data, error } = await supabase
        .from("signage_slots")
        .select("id, venue_id, name, orientation, slug, terminal_number, location_label, overscan_inset_pct, scale_adjust, program")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return (data as Slot | null) ?? null;
    },
  });
  const slotId = slot.data?.id ?? null;

  // This screen's authored assets, read through slot_queue (0045) and flattened to the
  // legacy per-slot item shape (sort_order = position, duration_seconds = the junction dwell,
  // active = asset-global). resolveRotation's inputs are byte-identical to the old slot_id read.
  const items = useQuery({
    queryKey: ["signage", "items", slotId],
    enabled: !!slotId,
    queryFn: (): Promise<SignageItem[]> => fetchSlotQueuePublic(slotId as string),
  });

  const takeover = useQuery({
    queryKey: ["signage", "takeover", slotId],
    queryFn: async (): Promise<Takeover | null> => {
      const nowIso = new Date().toISOString();
      let q = supabase
        .from("screen_takeovers")
        .select("id, message, sub_message, starts_at, ends_at, slot_id")
        .eq("venue_id", VENUE_ID)
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`);
      // Per-screen scope (0045): a takeover applies iff its slot_id is null (all screens) OR
      // equals THIS slot. Broadcast sends null today, so this is a no-op until per-screen
      // sends exist (task 2); scoping it here means the reader needs no change then.
      q = slotId ? q.or(`slot_id.is.null,slot_id.eq.${slotId}`) : q.is("slot_id", null);
      const { data, error } = await q
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Takeover | null) ?? null;
    },
    // Takeovers have hard time bounds; re-evaluate on the safety-net cadence so an
    // ends_at passing without a realtime event still clears the overlay.
    refetchInterval: 30_000,
  });

  const liveGame = useQuery({
    queryKey: ["signage", "liveGame"],
    queryFn: async (): Promise<LiveGame | null> => {
      const { data, error } = await supabase
        .from("games")
        .select("id, status")
        .eq("venue_id", VENUE_ID)
        .in("status", ["active", "paused"])
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as LiveGame | null) ?? null;
    },
  });

  // Toast mirror: name/price/photo/stock (anon-safe columns) + public_blurb from the
  // description-safe view. Keyed by guid for source_toast_guid auto-fill AND for the
  // ★ SCREENS auto-materialization. Read-only (docs/09 — no sync writes from here).
  const toast = useQuery({
    queryKey: ["signage", "toast"],
    queryFn: async (): Promise<Map<string, ToastCacheRow>> => {
      const [{ data: cache }, { data: menu }] = await Promise.all([
        supabase
          .from("toast_menu_cache")
          .select("guid, name, price, image_storage_path, image_url, menu_group, out_of_stock, pos_visible, long_blurb")
          .eq("venue_id", VENUE_ID),
        supabase.from("public_menu").select("guid, public_blurb"),
      ]);
      const blurbs = new Map<string, string | null>(
        ((menu ?? []) as { guid: string; public_blurb: string | null }[]).map((m) => [m.guid, m.public_blurb]),
      );
      const map = new Map<string, ToastCacheRow>();
      for (const r of (cache ?? []) as Array<{
        guid: string; name: string | null; price: number | null;
        image_storage_path: string | null; image_url: string | null;
        menu_group: string | null; out_of_stock: boolean; pos_visible: boolean | null;
        long_blurb: string | null;
      }>) {
        map.set(r.guid, {
          guid: r.guid,
          name: r.name,
          price: r.price,
          image: r.image_storage_path ?? r.image_url,
          menu_group: r.menu_group,
          out_of_stock: r.out_of_stock,
          pos_visible: r.pos_visible ?? true, // default-visible if unsynced (mirrors 0034)
          public_blurb: blurbs.get(r.guid) ?? null,
          long_blurb: r.long_blurb, // anon-readable cache column (0048); no template renders it yet
        });
      }
      return map;
    },
    staleTime: 60_000,
  });

  // ── Realtime: one channel, invalidate only the affected keys (ARCH-1) ───────
  useEffect(() => {
    const ch = supabase
      .channel("signage:slot")
      .on("postgres_changes", { event: "*", schema: "public", table: "signage_items", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "items"] }))
      // slot_queue carries per-screen order/dwell now (0045) — a queue edit must re-fetch the
      // rotation. No venue_id column on the junction (single-venue project), so subscribe
      // unfiltered and invalidate; the flattened read re-joins the assets.
      .on("postgres_changes", { event: "*", schema: "public", table: "slot_queue" },
        () => qc.invalidateQueries({ queryKey: ["signage", "items"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "screen_takeovers", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "takeover"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "liveGame"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "toast_menu_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "toast"] }))
      // A PROGRAM switch (ROTATION ↔ PLAYLIST, docs/15) writes signage_slots.program — re-fetch
      // the slot row so the TV flips into/out of a playlist program with no reload, same as every
      // other admin action. (This channel didn't watch signage_slots before M1.)
      .on("postgres_changes", { event: "*", schema: "public", table: "signage_slots", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "slot"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return { venue, slot, items, takeover, liveGame, toast };
}

/**
 * Live scheduled events for the venue (docs/13). Reads the anon horizon-gated view
 * `signage_events_live` (0035) — a row appears ONLY inside its on-screen window, and
 * only display columns are exposed. Realtime can't deliver anon rows through a SECURITY
 * DEFINER view, so this polls at 30s (within the display rules' one-fallback-poll
 * allowance; the stage math is client-side and re-derived every render tick anyway).
 */
export function useLiveEvents(venueId: string = VENUE_ID) {
  return useQuery({
    queryKey: ["signage", "events", venueId],
    refetchInterval: 30_000,
    queryFn: async (): Promise<LiveEvent[]> => {
      const { data, error } = await supabase
        .from("signage_events_live")
        .select("id, venue_id, name, kind, skin, fields, toast_guid, fire_at, tease_minutes, alert_minutes, window_minutes, interrupt_game, status")
        .eq("venue_id", venueId)
        // Stable fetch order so the eventCards array is deterministic; compareRotation's id
        // tiebreak is the real guarantee, this just removes upstream nondeterminism (WARN-1).
        .order("id");
      if (error) throw error;
      return (data ?? []) as LiveEvent[];
    },
  });
}

/** Build the rotation-level card for an active WINDOW/MESSAGE event (docs/13). */
function eventRotationCard(ev: LiveEvent): SignageItem {
  // Event cards CAN now carry a per-item seconds control + a queue position, set from the
  // EDIT ROTATION live-queue editor and persisted onto the event row's fields jsonb
  // (fields.duration_seconds / fields.rotation_sort). Absent either, the historical defaults
  // hold: 12s dwell (mockup pace) and sort_order -100 (event promos lead the rotation) — so
  // TVs are byte-identical until a manager reorders/retimes a card.
  const duration = typeof ev.fields?.duration_seconds === "number" ? ev.fields.duration_seconds : 12;
  const rotationSort = typeof ev.fields?.rotation_sort === "number" ? ev.fields.rotation_sort : -100;
  return {
    id: `event:${ev.id}`,
    slot_id: null,
    template: ev.kind === "message" ? "event_message" : "event_window",
    // Carry the linked guid so the standard OOS/POS auto-hide + live-price path applies.
    fields: { ...ev.fields, source_toast_guid: ev.toast_guid ?? undefined },
    event: ev,
    starts_at: null,
    ends_at: null,
    sort_order: rotationSort, // event promos lead (-100) unless a manager reordered the card
    duration_seconds: Math.max(6, duration),
    active: true,
    materialized: true,
  };
}

/**
 * Resolve the rotation the slot should show right now: active items in their time
 * windows (client-side, matches the DrinksDisplay pattern), plus presentation-layer
 * ★ SCREENS entries and any active WINDOW/MESSAGE event cards (docs/13); minus any
 * item whose source_toast_guid is 86'd or off the POS view.
 *
 * MOMENT TEASE interstitials are NOT injected here — they are timing-based (every ~4th
 * turn) and handled by the Rotation component so the pure list stays deterministic.
 */
export function resolveRotation(
  items: SignageItem[],
  toast: Map<string, ToastCacheRow>,
  now: Date = new Date(),
  events: LiveEvent[] = [],
): SignageItem[] {
  const t = now.getTime();
  const inWindow = (it: SignageItem) =>
    (!it.starts_at || new Date(it.starts_at).getTime() <= t) &&
    (!it.ends_at || new Date(it.ends_at).getTime() > t);

  // Auto-hide rule (docs/09 + 0034): skip any item sourced from a Toast item that is
  // out-of-stock OR not POS-visible. The owner's principle — never advertise what
  // isn't active on the POS view — so a POS-hidden source is treated like an 86.
  const notHidden = (it: SignageItem) => {
    const guid = it.fields?.source_toast_guid as string | undefined;
    if (!guid) return true;
    const row = toast.get(guid);
    if (!row) return true; // unknown guid: don't over-hide authored copy
    return !row.out_of_stock && row.pos_visible;
  };

  const scheduled = items.filter((it) => inWindow(it) && notHidden(it));

  // Active WINDOW/MESSAGE event cards (docs/13) join the rotation exactly like ★ SCREENS
  // — presentation-layer only, never DB rows. A toast-linked card obeys the same 86'd /
  // off-POS auto-hide as any drink_special (notHidden reads fields.source_toast_guid).
  const eventCards: SignageItem[] = [];
  for (const ev of events) {
    if (ev.kind !== "window" && ev.kind !== "message") continue;
    if (eventStage(ev, now) !== "active") continue;
    const card = eventRotationCard(ev);
    if (!notHidden(card)) continue;
    eventCards.push(card);
  }

  // ★ SCREENS materialization: in-stock items in the hidden toggle group auto-appear
  // as drink_special entries (template defaults + Toast fields). These are NEVER DB
  // rows — they exist only for this render (docs/09 anti-goal: no sync writes).
  // Only in-stock AND POS-visible ★ SCREENS items advertise (0034 owner principle).
  // Sort the eligible guids so the trailer order is deterministic (Map iteration follows
  // the nondeterministic fetch order otherwise), then SPREAD them 10000, 10001, 10002 …
  // rather than stacking every trailer on 10000 — a shared 10000 makes a below-trailer
  // event move a silent no-op (midpoint of 10000/10000 = 10000) and reintroduces a
  // fetch-order tie between trailers (WARN-2).
  const screensGuids = [...toast.entries()]
    .filter(([, row]) => row.menu_group === SCREENS_GROUP && !row.out_of_stock && row.pos_visible)
    .map(([guid]) => guid)
    .sort();
  const materialized: SignageItem[] = screensGuids.map((guid, i) => ({
    id: `screens:${guid}`,
    slot_id: null,
    template: "drink_special",
    fields: { source_toast_guid: guid, photo_treatment: "viewport" },
    starts_at: null,
    ends_at: null,
    sort_order: 10_000 + i, // after authored items, spread so a card can move BELOW a trailer
    duration_seconds: 12,
    active: true,
    materialized: true,
  }));

  return [...eventCards, ...scheduled, ...materialized].sort(compareRotation);
}

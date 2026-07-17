import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { fetchSlotQueueAdmin, fetchAssetsWithPlacements, swapQueuePositions, setQueueDuration, type AssetWithPlacements } from "./slotQueue";
import type { Orientation, PriceOption, SignageItem, Template, ToastCacheRow } from "./useSignage";
import type { SlotProgram } from "./mediaProgram";
import { slotRenderFieldsUnchanged, HUB_SLOT_RENDER_FIELDS } from "./slotRealtime";

/**
 * Data layer for the STAFF signage templater (/signage — docs/09 "Admin").
 *
 * Writer counterpart to useSignage's public reader. All writes to signage_items /
 * screen_takeovers require has_module('signage') (RLS 0024 — admin implied); image
 * uploads go to the public-read `signage` bucket (storage policy 0017, any venue_staff).
 * Toast is READ-ONLY here (docs/09 amendment) — the cache is a picker source only, we
 * never write stock/featured. Realtime-first: one channel invalidates the affected keys.
 */

export interface AdminSlot {
  id: string;
  name: string;
  orientation: Orientation;
  slug: string;
  terminal_number: number | null;
  location_label: string | null;
  last_seen: string | null;
  /** The screen's PROGRAM (docs/15). null = ROTATION; else a playlist/capture/multiview program. */
  program: SlotProgram | null;
}

export interface AdminItem extends SignageItem {
  recurrence: Recurrence | null;
  created_at: string | null;
}

export interface AdminTakeover {
  id: string;
  message: string;
  sub_message: string | null;
  starts_at: string;
  ends_at: string | null;
  signage_item_id: string | null;
  /** Per-screen scope (0045): null = all screens (venue-wide), else this one slot. */
  slot_id: string | null;
}

/** Re-export so the hub/library can type the deduped asset list. */
export type { AssetWithPlacements };

/** recurrence jsonb shape (docs/09; same family as scheduled_events). null = one-shot. */
export type Recurrence =
  | { kind: "annual"; month: number; day: number }
  | { kind: "weekly"; daysOfWeek: string[] };

export type ScreenHealth = "online" | "stale" | "offline";

/** last_seen → health (docs/09: heartbeat every 60s). <2min online, <10min stale, else offline. */
export function screenHealth(lastSeen: string | null): ScreenHealth {
  if (!lastSeen) return "offline";
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < 2 * 60_000) return "online";
  if (age < 10 * 60_000) return "stale";
  return "offline";
}

const SCREENS_GROUP = "★ SCREENS";

/* ── queries ─────────────────────────────────────────────────────────────── */

export function useAdminSlots() {
  return useQuery({
    queryKey: ["signage-admin", "slots"],
    // Re-poll on the 60s heartbeat cadence so the health badge decays without a manual
    // refresh (this is admin, not a display — a slow poll is allowed; docs/01 display
    // rules govern the /signage/s board, not this console).
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminSlot[]> => {
      const { data, error } = await supabase
        .from("signage_slots")
        .select("id, name, orientation, slug, terminal_number, location_label, last_seen, program")
        .eq("venue_id", VENUE_ID)
        .order("terminal_number", { nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as AdminSlot[];
    },
  });
}

/** Realtime on signage_slots so a PROGRAM switch (docs/15) reflects on the hub cards without
 *  waiting for the 60s health poll — the mode/program chip must mirror what the TV shows.
 *  Skips last_seen-only UPDATEs (every screen's 60s heartbeat, 60s × N screens of churn, M1
 *  NOTE-2): the health chip stays fresh via useAdminSlots' 60s refetch poll, so those need not
 *  invalidate. A real change (name/orientation/slug/terminal/label/program) still refetches
 *  immediately, preserving the hub↔TV parity invariant. */
export function useSlotsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("signage-admin:slots")
      .on("postgres_changes", { event: "*", schema: "public", table: "signage_slots", filter: `venue_id=eq.${VENUE_ID}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const cached = qc.getQueryData<AdminSlot[]>(["signage-admin", "slots"]);
          const prev = cached?.find((s) => s.id === row.id) as Record<string, unknown> | undefined;
          if (slotRenderFieldsUnchanged(HUB_SLOT_RENDER_FIELDS, prev, row)) return;
          qc.invalidateQueries({ queryKey: ["signage-admin", "slots"] });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
}

export interface LiveGameRow {
  id: string;
  status: "active" | "paused";
  game_date: string | null;
}

/** The venue's live game resolved EXACTLY as the public SlotDisplay resolves it
 *  (useSignage.ts liveGame query): status active/paused, venue-wide, date IGNORED.
 *  The hub MUST source game-mode from this — NOT useTonight() (which is tonight-only by
 *  venue date) — so the MODE chip can never disagree with what the screens actually show.
 *  A stale `active` game left over from a past date (this venue has hit exactly that) still
 *  pins every screen into game mode; the hub surfaces that date rather than hiding it. */
export function useLiveGame() {
  return useQuery({
    queryKey: ["signage-admin", "live-game"],
    // No sub-30s poll (docs/01) — game start/stop arrives via realtime elsewhere; this
    // slow poll just re-confirms a stale-active game hasn't been cleared out-of-band.
    refetchInterval: 60_000,
    queryFn: async (): Promise<LiveGameRow | null> => {
      const { data, error } = await supabase
        .from("games")
        .select("id, status, game_date")
        .eq("venue_id", VENUE_ID)
        .in("status", ["active", "paused"])
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as LiveGameRow | null) ?? null;
    },
  });
}

export function useAllItems() {
  const qc = useQueryClient();
  // Every (slot, asset) pairing for the venue via slot_queue (0045), flattened to the legacy
  // AdminItem shape (slot_id = the queue's slot, sort_order = position, duration_seconds = the
  // junction dwell). Grouped by slot_id downstream (SignageHub itemsBySlot / EditRotation).
  const q = useQuery({
    queryKey: ["signage-admin", "items"],
    queryFn: async (): Promise<AdminItem[]> => (await fetchSlotQueueAdmin()) as unknown as AdminItem[],
  });

  useEffect(() => {
    const ch = supabase
      .channel("signage-admin:items")
      .on("postgres_changes", { event: "*", schema: "public", table: "signage_items", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage-admin", "items"] }))
      // A reorder / dwell change / add / remove writes slot_queue, not signage_items — so the
      // console must invalidate on junction changes too (single-venue project → no filter).
      .on("postgres_changes", { event: "*", schema: "public", table: "slot_queue" },
        () => qc.invalidateQueries({ queryKey: ["signage-admin", "items"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/**
 * The ASSET LIBRARY read (task 2): every venue asset ONCE + the screens it runs on
 * (fetchAssetsWithPlacements). Idle assets (queued nowhere) are included, so the library
 * grid shows them with no P/L chips lit. Invalidated by the same realtime channel as
 * useAllItems (signage_items + slot_queue changes) via a shared queryKey prefix — but keyed
 * separately so the two reads don't share a cache entry.
 */
export function useSignageAssets() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["signage-admin", "assets"],
    queryFn: (): Promise<AssetWithPlacements[]> => fetchAssetsWithPlacements(),
  });

  useEffect(() => {
    const ch = supabase
      .channel("signage-admin:assets")
      .on("postgres_changes", { event: "*", schema: "public", table: "signage_items", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage-admin", "assets"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "slot_queue" },
        () => qc.invalidateQueries({ queryKey: ["signage-admin", "assets"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/** Recent takeovers (newest first) + the currently-active one derived client-side. */
export function useTakeovers() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["signage-admin", "takeovers"],
    // Countdown + expiry need to re-evaluate even without a realtime event on ends_at.
    refetchInterval: 30_000,
    queryFn: async (): Promise<AdminTakeover[]> => {
      const { data, error } = await supabase
        .from("screen_takeovers")
        .select("id, message, sub_message, starts_at, ends_at, signage_item_id, slot_id")
        .eq("venue_id", VENUE_ID)
        .order("starts_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as AdminTakeover[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("signage-admin:takeovers")
      .on("postgres_changes", { event: "*", schema: "public", table: "screen_takeovers", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage-admin", "takeovers"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/** A row of the events table (docs/13). The stage engine that fires these lands in the
 *  events task; the hub only READS them for the RUNNING & UPCOMING strip today. */
export interface ScheduledEvent {
  id: string;
  name: string;
  kind: "window" | "message" | "moment";
  skin: string;
  fields: Record<string, unknown>;
  fire_at: string | null;
  recurrence: { daysOfWeek?: string[]; time?: string } | null;
  window_minutes: number;
  tease_minutes: number;
  alert_minutes: number;
  interrupt_game: boolean;
  status: "scheduled" | "running" | "completed" | "aborted" | "disabled";
}

/** scheduled_events for this venue (staff read via has_module('events'), 0035). Feeds the
 *  hub's RUNNING & UPCOMING strip; the full console lives at /signage/events. */
export function useScheduledEvents() {
  return useQuery({
    queryKey: ["signage-admin", "events"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<ScheduledEvent[]> => {
      const { data, error } = await supabase
        .from("scheduled_events")
        .select("id, name, kind, skin, fields, fire_at, recurrence, window_minutes, tease_minutes, alert_minutes, interrupt_game, status")
        .eq("venue_id", VENUE_ID)
        .order("fire_at", { nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as ScheduledEvent[];
    },
  });
}

export function activeTakeover(list: AdminTakeover[], now = Date.now()): AdminTakeover | null {
  return (
    list.find(
      (t) => new Date(t.starts_at).getTime() <= now && (!t.ends_at || new Date(t.ends_at).getTime() > now),
    ) ?? null
  );
}

/**
 * The active takeover that applies to ONE screen (0045 per-screen scope). A venue-wide
 * takeover (slot_id null) applies to every slot; a scoped one applies only to its slot. This
 * is the SAME rule the public SlotDisplay reader scopes by (useSignage takeover query) — so
 * the hub's per-card TAKEOVER mode can never disagree with what that TV actually shows.
 */
export function activeTakeoverForSlot(list: AdminTakeover[], slotId: string, now = Date.now()): AdminTakeover | null {
  return (
    list.find(
      (t) =>
        (t.slot_id === null || t.slot_id === slotId) &&
        new Date(t.starts_at).getTime() <= now &&
        (!t.ends_at || new Date(t.ends_at).getTime() > now),
    ) ?? null
  );
}

/**
 * Toast mirror keyed by guid — source picker for drink_special + the ★ SCREENS panel.
 * Same shape/columns as useSignage's toast query (mirrored image, description-safe blurb).
 */
export function useToastCache() {
  return useQuery({
    queryKey: ["signage-admin", "toast"],
    staleTime: 60_000,
    queryFn: async (): Promise<ToastCacheRow[]> => {
      const [{ data: cache }, { data: menu }] = await Promise.all([
        supabase
          .from("toast_menu_cache")
          .select("guid, name, price, image_storage_path, image_url, menu_group, out_of_stock, pos_visible, long_blurb, price_options")
          .eq("venue_id", VENUE_ID)
          .order("menu_group"),
        supabase.from("public_menu").select("guid, public_blurb"),
      ]);
      const blurbs = new Map<string, string | null>(
        ((menu ?? []) as { guid: string; public_blurb: string | null }[]).map((m) => [m.guid, m.public_blurb]),
      );
      return ((cache ?? []) as Array<{
        guid: string; name: string | null; price: number | null;
        image_storage_path: string | null; image_url: string | null;
        menu_group: string | null; out_of_stock: boolean; pos_visible: boolean | null;
        long_blurb: string | null; price_options: PriceOption[] | null;
      }>).map((r) => ({
        guid: r.guid,
        name: r.name,
        price: r.price,
        image: r.image_storage_path ?? r.image_url,
        menu_group: r.menu_group,
        out_of_stock: r.out_of_stock,
        pos_visible: r.pos_visible ?? true, // default-visible if unsynced (mirrors 0034)
        public_blurb: blurbs.get(r.guid) ?? null,
        long_blurb: r.long_blurb, // 0048 — available to templates later; nothing renders it yet
        price_options: r.price_options ?? null, // 0050 — available to templates later; nothing renders it yet
      }));
    },
  });
}

/** Map form of the cache for template preview / auto-hide lookups. */
export function toastMap(rows: ToastCacheRow[] | undefined): Map<string, ToastCacheRow> {
  const m = new Map<string, ToastCacheRow>();
  for (const r of rows ?? []) m.set(r.guid, r);
  return m;
}

/** In-stock, POS-visible ★ SCREENS featured items (read-only reality panel, docs/09;
 *  POS-visibility gate per 0034 — matches the public slot page's materialization). */
export function featuredItems(rows: ToastCacheRow[] | undefined): ToastCacheRow[] {
  return (rows ?? []).filter((r) => r.menu_group === SCREENS_GROUP && !r.out_of_stock && r.pos_visible);
}

/* ── mutation helpers (plain async — components wrap in useMutation) ──────── */

export interface ItemDraft {
  id?: string;
  slot_id: string | null;
  template: Template;
  fields: Record<string, unknown>;
  starts_at: string | null;
  ends_at: string | null;
  recurrence: Recurrence | null;
  duration_seconds: number;
  active: boolean;
  show_on_website: boolean;
}

/**
 * Insert or update the ASSET (signage_items). Returns the row id. Placement on a screen
 * (slot_id, per-screen position + dwell) is NO LONGER written here — that lives on slot_queue
 * (0045); the caller follows this with placeAsset() to queue/re-queue the asset. This function
 * touches only asset-global columns, so an asset shared across screens (task 2) stays coherent.
 */
export async function saveItem(draft: ItemDraft): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (draft.id) {
    const { error } = await supabase
      .from("signage_items")
      .update({
        template: draft.template,
        fields: draft.fields,
        starts_at: draft.starts_at,
        ends_at: draft.ends_at,
        recurrence: draft.recurrence,
        active: draft.active,
        show_on_website: draft.show_on_website,
      })
      .eq("id", draft.id);
    if (error) throw error;
    return draft.id;
  }
  const { data, error } = await supabase
    .from("signage_items")
    .insert({
      venue_id: VENUE_ID,
      template: draft.template,
      fields: draft.fields,
      starts_at: draft.starts_at,
      ends_at: draft.ends_at,
      recurrence: draft.recurrence,
      show_on_website: draft.show_on_website,
      active: draft.active,
      created_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from("signage_items").delete().eq("id", id);
  if (error) throw error;
}

export async function setItemActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("signage_items").update({ active }).eq("id", id);
  if (error) throw error;
}

/** Per-SCREEN on-screen duration (EDIT ROTATION seconds control) → slot_queue.duration_seconds
 *  for this (slot, asset) pairing (0045). The public SlotDisplay rotation advance honors the
 *  flattened per-item dwell (no fixed interval). Takes the flattened AdminItem so it can key
 *  the junction by slot_id + id. */
export async function setItemDuration(item: AdminItem, seconds: number): Promise<void> {
  if (!item.slot_id) return;
  await setQueueDuration(item.slot_id, item.id, seconds);
}

/** The seconds a rotation slide can dwell (EDIT ROTATION picker). Top Sellers wants a longer
 *  dwell than a quick promo, so the ladder runs up to a full minute. */
export const DURATION_CHOICES = [8, 12, 20, 30, 45, 60] as const;

/** Swap position with the adjacent asset on the same screen (▲/▼ reorder) → slot_queue.position
 *  for the two (slot, asset) pairings (0045). Both rows are on the same slot (adjacent authored
 *  neighbours), so slot_id matches; the flattened AdminItem carries slot_id + sort_order. */
export async function reorderItem(a: AdminItem, b: AdminItem): Promise<void> {
  if (!a.slot_id || !b.slot_id) return;
  await swapQueuePositions(
    { slot_id: a.slot_id, id: a.id, sort_order: a.sort_order },
    { slot_id: b.slot_id, id: b.id, sort_order: b.sort_order },
  );
}

/* ── takeover mutations ──────────────────────────────────────────────────── */

export async function sendTakeover(v: {
  message: string;
  sub_message: string | null;
  durationMinutes: number | null;
  /** Per-screen scope (0045, D2): null = ALL screens (venue-wide), else this one slot. */
  slotId?: string | null;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const startsAt = new Date();
  const endsAt = v.durationMinutes != null ? new Date(startsAt.getTime() + v.durationMinutes * 60_000) : null;
  const { error } = await supabase.from("screen_takeovers").insert({
    venue_id: VENUE_ID,
    message: v.message,
    sub_message: v.sub_message,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
    slot_id: v.slotId ?? null,
    created_by: auth.user?.id ?? null,
  });
  if (error) throw error;
}

/** Dismiss = set ends_at to now (an until-dismissed takeover has ends_at null). */
export async function dismissTakeover(id: string): Promise<void> {
  const { error } = await supabase.from("screen_takeovers").update({ ends_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/* ── celebration shout-out moment (linked screen_takeovers) ──────────────── */

/** Read the takeover linked to a celebration item, if any. */
export async function linkedMoment(itemId: string): Promise<AdminTakeover | null> {
  const { data, error } = await supabase
    .from("screen_takeovers")
    .select("id, message, sub_message, starts_at, ends_at, signage_item_id")
    .eq("signage_item_id", itemId)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AdminTakeover | null) ?? null;
}

/** Create/replace the celebration's linked shout-out takeover; null clears it. */
export async function saveMoment(
  itemId: string,
  moment: { startsAt: string; durationSeconds: number; message: string; sub: string | null } | null,
): Promise<void> {
  // A celebration owns at most one linked moment; delete any existing then (re)create.
  // supabase-js returns errors rather than throwing — a silently-failed delete followed by
  // an insert would leave TWO linked moments (the stray hidden by linkedMoment's limit 1 but
  // still firing on screens), so surface it and abort before re-inserting.
  const { error: delErr } = await supabase.from("screen_takeovers").delete().eq("signage_item_id", itemId);
  if (delErr) throw delErr;
  if (!moment) return;
  const { data: auth } = await supabase.auth.getUser();
  const ends = new Date(new Date(moment.startsAt).getTime() + moment.durationSeconds * 1000);
  const { error } = await supabase.from("screen_takeovers").insert({
    venue_id: VENUE_ID,
    message: moment.message,
    sub_message: moment.sub,
    starts_at: moment.startsAt,
    ends_at: ends.toISOString(),
    signage_item_id: itemId,
    created_by: auth.user?.id ?? null,
  });
  if (error) throw error;
}

/* ── image upload (client resize ≤1080px long edge → signage bucket) ─────── */

/**
 * Custom staff image upload for events + signage items (Phase 8). Resizes/re-encodes to a
 * ≤1600px JPEG (EXIF is dropped by the canvas re-encode — see resizeToMaxEdge) and writes
 * to `uploads/{venue_id}/{uuid}.jpg` in the PUBLIC-read `signage` bucket. That prefix is
 * module-gated by RLS (0037: has_module('events') OR has_module('signage')) — the venue is
 * read from the path, so nothing is hardcoded. Returns the public URL for fields.image_url.
 *
 * upsert is deliberately OFF: the path carries a fresh UUID so it never collides, and an
 * upsert (INSERT … ON CONFLICT) trips the storage RLS gate — the ON-CONFLICT UPDATE path
 * needs SELECT/UPDATE visibility this bucket doesn't grant authenticated callers. A plain
 * insert to a new key is all we need and is what the RLS policies allow.
 */
export async function uploadCustomImage(file: File): Promise<string> {
  const blob = await resizeToMaxEdge(file, 1600);
  const uuid = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `uploads/${VENUE_ID}/${uuid}.jpg`;
  const { error } = await supabase.storage.from("signage").upload(path, blob, {
    contentType: "image/jpeg",
  });
  if (error) throw error;
  return supabase.storage.from("signage").getPublicUrl(path).data.publicUrl;
}

/** Resize an image file so its longest edge is ≤ maxEdge, re-encoded as JPEG (docs/09). */
export function resizeToMaxEdge(file: File, maxEdge: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(img.width, img.height);
      const scale = Math.min(1, maxEdge / longest);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas unavailable"));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("image encode failed"))),
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import type { Orientation, SignageItem, Template, ToastCacheRow } from "./useSignage";

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
}

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
        .select("id, name, orientation, slug, terminal_number, location_label, last_seen")
        .eq("venue_id", VENUE_ID)
        .order("terminal_number", { nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as AdminSlot[];
    },
  });
}

export function useAllItems() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["signage-admin", "items"],
    queryFn: async (): Promise<AdminItem[]> => {
      const { data, error } = await supabase
        .from("signage_items")
        .select("id, slot_id, template, fields, starts_at, ends_at, recurrence, sort_order, duration_seconds, active, show_on_website, created_at")
        .eq("venue_id", VENUE_ID)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as AdminItem[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("signage-admin:items")
      .on("postgres_changes", { event: "*", schema: "public", table: "signage_items", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage-admin", "items"] }))
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
        .select("id, message, sub_message, starts_at, ends_at, signage_item_id")
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

export function activeTakeover(list: AdminTakeover[], now = Date.now()): AdminTakeover | null {
  return (
    list.find(
      (t) => new Date(t.starts_at).getTime() <= now && (!t.ends_at || new Date(t.ends_at).getTime() > now),
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
          .select("guid, name, price, image_storage_path, image_url, menu_group, out_of_stock, pos_visible")
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
      }>).map((r) => ({
        guid: r.guid,
        name: r.name,
        price: r.price,
        image: r.image_storage_path ?? r.image_url,
        menu_group: r.menu_group,
        out_of_stock: r.out_of_stock,
        pos_visible: r.pos_visible ?? true, // default-visible if unsynced (mirrors 0034)
        public_blurb: blurbs.get(r.guid) ?? null,
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

/** Insert or update an item. Returns the row id (new items get an appended sort_order). */
export async function saveItem(draft: ItemDraft, nextSortOrder: number): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (draft.id) {
    const { error } = await supabase
      .from("signage_items")
      .update({
        slot_id: draft.slot_id,
        template: draft.template,
        fields: draft.fields,
        starts_at: draft.starts_at,
        ends_at: draft.ends_at,
        recurrence: draft.recurrence,
        duration_seconds: draft.duration_seconds,
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
      slot_id: draft.slot_id,
      template: draft.template,
      fields: draft.fields,
      starts_at: draft.starts_at,
      ends_at: draft.ends_at,
      recurrence: draft.recurrence,
      show_on_website: draft.show_on_website,
      // DECISION: new items append to the end of the slot (highest sort_order + 1); staff
      // reorder with the ▲/▼ buttons afterward rather than typing a position. Matches the
      // DrinksAdmin group ordering UX; the spec's "sort position (append default)" is honoured
      // as append-only, keeping the mobile form short. Caller passes max(sort_order)+1 — NOT
      // the row count, which collides after a delete leaves a gap (two items on the same order).
      sort_order: nextSortOrder,
      duration_seconds: draft.duration_seconds,
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

/** Swap sort_order with the adjacent item in the same slot (▲/▼ reorder). */
export async function reorderItem(a: AdminItem, b: AdminItem): Promise<void> {
  const e1 = await supabase.from("signage_items").update({ sort_order: b.sort_order }).eq("id", a.id);
  if (e1.error) throw e1.error;
  const e2 = await supabase.from("signage_items").update({ sort_order: a.sort_order }).eq("id", b.id);
  if (e2.error) throw e2.error;
}

/* ── takeover mutations ──────────────────────────────────────────────────── */

export async function sendTakeover(v: { message: string; sub_message: string | null; durationMinutes: number | null }): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const startsAt = new Date();
  const endsAt = v.durationMinutes != null ? new Date(startsAt.getTime() + v.durationMinutes * 60_000) : null;
  const { error } = await supabase.from("screen_takeovers").insert({
    venue_id: VENUE_ID,
    message: v.message,
    sub_message: v.sub_message,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
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

export async function uploadSignageImage(file: File): Promise<string> {
  const blob = await resizeToMaxEdge(file, 1080);
  const uuid = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `signage-items/${uuid}/image.jpg`;
  const { error } = await supabase.storage.from("signage").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: true,
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

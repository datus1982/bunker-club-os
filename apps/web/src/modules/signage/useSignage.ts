import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

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
}

export type Template = "drink_special" | "event" | "announcement" | "image_only" | "celebration";

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
  public_blurb: string | null; // description-safe blurb (text before `---`), from public_menu
}

export interface LiveGame {
  id: string;
  status: "active" | "paused";
}

const SCREENS_GROUP = "★ SCREENS";

/** Everything the slot page needs, keyed by slug. */
export function useSlot(slug: string) {
  const qc = useQueryClient();

  const venue = useQuery({
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

  const slot = useQuery({
    queryKey: ["signage", "slot", slug],
    queryFn: async (): Promise<Slot | null> => {
      const { data, error } = await supabase
        .from("signage_slots")
        .select("id, venue_id, name, orientation, slug, terminal_number, location_label, overscan_inset_pct, scale_adjust")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return (data as Slot | null) ?? null;
    },
  });
  const slotId = slot.data?.id ?? null;

  const items = useQuery({
    queryKey: ["signage", "items", slotId],
    enabled: !!slotId,
    queryFn: async (): Promise<SignageItem[]> => {
      const { data, error } = await supabase
        .from("signage_items")
        .select("id, slot_id, template, fields, starts_at, ends_at, sort_order, duration_seconds, active")
        .eq("slot_id", slotId)
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as SignageItem[];
    },
  });

  const takeover = useQuery({
    queryKey: ["signage", "takeover"],
    queryFn: async (): Promise<Takeover | null> => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("screen_takeovers")
        .select("id, message, sub_message, starts_at, ends_at")
        .eq("venue_id", VENUE_ID)
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
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
          .select("guid, name, price, image_storage_path, image_url, menu_group, out_of_stock")
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
        menu_group: string | null; out_of_stock: boolean;
      }>) {
        map.set(r.guid, {
          guid: r.guid,
          name: r.name,
          price: r.price,
          image: r.image_storage_path ?? r.image_url,
          menu_group: r.menu_group,
          out_of_stock: r.out_of_stock,
          public_blurb: blurbs.get(r.guid) ?? null,
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
      .on("postgres_changes", { event: "*", schema: "public", table: "screen_takeovers", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "takeover"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "liveGame"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "toast_menu_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "toast"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return { venue, slot, items, takeover, liveGame, toast };
}

/**
 * Resolve the rotation the slot should show right now: active items in their time
 * windows (client-side, matches the DrinksDisplay pattern), plus presentation-layer
 * ★ SCREENS entries; minus any item whose source_toast_guid is 86'd.
 */
export function resolveRotation(
  items: SignageItem[],
  toast: Map<string, ToastCacheRow>,
  now: Date = new Date(),
): SignageItem[] {
  const t = now.getTime();
  const inWindow = (it: SignageItem) =>
    (!it.starts_at || new Date(it.starts_at).getTime() <= t) &&
    (!it.ends_at || new Date(it.ends_at).getTime() > t);

  // Auto-hide rule (docs/09): skip any item sourced from an out-of-stock Toast item.
  const notHidden = (it: SignageItem) => {
    const guid = it.fields?.source_toast_guid as string | undefined;
    if (!guid) return true;
    const row = toast.get(guid);
    return !row?.out_of_stock;
  };

  const scheduled = items.filter((it) => inWindow(it) && notHidden(it));

  // ★ SCREENS materialization: in-stock items in the hidden toggle group auto-appear
  // as drink_special entries (template defaults + Toast fields). These are NEVER DB
  // rows — they exist only for this render (docs/09 anti-goal: no sync writes).
  const materialized: SignageItem[] = [];
  for (const [guid, row] of toast) {
    if (row.menu_group !== SCREENS_GROUP || row.out_of_stock) continue;
    materialized.push({
      id: `screens:${guid}`,
      slot_id: null,
      template: "drink_special",
      fields: { source_toast_guid: guid, photo_treatment: "viewport" },
      starts_at: null,
      ends_at: null,
      sort_order: 10_000, // after authored items
      duration_seconds: 12,
      active: true,
      materialized: true,
    });
  }

  return [...scheduled, ...materialized].sort((a, b) => a.sort_order - b.sort_order);
}

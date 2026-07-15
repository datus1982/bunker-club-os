import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

// Data layer for the /drinks board (docs/08) AND the signage Top Sellers rotation slide
// (Phase 8). Pure realtime READER of the tables the scheduled toast-sync writes — the
// display never calls the edge function (AUTH-1 b).

export interface DrinkItem {
  menu_group_guid: string;
  rank: number;
  item_name: string;
  price: number;
  sales_count: number;
  sales_percentage: number;
  business_date: string;
  /** Toast item guid (null for guid-less legacy rows) — carried so the POS-visibility gate
   *  and the overall-merge fallback can match items. */
  item_guid?: string | null;
}

export interface DrinkGroup {
  toast_menu_guid: string;
  name: string;
  display_order: number;
}

export interface DrinksConfig {
  header_text: string;
  footer_text: string;
  display_mode: "rotate" | "single";
  auto_rotate_seconds: number;
  refresh_interval: number;
}

const DEFAULT_CONFIG: DrinksConfig = {
  header_text: "TODAY'S TOP DRINKS",
  footer_text: "■ ONLINE",
  display_mode: "rotate",
  auto_rotate_seconds: 10,
  refresh_interval: 60,
};

/** The synthetic sales_cache group guid the toast-sync writes for the whole-menu top-5.
 *  This is the Top Sellers slide's source of truth (docs/08 + Phase 8). */
export const OVERALL_GROUP = "MAIN_MENU_ALL";

/**
 * Dynamic item-name sizing (ported from legacy getItemNameFontSize), tuned for the 1080-wide
 * canvas. Shared by the /drinks board card AND the signage Top Sellers slide so a long name
 * shrinks identically on both surfaces (Phase 8 requirement).
 */
export function itemNameFont(name: string): number {
  const n = name.length;
  if (n <= 12) return 84;
  if (n <= 18) return 76;
  if (n <= 24) return 68;
  if (n <= 30) return 60;
  if (n <= 36) return 54;
  if (n <= 42) return 48;
  return 42;
}

/**
 * Shared sales_cache reader (Phase 8 extraction). ONE query + ONE realtime subscription
 * feeding both /drinks (per-group rotation) and the signage Top Sellers slide (overall).
 * Applies the POS-visibility gate exactly once (0034 / reviewer NOTE-2): the owner never
 * wants a product advertised unless it's active on the POS view, so any sales row whose
 * Toast item is explicitly pos_visible=false is dropped — matched by item_guid, or by name
 * for guid-less rows. Unknown items stay visible (mirrors 0034's default-true). Returns the
 * rows grouped by menu_group_guid (including the MAIN_MENU_ALL overall group).
 */
export function useSalesCache() {
  const qc = useQueryClient();

  const sales = useQuery({
    queryKey: ["drinks", "sales"],
    queryFn: async (): Promise<Record<string, DrinkItem[]>> => {
      const [salesRes, hiddenRes] = await Promise.all([
        supabase
          .from("sales_cache")
          .select("menu_group_guid, rank, item_guid, item_name, price, sales_count, sales_percentage, business_date")
          .eq("venue_id", VENUE_ID)
          .order("rank"),
        supabase
          .from("toast_menu_cache")
          .select("guid, name")
          .eq("venue_id", VENUE_ID)
          .eq("pos_visible", false),
      ]);
      if (salesRes.error) throw salesRes.error;
      const hidden = (hiddenRes.data ?? []) as { guid: string; name: string | null }[];
      const hiddenGuids = new Set(hidden.map((h) => h.guid));
      const hiddenNames = new Set(hidden.map((h) => String(h.name ?? "").trim().toLowerCase()));
      const rows = ((salesRes.data ?? []) as DrinkItem[]).filter(
        (r) =>
          r.item_guid
            ? !hiddenGuids.has(r.item_guid)
            : !hiddenNames.has(String(r.item_name).trim().toLowerCase()),
      );
      const byGroup: Record<string, DrinkItem[]> = {};
      for (const row of rows) {
        (byGroup[row.menu_group_guid] ??= []).push(row);
      }
      return byGroup;
    },
  });

  // Realtime: sales rows OR a POS-visibility flip re-render (no polling — ARCH-1). A hidden
  // item must drop off both the board and the Top Sellers slide (0034 / reviewer NOTE-2).
  useEffect(() => {
    const channel = supabase
      .channel("drinks:sales")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["drinks", "sales"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "toast_menu_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["drinks", "sales"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  return { byGroup: sales.data ?? {}, isLoading: sales.isLoading };
}

/**
 * The whole-menu top sellers (Top Sellers signage slide, Phase 8). Prefers the toast-sync's
 * MAIN_MENU_ALL rows; if that overall group isn't configured/populated, synthesizes an
 * overall list by merging every group's rows (dedupe by item, keeping the max count) so the
 * slide never goes blank just because the owner didn't enable an OVERALL group.
 */
export function useTopSellers(): { items: DrinkItem[]; loading: boolean } {
  const { byGroup, isLoading } = useSalesCache();
  return { items: overallTopSellers(byGroup), loading: isLoading };
}

/** Derive the overall top-5 from grouped sales (pure — unit-friendly). */
export function overallTopSellers(byGroup: Record<string, DrinkItem[]>, limit = 5): DrinkItem[] {
  // DECISION: the Top Sellers slide sources the toast-sync's MAIN_MENU_ALL rows (the owner has
  // "OVERALL TOP 5" enabled in drinks_menu_groups, so it's populated). toast-sync only writes
  // MAIN_MENU_ALL when it's a configured group, so rather than edit + redeploy the edge fn to
  // always write it, we fall back to a client-side merge across groups — the slide never blanks
  // even if that group is later disabled.
  const main = byGroup[OVERALL_GROUP];
  if (main && main.length) {
    return [...main].sort((a, b) => a.rank - b.rank).slice(0, limit);
  }
  // Fallback: merge across groups, dedupe by guid (or name), keep the highest count, re-rank.
  const merged = new Map<string, DrinkItem>();
  for (const [g, items] of Object.entries(byGroup)) {
    if (g === OVERALL_GROUP) continue;
    for (const it of items) {
      const key = (it.item_guid ?? it.item_name).toString().trim().toLowerCase();
      const prev = merged.get(key);
      if (!prev || it.sales_count > prev.sales_count) merged.set(key, it);
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.sales_count - a.sales_count)
    .slice(0, limit)
    .map((it, i) => ({ ...it, rank: i + 1 }));
}

/* ── SMART TOAST slides (0043) — durable per-day sales history ───────────────── */

/** A guid's summed units over the window, carrying the last-seen name (fallback label). */
export interface HistorySum {
  toast_guid: string;
  quantity: number;
  name: string | null;
  menu_group: string | null;
}

export interface SalesHistoryResult {
  /** guid → summed units over the last `days` (only guids that sold at least once appear). */
  sums: Map<string, HistorySum>;
  /** The TRUTHFUL window depth actually covered by the data, capped at `days` — so a
   *  CHAMPION slide can say "LAST 9 DAYS" when history only reaches back 9 days, never
   *  claiming a month it doesn't have. */
  trueDays: number;
  loading: boolean;
}

/**
 * Per-guid summed units over the last `days` business dates, via the SERVER-SIDE
 * `sales_history_totals` RPC (0044). The old client-side select truncated at PostgREST's 1000
 * -row cap — a 30-day window is >1000 rows, so the CHAMPION headline silently undercounted
 * (reviewer F1). The RPC aggregates in SQL over EXACTLY `days` business dates ending at the
 * CURRENT venue business date (tz + closeout computed server-side — F2), and returns the
 * window-global date_count so trueDays stays honest on shallow history. Anon read; no realtime
 * — a 60s poll (display-rules fallback-poll allowance). The template joins these sums to the
 * toast cache (names/photos/POS gate) itself; zero-sellers are handled there (roster-driven).
 */
export function useSalesHistory(days: number): SalesHistoryResult {
  const q = useQuery({
    queryKey: ["drinks", "history", days],
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ sums: Map<string, HistorySum>; trueDays: number }> => {
      const { data, error } = await supabase.rpc("sales_history_totals", { p_venue: VENUE_ID, p_days: days });
      if (error) throw error;
      const rows = (data ?? []) as { toast_guid: string; total_qty: number; first_date: string | null; date_count: number }[];
      const sums = new Map<string, HistorySum>();
      let dateCount = 0;
      for (const r of rows) {
        // name/menu_group are resolved from the toast cache in the template; the RPC returns
        // only totals (the CHAMPION picks the top guid present + POS-visible in the cache).
        sums.set(r.toast_guid, { toast_guid: r.toast_guid, quantity: Number(r.total_qty), name: null, menu_group: null });
        dateCount = r.date_count; // window-global — identical on every row
      }
      // Truthful depth = distinct business dates actually present in the window (F2), capped at
      // the requested days (the RPC window is already `days` dates, so this never exceeds it).
      const trueDays = Math.min(days, dateCount);
      return { sums, trueDays };
    },
  });
  return { sums: q.data?.sums ?? new Map(), trueDays: q.data?.trueDays ?? 0, loading: q.isLoading };
}

export function useDrinksBoard() {
  const qc = useQueryClient();

  const config = useQuery({
    queryKey: ["drinks", "config"],
    queryFn: async (): Promise<DrinksConfig> => {
      const { data, error } = await supabase
        .from("drinks_display_config")
        .select("header_text, footer_text, display_mode, auto_rotate_seconds, refresh_interval")
        .eq("venue_id", VENUE_ID)
        .maybeSingle();
      if (error) throw error;
      return (data as DrinksConfig | null) ?? DEFAULT_CONFIG;
    },
  });

  const groups = useQuery({
    queryKey: ["drinks", "groups"],
    queryFn: async (): Promise<DrinkGroup[]> => {
      const { data, error } = await supabase
        .from("drinks_menu_groups")
        .select("toast_menu_guid, name, display_order")
        .eq("venue_id", VENUE_ID)
        .eq("enabled", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as DrinkGroup[];
    },
  });

  // Sales + POS-visibility gate come from the shared reader (one query / one subscription).
  const { byGroup, isLoading: salesLoading } = useSalesCache();

  // Realtime for the board-only tables (sales + toast handled by useSalesCache above).
  useEffect(() => {
    const channel = supabase
      .channel("drinks:board")
      .on("postgres_changes", { event: "*", schema: "public", table: "drinks_menu_groups", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["drinks", "groups"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "drinks_display_config", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["drinks", "config"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  return {
    config: config.data ?? DEFAULT_CONFIG,
    groups: groups.data ?? [],
    sales: byGroup,
    loading: config.isLoading || groups.isLoading || salesLoading,
  };
}

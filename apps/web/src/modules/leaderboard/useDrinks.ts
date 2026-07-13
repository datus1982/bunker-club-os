import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

// Data layer for the /drinks board (docs/08). Pure realtime READER of the tables the
// scheduled toast-sync writes — the display never calls the edge function (AUTH-1 b).

export interface DrinkItem {
  menu_group_guid: string;
  rank: number;
  item_name: string;
  price: number;
  sales_count: number;
  sales_percentage: number;
  business_date: string;
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

  const sales = useQuery({
    queryKey: ["drinks", "sales"],
    queryFn: async (): Promise<Record<string, DrinkItem[]>> => {
      // POS-visibility gate (0034 / reviewer NOTE-2): the owner never wants a
      // product advertised unless it's active on the POS view. Fetch the sales
      // rows and the (small) set of explicitly POS-hidden Toast items in
      // parallel, then drop any sales row whose item is hidden — matching by
      // item_guid, or by name for guid-less rows. Unknown items stay visible,
      // mirroring 0034's default-true, so all-visible data renders identically.
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
      const rows = ((salesRes.data ?? []) as (DrinkItem & { item_guid: string | null })[]).filter(
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

  // Realtime: any change to the cache or config re-renders the board (no polling — ARCH-1).
  useEffect(() => {
    const channel = supabase
      .channel("drinks:board")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["drinks", "sales"] }))
      // POS-visibility flips live in toast_menu_cache — refresh so a hidden item
      // drops off the board (0034 / reviewer NOTE-2).
      .on("postgres_changes", { event: "*", schema: "public", table: "toast_menu_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["drinks", "sales"] }))
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
    sales: sales.data ?? {},
    loading: config.isLoading || groups.isLoading || sales.isLoading,
  };
}

import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Public menu data (docs/14) — reads the anon-safe `public_menu` view (0015), NEVER
 * the raw toast_menu_cache.description column (recipe safety: anon lost the column
 * grant in 0015). public_blurb is already the "text before ---" computed by the view;
 * it may be null (show nothing until a human writes a blurb). The ★ SCREENS group is
 * excluded by the view.
 *
 * DECISION: out-of-stock (86'd) items are HIDDEN from the public menu for cleanliness
 * — a bar's marketing menu shouldn't list what's gone. If hiding would empty a whole
 * group the group simply drops out (the page is empty-state tolerant).
 */

export interface MenuItem {
  guid: string;
  name: string;
  blurb: string | null;
  price: number | null;
  image: string | null;
}

export interface MenuGroup {
  group: string;
  items: MenuItem[];
}

// Section order for the menu, owner-configurable via the venue_settings
// `site_menu_group_order` key (seeded by migration 0031). Groups listed there
// render first in exact order; any group NOT listed (e.g. a brand-new Toast group)
// falls to the end, alphabetically — the menu never breaks on an unknown group.
//
// This constant is the FALLBACK (first-paint / offline / key-missing) and MUST
// byte-match the 0031 `site_menu_group_order` seed AND the live DB value — the
// same three-way invariant useSiteCopy holds for its keys. Cocktails-first is the
// owner's request (2026-07-13); names are the exact `menu_group` strings in the
// live toast_menu_cache. Update all three together.
const MENU_GROUP_ORDER_FALLBACK = [
  "Signature Cocktails",
  "Cocktail Features",
  "Winter Cocktails",
  "Classics",
  "Mocktails",
  "Shots",
  "Draft Beers",
  "Bottle / Cans",
  "N/A Beers",
  "Wine",
  "Whiskey / Bourbon / Rye",
  "Scotch",
  "Tequila",
  "Rum",
  "Vodka",
  "Gin",
  "Cordials",
  "Soft Drinks",
  "Food",
  "Merch",
];

function rankFn(order: string[]) {
  return (name: string): number => {
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };
}

export function useMenu() {
  return useQuery({
    queryKey: ["site-menu", VENUE_ID],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MenuGroup[]> => {
      // Pull the menu rows and the owner's group-order key in parallel (no waterfall).
      const [menuRes, orderRes] = await Promise.all([
        supabase
          .from("public_menu")
          .select('guid, "group", name, public_blurb, price, image, in_stock')
          .eq("venue_id", VENUE_ID),
        supabase
          .from("venue_settings")
          .select("value")
          .eq("venue_id", VENUE_ID)
          .eq("key", "site_menu_group_order")
          .maybeSingle(),
      ]);
      const { data, error } = menuRes;
      if (error) throw error;

      // Use the configured order when present + well-formed; else the fallback.
      const configured = orderRes.data?.value;
      const order =
        Array.isArray(configured) && configured.every((s) => typeof s === "string")
          ? (configured as string[])
          : MENU_GROUP_ORDER_FALLBACK;
      const groupRank = rankFn(order);

      type Row = {
        guid: string;
        group: string | null;
        name: string | null;
        public_blurb: string | null;
        price: number | null;
        image: string | null;
        in_stock: boolean;
      };

      const byGroup = new Map<string, MenuItem[]>();
      for (const r of (data ?? []) as Row[]) {
        if (!r.in_stock) continue; // DECISION: hide 86'd items.
        if (!r.name) continue;
        const g = r.group?.trim() || "Other";
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push({
          guid: r.guid,
          name: r.name,
          blurb: r.public_blurb,
          price: r.price,
          image: r.image,
        });
      }

      const groups: MenuGroup[] = [...byGroup.entries()].map(([group, items]) => ({
        group,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));

      groups.sort((a, b) => {
        const r = groupRank(a.group) - groupRank(b.group);
        return r !== 0 ? r : a.group.localeCompare(b.group);
      });
      return groups;
    },
  });
}

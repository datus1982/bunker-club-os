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

// Preferred section order for a bar menu (drinks first, then spirits, then food/merch).
// Groups not listed here fall to the end, alphabetically — new Toast groups never break.
const GROUP_ORDER = [
  "Draft Beers",
  "Bottle / Cans",
  "N/A Beers",
  "Signature Cocktails",
  "Cocktail Features",
  "Winter Cocktails",
  "Classics",
  "Mocktails",
  "Shots",
  "Whiskey / Bourbon / Rye",
  "Scotch",
  "Tequila",
  "Rum",
  "Vodka",
  "Gin",
  "Cordials",
  "Wine",
  "Soft Drinks",
  "Food",
  "Merch",
];

function groupRank(name: string): number {
  const i = GROUP_ORDER.indexOf(name);
  return i === -1 ? GROUP_ORDER.length : i;
}

export function useMenu() {
  return useQuery({
    queryKey: ["site-menu", VENUE_ID],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MenuGroup[]> => {
      const { data, error } = await supabase
        .from("public_menu")
        .select('guid, "group", name, public_blurb, price, image, in_stock')
        .eq("venue_id", VENUE_ID);
      if (error) throw error;

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

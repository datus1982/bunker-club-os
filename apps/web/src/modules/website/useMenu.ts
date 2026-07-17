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

/** One pour-size option (0050) — a display label + dollar price, ascending by price.
 *  Public by construction (the sync drops internal fractional builds). */
export interface PriceOption {
  label: string;
  price: number;
}

export interface MenuItem {
  guid: string;
  name: string;
  blurb: string | null;
  /** Owner-authored long-form (0048) — text after `--- recipe |`. Recipe never reaches us.
   *  Purely additive: rendered as a softer paragraph under the short blurb when present. */
  longBlurb: string | null;
  price: number | null;
  /** Pour-size options (0050) for $0-base liquor/draft items — SHOT/COCKTAIL/DOUBLE,
   *  PINT/PITCHER, etc. When present, rendered IN PLACE of the single price. null = none. */
  priceOptions: PriceOption[] | null;
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
// same three-way invariant useSiteCopy holds for its keys. Owner reorder
// (2026-07-13); names are the exact `menu_group` strings in the live
// toast_menu_cache. "Winter Cocktails" is deliberately unlisted — it is POS-hidden
// in Toast, so the pos_visible gate on public_menu keeps it off /menu regardless of
// order (gate added in 0034, accidentally dropped by 0040/0048, restored by 0049).
// Update all three together.
const MENU_GROUP_ORDER_FALLBACK = [
  "Signature Cocktails",
  "Cocktail Features",
  "Mocktails",
  "Draft Beers",
  "Vodka",
  "Gin",
  "Rum",
  "Classics",
  "Shots",
  "N/A Beers",
  "Bottle / Cans",
  "Wine",
  "Whiskey / Bourbon / Rye",
  "Scotch",
  "Tequila",
  "Cordials",
  "Soft Drinks",
  "Food",
  "Merch",
];

// GUIDs of toast_menu_cache items to suppress from the public /menu — POS
// register-convenience rows (e.g. a "Sputnik 1/2 off" priced-down duplicate) that
// are real menu items but shouldn't be marketed publicly. Owner-configurable via
// the venue_settings `site_menu_hidden_guids` key (seeded by migration 0033).
//
// This constant is the FALLBACK (first-paint / offline / key-missing) and MUST
// byte-match the 0033 `site_menu_hidden_guids` seed AND the live DB value — the
// same three-way invariant the group-order list holds. Update all three together.
//
// NOTE: this only affects the public /menu. The drinks display board reads
// sales_cache top-sellers via a different path and does NOT consult this list, so
// a hidden item that is also a top seller would still appear there (future owner call).
const MENU_HIDDEN_GUIDS_FALLBACK = ["fa3603be-0965-42d0-9cca-6e0708cce1f0"];

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
      // Pull the menu rows, the owner's group-order key, and the hidden-guids key
      // in parallel (no waterfall).
      const [menuRes, orderRes, hiddenRes] = await Promise.all([
        supabase
          .from("public_menu")
          .select('guid, "group", name, public_blurb, long_blurb, price, price_options, image, in_stock')
          .eq("venue_id", VENUE_ID),
        supabase
          .from("venue_settings")
          .select("value")
          .eq("venue_id", VENUE_ID)
          .eq("key", "site_menu_group_order")
          .maybeSingle(),
        supabase
          .from("venue_settings")
          .select("value")
          .eq("venue_id", VENUE_ID)
          .eq("key", "site_menu_hidden_guids")
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

      // GUIDs to suppress from the public menu. Defensive: a missing or malformed
      // key means NO filtering (never crash, never over-hide) — fall back to the
      // constant only when the key is entirely absent, and to no-op when present
      // but the wrong shape.
      const hiddenRaw = hiddenRes.data?.value;
      const hidden = new Set<string>(
        hiddenRes.data === null
          ? MENU_HIDDEN_GUIDS_FALLBACK
          : Array.isArray(hiddenRaw)
            ? hiddenRaw.filter((s): s is string => typeof s === "string")
            : [],
      );

      type Row = {
        guid: string;
        group: string | null;
        name: string | null;
        public_blurb: string | null;
        long_blurb: string | null;
        price: number | null;
        price_options: PriceOption[] | null;
        image: string | null;
        in_stock: boolean;
      };

      // Defensive: only accept well-formed {label:string, price:number} entries; a malformed
      // price_options never crashes the row (falls back to the single price / hide-$0 path).
      const cleanOptions = (raw: PriceOption[] | null): PriceOption[] | null => {
        if (!Array.isArray(raw)) return null;
        const ok = raw.filter(
          (o): o is PriceOption =>
            !!o && typeof o.label === "string" && o.label.length > 0 && typeof o.price === "number",
        );
        return ok.length > 0 ? ok : null;
      };

      const byGroup = new Map<string, MenuItem[]>();
      for (const r of (data ?? []) as Row[]) {
        if (hidden.has(r.guid)) continue; // owner-hidden POS-convenience item (0033).
        if (!r.in_stock) continue; // DECISION: hide 86'd items.
        if (!r.name) continue;
        const g = r.group?.trim() || "Other";
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push({
          guid: r.guid,
          name: r.name,
          blurb: r.public_blurb,
          longBlurb: r.long_blurb,
          price: r.price,
          priceOptions: cleanOptions(r.price_options),
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

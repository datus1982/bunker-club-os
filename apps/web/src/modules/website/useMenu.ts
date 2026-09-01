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

// ── ORDER: Toast is the single source (0064, owner ask 2026-09-01) ───────────
// The owner arranges his menus, groups and items in Toast; /menu mirrors that layout
// exactly. THE WEBSITE CARRIES NO ORDER OF ITS OWN — there is no list to maintain here,
// no venue_settings key to keep in sync, and no session needed when he adds a group.
//
// toast-menu-sync (v10) stamps every cached item with where it sat in the Toast walk:
//   group_position — global, monotonic, groups in Toast's order (sub-groups follow parents);
//   item_position  — the item's index inside its group.
// Both surface through public_menu (0064). A group is ranked by the MINIMUM group_position
// of its surviving items, so a group keeps its place even when its first item is 86'd or
// POS-hidden. Nulls (unknown / not yet synced) sort LAST and tiebreak by name, so a stale or
// half-synced cache degrades to the old alphabetical behaviour instead of scrambling.
//
// Replaced the `site_menu_group_order` venue_settings key + its byte-matching constant
// (0031, retired) — that pair is exactly the hand-off the owner asked to be rid of.

// Rank helper: nulls (and non-finite values) sort after every real position.
const NO_POSITION = Number.POSITIVE_INFINITY;
function rank(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NO_POSITION;
}

// GUIDs of toast_menu_cache items to suppress from the public /menu — POS
// register-convenience rows (e.g. a "Sputnik 1/2 off" priced-down duplicate) that
// are real menu items but shouldn't be marketed publicly. Owner-configurable via
// the venue_settings `site_menu_hidden_guids` key (seeded by migration 0033).
//
// This constant is the FALLBACK (first-paint / offline / key-missing) and MUST
// byte-match the 0033 `site_menu_hidden_guids` seed AND the live DB value.
// Update all three together.
//
// NOTE: this only affects the public /menu. The drinks display board reads
// sales_cache top-sellers via a different path and does NOT consult this list, so
// a hidden item that is also a top seller would still appear there (future owner call).
const MENU_HIDDEN_GUIDS_FALLBACK = ["fa3603be-0965-42d0-9cca-6e0708cce1f0"];

export function useMenu() {
  return useQuery({
    queryKey: ["site-menu", VENUE_ID],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MenuGroup[]> => {
      // Pull the menu rows and the hidden-guids key in parallel (no waterfall).
      const [menuRes, hiddenRes] = await Promise.all([
        supabase
          .from("public_menu")
          .select(
            'guid, "group", name, public_blurb, long_blurb, price, price_options, image, in_stock, group_position, item_position',
          )
          .eq("venue_id", VENUE_ID),
        supabase
          .from("venue_settings")
          .select("value")
          .eq("venue_id", VENUE_ID)
          .eq("key", "site_menu_hidden_guids")
          .maybeSingle(),
      ]);
      const { data, error } = menuRes;
      if (error) throw error;

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
        group_position: number | null;
        item_position: number | null;
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

      // Item + its Toast position, kept side by side so the sort can read the position
      // without leaking it into the public MenuItem shape.
      type Placed = { item: MenuItem; itemPos: number };

      const byGroup = new Map<string, Placed[]>();
      // Lowest group_position seen per group name — the group's rank on the page.
      const groupRank = new Map<string, number>();

      for (const r of (data ?? []) as Row[]) {
        if (hidden.has(r.guid)) continue; // owner-hidden POS-convenience item (0033).
        if (!r.in_stock) continue; // DECISION: hide 86'd items.
        if (!r.name) continue;
        const g = r.group?.trim() || "Other";
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push({
          itemPos: rank(r.item_position),
          item: {
            guid: r.guid,
            name: r.name,
            blurb: r.public_blurb,
            longBlurb: r.long_blurb,
            price: r.price,
            priceOptions: cleanOptions(r.price_options),
            image: r.image,
          },
        });
        // A group ranks by its EARLIEST surviving item, so 86'd/hidden rows can't
        // push a whole section down the page.
        const gp = rank(r.group_position);
        const seen = groupRank.get(g);
        if (seen === undefined || gp < seen) groupRank.set(g, gp);
      }

      const groups: MenuGroup[] = [...byGroup.entries()].map(([group, placed]) => ({
        group,
        items: placed
          .slice()
          .sort((a, b) =>
            a.itemPos !== b.itemPos
              ? a.itemPos - b.itemPos
              : a.item.name.localeCompare(b.item.name),
          )
          .map((p) => p.item),
      }));

      groups.sort((a, b) => {
        const ra = groupRank.get(a.group) ?? NO_POSITION;
        const rb = groupRank.get(b.group) ?? NO_POSITION;
        return ra !== rb ? ra - rb : a.group.localeCompare(b.group);
      });
      return groups;
    },
  });
}

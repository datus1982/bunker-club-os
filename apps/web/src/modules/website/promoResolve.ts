import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Shared resolver for website promo cards sourced from `signage_items`.
 *
 * A signage item flagged 🌐 SHOW ON WEBSITE may be a Toast-sourced `drink_special`
 * whose display copy lives LIVE in Toast, not in the item — its `fields` carry only
 * `source_toast_guid` (+ optional manual overrides / ingredients / flourish). To render
 * such a card the site must resolve that guid through `public_menu` (the anon-safe,
 * POS-visibility-gated view — the correct public surface, same one /menu reads), never
 * the raw `toast_menu_cache`.
 *
 * POS principle for the website: a guid that is off-POS is already excluded from the
 * view, and we additionally drop 86'd (in_stock=false) rows here — so a sold-out or
 * hidden drink is simply ABSENT from the returned map. Callers treat "guid set but
 * absent from map" as "skip this promo entirely".
 *
 * All reads degrade to an empty map on error — never throw the page.
 */

export interface ResolvedMenu {
  guid: string;
  name: string | null;
  public_blurb: string | null;
  price: number | null;
  /** Ready-to-use image URL (public_menu.image = image_storage_path ?? image_url). */
  image: string | null;
  group: string | null;
}

/** Fetch `public_menu` rows for the given Toast GUIDs in ONE query. Returns a
 *  guid→row map; a guid absent from the map means "off-POS or 86'd — skip it". */
export async function fetchPromoMenu(
  guids: Array<string | null | undefined>,
): Promise<Map<string, ResolvedMenu>> {
  const map = new Map<string, ResolvedMenu>();
  const unique = [
    ...new Set(guids.filter((g): g is string => typeof g === "string" && g.trim() !== "")),
  ];
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from("public_menu")
    .select('guid, "group", name, public_blurb, price, image, in_stock')
    .eq("venue_id", VENUE_ID)
    .in("guid", unique);
  if (error) return map; // degrade — never throw the page.

  for (const r of (data ?? []) as Array<ResolvedMenu & { in_stock: boolean }>) {
    if (!r.in_stock) continue; // 86'd: treat as absent (POS principle applies to the site).
    map.set(r.guid, {
      guid: r.guid,
      name: r.name,
      public_blurb: r.public_blurb,
      price: r.price,
      image: r.image,
      group: r.group,
    });
  }
  return map;
}

/** Whole-dollar prices render without cents ("$6"), fractional with two decimals ("$6.50"). */
function fmtPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/** Fallback body line for a Toast-sourced drink promo, e.g. "$10 — Signature Cocktails".
 *  Uses whatever of price / group is present; undefined when neither is. */
export function priceLine(price: number | null, group: string | null): string | undefined {
  const p = price != null && price > 0 ? `$${fmtPrice(price)}` : undefined;
  const g = group?.trim() || undefined;
  if (p && g) return `${p} — ${g}`;
  return p ?? g ?? undefined;
}

/** Read a trimmed non-empty string field from a signage item's `fields` blob. */
export function fieldStr(fields: unknown, keys: string[]): string | undefined {
  if (!fields || typeof fields !== "object") return undefined;
  const f = fields as Record<string, unknown>;
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

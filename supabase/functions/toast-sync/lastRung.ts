// lastRung.ts — the NOW POURING ticker's "last item rung in" derivation for toast-sync.
//
// Pure & dependency-free so it runs under both Deno (the edge function) and Node/tsx (the unit
// test in scripts/test-last-rung.ts). House pattern: businessDate.ts / eventCounter.ts /
// selectionCounts.ts precedent.
//
// DISPLAY SEMANTICS ONLY. Nothing here touches sales tallies — sales_cache / sales_history /
// event counters are entirely unaffected by this module (see the "KEEPS crediting the rung item
// only" note at the call site in index.ts). This decides ONE string: what the ticker says.
//
// Exclusions, in the order they were added:
//   1. POS-HIDDEN items (pos_visible=false) — the standing owner principle "never advertise
//      anything not active on the POS view". Matched by guid AND by name.
//   2. EXCLUDED MENU GROUPS (venue_settings.signage_rung_excluded_groups, seeded
//      ["Food","Merch","Soft Drinks"]) — "NOW POURING: Hot Dog" is wrong on a drinks ticker, and
//      a rung soda water is not a pour. Matched by GUID only, resolved from
//      toast_menu_cache.menu_group; an item guid absent from the cache keeps the prior behavior
//      (not excluded / fail-open).
//   3. 86'D ITEMS (v10) — folded into the SAME `excludedGroupGuids` set by the caller via
//      rankFilter.blockedGuids(), so this function needed no change. See rankFilter.ts for the
//      owner ruling ("86'd = not advertised in ANY way") and the fail-open contract.
// An excluded selection is SKIPPED and the walk keeps looking at earlier selections, exactly the
// way the pos_visible exclusion already worked.

// ── Toast order shapes (the subset this module reads) ────────────────────────
export interface RungSelection {
  item?: { guid: string } | null;
  displayName?: string | null;
  voided?: boolean | null;
}
export interface RungOrder {
  checks?: { selections?: RungSelection[] | null; voided?: boolean | null }[] | null;
  excessFood?: boolean | null;
  openedDate?: string | null; // ISO 8601
  voided?: boolean | null;
}

export interface LastRung { name: string; at: string }

/**
 * The most recent non-voided, non-excluded selection by order openedDate for the business date,
 * so the signage ticker can say "◆ NOW POURING: {name}" = literally the last thing rung in.
 * Returns { name, at } (at = the order's openedDate ISO) or null when nothing qualifies (the
 * caller then leaves the prior value untouched — the reader ages it out at 90 min).
 */
export function computeLastRung(
  orders: RungOrder[],
  hiddenGuids: Set<string>,
  hiddenNames: Set<string>,
  excludedGroupGuids: Set<string> = new Set(),
): LastRung | null {
  let best: { openedMs: number; name: string; at: string } | null = null;
  for (const order of orders) {
    if (order.voided || order.excessFood) continue;
    const at = order.openedDate ?? "";
    const openedMs = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(openedMs)) continue;
    for (const check of order.checks ?? []) {
      if (check.voided) continue;
      for (const sel of check.selections ?? []) {
        if (sel.voided || !sel.item) continue;
        const name = (sel.displayName ?? "").trim();
        if (!name) continue;
        if ((sel.item.guid && hiddenGuids.has(sel.item.guid)) || hiddenNames.has(name.toLowerCase())) continue;
        // Excluded menu groups (Food / Merch): skip and keep walking earlier selections.
        if (sel.item.guid && excludedGroupGuids.has(sel.item.guid)) continue;
        // Latest order wins; within the same order (equal openedMs) the LAST selection wins.
        if (!best || openedMs >= best.openedMs) best = { openedMs, name, at };
      }
    }
  }
  return best ? { name: best.name, at: best.at } : null;
}

/**
 * venue_settings.signage_rung_excluded_groups → a set of normalized (trimmed, lowercased) menu
 * group names. Accepts a jsonb array of strings, or a JSON string containing one. ANY other
 * shape (missing key, null, object, number, malformed JSON) FAILS OPEN to an empty set = the
 * pre-filter behavior. Non-string / blank entries inside an array are ignored.
 */
export function parseExcludedGroups(value: unknown): Set<string> {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return new Set();
    }
  }
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const norm = entry.trim().toLowerCase();
    if (norm) out.add(norm);
  }
  return out;
}

/**
 * toast_menu_cache rows + excluded group names → the set of item GUIDs to skip. Group match is
 * case-insensitive on the trimmed name. Empty exclusion set ⇒ empty result (no work, no change).
 */
export function excludedGuidsForGroups(
  rows: { guid: string; menu_group?: string | null }[],
  excludedGroups: Set<string>,
): Set<string> {
  const out = new Set<string>();
  if (excludedGroups.size === 0) return out;
  for (const r of rows) {
    if (!r?.guid) continue;
    const g = (r.menu_group ?? "").trim().toLowerCase();
    if (g && excludedGroups.has(g)) out.add(r.guid);
  }
  return out;
}

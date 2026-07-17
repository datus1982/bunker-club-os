// selectionCounts.ts — the ONE per-selection counting core for toast-sync (cross-ring arc).
//
// Pure & dependency-free so it runs under both Deno (the edge function) and Node/tsx (the unit
// test in scripts/test-selection-counts.ts). House pattern: businessDate.ts / eventCounter.ts /
// menuText precedent.
//
// WHY THIS EXISTS ─────────────────────────────────────────────────────────────
// The bar's post-restructure Toast menu lets a cocktail be rung TWO ways:
//   (path 1) the COCKTAIL item + a liquor-upgrade modifier ("Old Fashioned" + "Knob Creek"), or
//   (path 2) the LIQUOR item + a cocktail modifier ("Knob Creek" + "Old Fashioned" from a
//            "Cocktail Mods" modifier group).
// Every counting surface used to credit ONLY the rung item, so a path-2 ring made the cocktail
// vanish from top sellers / underdogs / champion / event counters.
//
// FIX — symmetric, modifier-aware counting. For each non-voided selection we credit:
//   • the RUNG ITEM (as before), AND
//   • every MODIFIER whose normalized name EXACTLY matches a sellable item in toast_menu_cache
//     (case-insensitive, trimmed), OR whose own guid IS a sellable item guid (item-backed
//     mixers, e.g. SPRITE — the guid-equal fast path).
// So path 1 credits {OF, KC} and path 2 credits {KC, OF} — IDENTICAL tallies, the owner's goal.
// It also correctly credits item-backed mixers (a SPRITE modifier → Sprite) and liquor
// upgrades toward the liquor's own tally.
//
// The credited item's DISPLAY metadata (name / price / menu group) is resolved by the CALLER
// (index.ts) — rung credits keep using the selection's own name/price/group (byte-identical to
// the pre-arc output); modifier credits resolve name/price/group from toast_menu_cache. This
// module only decides WHAT guids a selection credits and by how much.

// ── Toast order shapes (the subset we read) ──────────────────────────────────
export interface CountModifier {
  item?: { guid?: string | null } | null;
  displayName?: string | null;
  quantity?: number | null;
  voided?: boolean | null;
  // Toast can nest modifiers-of-modifiers; we walk ONE level deep (see creditsForSelection).
  modifiers?: CountModifier[] | null;
}
export interface CountSelection {
  item?: { guid?: string | null } | null;
  itemGroup?: { guid?: string | null; name?: string | null } | null;
  displayName?: string | null;
  receiptLinePrice?: number | null;
  quantity?: number | null;
  voided?: boolean | null;
  modifiers?: CountModifier[] | null;
}

/** A single credit produced by a selection. `source` lets the caller pick the metadata origin:
 *  "item" → the selection's own name/price/group; "modifier" → the matched item's cache row. */
export interface Credit {
  guid: string;
  qty: number;
  source: "item" | "modifier";
}

// ── name map (built from toast_menu_cache: guid + name) ───────────────────────
export interface NameMap {
  /** normalized item name → item guid (names shared by ≥2 items are EXCLUDED — see `ambiguous`). */
  byName: Map<string, string>;
  /** every sellable item guid (the guid-equal fast path for item-backed mixer modifiers). */
  guids: Set<string>;
  /** normalized names dropped because two+ cache items share them (never guess — logged once/run). */
  ambiguous: Set<string>;
}

/** Trim + lowercase, the single normalization used for every name comparison. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Build the name→guid map from toast_menu_cache rows (`select guid, name`). Ambiguity guard:
 * if two DISTINCT guids share a normalized name, that name is excluded from `byName` and
 * recorded in `ambiguous` (the caller logs it once per run) — we never guess which item a
 * modifier meant. Rows with a blank name contribute their guid to `guids` (fast-path only).
 */
export function buildNameMap(rows: { guid: string; name: string | null }[]): NameMap {
  const guids = new Set<string>();
  const firstGuidFor = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const r of rows) {
    if (!r.guid) continue;
    guids.add(r.guid);
    const n = normalizeName(r.name);
    if (!n) continue;
    const prev = firstGuidFor.get(n);
    if (prev === undefined) firstGuidFor.set(n, r.guid);
    else if (prev !== r.guid) ambiguous.add(n); // two different items, same name → ambiguous
  }
  const byName = new Map<string, string>();
  for (const [n, guid] of firstGuidFor) {
    if (!ambiguous.has(n)) byName.set(n, guid);
  }
  return { byName, guids, ambiguous };
}

/** An empty name map — modifiers never match (used where cross-ring matching isn't wanted). */
export function emptyNameMap(): NameMap {
  return { byName: new Map(), guids: new Set(), ambiguous: new Set() };
}

// ── the counting core ─────────────────────────────────────────────────────────
/** Resolve a single modifier to a sellable item guid, or null when it isn't an item
 *  (pour sizes ".25oz", "Dirty", garnishes, etc. never match). Guid-equal fast path first,
 *  then exact normalized name against the (ambiguity-filtered) cache map. */
function matchModifier(mod: CountModifier, nameMap: NameMap): string | null {
  const g = mod.item?.guid ?? null;
  if (g && nameMap.guids.has(g)) return g; // item-backed mixer (modifier guid === item guid)
  const n = normalizeName(mod.displayName);
  if (n && nameMap.byName.has(n)) return nameMap.byName.get(n)!;
  return null;
}

function walkModifiers(
  mods: CountModifier[] | null | undefined,
  parentQty: number,
  nameMap: NameMap,
  out: Credit[],
  depthLeft: number,
): void {
  for (const mod of mods ?? []) {
    if (!mod || mod.voided) continue;
    const modQty = mod.quantity || 1; // 0/undefined → 1 (mirrors selection qty convention)
    const qty = parentQty * modQty;
    const guid = matchModifier(mod, nameMap);
    if (guid) out.push({ guid, qty, source: "modifier" });
    // Nested modifiers-of-modifiers: ONE level deep only, same rules, qty compounds.
    if (depthLeft > 0) walkModifiers(mod.modifiers, qty, nameMap, out, depthLeft - 1);
  }
}

/**
 * Credits for one selection: the rung item (unconditional when present, byte-identical to the
 * pre-arc counters) plus every item-matched modifier. A voided selection credits nothing.
 * Caller is responsible for order/check void gating and the excessFood skip (this module can't
 * see them). Returned credits may repeat a guid (e.g. an item credited both as the rung item and
 * as a modifier) — callers sum quantities, so duplicates are correct, not double-counting.
 *
 * Modifier quantity × selection quantity applies. Nested modifiers are walked ONE level deep.
 */
export function creditsForSelection(sel: CountSelection, nameMap: NameMap): Credit[] {
  const out: Credit[] = [];
  if (!sel || sel.voided) return out;
  const selQty = sel.quantity || 1;
  const itemGuid = sel.item?.guid ?? null;
  if (itemGuid) out.push({ guid: itemGuid, qty: selQty, source: "item" });
  walkModifiers(sel.modifiers, selQty, nameMap, out, 1);
  return out;
}

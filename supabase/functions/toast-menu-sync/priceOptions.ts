// priceOptions.ts — pour-size price options for the public menu (owner ask 2026-07-17).
//
// The owner's liquor/draft items carry a $0 BASE_PRICE and expose their real prices as
// options inside a "Size"/"Tier"/"Pour" modifier group (Menus V2). Today those items show
// NO price on bunkerokc.com/menu. This module turns that group into a compact, public-safe
// options row, e.g.  SHOT $7 · COCKTAIL $8 · DOUBLE $9  (drafts: PINT $5 · PITCHER $18).
//
// Pure + dependency-free so it runs under Deno (the edge fn) and Node/tsx (the unit test),
// exactly like menuText.ts. All Toast payload access is passed in as plain maps; no I/O.
//
// ── Two menu shapes, one extractor ───────────────────────────────────────────
// Today: ~120 PER-ITEM groups named "Size"/"Size <brand>"/"Pour Size", each referenced by
// a single item. The owner is about to RESTRUCTURE to SHARED tier groups (names likely
// containing "Tier") applied to many bottles at once — and during the transition an item may
// briefly reference BOTH its old per-item group and a new shared one. The multi-group rule
// below (prefer the group used by MORE items venue-wide) makes the shared tier win without any
// code change, and never merges two groups' options.
//
// ── Recipe/build safety ──────────────────────────────────────────────────────
// The size groups also carry INTERNAL fractional builds (.25oz / .5oz / .75oz / .75) used for
// splitting pours — these are NOT menu prices and MUST NOT display. They are excluded by the
// label rule (any option whose name starts with a leading-decimal fraction). A whole-number
// pour like `1.5oz` (Blantons, no parenthetical) is a real size and DOES display (as `1.5OZ`).

export interface PriceOption {
  label: string;
  price: number;
}

// Raw Menus V2 shapes (only the fields we read). The root payload carries two maps —
// `modifierGroupReferences` and `modifierOptionReferences` — keyed by stringified refId.
export interface RawModifierOption {
  name?: string | null;
  price?: number | null;
}
export interface RawModifierGroup {
  name?: string | null;
  // refIds into the modifierOptionReferences map (Menus V2). Numbers in the payload.
  modifierOptionReferences?: Array<number | string> | null;
}

// Candidate size/tier/pour group: matched purely by NAME so it works for the per-item "Size"
// groups today AND the shared "Tier N" groups the owner is about to build. A mixer/garnish/
// cocktail-mods group (none contain size|tier|pour) is never a candidate.
const SIZE_GROUP_RE = /size|tier|pour/i;

export function isSizeGroupName(name: string | null | undefined): boolean {
  return typeof name === "string" && SIZE_GROUP_RE.test(name);
}

/**
 * Display label for one option, or null to EXCLUDE it. Rules (in order):
 *   1. A parenthesized word/phrase wins — `1oz (Shot)` → SHOT, `16oz (Pint)` → PINT,
 *      `1oz (shot)` → SHOT (case-insensitive), trimmed + uppercased.
 *   2. A name starting with a LEADING-DECIMAL fraction (`.25oz`, `.5oz`, `.75oz`, `.75`,
 *      `0.5oz`) is an internal build price → EXCLUDE (return null).
 *   3. Otherwise display the name itself, uppercased — `Pint` → PINT, `Pitcher` → PITCHER,
 *      `Sugar Free` → SUGAR FREE, `Double` → DOUBLE, and a whole-number pour like Blantons'
 *      bare `1.5oz` → `1.5OZ` (acceptable — it starts with a whole digit, not a leading `.`).
 */
export function deriveOptionLabel(rawName: string | null | undefined): string | null {
  const name = (rawName ?? "").trim();
  if (!name) return null;
  // 1. Parenthesized descriptor wins.
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) {
    const inner = paren[1].trim();
    return inner ? inner.toUpperCase() : null;
  }
  // 2. Leading-decimal fraction (.25oz / .5oz / .75 / 0.5oz) = internal build → exclude.
  if (/^0?\.\d/.test(name)) return null;
  // 3. Display the name itself, uppercased.
  return name.toUpperCase();
}

/**
 * Count, per group refId, how many DISTINCT items reference it venue-wide. Feeds the
 * multi-group tiebreak in extractPriceOptions (shared tier beats legacy per-item group).
 * Pass one entry per item — its modifierGroupReferences list. An item that lists the same
 * group twice is counted once for that group.
 */
export function buildGroupUsage(
  itemGroupRefLists: Iterable<Array<number | string> | null | undefined>,
): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const refs of itemGroupRefLists) {
    const seen = new Set<string>();
    for (const r of refs ?? []) {
      const k = String(r);
      if (seen.has(k)) continue;
      seen.add(k);
      usage[k] = (usage[k] ?? 0) + 1;
    }
  }
  return usage;
}

export interface ExtractInput {
  /** item.modifierGroupReferences — the groups THIS item references. */
  groupRefIds: Array<number | string> | null | undefined;
  /** Root payload map: refId → group. */
  groupRefs: Record<string, RawModifierGroup>;
  /** Root payload map: refId → option. */
  optionRefs: Record<string, RawModifierOption>;
  /** Venue-wide group usage counts (buildGroupUsage). */
  usage: Record<string, number>;
}

/**
 * Extract the public price-options row for one item, or null when there is none.
 *
 * Steps:
 *   - Candidate groups = this item's referenced groups whose NAME matches size|tier|pour.
 *   - Choose ONE group: the candidate referenced by MORE items venue-wide (shared tier beats
 *     a legacy per-item group); tiebreak by ref id ascending for determinism. Never merge.
 *   - Within the chosen group: derive labels (excluding internal fractional builds), drop
 *     options with no meaningful price, dedupe by normalized label (first wins), sort by price.
 *   - Empty result → null.
 */
export function extractPriceOptions(input: ExtractInput): PriceOption[] | null {
  const { groupRefIds, groupRefs, optionRefs, usage } = input;
  if (!groupRefIds || groupRefIds.length === 0) return null;

  // Candidate groups referenced by this item (deduped, name-matched).
  const candidateKeys: string[] = [];
  const seenGroup = new Set<string>();
  for (const r of groupRefIds) {
    const k = String(r);
    if (seenGroup.has(k)) continue;
    seenGroup.add(k);
    const g = groupRefs[k];
    if (g && isSizeGroupName(g.name)) candidateKeys.push(k);
  }
  if (candidateKeys.length === 0) return null;

  // Choose one: most venue-wide usage, then lowest ref id (numeric, then string) — a stable,
  // deterministic pick that resolves the transition case (many-bottle shared tier > per-item).
  candidateKeys.sort((a, b) => {
    const ua = usage[a] ?? 0;
    const ub = usage[b] ?? 0;
    if (ua !== ub) return ub - ua;
    return compareRefId(a, b);
  });
  const group = groupRefs[candidateKeys[0]];

  const options: PriceOption[] = [];
  const labelSeen = new Set<string>();
  for (const optRef of group.modifierOptionReferences ?? []) {
    const opt = optionRefs[String(optRef)];
    if (!opt) continue;
    const label = deriveOptionLabel(opt.name);
    if (!label) continue; // internal fractional build, or empty name
    const price = opt.price;
    // DECISION: exclude options with no meaningful price — null/absent/non-finite OR <= 0. The
    // contract names "null/absent"; $0 is treated the same because a $0 pour is never a real
    // advertised price (the only observed $0 group, "Pour Size" ref 464, is a decoy the
    // multi-group tiebreak already discards). Guards against a "SHOT $0" render. All real pour
    // prices are > 0, so no live row is affected.
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    if (labelSeen.has(label)) continue; // dedupe by normalized label, first occurrence wins
    labelSeen.add(label);
    options.push({ label, price });
  }
  if (options.length === 0) return null;
  options.sort((a, b) => a.price - b.price);
  return options;
}

// Compare two refId strings: numeric when both parse, else lexicographic — total + stable.
function compareRefId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

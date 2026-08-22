/**
 * rankGates.ts — the DISPLAY-side half of the ranked-surface gates (owner rulings, PR #93).
 *
 * Pure, dependency-free (no react, no supabase, no `@/` alias) so the unit test can import it
 * directly under tsx — the scheduleResolve.ts / audioVerdict.ts house pattern.
 *
 * WHY A SECOND COPY. The edge function enforces these gates at WRITE time for `sales_cache`
 * (supabase/functions/toast-sync/rankFilter.ts), which covers every surface that reads that table
 * — the top_sellers slide, the CHAMPION's live top-3 strip, the legacy /drinks board and the
 * website TOP SELLERS card — and it re-ranks so the lists close ranks instead of leaving holes.
 * But two surfaces do NOT read sales_cache:
 *
 *   • CHAMPION's headline item comes from `sales_history` via the sales_history_totals RPC (0044).
 *     History is the durable tally and is deliberately NEVER filtered — an 86'd item keeps
 *     accruing its true count. So the gate has to be applied where the champion is CHOSEN.
 *   • UNDERDOGS' roster comes from the toast_menu_cache map, not from sales.
 *
 * Those two are gated here, at their own read/render seam. This is a deliberate port of the
 * fail-open contract in toast-sync/lastRung.ts + rankFilter.ts, not a shared import: the edge
 * function runs under Deno and is outside the Vite root. Same documented-copy precedent as the
 * venue business-date/closeout rule (edge fn + 0044 SQL + client). If these two ever disagree,
 * rankFilter.ts is the authority.
 *
 * FAIL-OPEN THROUGHOUT: unknown ⇒ show. A missing or malformed settings value yields an empty
 * set, which restores the pre-gate behavior exactly — a config outage can never blank a board.
 */

/**
 * venue_settings.signage_rank_excluded_groups → a set of normalized (trimmed, lowercased) menu
 * group names. Accepts a jsonb array of strings, or a JSON string containing one. ANY other shape
 * (missing key, null, object, number, malformed JSON) FAILS OPEN to an empty set. Non-string /
 * blank entries inside an array are ignored.
 *
 * Behaviour-identical to toast-sync/lastRung.ts `parseExcludedGroups` (see the port note above).
 */
export function parseRankExcludedGroups(value: unknown): Set<string> {
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
 * Is this item's menu group barred from ranked surfaces? Case-insensitive on the trimmed name;
 * a null/blank/unknown group is NOT excluded (fail-open — the same rule as a toast_menu_cache
 * miss on the edge-function side).
 */
export function isGroupExcluded(menuGroup: string | null | undefined, excluded: Set<string>): boolean {
  if (excluded.size === 0) return false;
  const g = (menuGroup ?? "").trim().toLowerCase();
  return g ? excluded.has(g) : false;
}

/** The toast_menu_cache fields the ranked-surface gate reads. */
export interface RankGateRow {
  menu_group: string | null;
  out_of_stock: boolean;
  pos_visible: boolean;
}

/**
 * The ONE predicate both display-side ranked surfaces (CHAMPION candidate walk, UNDERDOGS roster)
 * ask of a toast cache row, so the two can never drift apart:
 *
 *   • pos_visible — the standing owner principle, "never advertise anything not active on the
 *     POS view" (0034). Already enforced on both surfaces before this refactor.
 *   • !out_of_stock — 86'd = not advertised in ANY way. Already enforced on both surfaces.
 *   • menu group not rank-excluded — NEW: keeps PR #55's mixer credits (Soda Water, Red Bull)
 *     off the ranked surfaces without touching the counting engine that produced them.
 */
export function isRankable(row: RankGateRow, excludedGroups: Set<string>): boolean {
  return row.pos_visible && !row.out_of_stock && !isGroupExcluded(row.menu_group, excludedGroups);
}

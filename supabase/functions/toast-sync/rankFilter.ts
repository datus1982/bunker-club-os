// rankFilter.ts — which items may appear on a RANKED / promotional sales surface.
//
// Pure & dependency-free so it runs under both Deno (the edge function) and Node/tsx (the unit
// test in scripts/test-rank-filter.ts). House pattern: businessDate.ts / eventCounter.ts /
// selectionCounts.ts / lastRung.ts precedent.
//
// DISPLAY SEMANTICS ONLY — the same contract lastRung.ts carries. Nothing here touches the
// durable tallies: sales_history, the event counters, and selectionCounts' cross-ring credit
// engine are entirely unaffected. This module decides ONE thing: whether an item is allowed to
// be *advertised* in a ranked list. The tally that made it #1 is still recorded either way.
//
// Three owner rulings are enforced here, all by item GUID:
//
//   1. 86'D = NOT ADVERTISED IN ANY WAY (toast_menu_cache.out_of_stock, maintained by
//      toast-menu-sync's stock poll). The drink_special template and ★ SCREENS materialization
//      already auto-hide out-of-stock items; the ranked surfaces did not. An item the bar cannot
//      pour must not be the star of the top-sellers board. Restock re-admits it automatically —
//      the 60s sales_cache rebuild re-runs this filter every pass, so there is no manual step.
//
//   2. EXCLUDED MENU GROUPS (venue_settings.signage_rank_excluded_groups, seeded ["Soft Drinks"]).
//      PR #55's cross-ring counting credits a modifier that name-matches a cache item — correct
//      and deliberate for liquor upgrades (a call-brand Margarita credits the liquor), absurd for
//      MIXERS: every vodka-soda credited "Soda Water" until it out-ranked every real drink. The
//      counting engine stays exactly as it is (it is right); the DISPLAY layer refuses to rank
//      the polluted groups. NOTE the deliberate asymmetry with the ticker's own
//      signage_rung_excluded_groups (["Food","Merch","Soft Drinks"]): Food is barred from the
//      NOW POURING ticker but MUST still be able to rank — the owner's Hot Dog champion ruling
//      (PR #39). Two keys, two intents; neither may be collapsed into the other.
//
//   3. POS-HIDDEN ITEMS (toast_menu_cache.pos_visible === false — the PR #11 gate). "Never
//      advertise anything not active on the POS view" is the standing owner principle; the
//      display-side gate (rankGates.isRankable) has enforced it on CHAMPION/UNDERDOGS all along,
//      but the sales_cache WRITE seam did not (PR #93 reviewer NOTE-3, owner-ratified). Folding
//      it in here makes the write and read seams symmetric. Strict-false check only — the PR #11
//      convention: null/undefined pos_visible = unknown ⇒ show (fail-open); only an explicit
//      Toast-side hide blocks. In the NOW POURING path this is redundant with the existing
//      guid+name hidden gate (harmlessly so — same items, same outcome).
//
// FAIL-OPEN THROUGHOUT (the standing POS-gate convention): unknown ⇒ show. An item guid absent
// from toast_menu_cache, a null/undefined out_of_stock, or a missing/malformed settings value all
// resolve to "not blocked" — a data outage can never blank the board.

import { excludedGuidsForGroups } from "./lastRung.ts";

/** The toast_menu_cache columns this module reads. Everything is optional but `guid`. */
export interface RankCacheRow {
  guid: string;
  menu_group?: string | null;
  out_of_stock?: boolean | null;
  pos_visible?: boolean | null;
}

/**
 * toast_menu_cache rows + a set of normalized excluded group names → the set of item GUIDs that
 * must not appear on a ranked surface.
 *
 * Blocked when ANY of:
 *   • out_of_stock === true  (strict true only — null/undefined = unknown stock ⇒ fail-open),
 *   • pos_visible === false  (strict false only — null/undefined = unknown ⇒ fail-open, the
 *     PR #11 convention), or
 *   • the row's menu_group is in `excludedGroups` (case-insensitive on the trimmed name).
 *
 * Group names are parsed from the venue_settings value by lastRung.parseExcludedGroups (shared —
 * the two exclusion families read identically-shaped jsonb arrays and must agree on the fail-open
 * contract). The group half delegates to lastRung.excludedGuidsForGroups so there is exactly ONE
 * group-matching implementation across both surfaces.
 */
export function blockedGuids(rows: RankCacheRow[], excludedGroups: Set<string>): Set<string> {
  const out = excludedGuidsForGroups(rows, excludedGroups);
  for (const r of rows) {
    if (!r?.guid) continue;
    if (r.out_of_stock === true || r.pos_visible === false) out.add(r.guid);
  }
  return out;
}

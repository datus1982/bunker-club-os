// eventCounter.ts — pure math for the Phase 7 event SALES COUNTER (docs/13 "Counter mechanics").
//
// Dependency-free so it runs under both Deno (the edge function) and Node/tsx (the unit test
// in scripts/test-event-counter.ts). Two jobs:
//   (1) LIVE COUNTER — sum units of a linked Toast item within an event window [from, to].
//   (2) POST-EVENT STATS — total units over the window + a "vs. average night" lift readout
//       derived from sales_cache history (that item's average units per prior business date).
//
// The counter is display copy only (docs/13 guardrail: never implies per-person tracking). It
// reuses the same Toast order shape toast-sync already pulls (checks[].selections[]), plus the
// order-level `openedDate` for the time window and voided flags for exclusion.
//
// CROSS-RING (2026-07): the counter now credits a linked item rung EITHER way — as the item OR
// as an item-matched modifier — by delegating per-selection crediting to selectionCounts.ts. So
// a Rocket Sauce rung liquor-first still ticks its event counter. Pass a NameMap built from
// toast_menu_cache to enable modifier matching; omit it and only the rung item is counted.
import { creditsForSelection, emptyNameMap, type CountSelection, type NameMap } from "./selectionCounts.ts";

// ── Toast order shapes (subset we read) ──────────────────────────────────────
export interface RawSelection {
  item?: { guid?: string } | null;
  quantity?: number;
  voided?: boolean;
  modifiers?: CountSelection["modifiers"];
}
export interface RawCheck {
  selections?: RawSelection[];
  voided?: boolean;
}
export interface RawOrder {
  openedDate?: string | null;
  voided?: boolean;
  checks?: RawCheck[];
}

/**
 * Sum the units of `guid` across orders opened within [fromMs, toMs] (inclusive), excluding
 * voided orders, voided checks, and voided selections. Orders with no parseable openedDate are
 * skipped (can't place them in the window). CROSS-RING: `guid` is credited whether it was rung
 * as the item OR as an item-matched modifier — pass the venue's NameMap to enable the modifier
 * side (default = rung item only, byte-identical to the pre-arc counter).
 */
export function countUnitsForGuid(
  orders: RawOrder[],
  guid: string,
  fromMs: number,
  toMs: number,
  nameMap: NameMap = emptyNameMap(),
): number {
  let units = 0;
  for (const order of orders) {
    if (order.voided) continue;
    const t = order.openedDate ? Date.parse(order.openedDate) : NaN;
    if (Number.isNaN(t) || t < fromMs || t > toMs) continue;
    for (const check of order.checks ?? []) {
      if (check.voided) continue;
      for (const sel of check.selections ?? []) {
        if (sel.voided) continue;
        for (const credit of creditsForSelection(sel as CountSelection, nameMap)) {
          if (credit.guid === guid) units += credit.qty;
        }
      }
    }
  }
  return units;
}

// ── Baseline: average units per business date from sales_cache history ────────
export interface SalesRow {
  business_date: string; // 'YYYYMMDD'
  sales_count: number;
}

export interface AverageResult {
  /** Mean units-per-date across qualifying prior dates, or null if too few to compare. */
  avg: number | null;
  /** How many distinct prior business dates the item appeared on (after exclusion). */
  dates: number;
}

/**
 * Average units-per-business-date for an item from its sales_cache rows, EXCLUDING the event's
 * own business date. An item can appear in more than one group's top-5 on the same date
 * (its own group AND MAIN_MENU_ALL) with the same count, so we collapse to the MAX count per
 * date (they're equal; max is robust) rather than summing. Fewer than 3 qualifying dates → no
 * comparison (avg null) so a brand-new / rarely-charting item never produces a noisy lift %.
 */
export function averageUnitsPerDate(
  rows: SalesRow[],
  excludeBusinessDate: string,
): AverageResult {
  const perDate = new Map<string, number>();
  for (const r of rows) {
    if (r.business_date === excludeBusinessDate) continue;
    const prev = perDate.get(r.business_date);
    const count = r.sales_count ?? 0;
    if (prev === undefined || count > prev) perDate.set(r.business_date, count);
  }
  const dates = perDate.size;
  if (dates < 3) return { avg: null, dates };
  let sum = 0;
  for (const v of perDate.values()) sum += v;
  return { avg: sum / dates, dates };
}

/**
 * Percent difference of `units` vs the average night, rounded to a whole percent.
 * null baseline (too few dates) or a zero baseline → null (no meaningful comparison).
 */
export function vsAvgPct(units: number, avg: number | null): number | null {
  if (avg === null || avg === 0) return null;
  return Math.round(((units - avg) / avg) * 100);
}

// ── fields merge (never clobber sibling keys) ────────────────────────────────
/** Shallow-merge a patch into an event's `fields` jsonb, preserving all other keys. */
export function mergeFields(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...patch };
}

export interface FinalStats {
  units: number;
  window_minutes: number;
  vs_avg_pct: number | null;
  computed_at: string;
}

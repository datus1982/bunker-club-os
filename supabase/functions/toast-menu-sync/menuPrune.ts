// menuPrune — which cached items Toast no longer carries (0066).
//
// Owner ruling (2026-09-01): "Toast should be the sole source of truth. If it is in Toast,
// visible, in stock, sellable, it should show up. If it's hidden, 86'd, deleted, etc it
// should be gone."
//
// The sync has always been additive: it upserts everything the Menus V2 payload contains and
// says nothing about what LEFT. This is the other half — a plain set difference between the
// guids the walk just produced and the guids sitting in `toast_menu_cache`.
//
// THE GUARD IS THE WHOLE POINT. A failed/partial/empty payload must NEVER blank the menu
// (the media-catalog "empty flap" lesson — an empty scan there once marked every file
// missing). So an empty present-set is a hard no-op: `removed` comes back empty and the
// caller writes nothing. Anything that reaches this function with zero present guids is a
// broken Toast response, not a restaurant that deleted its entire menu.
//
// Pure + allocation-cheap; no I/O, no clock. The caller supplies the timestamp so the whole
// pass shares one. `pnpm test:menuprune`.

/** The two cache columns the diff needs. */
export interface PruneCacheRow {
  guid: string;
  /** null = currently considered present. */
  removed_at?: string | null;
}

export interface PrunePlan {
  /**
   * Absent from Toast AND not already flagged — these need the full write
   * (pos_visible=false, removed_at=<now>, positions nulled).
   */
  removed: string[];
  /**
   * Absent from Toast and ALREADY flagged — deliberately NOT rewritten, so the original
   * removal timestamp survives (it is the honest "when did Toast lose this" record, and it
   * is what a staff surface shows). They are already pos_visible=false from the pass that
   * first flagged them.
   */
  alreadyRemoved: string[];
  /**
   * Present in Toast but currently carrying a removal timestamp — an item the owner put
   * BACK. No write is planned for them here: the caller's upsert already carries
   * removed_at:null for every present row, so they are restored on this very pass. Reported
   * so the run's JSON can say so out loud.
   */
  restored: string[];
}

const EMPTY: PrunePlan = { removed: [], alreadyRemoved: [], restored: [] };

/**
 * Diff the guids a Toast walk produced against the guids in the cache.
 *
 * @param cacheRows    every cached row for the venue (guid + removed_at).
 * @param presentGuids the guids the walk just produced (after de-dupe).
 */
export function planPrune(
  cacheRows: readonly PruneCacheRow[],
  presentGuids: Iterable<string>,
): PrunePlan {
  const present = presentGuids instanceof Set
    ? presentGuids as Set<string>
    : new Set(presentGuids);

  // Empty payload ⇒ no-op. See the header: a blank walk is a Toast failure, never a reason
  // to prune. Nothing else in this function is allowed to run before this check.
  if (present.size === 0) return { ...EMPTY };

  const plan: PrunePlan = { removed: [], alreadyRemoved: [], restored: [] };
  for (const row of cacheRows ?? []) {
    const guid = row?.guid;
    if (typeof guid !== "string" || guid.length === 0) continue;
    const flagged = row.removed_at != null;
    if (present.has(guid)) {
      if (flagged) plan.restored.push(guid);
    } else if (flagged) {
      plan.alreadyRemoved.push(guid);
    } else {
      plan.removed.push(guid);
    }
  }
  return plan;
}

/** Split a guid list into `size`-sized chunks (PostgREST `.in()` URL length safety). */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  if (size <= 0) return [list.slice()];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ── The prune cap ─────────────────────────────────────────────────────────────────────── */
//
// WARN-1 (addendum review): the empty-payload guard above only catches a TOTALLY empty walk.
// A Toast 200 whose `menus` array is merely INCOMPLETE — one menu missing, a partial page —
// looks like a perfectly good payload, and the plain diff would prune every item in the menus
// that didn't come back. Worse, index.ts records that payload's `lastUpdated` afterwards, so
// the next 2-minute tick sees menuChanged=false, never re-walks, and the site stays blank
// until a real Toast publish or a manual {force:true}. Silent, unbounded and self-latching.
//
// So a prune bigger than the cap is HELD, not applied: the pass logs, raises an alarm state
// key, skips the prune AND skips the lastUpdated write, so every tick retries until Toast
// answers completely — the run self-heals instead of latching.
//
// The cap is 15% of the cache, with a floor of 5 so a small or freshly-seeded cache isn't
// held for an ordinary handful of deletions. `force:true` bypasses it entirely: a forced run
// is a human saying "yes, I mean it", which is exactly how a genuine mass delete gets through
// (and, per the runbook, how an operator recovers a blanked menu).

/** Largest prune applied without a human: 15% of the cache, never fewer than 5 rows. */
export function pruneCap(cacheCount: number): number {
  const n = Number.isFinite(cacheCount) && cacheCount > 0 ? cacheCount : 0;
  return Math.max(5, Math.ceil(0.15 * n));
}

export interface PruneGateResult {
  /** true = the prune is held this pass (alarm raised, lastUpdated NOT recorded, retry next tick). */
  held: boolean;
  /** The cap the count was measured against — reported so the alarm/log can be specific. */
  cap: number;
}

/**
 * Decide whether a planned prune is small enough to apply unattended.
 * `force` (an operator's {force:true}) always applies.
 */
export function gatePrune(
  opts: { removedCount: number; cacheCount: number; force: boolean },
): PruneGateResult {
  const cap = pruneCap(opts.cacheCount);
  if (opts.force) return { held: false, cap };
  return { held: opts.removedCount > cap, cap };
}

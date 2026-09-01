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

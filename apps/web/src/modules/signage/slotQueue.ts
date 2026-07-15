import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import type { SignageItem } from "./useSignage";

/**
 * slot_queue (screen ↔ asset junction, migration 0045) read/write helpers.
 *
 * The data-spine change of the hub-consolidation arc: a signage_items row is a venue-wide
 * ASSET; slot_queue says which screens it's queued on (position = per-screen order, was
 * signage_items.sort_order) and for how long (duration_seconds = per-screen dwell). This
 * module is the SINGLE place that knows the junction shape — the public reader, the admin
 * reader, ItemEditor, EditRotation and (task 2) the hub library all go through here so the
 * mapping stays in one spot and resolveRotation's output stays byte-identical.
 *
 * The flattened read shape deliberately reproduces the LEGACY per-slot item object:
 *   sort_order       ← slot_queue.position
 *   duration_seconds ← slot_queue.duration_seconds  (the junction's dwell, not the item's)
 *   active           ← signage_items.active          (asset-global pause; authoritative)
 *   slot_id          ← the queue's slot
 * so every downstream consumer (resolveRotation, EditRotation rows, SignageHub itemsBySlot,
 * the website is unaffected — it reads signage_items directly) keeps working unchanged.
 */

/** Asset columns the PUBLIC board needs (no slot_id/sort_order/duration_seconds — those are
 *  on the junction now). */
export const ASSET_COLS_PUBLIC = "id, template, fields, starts_at, ends_at, active";
/** Asset columns the STAFF console needs (adds recurrence / website flag / created_at). */
export const ASSET_COLS_ADMIN =
  "id, template, fields, starts_at, ends_at, active, recurrence, show_on_website, created_at";

/** One slot_queue row joined to its asset. `item` is the embedded signage_items object. */
interface QueueJoinRow {
  slot_id: string;
  position: number;
  duration_seconds: number;
  active: boolean; // junction active (on-air on this screen)
  item: Record<string, unknown> | null;
}

/** Flatten a joined queue row into the legacy per-slot item shape (see module doc). The
 *  spread carries any extra asset columns (recurrence/created_at/show_on_website when the
 *  admin select requested them) so a cast to AdminItem at the call site is sound. */
function flatten(row: QueueJoinRow): SignageItem | null {
  const it = row.item;
  if (!it) return null;
  return {
    ...it,
    id: it.id as string,
    slot_id: row.slot_id,
    template: it.template as SignageItem["template"],
    fields: (it.fields as Record<string, unknown>) ?? {},
    starts_at: (it.starts_at as string | null) ?? null,
    ends_at: (it.ends_at as string | null) ?? null,
    // per-screen order + dwell come from the JUNCTION, not the asset.
    sort_order: row.position,
    duration_seconds: row.duration_seconds,
    // asset-global pause is authoritative; junction active is filtered at the query for the
    // public board and left true (until task-2 per-screen pause exists) for the admin read.
    active: (it.active as boolean) ?? true,
  };
}

/**
 * PUBLIC board: a slot's on-air queue, flattened to SignageItem[] in position order.
 * Filters to junction-active AND asset-active — byte-identical to the legacy
 * `signage_items.eq(slot_id).eq(active,true).order(sort_order)`.
 */
export async function fetchSlotQueuePublic(slotId: string): Promise<SignageItem[]> {
  const { data, error } = await supabase
    .from("slot_queue")
    .select(`slot_id, position, duration_seconds, active, item:signage_items!inner(${ASSET_COLS_PUBLIC})`)
    .eq("slot_id", slotId)
    .eq("active", true) // junction on-air
    .eq("item.active", true) // asset not paused
    .order("position");
  if (error) throw error;
  return ((data ?? []) as unknown as QueueJoinRow[])
    .map(flatten)
    .filter((x): x is SignageItem => x !== null);
}

/**
 * STAFF console: every (slot, asset) pairing for the venue — ACTIVE and paused, so a
 * paused/out-of-window row stays editable in EDIT ROTATION. Flattened to the same shape,
 * ordered by position. Grouped by slot_id downstream (SignageHub itemsBySlot / EditRotation).
 */
export async function fetchSlotQueueAdmin(): Promise<SignageItem[]> {
  const { data, error } = await supabase
    .from("slot_queue")
    .select(`slot_id, position, duration_seconds, active, item:signage_items!inner(${ASSET_COLS_ADMIN}, venue_id)`)
    .eq("item.venue_id", VENUE_ID)
    .order("position");
  if (error) throw error;
  return ((data ?? []) as unknown as QueueJoinRow[])
    .map(flatten)
    .filter((x): x is SignageItem => x !== null);
}

/* ── write helpers (keyed by slot_id + item_id — the junction PK) ──────────── */

/** Queue an asset onto a screen at `position` for `duration` seconds (new placement). */
export async function addToQueue(
  slotId: string,
  itemId: string,
  position: number,
  duration: number,
): Promise<void> {
  const { error } = await supabase
    .from("slot_queue")
    .insert({ slot_id: slotId, item_id: itemId, position, duration_seconds: duration, active: true });
  if (error) throw error;
}

/** Remove an asset from ONE screen (the ✕ in the queue — task 2). Leaves the asset + its
 *  other placements intact. */
export async function removeFromQueue(slotId: string, itemId: string): Promise<void> {
  const { error } = await supabase.from("slot_queue").delete().eq("slot_id", slotId).eq("item_id", itemId);
  if (error) throw error;
}

/** Per-screen dwell (EDIT ROTATION SECS control) → slot_queue.duration_seconds. */
export async function setQueueDuration(slotId: string, itemId: string, seconds: number): Promise<void> {
  const { error } = await supabase
    .from("slot_queue")
    .update({ duration_seconds: seconds })
    .eq("slot_id", slotId)
    .eq("item_id", itemId);
  if (error) throw error;
}

/** Swap two assets' positions on the SAME screen (▲/▼ reorder). Each arg carries its
 *  slot + item + current position. */
export async function swapQueuePositions(
  a: { slot_id: string; id: string; sort_order: number },
  b: { slot_id: string; id: string; sort_order: number },
): Promise<void> {
  const e1 = await supabase
    .from("slot_queue")
    .update({ position: b.sort_order })
    .eq("slot_id", a.slot_id)
    .eq("item_id", a.id);
  if (e1.error) throw e1.error;
  const e2 = await supabase
    .from("slot_queue")
    .update({ position: a.sort_order })
    .eq("slot_id", b.slot_id)
    .eq("item_id", b.id);
  if (e2.error) throw e2.error;
}

/**
 * Reconcile where an asset is queued after an ItemEditor save.
 *   • new asset (fromSlotId null)        → queue it on slotId at nextPosition.
 *   • edited, same slot                  → keep its position, update the dwell.
 *   • edited, slot changed               → move it off fromSlotId, queue on slotId (append).
 * Idempotent per call; preserves position on a same-slot edit so a re-save never jumps a card.
 */
export async function placeAsset(opts: {
  itemId: string;
  slotId: string;
  fromSlotId: string | null;
  duration: number;
  nextPosition: number;
}): Promise<void> {
  const { itemId, slotId, fromSlotId, duration, nextPosition } = opts;
  if (fromSlotId && fromSlotId !== slotId) {
    await removeFromQueue(fromSlotId, itemId);
  }
  const existing = await supabase
    .from("slot_queue")
    .select("slot_id")
    .eq("slot_id", slotId)
    .eq("item_id", itemId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    // Already queued here (same-slot edit) — update the dwell, keep the position.
    const { error } = await supabase
      .from("slot_queue")
      .update({ duration_seconds: duration, active: true })
      .eq("slot_id", slotId)
      .eq("item_id", itemId);
    if (error) throw error;
  } else {
    await addToQueue(slotId, itemId, nextPosition, duration);
  }
}

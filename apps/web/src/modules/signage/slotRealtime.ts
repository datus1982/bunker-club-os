/**
 * Heartbeat-churn guard for signage_slots realtime (M1 review NOTE-2).
 *
 * Every screen writes a last_seen UPDATE via signage_heartbeat() on its 60s heartbeat, so
 * signage_slots emits 60s × N-screens of realtime UPDATEs venue-wide. Neither surface renders
 * last_seen off the realtime row — the public TV board never shows it, and the hub's health
 * chip decays via its OWN 60s poll (useAdminSlots.refetchInterval) — so an UPDATE that touches
 * ONLY last_seen must invalidate nothing. Before this guard, each such heartbeat refetched the
 * slot query on every subscribed page.
 *
 * signage_slots' replica identity is DEFAULT (PK only), so payload.old carries no columns to
 * diff — we compare payload.new to the CACHED row instead (per the task's fallback path).
 */

/** Fields the public TV board (useSignage.Slot) actually renders off a signage_slots row.
 *  program_hold / program_set_at drive the M3 two-tier override (D4) — a hold change with the
 *  same program jsonb (e.g. plain flip → SPECIAL EVENT) must still wake the TV, so they're here. */
export const TV_SLOT_RENDER_FIELDS = [
  "program",
  "program_hold",
  "program_set_at",
  "kind",
  "name",
  "orientation",
  "location_label",
  "terminal_number",
  "overscan_inset_pct",
  "scale_adjust",
] as const;

/** Fields the staff hub (useSignageAdmin.AdminSlot) renders off a signage_slots row. last_seen
 *  is deliberately EXCLUDED — the health chip stays fresh via useAdminSlots' 60s poll, so a
 *  last_seen-only heartbeat need not invalidate the hub's slot list. */
export const HUB_SLOT_RENDER_FIELDS = [
  "name",
  "orientation",
  "slug",
  "terminal_number",
  "location_label",
  "program",
  "program_hold",
  "program_set_at",
  "kind",
] as const;

/**
 * True when every render-relevant field in `next` (a realtime payload.new row) matches the
 * `cached` row ⇒ the UPDATE is last_seen-only (or otherwise render-irrelevant) and the caller
 * should SKIP invalidation. False ⇒ invalidate: some field differs, or there's no cached row
 * to compare (can't prove it's a no-op, so refetch to be safe).
 */
export function slotRenderFieldsUnchanged(
  fields: readonly string[],
  cached: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): boolean {
  if (!cached) return false;
  return fields.every((k) => {
    const a = cached[k];
    const b = next[k];
    // program is jsonb (object | null) — structural compare. A false "changed" here only
    // over-refetches (safe direction); it never drops a real program switch.
    if (k === "program") return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    return a === b;
  });
}

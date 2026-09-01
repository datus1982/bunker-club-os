// posVisible — the ONE definition of "active on the POS view" (0034).
//
// Extracted 2026-09-01 because two walks now need it: the row walk in index.ts (which
// computes each cached row's pos_visible) and the ordering walk in menuOrder.ts (which must
// pick the SAME occurrence of a shared item that the row de-dupe keeps). Two copies of this
// rule drifting apart would put an item's menu_group and its position in different groups —
// exactly the class of bug this pair of changes exists to fix.

/**
 * Menus V2 `visibility` is an array of channel strings (e.g.
 * ["ORDERING_PARTNERS","TOAST_ONLINE_ORDERING","POS","KIOSK"]). "POS" present = active on the
 * register = advertisable (owner's principle).
 *
 * Defensive: a missing visibility (undefined/null) is treated as visible so a schema surprise
 * never over-hides — mirrors the default-in-stock stance. An explicit empty array means hidden
 * on every channel (how the owner hid Winter Cocktails) → not visible. A legacy scalar enum
 * ("NONE") is honored as a fallback.
 */
export function isPosVisible(vis: unknown): boolean {
  if (vis === undefined || vis === null) return true;
  if (Array.isArray(vis)) return vis.includes("POS");
  return String(vis).toUpperCase() !== "NONE";
}

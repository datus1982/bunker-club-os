// menuOrder — where each Toast menu item sits in the owner's own menu layout (0064).
//
// Owner ask (2026-09-01): "I want to be able to set the order in Toast, I don't want to have
// to come to a session." Toast already owns names/prices/photos/blurbs/visibility; this makes
// it own ORDER. The rule is deliberately dumb and faithful:
//
//   * walk `menus` in the order Toast returns them;
//   * inside a menu, walk `menuGroups` in order;
//   * a group's nested `menuGroups` are walked DEPTH-FIRST, immediately after that group's
//     own items — so a sub-group always follows its parent rather than drifting to the end;
//   * every time the walk ENTERS a group it takes the next group number (0, 1, 2, …), so the
//     numbers are globally monotonic across the whole payload;
//   * an item's `item_position` is its index inside its group's `menuItems`.
//
// An item can legitimately appear in several menus/groups (Toast reuses items). The FIRST
// occurrence — the earliest place the owner put it — wins, so a "Signature Cocktails" item
// also parked on a late "Happy Hour" menu still renders in the cocktails section.
//
// Pure + defensive: any malformed node is skipped, never thrown (a shape surprise must not
// abort a whole sync pass — the 0050 WARN-1 lesson). `pnpm test:menuorder`.

export interface MenuPosition {
  /** 0-based index of the group in the global depth-first walk. */
  group_position: number;
  /** 0-based index of the item inside its group's menuItems. */
  item_position: number;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Map every item guid in a Menus V2 payload to its {group_position, item_position}.
 * First occurrence wins. Returns an empty map for a malformed/absent payload.
 */
export function assignMenuPositions(menusData: unknown): Map<string, MenuPosition> {
  const out = new Map<string, MenuPosition>();
  if (!isRecord(menusData)) return out;

  let groupCounter = 0;

  const walkGroup = (group: unknown) => {
    if (!isRecord(group)) return;
    const groupPosition = groupCounter++;
    const items = asArray(group.menuItems);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isRecord(item)) continue;
      const guid = item.guid;
      if (typeof guid !== "string" || guid.length === 0) continue;
      if (out.has(guid)) continue; // first occurrence wins (lowest positions)
      out.set(guid, { group_position: groupPosition, item_position: i });
    }
    // Depth-first: a sub-group follows its parent immediately.
    for (const sub of asArray(group.menuGroups)) walkGroup(sub);
  };

  for (const menu of asArray(menusData.menus)) {
    if (!isRecord(menu)) continue;
    for (const group of asArray(menu.menuGroups)) walkGroup(group);
  }

  return out;
}

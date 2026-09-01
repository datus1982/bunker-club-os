// menuOrder — where each Toast menu item sits in the owner's own menu layout (0064), and
// WHICH of its occurrences the cache should keep (2026-09-01 amendment).
//
// Owner ask (2026-09-01): "I want to be able to set the order in Toast, I don't want to have
// to come to a session." Toast already owns names/prices/photos/blurbs/visibility; this makes
// it own ORDER. The walk rule is deliberately dumb and faithful:
//
//   * walk `menus` in the order Toast returns them;
//   * inside a menu, walk `menuGroups` in order;
//   * a group's nested `menuGroups` are walked DEPTH-FIRST, immediately after that group's
//     own items — so a sub-group always follows its parent rather than drifting to the end;
//   * every time the walk ENTERS a group it takes the next group number (0, 1, 2, …), so the
//     numbers are globally monotonic across the whole payload;
//   * an item's `item_position` is its index inside its group's `menuItems`.
//
// ── WHICH OCCURRENCE WINS ────────────────────────────────────────────────────────────────
// An item can legitimately appear in several menus/groups (Toast reuses items), but the cache
// holds ONE row per guid, carrying one menu_group, one pos_visible and one position.
//
// DECISION (2026-09-01, replaces the earlier last-wins rule): among a guid's occurrences keep
// the FIRST whose EFFECTIVE POS visibility is true (menu → group → item cascade, the same one
// index.ts computes); if no occurrence is visible, keep the FIRST occurrence.
//
// Why: a VISIBLE listing must never be masked by a hidden one. The owner hit this live — his
// "Tiki Tuesday" group (visible, walked first) shares items with "Classics" (POS-hidden,
// walked later). Under last-wins each shared item cached as menu_group "Classics" with
// pos_visible=false, so drinks that are on the menu and selling vanished from
// bunkerokc.com/menu entirely. Under first-visible-wins they cache as Tiki Tuesday, visible,
// in their Tiki position. The all-hidden fallback keeps the row (and its last-known data)
// rather than dropping it — the pos_visible gate is what hides it, uniformly.
//
// index.ts's row de-dupe applies the IDENTICAL rule by keeping the row whose own
// (group_position, item_position) matches what this walk chose — so menu_group, pos_visible
// and the positions can never come from different occurrences again.
//
// BACKLOG: an item genuinely wanted in two visible groups still renders once, under the first
// of them. Showing it in both needs a row-per-occurrence cache, which is a schema change.
//
// Pure + defensive: any malformed node is skipped, never thrown (a shape surprise must not
// abort a whole sync pass — the 0050 WARN-1 lesson). `pnpm test:menuorder`.
import { isPosVisible } from "./posVisible.ts";

export interface MenuPosition {
  /** 0-based index of the group in the global depth-first walk. */
  group_position: number;
  /** 0-based index of the item inside its group's menuItems. */
  item_position: number;
}

/** Internal: a position plus whether that occurrence was POS-visible. */
interface Candidate extends MenuPosition {
  visible: boolean;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Map every item guid in a Menus V2 payload to the {group_position, item_position} of the
 * occurrence the cache should keep: the FIRST POS-visible one, else the FIRST one (see the
 * DECISION above — it must match index.ts's row de-dupe).
 * Returns an empty map for a malformed/absent payload.
 */
export function assignMenuPositions(menusData: unknown): Map<string, MenuPosition> {
  const chosen = new Map<string, Candidate>();
  if (!isRecord(menusData)) return new Map();

  let groupCounter = 0;

  // `groupVisible` carries the POS-visibility cascade down the tree exactly as index.ts does:
  // a hidden menu hides its groups, a hidden group hides its items and its sub-groups.
  const walkGroup = (group: unknown, groupVisible: boolean) => {
    // Skipped WITHOUT consuming a group number — index.ts's walk guards identically, so the
    // two counters stay in lockstep.
    if (!isRecord(group)) return;
    const here = groupVisible && isPosVisible(group.visibility);
    const groupPosition = groupCounter++;
    const items = asArray(group.menuItems);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isRecord(item)) continue;
      const guid = item.guid;
      if (typeof guid !== "string" || guid.length === 0) continue;
      const visible = here && isPosVisible(item.visibility);
      const prev = chosen.get(guid);
      // First occurrence seeds; after that ONLY a visible occurrence can displace a hidden
      // one. A later visible occurrence never displaces an earlier visible one (first wins),
      // and a later hidden occurrence never displaces anything.
      if (!prev || (!prev.visible && visible)) {
        chosen.set(guid, { group_position: groupPosition, item_position: i, visible });
      }
    }
    // Depth-first: a sub-group follows its parent immediately.
    for (const sub of asArray(group.menuGroups)) walkGroup(sub, here);
  };

  for (const menu of asArray(menusData.menus)) {
    if (!isRecord(menu)) continue;
    // A menu can itself be POS-hidden; seed the cascade from the menu's visibility.
    const menuVisible = isPosVisible(menu.visibility);
    for (const group of asArray(menu.menuGroups)) walkGroup(group, menuVisible);
  }

  const out = new Map<string, MenuPosition>();
  for (const [guid, c] of chosen) out.set(guid, { group_position: c.group_position, item_position: c.item_position });
  return out;
}

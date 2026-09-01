/**
 * Unit test for the Toast menu-order extractor (toast-menu-sync menuOrder, 0064).
 * `pnpm test:menuorder` (npx tsx scripts/test-menu-order.ts). Pure fixtures, no I/O —
 * same style as test-price-options.ts.
 *
 * Contract under test (owner ask 2026-09-01 — Toast is the menu order):
 *   - menus in payload order, groups in order, sub-groups depth-first right after their parent;
 *   - group_position is a global monotonic counter incremented on ENTERING each group;
 *   - item_position is the item's index inside its group's menuItems;
 *   - an item repeated across menus/groups keeps its FIRST (lowest) positions;
 *   - malformed nodes are skipped, never thrown.
 */
import {
  assignMenuPositions,
  type MenuPosition,
} from "../supabase/functions/toast-menu-sync/menuOrder.ts";

let failures = 0;
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${g}, want ${w}`);
}
const at = (m: Map<string, MenuPosition>, guid: string) => m.get(guid) ?? null;
const pos = (g: number, i: number): MenuPosition => ({ group_position: g, item_position: i });

const item = (guid: string) => ({ guid, name: guid });

// ── Flat single menu ─────────────────────────────────────────────────────────
const flat = assignMenuPositions({
  menus: [{
    name: "Main",
    menuGroups: [
      { name: "Tiki Tuesday", menuItems: [item("a"), item("b")] },
      { name: "Signature Cocktails", menuItems: [item("c")] },
    ],
  }],
});
eq("first group, first item", at(flat, "a"), pos(0, 0));
eq("first group, second item", at(flat, "b"), pos(0, 1));
eq("second group, first item", at(flat, "c"), pos(1, 0));
eq("unknown guid null", at(flat, "zz"), null);

// ── Nested sub-groups are depth-first (follow their parent) ──────────────────
const nested = assignMenuPositions({
  menus: [{
    menuGroups: [
      {
        name: "Beer",
        menuItems: [item("beer1")],
        menuGroups: [
          { name: "Drafts", menuItems: [item("draft1"), item("draft2")] },
          { name: "Cans", menuItems: [item("can1")] },
        ],
      },
      { name: "Wine", menuItems: [item("wine1")] },
    ],
  }],
});
eq("parent group is 0", at(nested, "beer1"), pos(0, 0));
eq("sub-group follows parent (1)", at(nested, "draft1"), pos(1, 0));
eq("sub-group item index", at(nested, "draft2"), pos(1, 1));
eq("second sub-group (2)", at(nested, "can1"), pos(2, 0));
eq("next top-level group comes AFTER the sub-tree (3)", at(nested, "wine1"), pos(3, 0));

// ── Multiple menus continue the same counter ────────────────────────────────
const multi = assignMenuPositions({
  menus: [
    { menuGroups: [{ menuItems: [item("m1a")] }, { menuItems: [item("m1b")] }] },
    { menuGroups: [{ menuItems: [item("m2a")] }] },
  ],
});
eq("menu 1 group 0", at(multi, "m1a"), pos(0, 0));
eq("menu 1 group 1", at(multi, "m1b"), pos(1, 0));
eq("menu 2 continues the counter (2)", at(multi, "m2a"), pos(2, 0));

// ── First occurrence wins ───────────────────────────────────────────────────
const dupe = assignMenuPositions({
  menus: [
    { menuGroups: [{ name: "Signature Cocktails", menuItems: [item("x"), item("dup")] }] },
    { menuGroups: [{ name: "Happy Hour", menuItems: [item("dup")] }] },
  ],
});
eq("repeated item keeps its FIRST position", at(dupe, "dup"), pos(0, 1));
eq("dupe map size", dupe.size, 2);

// ── Defensive shapes ────────────────────────────────────────────────────────
eq("null payload empty", assignMenuPositions(null).size, 0);
eq("undefined payload empty", assignMenuPositions(undefined).size, 0);
eq("string payload empty", assignMenuPositions("nope").size, 0);
eq("missing menus empty", assignMenuPositions({}).size, 0);
eq("menus not an array empty", assignMenuPositions({ menus: {} }).size, 0);

const messy = assignMenuPositions({
  menus: [
    null,
    { menuGroups: null },
    {
      menuGroups: [
        "not-a-group",
        { menuItems: [null, { name: "no guid" }, item("ok"), { guid: 42 }, { guid: "" }] },
      ],
    },
  ],
});
// A non-record "group" is skipped WITHOUT consuming a group number (it isn't a group at
// all), so the one real group here is 0; the item keeps its raw menuItems index (2) even
// though the two entries before it were unusable — positions only ever have to compare.
eq("malformed nodes skipped, valid item kept", at(messy, "ok"), pos(0, 2));
eq("only the valid item is mapped", messy.size, 1);

// An empty group still consumes a group number (it exists in the owner's layout).
const empties = assignMenuPositions({
  menus: [{ menuGroups: [{ menuItems: [] }, { menuItems: [item("after-empty")] }] }],
});
eq("empty group still consumes a number", at(empties, "after-empty"), pos(1, 0));

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll menu-order tests passed.");

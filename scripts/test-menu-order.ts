/**
 * Unit test for the Toast menu-order extractor (toast-menu-sync menuOrder, 0064).
 * `pnpm test:menuorder` (npx tsx scripts/test-menu-order.ts). Pure fixtures, no I/O —
 * same style as test-price-options.ts.
 *
 * Contract under test (owner ask 2026-09-01 — Toast is the menu order):
 *   - menus in payload order, groups in order, sub-groups depth-first right after their parent;
 *   - group_position is a global monotonic counter incremented on ENTERING each group;
 *   - item_position is the item's index inside its group's menuItems;
 *   - an item repeated across menus/groups keeps the FIRST occurrence that is POS-VISIBLE
 *     (menu → group → item cascade), else the FIRST occurrence — the row that survives
 *     index.ts's de-dupe, so menu_group, pos_visible and position always agree. This is the
 *     2026-09-01 amendment: under the old last-wins rule the owner's Tiki Tuesday drinks,
 *     also listed in the POS-hidden Classics group, cached as hidden and vanished from the
 *     website;
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

// ── Which occurrence wins: FIRST VISIBLE, else FIRST (2026-09-01 amendment) ─
// index.ts's row de-dupe keeps the same occurrence, so menu_group / pos_visible / position
// always describe one single listing.
const HIDDEN: string[] = []; // explicit empty visibility array = hidden on every channel
const VISIBLE = ["POS"];

// Two visible listings → the FIRST wins. ("Cantina Pizzolato" sits in Draft Beers and in
// Wine; it renders under Draft Beers now.)
const dupe = assignMenuPositions({
  menus: [
    { menuGroups: [{ name: "Draft Beers", menuItems: [item("x"), item("dup")] }] },
    { menuGroups: [{ name: "Wine", menuItems: [item("dup")] }] },
  ],
});
eq("two visible listings — first wins", at(dupe, "dup"), pos(0, 1));
eq("dupe map size", dupe.size, 2);

// Same rule inside one menu, across sibling groups.
const dupeSameMenu = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "Draft Beers", menuItems: [item("a"), item("dup2")] },
      { name: "Wine", menuItems: [item("b"), item("c"), item("dup2")] },
    ],
  }],
});
eq("first occurrence within one menu", at(dupeSameMenu, "dup2"), pos(0, 1));

// THE LIVE BUG: visible group first, hidden group second. Under the old last-wins rule the
// item cached as the hidden group and vanished from the website.
const visibleThenHidden = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "Tiki Tuesday", visibility: VISIBLE, menuItems: [item("wilson"), item("hurricane")] },
      { name: "Classics", visibility: HIDDEN, menuItems: [item("old-fashioned"), item("hurricane")] },
    ],
  }],
});
eq("hidden-after-visible keeps the VISIBLE occurrence", at(visibleThenHidden, "hurricane"), pos(0, 1));
eq("hidden-only item keeps its hidden position", at(visibleThenHidden, "old-fashioned"), pos(1, 0));

// The mirror image: hidden group walked FIRST, visible group second. The visible occurrence
// must displace the hidden one even though it comes later.
const hiddenThenVisible = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "Classics", visibility: HIDDEN, menuItems: [item("painkiller"), item("fern-gully")] },
      { name: "Tiki Tuesday", visibility: VISIBLE, menuItems: [item("fern-gully")] },
    ],
  }],
});
eq("visible-after-hidden WINS", at(hiddenThenVisible, "fern-gully"), pos(1, 0));
eq("still-hidden sibling keeps its own position", at(hiddenThenVisible, "painkiller"), pos(0, 0));

// A second visible occurrence never displaces the first visible one.
const twoVisibleAfterHidden = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "Classics", visibility: HIDDEN, menuItems: [item("z")] },
      { name: "Tiki Tuesday", visibility: VISIBLE, menuItems: [item("z")] },
      { name: "Features", visibility: VISIBLE, menuItems: [item("pad"), item("z")] },
    ],
  }],
});
eq("first VISIBLE occurrence wins over later visible ones", at(twoVisibleAfterHidden, "z"), pos(1, 0));

// All occurrences hidden → keep the FIRST (the row survives; pos_visible is what hides it).
const allHidden = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "Classics", visibility: HIDDEN, menuItems: [item("pad2"), item("ghost")] },
      { name: "Winter Cocktails", visibility: HIDDEN, menuItems: [item("ghost")] },
    ],
  }],
});
eq("all-hidden keeps the FIRST occurrence", at(allHidden, "ghost"), pos(0, 1));

// Visibility cascades: a hidden MENU hides its groups, and a hidden ITEM is hidden inside a
// visible group. Both must count as "not visible" when choosing.
const cascade = assignMenuPositions({
  menus: [
    { name: "Archived", visibility: HIDDEN, menuGroups: [{ name: "Old", visibility: VISIBLE, menuItems: [item("c1")] }] },
    { name: "Live", visibility: VISIBLE, menuGroups: [{ name: "Now", visibility: VISIBLE, menuItems: [item("c1")] }] },
  ],
});
eq("hidden MENU cascades — later visible listing wins", at(cascade, "c1"), pos(1, 0));

const itemHidden = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "A", visibility: VISIBLE, menuItems: [{ guid: "i1", name: "i1", visibility: HIDDEN }] },
      { name: "B", visibility: VISIBLE, menuItems: [{ guid: "i1", name: "i1", visibility: VISIBLE }] },
    ],
  }],
});
eq("item-level hidden loses to a later visible listing", at(itemHidden, "i1"), pos(1, 0));

// Absent visibility means visible (the defensive default) — so a listing with no visibility
// key is a visible one and wins over an explicitly hidden earlier listing.
const absentVis = assignMenuPositions({
  menus: [{
    menuGroups: [
      { name: "Hidden", visibility: HIDDEN, menuItems: [item("d1")] },
      { name: "NoVisKey", menuItems: [item("d1")] },
    ],
  }],
});
eq("missing visibility counts as visible", at(absentVis, "d1"), pos(1, 0));

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

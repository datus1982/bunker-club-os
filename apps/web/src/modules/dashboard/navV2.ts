import { hasModule, roleAtLeast, type ModuleKey, type StaffRole } from "@/shared/useRole";

/**
 * The v2 staff navigation (UX overhaul Beat 1, IA from docs/ux-overhaul/00-audit-and-ia).
 *
 * This is a SEPARATE data set from StaffNav's `SECTIONS` — classic is frozen, and the
 * two shapes differ (GAMES rename, MEDIA promoted, coming-soon slots, hash children).
 *
 * Gates are identical to classic: `module` → has_module grant (admin implies all),
 * `minRole` → rank. A section renders iff at least one REAL child is visible; a
 * coming-soon child alone never conjures a section.
 *
 * MEDIA is its own top-level section on its own paths (Beat 4). Those routes are v2-only:
 * on a classic device they redirect back into the hub, which is where classic keeps them.
 */
export interface NavChildV2 {
  /** Route, optionally with a `#anchor` (e.g. `/signage#library`). Empty for placeholders. */
  to: string;
  label: string;
  module?: ModuleKey;
  minRole?: StaffRole;
  end?: boolean;
  /** Reserved slot: rendered dim + non-navigating with a COMING SOON tag. */
  comingSoon?: boolean;
  /** Desktop sub-nav grouping label (dim kicker before the first child of the group). */
  group?: string;
  /**
   * ONE-LINE TASK DESCRIPTION (audit §C5, Beat 6 PR 1). The module tiles already do this
   * right ("Live scoring console — run the game", not "Trivia"); this extends the same
   * one-liner to the nav entries that read as bare nouns. Rendered in the MOBILE DRAWER
   * only (Body role, sentence case) — the desktop sub-nav row is a chip strip with no
   * room for a second line, and the `label` itself stays Label-role UPPERCASE.
   */
  task?: string;
}

export interface NavSectionV2 {
  label: string;
  children: NavChildV2[];
}

export const HOME_V2: NavChildV2 = {
  to: "/dashboard", label: "HOME", minRole: "staff", end: true,
  task: "Status board and where everything starts",
};

export const SECTIONS_V2: NavSectionV2[] = [
  {
    // Renamed from TRIVIA (owner decision B) — trivia is one game among future consoles.
    label: "GAMES",
    children: [
      { to: "/scoring", label: "SCORING", module: "trivia", group: "TRIVIA", task: "Run tonight's game and drive the screens" },
      { to: "/game/setup", label: "GAME SETUP", module: "trivia", group: "TRIVIA", task: "Create a game, its rounds and its questions" },
      { to: "/teams", label: "TEAMS", module: "trivia", group: "TRIVIA", task: "Regular-team roster, PINs and join requests" },
      { to: "/game/history", label: "HISTORY", module: "trivia", group: "TRIVIA", task: "Past games and their final boards" },
      // The reserved second-console slot. Never navigates (nothing is built yet).
      { to: "", label: "READ THE ROOM", module: "trivia", comingSoon: true },
      // SEASONS ranks trivia seasons but is admin-only, so it sits outside the TRIVIA group.
      { to: "/admin/seasons", label: "SEASONS", minRole: "admin", task: "Season standings, finals and playoffs" },
    ],
  },
  {
    label: "BAR OPS",
    children: [
      { to: "/signage", label: "SIGNAGE HUB", module: "signage", task: "See what every screen is showing right now" },
      { to: "/signage#events", label: "EVENTS & PROMOS", module: "signage", task: "Schedule a promo or put one on the screens now" },
      { to: "/admin/drinks", label: "TOP SELLERS", module: "drinks", task: "Which drink groups the sellers board rotates" },
    ],
  },
  {
    // Promoted out of the Signage Hub (owner decision A). Organisation only — the
    // surfaces themselves are unchanged; Beat 4 gave them real paths (Beat 1 pointed
    // these at /signage#… hash anchors, which still work for old bookmarks).
    // Gated on `signage`: MEDIA has no module of its own and these pages read/write
    // signage tables, so the hub's grant is the honest gate.
    label: "MEDIA",
    children: [
      { to: "/media/library", label: "LIBRARY", module: "signage", task: "Every film on the bar PC, and whether it is there" },
      { to: "/media/playlists", label: "PLAYLISTS", module: "signage", task: "Group films into the programs a screen can run" },
      { to: "/media/screens", label: "SCREENS & PROGRAMS", module: "signage", task: "Point a screen at a program, or set its dayparts" },
    ],
  },
  {
    label: "SYSTEM",
    children: [
      { to: "/admin/users", label: "USERS", minRole: "admin", task: "Invite staff and decide what each one can reach" },
      // /settings is still the Phase 1 Placeholder stub — never link a placeholder as
      // if it were real (addendum ruling 4).
      { to: "", label: "SETTINGS", minRole: "admin", comingSoon: true },
    ],
  },
];

export function childVisibleV2(role: StaffRole | null, modules: ModuleKey[], c: NavChildV2): boolean {
  return c.module ? hasModule(role, modules, c.module) : roleAtLeast(role, c.minRole ?? "staff");
}

/** Sections filtered to what this viewer may see (see the section rule above). */
export function visibleSectionsV2(role: StaffRole | null, modules: ModuleKey[]): NavSectionV2[] {
  return SECTIONS_V2
    .map((s) => ({ ...s, children: s.children.filter((c) => childVisibleV2(role, modules, c)) }))
    .filter((s) => s.children.some((c) => !c.comingSoon));
}

/** Split "/signage#events" into its path and bare hash ("events"). */
function parseTo(to: string): { path: string; hash: string } {
  const i = to.indexOf("#");
  return i === -1 ? { path: to, hash: "" } : { path: to.slice(0, i), hash: to.slice(i + 1) };
}

const matchesPath = (pathname: string, to: string) => pathname === to || pathname.startsWith(to + "/");

/**
 * Which nav child owns the current URL. Longest path prefix wins, EXCEPT that a child
 * carrying a hash beats a bare-path sibling when the location's hash matches it — that
 * is how `/signage#events` and `/signage#library` stay distinguishable from the bare
 * SIGNAGE HUB entry (no hash ⇒ SIGNAGE HUB, per the beat spec).
 */
export function resolveActiveV2(
  pathname: string,
  hash: string,
  home: NavChildV2 | null,
  sections: NavSectionV2[],
): { child?: NavChildV2; section?: NavSectionV2 } {
  const bare = hash.replace(/^#/, "");
  const flat: Array<{ child: NavChildV2; section?: NavSectionV2 }> = [
    ...(home ? [{ child: home }] : []),
    ...sections.flatMap((s) => s.children.map((c) => ({ child: c, section: s }))),
  ];
  const scored = flat
    .filter((e) => {
      if (!e.child.to || e.child.comingSoon) return false;
      const { path, hash: h } = parseTo(e.child.to);
      if (!matchesPath(pathname, path)) return false;
      return h ? h === bare : true;
    })
    .sort((a, b) => {
      const ah = parseTo(a.child.to).hash ? 1 : 0;
      const bh = parseTo(b.child.to).hash ? 1 : 0;
      if (ah !== bh) return bh - ah; // an exact hash match outranks the bare path
      return parseTo(b.child.to).path.length - parseTo(a.child.to).path.length;
    });
  return scored[0] ?? {};
}

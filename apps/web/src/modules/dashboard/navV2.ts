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
 * MEDIA links are hash anchors on /signage (addendum ruling 3 — no new routes in this
 * beat); the hub expands + scrolls to the named section.
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
}

export interface NavSectionV2 {
  label: string;
  children: NavChildV2[];
}

export const HOME_V2: NavChildV2 = { to: "/dashboard", label: "HOME", minRole: "staff", end: true };

export const SECTIONS_V2: NavSectionV2[] = [
  {
    // Renamed from TRIVIA (owner decision B) — trivia is one game among future consoles.
    label: "GAMES",
    children: [
      { to: "/scoring", label: "SCORING", module: "trivia", group: "TRIVIA" },
      { to: "/game/setup", label: "GAME SETUP", module: "trivia", group: "TRIVIA" },
      { to: "/teams", label: "TEAMS", module: "trivia", group: "TRIVIA" },
      { to: "/game/history", label: "HISTORY", module: "trivia", group: "TRIVIA" },
      // The reserved second-console slot. Never navigates (nothing is built yet).
      { to: "", label: "READ THE ROOM", module: "trivia", comingSoon: true },
      // SEASONS ranks trivia seasons but is admin-only, so it sits outside the TRIVIA group.
      { to: "/admin/seasons", label: "SEASONS", minRole: "admin" },
    ],
  },
  {
    label: "BAR OPS",
    children: [
      { to: "/signage", label: "SIGNAGE HUB", module: "signage" },
      { to: "/signage#events", label: "EVENTS & PROMOS", module: "signage" },
      { to: "/admin/drinks", label: "TOP SELLERS", module: "drinks" },
    ],
  },
  {
    // Promoted out of the Signage Hub (owner decision A). Organisation only — the
    // surfaces themselves are unchanged and still live on /signage.
    label: "MEDIA",
    children: [
      { to: "/signage#library", label: "LIBRARY", module: "signage" },
      { to: "/signage#playlists", label: "PLAYLISTS", module: "signage" },
      { to: "/signage#screens", label: "SCREENS & PROGRAMS", module: "signage" },
    ],
  },
  {
    label: "SYSTEM",
    children: [
      { to: "/admin/users", label: "USERS", minRole: "admin" },
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

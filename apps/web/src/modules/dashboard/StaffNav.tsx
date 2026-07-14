import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation, NavLink } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { useIsMobile } from "@/shared/useIsMobile";
import { hasModule, roleAtLeast, useRole, type ModuleKey, type StaffRole } from "@/shared/useRole";

/**
 * Slim persistent staff header. Renders above every staff route via the StaffLayout
 * wrapper in App.tsx so moving between tools never needs the URL bar. NOT present on
 * public/display/checkin/portal routes (kiosk + perf rules).
 *
 * UX-refinement wave: the flat NAV list is now a grouped two-tier IA organised by
 * "which system am I in" (docs/ux-refinement-mockup.html, owner-ratified 2026-07-13):
 *   HOME (top-level link) · TRIVIA · BAR OPS · SYSTEM.
 * Desktop: top bar = brand + HOME + section names; the active section reveals its
 * children in a sub-nav row below. Mobile: the ▚ MENU drawer becomes HOME + dim
 * section headers with their children indented (headers are NOT accordions).
 *
 * Self-gating: while clearance is loading or the viewer isn't staff, it renders only
 * the Outlet (RequireRole inside the route handles the actual redirect / deny screen),
 * so it never flashes chrome at a signed-out visitor. A section is visible iff at least
 * one of its children passes its gate; children filter individually.
 */

const MONO = "'VT323','Share Tech Mono',monospace";

// A nav child is shown when its gate passes: `module` → has_module grant (admin implied);
// `minRole` → rank (used for HOME/admin-only entries that aren't module-scoped).
interface NavChild { to: string; label: string; module?: ModuleKey; minRole?: StaffRole; end?: boolean }
interface NavSection { label: string; children: NavChild[] }

// HOME is a plain top-level link, not a section.
const HOME: NavChild = { to: "/dashboard", label: "HOME", minRole: "staff" };

// Two-tier IA. Sections grow children over time (EVENTS & PROMOS / BROADCAST land in
// later tasks) without ever crowding the top bar.
const SECTIONS: NavSection[] = [
  {
    label: "TRIVIA",
    children: [
      { to: "/scoring", label: "SCORING", module: "trivia" },
      { to: "/game/setup", label: "GAME SETUP", module: "trivia" },
      { to: "/teams", label: "TEAMS", module: "trivia" },
      { to: "/game/history", label: "HISTORY", module: "trivia" },
      // SEASONS ranks trivia seasons, so it lives with the trivia tools (ratified IA).
      { to: "/admin/seasons", label: "SEASONS", minRole: "admin" },
    ],
  },
  {
    label: "BAR OPS",
    children: [
      // `end` so the hub link only lights on exactly /signage, not its child pages
      // (/signage/screens/:slug, /signage/broadcast, /signage/events).
      { to: "/signage", label: "SIGNAGE HUB", module: "signage", end: true },
      // EVENTS & PROMOS = scheduled/recurring promos + moments (docs/13). Own module grant.
      { to: "/signage/events", label: "EVENTS & PROMOS", module: "events" },
      { to: "/signage/broadcast", label: "BROADCAST", module: "signage" },
      // TOP SELLERS = the sales-rank board config (was mislabelled "DRINKS"). Route +
      // module key unchanged; only the staff-facing label is task-named.
      { to: "/admin/drinks", label: "TOP SELLERS", module: "drinks" },
    ],
  },
  {
    label: "SYSTEM",
    children: [
      { to: "/admin/users", label: "USERS", minRole: "admin" },
      // SETTINGS deliberately unlinked — /settings is still a Placeholder stub.
    ],
  },
];

const childVisible = (role: StaffRole | null, modules: ModuleKey[], c: NavChild) =>
  c.module ? hasModule(role, modules, c.module) : roleAtLeast(role, c.minRole ?? "staff");

// Longest matching path wins so e.g. /game/setup beats a bare / prefix.
const matchesPath = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(to + "/");

export function StaffLayout() {
  const { role, modules, isSignedIn, loading } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const homeVisible = childVisible(role, modules, HOME);
  // Per-section visible children; a section renders iff it has at least one.
  const sections = SECTIONS.map((s) => ({
    ...s,
    children: s.children.filter((c) => childVisible(role, modules, c)),
  })).filter((s) => s.children.length > 0);

  // Active child = longest-prefix match across HOME + every visible child. The active
  // SECTION is the one that owns that child (undefined when we're on HOME).
  const flat: Array<{ child: NavChild; section?: NavSection }> = [
    ...(homeVisible ? [{ child: HOME }] : []),
    ...sections.flatMap((s) => s.children.map((c) => ({ child: c, section: s }))),
  ];
  const activeEntry = flat
    .filter((e) => matchesPath(location.pathname, e.child.to))
    .sort((a, b) => b.child.to.length - a.child.to.length)[0];
  const activeChild = activeEntry?.child;
  const activeSection = activeEntry?.section;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  // Clicking a section name jumps to its first visible child.
  const goToSection = (s: { children: NavChild[] }) => {
    if (s.children[0]) navigate(s.children[0].to);
  };

  // Close the drawer on any route change (covers link taps + browser back/forward).
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  // Drop the drawer if we cross back up to the desktop bar.
  useEffect(() => { if (!isMobile) setMenuOpen(false); }, [isMobile]);

  // Don't paint chrome until we know the viewer is staff (avoids a flash on redirect).
  const showNav = !loading && isSignedIn && roleAtLeast(role, "staff");
  const roleLabel = `VIEWING AS ${(role ?? "—").toUpperCase()}`;

  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100vh" }}>
      {showNav && (isMobile ? (
        /* ---- Mobile: compact header + grouped drawer ---- */
        <nav style={mobileNav}>
          <div style={mobileBar}>
            <NavLink to="/dashboard" className="u-head" style={{ ...mobileBrand, textDecoration: "none" }}>▚ BUNKER OS</NavLink>
            {activeChild && activeChild.to !== HOME.to && (
              <span style={mobileSection} aria-hidden="true">▸ {activeChild.label}</span>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className={menuOpen ? "u-fill u-ink" : ""}
              style={menuToggle}
            >
              {menuOpen ? "▟ CLOSE" : "▚ MENU"}
            </button>
          </div>
          {menuOpen && (
            <>
              {/* Backdrop: a tap anywhere outside the drawer closes it. */}
              <div style={backdrop} onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div className="staffnav-drawer" style={drawer} role="menu">
                {homeVisible && (
                  <NavLink
                    to={HOME.to}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => (isActive ? "u-fill u-ink" : "")}
                    style={({ isActive }) => ({ ...drawerLink, ...(isActive ? drawerLinkActive : null) })}
                  >
                    {HOME.label}
                  </NavLink>
                )}
                {sections.map((s) => (
                  <div key={s.label}>
                    {/* Section headers are labels, not tappable — one thumb-scroll shows all. */}
                    <div style={drawerSectionHeader} aria-hidden="true">{s.label}</div>
                    {s.children.map((c) => (
                      <NavLink
                        key={c.to}
                        to={c.to}
                        end={c.end}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className={({ isActive }) => (isActive ? "u-fill u-ink" : "")}
                        style={({ isActive }) => ({ ...drawerSubLink, ...(isActive ? drawerLinkActive : null) })}
                      >
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                ))}
                <div style={drawerFooter}>
                  <span style={{ fontSize: 16, opacity: 0.6, letterSpacing: 1 }}>{roleLabel}</span>
                  <button type="button" onClick={signOut} className="u-amber" style={signOutBtn}>SIGN OUT</button>
                </div>
              </div>
            </>
          )}
        </nav>
      ) : (
        /* ---- Desktop: two-tier bar (section names + active-section sub-nav) ---- */
        <nav style={desktopNav}>
          <div style={desktopTopRow}>
            <NavLink to="/dashboard" className="u-head" style={{ ...brand, textDecoration: "none" }}>▚ BUNKER OS</NavLink>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap", flex: 1 }}>
              {homeVisible && (
                <NavLink
                  to={HOME.to}
                  end
                  className={({ isActive }) => "u-head" + (isActive ? " u-fill u-ink" : "")}
                  style={({ isActive }) => ({ ...sect, ...(isActive ? sectActive : null) })}
                >
                  {HOME.label}
                </NavLink>
              )}
              {sections.map((s) => {
                const on = s === activeSection;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => goToSection(s)}
                    className={"u-head" + (on ? " u-fill u-ink" : "")}
                    style={{ ...sect, cursor: "pointer", ...(on ? sectActive : null) }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 16, opacity: 0.6, letterSpacing: 1, marginRight: 8, whiteSpace: "nowrap" }}>
              {roleLabel}
            </span>
            <button type="button" onClick={signOut} className="u-amber" style={signOutBtn}>SIGN OUT</button>
          </div>
          {/* Sub-nav row for the active section only. No row on HOME. */}
          {activeSection && (
            <div style={subRow}>
              {/* Amber accent #1 (owner-approved "just a bit"): the dim section kicker
                  in the sub-nav — signals "which system" without shouting. */}
              <span className="u-amber" style={subKick}>{activeSection.label} ▸</span>
              {activeSection.children.map((c) => (
                <NavLink
                  key={c.to}
                  to={c.to}
                  end={c.end}
                  className={({ isActive }) => (isActive ? "u-fill u-ink" : "")}
                  style={({ isActive }) => ({ ...subItem, ...(isActive ? subItemActive : null) })}
                >
                  {c.label}
                </NavLink>
              ))}
            </div>
          )}
        </nav>
      ))}
      <Outlet />
    </div>
  );
}

/* ---- Desktop styles ---- */
const desktopNav: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 50,
  background: "#000",
  borderBottom: "1px solid var(--terminal-green)",
  fontFamily: MONO,
};
const desktopTopRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
  padding: "8px 14px",
};
const brand: React.CSSProperties = {
  fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "var(--terminal-green)",
  marginRight: 12, whiteSpace: "nowrap",
};
const sect: React.CSSProperties = {
  fontSize: 20, letterSpacing: 1.5, color: "var(--terminal-green)",
  textDecoration: "none", padding: "4px 14px", border: "1px solid transparent",
  fontFamily: MONO, background: "transparent", whiteSpace: "nowrap",
};
const sectActive: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", fontWeight: 700,
};
const subRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
  padding: "6px 14px",
  borderTop: "1px solid rgba(0,255,65,0.14)",
  background: "#020402",
};
const subKick: React.CSSProperties = {
  fontSize: 13, letterSpacing: 3, opacity: 0.6, marginRight: 6, whiteSpace: "nowrap",
};
const subItem: React.CSSProperties = {
  fontSize: 16, letterSpacing: 1, color: "var(--terminal-green)", opacity: 0.72,
  textDecoration: "none", padding: "4px 12px", border: "1px solid transparent",
  whiteSpace: "nowrap",
};
const subItemActive: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", fontWeight: 700, opacity: 1,
};
const signOutBtn: React.CSSProperties = {
  fontSize: 16, letterSpacing: 1, color: "var(--terminal-amber, #ffb000)",
  background: "transparent", border: "1px solid var(--terminal-amber, #ffb000)",
  padding: "4px 10px", cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap",
};

/* ---- Mobile styles ---- */
const mobileNav: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 50,
  background: "#000",
  borderBottom: "1px solid var(--terminal-green)",
  fontFamily: MONO,
};
const mobileBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 12px",
};
const mobileBrand: React.CSSProperties = {
  display: "flex", alignItems: "center", minHeight: 44,
  fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: "var(--terminal-green)",
  whiteSpace: "nowrap",
};
const mobileSection: React.CSSProperties = {
  flex: 1, minWidth: 0, textAlign: "center",
  fontSize: 15, letterSpacing: 1, color: "var(--terminal-green)", opacity: 0.7,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
const menuToggle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  marginLeft: "auto",
  minHeight: 44, minWidth: 88, padding: "0 14px",
  fontSize: 18, letterSpacing: 1, fontFamily: MONO,
  color: "var(--terminal-green)", background: "transparent",
  border: "1px solid var(--terminal-green)", cursor: "pointer",
};
const backdrop: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 40, background: "rgba(0,0,0,0.5)",
};
const drawer: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60,
  display: "flex", flexDirection: "column",
  background: "#000",
  borderBottom: "1px solid var(--terminal-green)",
  borderTop: "1px solid rgba(0,255,65,0.25)",
  maxHeight: "calc(100vh - 60px)", overflowY: "auto",
  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
};
const drawerLink: React.CSSProperties = {
  display: "flex", alignItems: "center", minHeight: 48,
  padding: "0 18px",
  fontSize: 20, letterSpacing: 1, color: "var(--terminal-green)",
  textDecoration: "none",
  borderBottom: "1px solid rgba(0,255,65,0.15)",
};
const drawerSubLink: React.CSSProperties = {
  ...drawerLink,
  paddingLeft: 30, fontSize: 19, opacity: 0.85,
};
const drawerSectionHeader: React.CSSProperties = {
  padding: "11px 16px 5px", fontSize: 12, letterSpacing: 4, opacity: 0.45,
  color: "var(--terminal-green)",
  borderBottom: "1px solid rgba(0,255,65,0.15)", background: "#020402",
};
const drawerLinkActive: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", fontWeight: 700, opacity: 1,
};
const drawerFooter: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "14px 18px",
};

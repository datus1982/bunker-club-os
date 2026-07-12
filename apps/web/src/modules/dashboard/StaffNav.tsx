import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation, NavLink } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { hasModule, roleAtLeast, useRole, type ModuleKey, type StaffRole } from "@/shared/useRole";

/**
 * Slim persistent staff header (Phase 4b). Renders above every staff route via the
 * StaffLayout wrapper in App.tsx so moving between tools never needs the URL bar.
 * NOT present on public/display/checkin/portal routes (kiosk + perf rules).
 *
 * Self-gating: while clearance is loading or the viewer isn't staff, it renders only
 * the Outlet (RequireRole inside the route handles the actual redirect / deny screen),
 * so it never flashes chrome at a signed-out visitor.
 *
 * Phase 4c: below MOBILE_BREAKPOINT the wrapping flex bar (which ate ~404px / 48% of a
 * 390px viewport) collapses to a compact single-row header + a `▚ MENU` drawer. At or
 * above the breakpoint the desktop bar renders EXACTLY as before — same DOM, same styles.
 */

const MONO = "'VT323','Share Tech Mono',monospace";
const MOBILE_BREAKPOINT = 640; // px; below this we collapse to the drawer

// A nav item is shown when its gate passes: `module` → has_module grant (admin implied);
// `minRole` → rank (used for HOME/admin-only entries that aren't module-scoped).
interface NavItem { to: string; label: string; module?: ModuleKey; minRole?: StaffRole }

const NAV: NavItem[] = [
  { to: "/dashboard", label: "HOME", minRole: "staff" },
  { to: "/scoring", label: "TRIVIA", module: "trivia" },
  { to: "/game/setup", label: "GAME SETUP", module: "trivia" },
  { to: "/teams", label: "TEAMS", module: "trivia" },
  { to: "/history", label: "HISTORY", module: "trivia" },
  { to: "/admin/drinks", label: "DRINKS", module: "drinks" },
  { to: "/admin/seasons", label: "SEASONS", minRole: "admin" },
  { to: "/admin/users", label: "USERS", minRole: "admin" },
];

// matchMedia hook — true when the viewport is narrower than the mobile breakpoint.
// Conditional render (not just CSS) is needed because the collapsed layout is a
// different DOM shape (drawer) than the desktop bar.
function useIsMobile() {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return isMobile;
}

export function StaffLayout() {
  const { role, modules, isSignedIn, loading } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const visible = (i: NavItem) =>
    i.module ? hasModule(role, modules, i.module) : roleAtLeast(role, i.minRole ?? "staff");
  const items = NAV.filter(visible);

  // Current section for the collapsed indicator — longest matching path wins so that
  // e.g. /game/setup beats a bare / prefix. Survives into the drawer as the active item.
  const active = items
    .filter((i) => location.pathname === i.to || location.pathname.startsWith(i.to + "/"))
    .sort((a, b) => b.to.length - a.to.length)[0];

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  // Close the drawer on any route change (covers link taps + browser back/forward).
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  // Drop the drawer if we cross back up to the desktop bar.
  useEffect(() => { if (!isMobile) setMenuOpen(false); }, [isMobile]);

  // Don't paint chrome until we know the viewer is staff (avoids a flash on redirect).
  const showNav = !loading && isSignedIn && roleAtLeast(role, "staff");
  const roleLabel = `VIEWING AS ${(role ?? "—").toUpperCase()}`;

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh" }}>
      {showNav && (isMobile ? (
        /* ---- Mobile: compact header + collapsible drawer ---- */
        <nav style={mobileNav}>
          <div style={mobileBar}>
            <NavLink to="/dashboard" style={{ ...mobileBrand, textDecoration: "none" }}>▚ BUNKER OS</NavLink>
            {active && (
              <span style={mobileSection} aria-hidden="true">▸ {active.label}</span>
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
                {items.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => (isActive ? "u-fill u-ink" : "")}
                    style={({ isActive }) => ({ ...drawerLink, ...(isActive ? drawerLinkActive : null) })}
                  >
                    {i.label}
                  </NavLink>
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
        /* ---- Desktop: single horizontal bar (unchanged from Phase 4b) ---- */
        <nav
          style={{
            position: "sticky", top: 0, zIndex: 50,
            display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
            padding: "8px 14px",
            background: "#000",
            borderBottom: "1px solid var(--terminal-green)",
            fontFamily: MONO,
          }}
        >
          <NavLink to="/dashboard" style={{ ...brand, textDecoration: "none" }}>▚ BUNKER OS</NavLink>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap", flex: 1 }}>
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                className={({ isActive }) => (isActive ? "u-ink" : "")}
                style={({ isActive }) => ({ ...link, ...(isActive ? linkActive : null) })}
              >
                {i.label}
              </NavLink>
            ))}
          </div>
          <span style={{ fontSize: 16, opacity: 0.6, letterSpacing: 1, marginRight: 8, whiteSpace: "nowrap" }}>
            {roleLabel}
          </span>
          <button type="button" onClick={signOut} className="u-amber" style={signOutBtn}>SIGN OUT</button>
        </nav>
      ))}
      <Outlet />
    </div>
  );
}

const brand: React.CSSProperties = {
  fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "var(--terminal-green)",
  marginRight: 12, whiteSpace: "nowrap",
};
const link: React.CSSProperties = {
  fontSize: 18, letterSpacing: 1, color: "var(--terminal-green)",
  textDecoration: "none", padding: "4px 10px", border: "1px solid transparent",
};
const linkActive: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", fontWeight: 700,
};
const signOutBtn: React.CSSProperties = {
  fontSize: 16, letterSpacing: 1, color: "var(--terminal-amber, #ffb000)",
  background: "transparent", border: "1px solid var(--terminal-amber, #ffb000)",
  padding: "4px 10px", cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap",
};

/* ---- Mobile-only styles (Phase 4c) ---- */
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
const drawerLinkActive: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", fontWeight: 700,
};
const drawerFooter: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "14px 18px",
};

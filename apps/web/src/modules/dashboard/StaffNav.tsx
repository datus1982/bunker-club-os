import { Outlet, useNavigate, NavLink } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { roleAtLeast, useRole, type StaffRole } from "@/shared/useRole";

/**
 * Slim persistent staff header (Phase 4b). Renders above every staff route via the
 * StaffLayout wrapper in App.tsx so moving between tools never needs the URL bar.
 * NOT present on public/display/checkin/portal routes (kiosk + perf rules).
 *
 * Self-gating: while clearance is loading or the viewer isn't staff, it renders only
 * the Outlet (RequireRole inside the route handles the actual redirect / deny screen),
 * so it never flashes chrome at a signed-out visitor.
 */

const MONO = "'VT323','Share Tech Mono',monospace";

interface NavItem { to: string; label: string; min: StaffRole }

const NAV: NavItem[] = [
  { to: "/dashboard", label: "HOME", min: "staff" },
  { to: "/scoring", label: "TRIVIA", min: "host" },
  { to: "/game/setup", label: "GAME SETUP", min: "host" },
  { to: "/teams", label: "TEAMS", min: "host" },
  { to: "/history", label: "HISTORY", min: "host" },
  { to: "/admin/drinks", label: "DRINKS", min: "staff" },
  { to: "/admin/seasons", label: "SEASONS", min: "admin" },
];

export function StaffLayout() {
  const { role, isSignedIn, loading } = useRole();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  // Don't paint chrome until we know the viewer is staff (avoids a flash on redirect).
  const showNav = !loading && isSignedIn && roleAtLeast(role, "staff");

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh" }}>
      {showNav && (
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
            {NAV.filter((i) => roleAtLeast(role, i.min)).map((i) => (
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
            VIEWING AS {(role ?? "—").toUpperCase()}
          </span>
          <button type="button" onClick={signOut} className="u-amber" style={signOutBtn}>SIGN OUT</button>
        </nav>
      )}
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

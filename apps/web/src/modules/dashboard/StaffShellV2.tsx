import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { useIsMobile } from "@/shared/useIsMobile";
import { roleAtLeast, useRole } from "@/shared/useRole";
import { SectionNav } from "@/shared/ui";
import { HOME_V2, childVisibleV2, resolveActiveV2, visibleSectionsV2 } from "./navV2";
import { UiVersionToggle } from "./UiVersionToggle";
import "@/theme/staff-shell-v2.css";

/**
 * The v2 staff shell (UX overhaul Beat 1) — rendered by StaffLayout ONLY when this
 * device has opted in (`bunker.ui_version === "v2"`). Classic is untouched and remains
 * the default for everyone.
 *
 * Same contract as the classic shell: same root wrapper (`terminal-theme staff-ui`, so
 * every page keeps the staff fonts + 2px glow), same self-gating (no chrome until we
 * know the viewer is staff — RequireRole/RequireModule inside each route still does the
 * actual denying), same Outlet. It adds `staff-v2`, which is the only hook its
 * stylesheet answers to.
 */
export function StaffShellV2() {
  const { role, modules, isSignedIn, loading } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const homeVisible = childVisibleV2(role, modules, HOME_V2);
  const sections = visibleSectionsV2(role, modules);
  const { child: activeChild, section: activeSection } = resolveActiveV2(
    location.pathname,
    location.hash,
    homeVisible ? HOME_V2 : null,
    sections,
  );

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const showNav = !loading && isSignedIn && roleAtLeast(role, "staff");

  return (
    <div className="terminal-theme staff-ui staff-v2" style={{ minHeight: "100vh" }}>
      {showNav && (
        <SectionNav
          home={homeVisible ? HOME_V2 : null}
          sections={sections}
          activeTo={activeChild?.to}
          activeSectionLabel={activeSection?.label}
          isMobile={isMobile}
          roleLabel={`VIEWING AS ${(role ?? "—").toUpperCase()}`}
          onSignOut={signOut}
          extra={<UiVersionToggle />}
        />
      )}
      <Outlet />
    </div>
  );
}

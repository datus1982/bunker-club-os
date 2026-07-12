import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { hasModule, roleAtLeast, useRole, type ModuleKey, type StaffRole } from "./useRole";
import { useSession } from "./useSession";

function TerminalNotice({ text }: { text: string }) {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: 48 }}>
      <div className="terminal-border" style={{ display: "inline-block", padding: 24 }}>
        {text}
      </div>
    </div>
  );
}

/**
 * Requires any authenticated user (players + staff). Scaffolding — the real
 * player OTP sign-in flow lands in Phase 2 (registration v2). For now it gates,
 * showing where sign-in belongs rather than implementing it.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <TerminalNotice text="AUTHENTICATING…" />;
  if (!session) return <Navigate to="/checkin" replace />;
  return <>{children}</>;
}

/**
 * <RequireRole role="host"> — gates staff routes by minimum venue role (docs/01).
 * admin satisfies host satisfies staff.
 */
export function RequireRole({ role, children }: { role: StaffRole; children: ReactNode }) {
  const { role: current, loading, isSignedIn } = useRole();
  const location = useLocation();
  if (loading) return <TerminalNotice text="CHECKING CLEARANCE…" />;
  // Staff routes send unauthenticated users to the staff login (players use /checkin).
  if (!isSignedIn) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!roleAtLeast(current, role)) {
    return <TerminalNotice text={`ACCESS DENIED — requires ${role.toUpperCase()} clearance.`} />;
  }
  return <>{children}</>;
}

/**
 * <RequireModule module="drinks"> — gates a route on an explicit module grant (0024).
 * Admins implicitly hold every module; everyone else needs it in venue_staff.modules.
 * Direct-URL access to an ungranted module renders a themed ACCESS DENIED, never a crash.
 */
export function RequireModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { role, modules, loading, isSignedIn } = useRole();
  const location = useLocation();
  if (loading) return <TerminalNotice text="CHECKING CLEARANCE…" />;
  if (!isSignedIn) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!hasModule(role, modules, module)) {
    return <TerminalNotice text={`ACCESS DENIED — the ${module.toUpperCase()} module is not enabled for your account.`} />;
  }
  return <>{children}</>;
}

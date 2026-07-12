import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { useRole } from "@/shared/useRole";

/**
 * Minimal staff sign-in (email + password). Pulled forward from Phase 2 (docs/05)
 * so host tools + the parity checklist can be exercised end-to-end before the full
 * Registration v2 auth lands. Players still use /checkin (email OTP, Phase 2); this
 * is the staff/host door only. The full auth (OTP, password reset, staff invite) is
 * Phase 2's job — keep this deliberately small.
 */
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/dashboard";

  const { isSignedIn, role } = useRole();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else navigate(from, { replace: true });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail("");
    setPassword("");
  };

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div className="terminal-border" style={{ width: 460, maxWidth: "100%", padding: 32 }}>
        <div style={{ fontSize: 24, opacity: 0.7, letterSpacing: 3 }}>BUNKER UNIFIED OS</div>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, marginTop: 4 }}>SHELTER AUTHORITY LOGIN</h1>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        {isSignedIn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 24 }}>
              SIGNED IN · CLEARANCE: {(role ?? "NONE").toUpperCase()}
            </div>
            <button type="button" onClick={() => navigate(from, { replace: true })} style={btnPrimary}>CONTINUE →</button>
            <button type="button" onClick={signOut} style={btnGhost}>SIGN OUT</button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 20, opacity: 0.8 }}>EMAIL</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required style={input} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 20, opacity: 0.8 }}>PASSWORD</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required style={input} />
            </label>
            {error && <div style={{ fontSize: 20 }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={btnPrimary}>{busy ? "AUTHENTICATING…" : "SIGN IN"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  background: "#000",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "10px 12px",
  fontSize: 24,
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)",
  color: "#000",
  border: "1px solid var(--terminal-green)",
  padding: "12px 20px",
  fontSize: 26,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "10px 16px",
  fontSize: 22,
  cursor: "pointer",
  fontFamily: "'VT323','Share Tech Mono',monospace",
};

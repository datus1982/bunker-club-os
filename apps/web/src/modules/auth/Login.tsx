import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { roleAtLeast, useRole } from "@/shared/useRole";

/**
 * Staff sign-in door. Two ways in (Phase 4b):
 *  - PASSWORD (email + password), and
 *  - CODE (email OTP — the same signInWithOtp flow players use). Staff are distinguished
 *    by their venue_staff role, NOT the auth method, so the OTP path means a host who
 *    forgot their password never has to touch the Supabase dashboard to get back in.
 *
 * After auth, role decides the destination: staff+ land on the admin shell (/dashboard,
 * or wherever RequireRole bounced them from); a non-staff account that somehow signs in
 * here is sent to the player portal. Players normally use /checkin, not this page.
 */
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/dashboard";

  const { isSignedIn, role, loading: roleLoading } = useRole();

  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once authenticated and the role is resolved, route by clearance.
  useEffect(() => {
    if (!isSignedIn || roleLoading) return;
    navigate(roleAtLeast(role, "staff") ? from : "/portal", { replace: true });
  }, [isSignedIn, roleLoading, role, from, navigate]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    // success → the effect above redirects once the role query resolves.
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    // shouldCreateUser:false — this is a sign-in door, not registration; a typo'd
    // email must not mint a new auth user here.
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) setError(error.message);
    else setCodeSent(true);
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError(error.message);
    // success → redirect effect fires.
  };

  const [resetSent, setResetSent] = useState(false);
  const sendReset = async () => {
    if (!email) { setError("Enter your email first."); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setResetSent(true);
  };

  const signedInBusy = isSignedIn && roleLoading;

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div className="terminal-border" style={{ width: 460, maxWidth: "100%", padding: 32 }}>
        <div style={{ fontSize: 24, opacity: 0.7, letterSpacing: 3 }}>BUNKER UNIFIED OS</div>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, marginTop: 4 }}>SHELTER AUTHORITY LOGIN</h1>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        {isSignedIn ? (
          <div style={{ fontSize: 24 }}>{signedInBusy ? "CHECKING CLEARANCE…" : "SIGNED IN — REDIRECTING…"}</div>
        ) : (
          <>
            {/* Method toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button type="button" className={mode === "password" ? "u-fill u-ink" : ""} onClick={() => { setMode("password"); setError(null); }} style={mode === "password" ? tabActive : tab}>PASSWORD</button>
              <button type="button" className={mode === "code" ? "u-fill u-ink" : ""} onClick={() => { setMode("code"); setError(null); }} style={mode === "code" ? tabActive : tab}>EMAIL CODE</button>
            </div>

            {mode === "password" ? (
              <form onSubmit={submitPassword} style={col}>
                <Label text="EMAIL">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required style={input} />
                </Label>
                <Label text="PASSWORD">
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required style={input} />
                </Label>
                {error && <div style={{ fontSize: 20 }}>⚠ {error}</div>}
                <button type="submit" disabled={busy} className="u-fill u-ink" style={btnPrimary}>{busy ? "AUTHENTICATING…" : "SIGN IN"}</button>
                {resetSent ? (
                  <div style={{ fontSize: 17, opacity: 0.75 }}>✓ If that email has an account, a reset link is on its way. Or just use <b>EMAIL CODE</b> — no reset needed.</div>
                ) : (
                  <button type="button" onClick={sendReset} disabled={busy} style={{ ...btnGhost, fontSize: 17, opacity: 0.7, alignSelf: "flex-start", padding: "4px 8px", border: "none" }}>Forgot password? Send a reset link →</button>
                )}
              </form>
            ) : !codeSent ? (
              <form onSubmit={sendCode} style={col}>
                <Label text="EMAIL">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required style={input} />
                </Label>
                <div style={{ fontSize: 18, opacity: 0.7 }}>We'll send a 6-digit code to your staff email.</div>
                {error && <div style={{ fontSize: 20 }}>⚠ {error}</div>}
                <button type="submit" disabled={busy} className="u-fill u-ink" style={btnPrimary}>{busy ? "SENDING…" : "SEND CODE"}</button>
              </form>
            ) : (
              <form onSubmit={verifyCode} style={col}>
                <div style={{ fontSize: 20, opacity: 0.8 }}>Code sent to {email}.</div>
                <Label text="6-DIGIT CODE">
                  <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required style={{ ...input, letterSpacing: 8, fontSize: 30 }} maxLength={6} />
                </Label>
                {error && <div style={{ fontSize: 20 }}>⚠ {error}</div>}
                <button type="submit" disabled={busy} className="u-fill u-ink" style={btnPrimary}>{busy ? "VERIFYING…" : "VERIFY"}</button>
                <button type="button" onClick={() => { setCodeSent(false); setCode(""); setError(null); }} style={btnGhost}>← USE A DIFFERENT EMAIL</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 20, opacity: 0.8 }}>{text}</span>
      {children}
    </label>
  );
}

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const input: React.CSSProperties = {
  background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)",
  padding: "10px 12px", fontSize: 24, fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)",
  padding: "12px 20px", fontSize: 26, fontWeight: 700, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnGhost: React.CSSProperties = {
  background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)",
  padding: "10px 16px", fontSize: 20, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace",
};
const tab: React.CSSProperties = {
  flex: 1, background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)",
  padding: "10px 12px", minHeight: 44, fontSize: 20, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace",
  opacity: 0.6, whiteSpace: "nowrap",
};
const tabActive: React.CSSProperties = { ...tab, background: "var(--terminal-green)", color: "#000", fontWeight: 700, opacity: 1 };

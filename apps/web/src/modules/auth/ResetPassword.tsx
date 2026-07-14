import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { roleAtLeast, useRole } from "@/shared/useRole";

// Does the URL carry a recovery signal? The implicit-flow link lands as `#…&type=recovery`,
// a query link as `?…&type=recovery`. Captured at module scope: the auth client only clears
// the hash after a network round-trip, so import-time capture always precedes it (a mount-time
// read could lose that race and show the confirm gate to a genuine recovery user).
const urlIsRecovery =
  new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery" ||
  new URLSearchParams(window.location.search).get("type") === "recovery";

/**
 * Password-recovery landing (`/reset-password`). A Supabase recovery email links here
 * with a one-time token; the supabase client (detectSessionInUrl) exchanges it and fires
 * a PASSWORD_RECOVERY auth event, establishing a short-lived session that authorizes
 * exactly one thing: setting a new password via updateUser().
 *
 * Robust to both link shapes: the implicit-flow hash token (handled automatically →
 * PASSWORD_RECOVERY event) and a `?token_hash=…&type=recovery` query (verified here).
 *
 * NB: with OTP now the primary staff sign-in (EMAIL CODE on /login), this path is the
 * fallback for anyone who set a password and forgot it — not the main door.
 */

// "confirm" = an existing plain session with no recovery signal — we ask before
// letting it change its password (this page isn't the intended door for that).
type Phase = "checking" | "confirm" | "ready" | "invalid" | "done";

export function ResetPassword() {
  const navigate = useNavigate();
  const { role } = useRole();
  const [phase, setPhase] = useState<Phase>("checking");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolved = useRef(false);

  useEffect(() => {
    const markReady = () => { resolved.current = true; setPhase("ready"); };


    // 1) React to the recovery event the client fires once it processes the URL token.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") markReady();
    });

    // 2) Cover the cases the event doesn't: a ?token_hash=…&type=recovery query, or a
    //    session already in place before we subscribed.
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      if (tokenHash && type === "recovery") {
        const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
        if (!error) { markReady(); return; }
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        // A recovery URL that resolved to a session before the event fired → straight to
        // the form. A plain, already-signed-in session (no recovery signal) → confirm first.
        if (urlIsRecovery) { markReady(); return; }
        if (!resolved.current) {
          resolved.current = true;
          setSessionEmail(data.session.user.email ?? null);
          setPhase("confirm");
        }
        return;
      }
      // Give the client a beat to finish detectSessionInUrl before declaring the link dead.
      setTimeout(() => { if (!resolved.current) setPhase("invalid"); }, 1500);
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  // Cancel from the confirm step → back where a signed-in user belongs (mirrors Login's
  // post-auth routing: staff+ → dashboard, everyone else → portal).
  const cancelConfirm = () =>
    navigate(roleAtLeast(role, "staff") ? "/dashboard" : "/portal", { replace: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase("done");
    // The session is valid now; /login routes on by role (staff → dashboard, else portal).
    setTimeout(() => navigate("/login", { replace: true }), 1400);
  };

  return (
    <div className="terminal-theme staff-ui" style={wrap}>
      <div className="terminal-border" style={{ width: 460, maxWidth: "100%", padding: 32 }}>
        <div style={{ fontSize: 24, opacity: 0.7, letterSpacing: 3 }}>BUNKER UNIFIED OS</div>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, marginTop: 4 }}>SET NEW PASSWORD</h1>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        {phase === "checking" && <div style={{ fontSize: 24 }}>VERIFYING RESET LINK…</div>}

        {phase === "confirm" && (
          <div style={col}>
            <div style={{ fontSize: 22 }}>
              You are signed in{sessionEmail ? <> as <b>{sessionEmail}</b></> : null}. Change your password?
            </div>
            <div style={{ fontSize: 18, opacity: 0.75 }}>You reached this page without a reset link. Confirm to set a new password for this account.</div>
            <button type="button" className="u-fill u-ink" style={btnPrimary} onClick={() => setPhase("ready")}>CONFIRM — CHANGE PASSWORD</button>
            <button type="button" style={btnGhost} onClick={cancelConfirm}>← CANCEL</button>
          </div>
        )}

        {phase === "invalid" && (
          <div style={col}>
            <div style={{ fontSize: 22 }}>⚠ This reset link is invalid or has expired.</div>
            <div style={{ fontSize: 18, opacity: 0.75 }}>Reset links are single-use and expire after an hour. Head back to sign in — the fastest way in is <b>EMAIL CODE</b>, which needs no password.</div>
            <button type="button" className="u-fill u-ink" style={btnPrimary} onClick={() => navigate("/login")}>← BACK TO SIGN IN</button>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={submit} style={col}>
            <label style={fieldCol}>
              <span style={lbl}>NEW PASSWORD</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required style={input} />
            </label>
            <label style={fieldCol}>
              <span style={lbl}>CONFIRM PASSWORD</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required style={input} />
            </label>
            {error && <div style={{ fontSize: 20 }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} className="u-fill u-ink" style={btnPrimary}>{busy ? "SAVING…" : "SAVE PASSWORD"}</button>
          </form>
        )}

        {phase === "done" && <div style={{ fontSize: 24 }}>✓ PASSWORD UPDATED — REDIRECTING…</div>}
      </div>
    </div>
  );
}

const MONO = "'VT323','Share Tech Mono',monospace";
const wrap: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px clamp(12px, 5vw, 40px)", fontFamily: MONO };
const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const fieldCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const lbl: React.CSSProperties = { fontSize: 20, opacity: 0.8 };
const input: React.CSSProperties = {
  background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)",
  padding: "10px 12px", fontSize: 24, fontFamily: MONO,
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)",
  padding: "12px 20px", fontSize: 26, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
};
const btnGhost: React.CSSProperties = {
  background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)",
  padding: "10px 20px", fontSize: 22, cursor: "pointer", fontFamily: MONO,
};

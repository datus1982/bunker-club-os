import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";

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

type Phase = "checking" | "ready" | "invalid" | "done";

export function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolved = useRef(false);

  useEffect(() => {
    const markReady = () => { resolved.current = true; setPhase("ready"); };

    // 1) React to the recovery event the client fires once it processes the URL token.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && !resolved.current)) markReady();
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
      if (data.session) { markReady(); return; }
      // Give the client a beat to finish detectSessionInUrl before declaring the link dead.
      setTimeout(() => { if (!resolved.current) setPhase("invalid"); }, 1500);
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

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
    <div className="terminal-theme" style={wrap}>
      <div className="terminal-border" style={{ width: 460, maxWidth: "100%", padding: 32 }}>
        <div style={{ fontSize: 24, opacity: 0.7, letterSpacing: 3 }}>BUNKER UNIFIED OS</div>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, marginTop: 4 }}>SET NEW PASSWORD</h1>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        {phase === "checking" && <div style={{ fontSize: 24 }}>VERIFYING RESET LINK…</div>}

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
const wrap: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, fontFamily: MONO };
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

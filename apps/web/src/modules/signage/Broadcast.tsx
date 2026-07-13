import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTakeovers } from "./useSignageAdmin";
import { MONO, TakeoverConsole, ghost } from "./signageAdminShared";
import "./signage.css";

/**
 * /signage/broadcast — the priority-takeover console as its own BAR OPS page (reached from
 * the Signage Hub quick action + the BROADCAST nav entry). Same console the old templater
 * embedded; only the page framing is new.
 */
export function Broadcast() {
  const qc = useQueryClient();
  const takeoversQ = useTakeovers();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["signage-admin", "takeovers"] });

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Link to="/signage" style={{ ...ghost, textDecoration: "none", fontSize: 16, display: "inline-block", marginBottom: 12 }}>← SIGNAGE HUB</Link>
        <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BAR OPS · SIGNAGE ▸ BROADCAST</div>
        <h1 style={{ fontSize: "clamp(28px,6vw,44px)", fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>BROADCAST</h1>
        <TakeoverConsole takeovers={takeoversQ.data ?? []} onChanged={invalidate} />
      </div>
    </div>
  );
}

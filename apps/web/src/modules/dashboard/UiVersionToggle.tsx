import type { CSSProperties } from "react";
import { useUiVersion } from "@/shared/useUiVersion";

/**
 * The classic ⇄ v2 shell switch (UX overhaul Beat 1).
 *
 * Rendered by BOTH shells so there is always a way back (addendum ruling 5). Styled
 * inline, not from staff-shell-v2.css: that stylesheet is loaded only by StaffShellV2,
 * and the classic header must not depend on it (classic gains this control and nothing
 * else). Quiet by design — a way out, not a feature. 44px tap floor either way.
 */
export function UiVersionToggle({ style }: { style?: CSSProperties }) {
  const [version, setVersion] = useUiVersion();
  const next = version === "v2" ? "classic" : "v2";
  return (
    <button
      type="button"
      onClick={() => setVersion(next)}
      title={next === "v2" ? "Switch to the new staff layout" : "Switch back to the current staff layout"}
      style={{ ...btn, ...style }}
    >
      {version === "v2" ? "← BACK TO CLASSIC" : "TRY THE NEW LAYOUT →"}
    </button>
  );
}

const btn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minHeight: 44, padding: "0 12px",
  // No fontSize here on purpose: `.staff-ui button{font-size:1.25rem!important}` wins
  // over any inline value, so this control sits at the shared 20px staff button scale
  // in BOTH shells rather than pretending to a size it can't have.
  letterSpacing: 1, whiteSpace: "nowrap",
  color: "var(--terminal-green)", background: "transparent",
  border: "1px dashed rgba(0,255,65,0.55)", cursor: "pointer", opacity: 0.8,
};

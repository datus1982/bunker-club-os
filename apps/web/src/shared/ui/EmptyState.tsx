import type { CSSProperties, ReactNode } from "react";

/**
 * The shared empty state (audit §5 #7 — closes the green-on-green class: the trivia
 * NO-GAME button was a filled green button with green text, i.e. invisible, PR #17).
 *
 * Contrast contract: the action renders OUTLINED (green ink on black) by default, so
 * it can never be green-on-green. `primary` opts into the filled treatment and pairs
 * it with `u-ink` (black text on the green fill) — the only legible filled variant.
 */
export function EmptyState({
  eyebrow,
  message,
  actionLabel,
  onAction,
  primary = false,
  style,
}: {
  /** Dim kicker above the message, e.g. "NO GAME LOADED". */
  eyebrow?: ReactNode;
  message: ReactNode;
  /** Optional single action. Omitted → the box is informational only. */
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** Filled action (black-on-green) instead of outlined. */
  primary?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...box, ...style }}>
      {eyebrow != null && <div style={eyebrowStyle}>{eyebrow}</div>}
      <div style={messageStyle}>{message}</div>
      {actionLabel != null && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={primary ? "u-fill u-ink" : ""}
          style={primary ? { ...action, ...actionPrimary } : action}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

const box: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  gap: 10, textAlign: "center",
  padding: "26px 18px",
  border: "1px solid rgba(0,255,65,0.35)",
  background: "#020402",
};
const eyebrowStyle: CSSProperties = { fontSize: 13, letterSpacing: 4, opacity: 0.5, color: "var(--terminal-green)" };
const messageStyle: CSSProperties = { fontSize: 18, lineHeight: 1.5, opacity: 0.85, color: "var(--terminal-green)", maxWidth: 460 };
const action: CSSProperties = {
  minHeight: 44, padding: "0 18px", cursor: "pointer",
  background: "transparent", color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", letterSpacing: 1,
};
const actionPrimary: CSSProperties = {
  background: "var(--terminal-green)", color: "#000", fontWeight: 700,
};

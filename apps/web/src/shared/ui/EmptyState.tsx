import type { CSSProperties, ReactNode } from "react";
import { radius, space, TAP } from "./tokens";

/**
 * The shared empty state (audit §5 #7 — closes the green-on-green class: the trivia
 * NO-GAME button was a filled green button with green text, i.e. invisible, PR #17).
 *
 * Contrast contract: the action renders OUTLINED (text tier on the card fill) by
 * default, so it can never be same-on-same. `primary` opts into the accent fill and
 * pairs it with `st-btn-primary`, which paints the ground colour ON the accent — the
 * only legible filled variant.
 *
 * BEAT 6 (PR 1): surface-1 card, hairline, 6px radius; eyebrow on the Label role,
 * message on Body. Colour comes from classes (inline colour loses to the base
 * `!important`).
 */
export function EmptyState({
  eyebrow,
  message,
  actionLabel,
  onAction,
  primary = false,
  style,
}: {
  /** Dim kicker above the message, e.g. "NO GAME LOADED". Label role — stays caps. */
  eyebrow?: ReactNode;
  message: ReactNode;
  /** Optional single action. Omitted → the box is informational only. */
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** Accent-filled action instead of outlined. */
  primary?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="st-card" style={{ ...box, ...style }}>
      {eyebrow != null && <div className="st-label st-t2">{eyebrow}</div>}
      <div className="st-body st-t2" style={messageStyle}>{message}</div>
      {actionLabel != null && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={primary ? "st-btn st-btn-primary" : "st-btn"}
          style={action}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

const box: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  gap: space.s3, textAlign: "center",
  padding: `${space.s6}px ${space.s4}px`,
  borderRadius: radius.control,
};
const messageStyle: CSSProperties = { maxWidth: 460 };
const action: CSSProperties = {
  minHeight: TAP, minWidth: TAP, padding: `0 ${space.s4 + 2}px`, cursor: "pointer",
  letterSpacing: 0.5, fontSize: 15,
};

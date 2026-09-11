import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { radius, space, TAP } from "./tokens";

/**
 * A boxed one-liner: "this moved", "heads up", a save confirmation (audit §5 #9).
 * `info` = neutral card; `warn` = the calmed-amber callout (§B reserves amber for
 * ambient/pending — red is a budget spent only on destructive + true failure).
 * The optional link is an in-app route (react-router `Link`), 44px tall so it stays
 * tappable on a phone.
 *
 * BEAT 6 (PR 1): on the tokens. Colour comes from the `st-*` classes — an inline
 * colour cannot beat `.terminal-theme * { color: green !important }`.
 */
export function InlineNotice({
  kind = "info",
  message,
  to,
  label,
  style,
}: {
  kind?: "info" | "warn";
  message: ReactNode;
  /** In-app destination for the trailing link. */
  to?: string;
  label?: ReactNode;
  style?: CSSProperties;
}) {
  const warn = kind === "warn";
  return (
    <div
      className={warn ? "st-card st-callout-warn" : "st-card"}
      role={warn ? "alert" : undefined}
      style={{ ...box, ...style }}
    >
      <span className={warn ? "st-body st-amber" : "st-body st-t2"} style={messageStyle}>{message}</span>
      {to && label != null && (
        <Link to={to} className={warn ? "st-btn st-amber" : "st-btn st-accent"} style={link}>
          {label}
        </Link>
      )}
    </div>
  );
}

const box: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: space.s3, flexWrap: "wrap",
  padding: `${space.s3}px ${space.s4}px`,
  borderRadius: radius.control,
};
const messageStyle: CSSProperties = { minWidth: 0 };
const link: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: TAP, minWidth: TAP,
  padding: `0 ${space.s3}px`, textDecoration: "none", fontSize: 14, letterSpacing: 0.5,
  whiteSpace: "nowrap", border: "1px solid",
};

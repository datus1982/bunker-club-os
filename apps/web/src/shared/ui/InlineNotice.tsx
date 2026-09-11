import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { radius, space, TAP } from "./tokens";

/**
 * A boxed one-liner: "this moved", "heads up", a save confirmation (audit §5 #9).
 * `info` = neutral card; `warn` = the calmed-amber callout; `danger` = its red twin.
 * §B: amber is ambient/pending, and red is a budget spent ONLY on destructive actions
 * and TRUE failure states (a bar screen that is actually offline — not one merely going
 * stale). The optional link is an in-app route (react-router `Link`), 44px tall so it
 * stays tappable on a phone.
 *
 * BEAT 6 (PR 1): on the tokens. Colour comes from the `st-*` classes — an inline
 * colour cannot beat `.terminal-theme * { color: green !important }`.
 * BEAT 6 (PR 2): `danger` added for the HOME alert strip. PURELY ADDITIVE — the `info`
 * and `warn` rows below render exactly the classes they did before.
 */
export function InlineNotice({
  kind = "info",
  message,
  to,
  label,
  style,
}: {
  kind?: "info" | "warn" | "danger";
  message: ReactNode;
  /** In-app destination for the trailing link. */
  to?: string;
  label?: ReactNode;
  style?: CSSProperties;
}) {
  const tone = TONE[kind];
  return (
    <div
      className={tone.box}
      // info is a passive note; warn and danger are states a screen reader should hear.
      role={kind === "info" ? undefined : "alert"}
      style={{ ...box, ...style }}
    >
      <span className={tone.text} style={messageStyle}>{message}</span>
      {to && label != null && (
        <Link to={to} className={tone.link} style={link}>
          {label}
        </Link>
      )}
    </div>
  );
}

/** Box fill, ink and link treatment per kind. `st-btn-danger` carries the red edge +
 *  hover the plain tone classes do not. */
const TONE = {
  info: { box: "st-card", text: "st-body st-t2", link: "st-btn st-accent" },
  warn: { box: "st-card st-callout-warn", text: "st-body st-amber", link: "st-btn st-amber" },
  danger: { box: "st-card st-callout-danger", text: "st-body st-danger", link: "st-btn st-btn-danger" },
} as const;

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

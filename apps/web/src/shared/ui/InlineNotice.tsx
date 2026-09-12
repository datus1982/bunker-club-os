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
 * BEAT 6 (PR 2, review NOTE-4), two accessibility fixes:
 *  · SEVERITY IS NOT COLOUR-ONLY. Each non-info tone draws a leading glyph (● danger,
 *    ⚠ warn). A caller whose copy already opens with its own mark passes `glyph={false}`
 *    rather than showing two.
 *  · ROLE. These are mostly PERSISTENT conditions a page renders on arrival, and
 *    `role="alert"` is assertive — it interrupts a screen-reader user for something that
 *    was already true before they got here. Default is `role="status"` (polite); a notice
 *    that genuinely appears MID-SESSION in response to an action passes `role="alert"`.
 */
export function InlineNotice({
  kind = "info",
  message,
  to,
  label,
  role,
  glyph = true,
  style,
}: {
  kind?: "info" | "warn" | "danger";
  message: ReactNode;
  /** In-app destination for the trailing link. */
  to?: string;
  label?: ReactNode;
  /** `status` (default, polite — a condition that is simply true) or `alert` (assertive —
   *  something that just happened). `info` notices are never announced either way. */
  role?: "status" | "alert";
  /** Draw the tone glyph. Pass false when the caller's own copy already carries one. */
  glyph?: boolean;
  style?: CSSProperties;
}) {
  const tone = TONE[kind];
  return (
    <div
      className={tone.box}
      role={kind === "info" ? undefined : role ?? "status"}
      style={{ ...box, ...style }}
    >
      <span className={tone.text} style={messageStyle}>
        {glyph && tone.glyph && (
          // aria-hidden: the glyph is redundant to a screen reader (the role already
          // announces it) and "BLACK CIRCLE" read aloud before the sentence is noise.
          <span aria-hidden="true" style={glyphStyle}>{tone.glyph}</span>
        )}
        {message}
      </span>
      {to && label != null && (
        <Link to={to} className={tone.link} style={link}>
          {label}
        </Link>
      )}
    </div>
  );
}

/** Box fill, ink, glyph and link treatment per kind. `st-btn-danger` carries the red edge
 *  + hover the plain tone classes do not. */
const TONE = {
  info: { box: "st-card", text: "st-body st-t2", link: "st-btn st-accent", glyph: "" },
  warn: { box: "st-card st-callout-warn", text: "st-body st-amber", link: "st-btn st-amber", glyph: "⚠" },
  danger: { box: "st-card st-callout-danger", text: "st-body st-danger", link: "st-btn st-btn-danger", glyph: "●" },
} as const;

const box: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: space.s3, flexWrap: "wrap",
  padding: `${space.s3}px ${space.s4}px`,
  borderRadius: radius.control,
};
const messageStyle: CSSProperties = { minWidth: 0 };
const glyphStyle: CSSProperties = { marginRight: space.s2 };
const link: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: TAP, minWidth: TAP,
  padding: `0 ${space.s3}px`, textDecoration: "none", fontSize: 14, letterSpacing: 0.5,
  whiteSpace: "nowrap", border: "1px solid",
};

import type { CSSProperties, ReactNode } from "react";
import { space } from "./tokens";

/**
 * The one status chip (audit §5 #6) — generalises the ad-hoc `.dot` / `.mode` /
 * `.typebadge` / PANEL badges that each page hand-rolled with its own size, border and
 * colour literal.
 *
 * COLOUR IS A CLASS, NEVER AN INLINE VALUE: `.terminal-theme * { color: green
 * !important }` beats any inline `color`, so a chip that tried to paint itself amber
 * would silently render green. The `st-*` token classes (and the `u-*` utilities they
 * re-declare) are what actually win, and the border rides `currentColor` so it always
 * matches whatever the class set.
 *
 * Size is inline px: nothing inherits font-size under `.terminal-theme` (a class rule
 * sets it on every element and inheritance has zero specificity — PR #89).
 *
 * BEAT 6 (PR 1) — the tones move onto the §B accent budget:
 *   `live`  → #00FF41, the ONE reserved full-saturation green: a true real-time state
 *   `info`  → the calmed accent #7FE6A8
 *   `idle`/`off` → the disabled text tier
 *   `neutral` → the SECONDARY text tier (see the tone note below)
 *   `warn`  → calmed amber #E8B04B
 *   `alert` → danger red #FF5A5A
 * DECISION (tagged, Beat 3, unchanged): the audit named five tones, but the surfaces
 * this replaces carry a genuine RED state — screen health DOWN and MODE: TAKEOVER — and
 * folding red into `warn` would change what an operator reads across the bar. `alert`
 * is that state, not a new one. §B's "red is a budget" is about destructive ACTIONS;
 * a screen that is actually down is the other half of that budget (true failure state).
 *
 * BEAT 6 (PR 3) — `neutral` is added, and `idle`/`off` are deliberately NOT changed.
 * PR 1's addendum ratified `idle`/`off` on the Disabled tier "with a caveat": those two
 * mark places where nothing is happening (an asset queued nowhere, a finished event) and
 * de-emphasis is honest there. A CONTROL that is switched off is the opposite case — its
 * state is the thing an operator came to read — and 3.5:1 is the wrong tier for it. Rather
 * than re-tier `off` (which would also lift the DONE/IDLE chips it is spent on in the hub),
 * `neutral` names "a readable state with no colour of its own" and Top Sellers' OFF chip
 * moves onto it. Tone, not a per-call-site override: the next off-state chip should be able
 * to ask for the same thing by name.
 */
export type StatusTone = "live" | "info" | "idle" | "off" | "neutral" | "warn" | "alert";

const TONE_CLASS: Record<StatusTone, string> = {
  live: "st-live",
  info: "st-accent",
  idle: "st-t3",
  off: "st-t3",
  neutral: "st-t2",
  warn: "st-amber",
  alert: "st-danger",
};

export function StatusChip({
  tone = "info",
  label,
  dot = false,
  title,
  style,
}: {
  tone?: StatusTone;
  label: ReactNode;
  /** Leading ● — for the states an operator scans for (health, ON AIR). */
  dot?: boolean;
  /** Native tooltip (e.g. the full slot name behind a one-letter code). */
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`st-chip ${TONE_CLASS[tone]}`}
      title={title}
      style={{ ...chip, ...style }}
    >
      {dot && <span style={{ fontSize: 12, flex: "0 0 auto" }} aria-hidden="true">●</span>}
      {/* The label needs its own block for text-overflow to fire: `text-overflow` is
          ignored on a flex CONTAINER, so a long chip (PROGRAM: ALL MEDIA (SHUFFLE) ·
          override) was being cut mid-word with no ellipsis. */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
        {label}
      </span>
    </span>
  );
}

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  letterSpacing: 0.06 * 12,
  lineHeight: 1.3,
  textTransform: "uppercase",
  padding: `${space.s1}px ${space.s2 + 2}px`,
  whiteSpace: "nowrap",
  // Never shrink below the label inside a flex row (a squeezed cell was cutting "DRINK"
  // down to "DRI…"), never grow past the container (the hub's 240px identity column holds
  // a chip whose label can be far longer — it ellipsizes there instead of widening the
  // page). A caller whose cell is genuinely too narrow gives the chips a row of their own.
  flex: "0 0 auto",
  maxWidth: "100%",
  overflow: "hidden",
};

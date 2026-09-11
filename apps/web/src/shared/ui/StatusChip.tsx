import type { CSSProperties, ReactNode } from "react";

/**
 * The one status chip (audit §5 #6) — generalises the ad-hoc `.dot` / `.mode` /
 * `.typebadge` / PANEL badges that each page hand-rolled with its own size, border and
 * colour literal.
 *
 * COLOUR IS A CLASS, NEVER AN INLINE VALUE: `.terminal-theme * { color: green
 * !important }` beats any inline `color`, so a chip that tried to paint itself amber
 * would silently render green. The theme's own escape hatches (`u-amber`, `u-red`,
 * `u-idle`) are what actually win, and the border rides `currentColor` so it always
 * matches whatever the class set.
 *
 * Size is inline px: nothing inherits font-size under `.terminal-theme` (a class rule
 * sets it on every element and inheritance has zero specificity — PR #89).
 *
 * Tones: `live` / `info` green · `idle` / `off` dim grey · `warn` amber · `alert` red.
 * DECISION (tagged, Beat 3): the audit named five tones, but the surfaces this replaces
 * carry a genuine RED state — screen health DOWN and MODE: TAKEOVER — and folding red
 * into `warn` would change what an operator reads across the bar. `alert` is that state,
 * not a new one.
 */
export type StatusTone = "live" | "info" | "idle" | "off" | "warn" | "alert";

const TONE_CLASS: Record<StatusTone, string> = {
  live: "",
  info: "",
  idle: "u-idle",
  off: "u-idle",
  warn: "u-amber",
  alert: "u-red",
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
      className={TONE_CLASS[tone]}
      title={title}
      style={{
        ...chip,
        opacity: tone === "idle" || tone === "off" ? 0.75 : 1,
        ...style,
      }}
    >
      {dot && <span style={{ fontSize: 15, flex: "0 0 auto" }} aria-hidden="true">●</span>}
      {/* The label needs its own block for text-overflow to fire: `text-overflow` is
          ignored on a flex CONTAINER, so a long chip (PROGRAM: ALL MEDIA (SHUFFLE) ·
          override) was being cut mid-word with no ellipsis. */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 15 }}>
        {label}
      </span>
    </span>
  );
}

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 15,
  letterSpacing: 1.5,
  lineHeight: 1.2,
  padding: "2px 8px",
  border: "1px solid currentColor",
  whiteSpace: "nowrap",
  maxWidth: "100%",
  minWidth: 0,
  overflow: "hidden",
};

import type { CSSProperties, ReactNode } from "react";

/**
 * The standard staff page heading (audit §5 #1, mockup `.eyebrow` / `.h2` / `.tag`).
 *
 *   SECTION ▸ PAGE        ← eyebrow (small, letterspaced, dim)
 *   PAGE TITLE   [tag]    ← h2 + optional right-hand slot
 *
 * Colour + typeface come from the surrounding `.terminal-theme staff-ui` shell (Share
 * Tech Mono headers, JetBrains Mono body, 2px glow). Sizes are explicit px because
 * NOTHING inherits font-size under `.terminal-theme` — a class rule sets it on every
 * element and inheritance has zero specificity (the load-bearing gotcha from PR #89).
 * Styles are inline (the house pattern) so the primitive works in either shell.
 */
export function StaffPageHeader({
  eyebrow,
  title,
  tag,
  right,
  style,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Small dim chip beside the title (e.g. a count or state). */
  tag?: ReactNode;
  /** Right-aligned slot on the title row (e.g. a primary action). */
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...wrap, ...style }}>
      {eyebrow != null && <div style={eyebrowStyle}>{eyebrow}</div>}
      <div style={row}>
        <h2 className="u-head" style={titleStyle}>
          {title}
          {tag != null && <span style={tagStyle}>{tag}</span>}
        </h2>
        {right != null && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</div>}
      </div>
    </div>
  );
}

const wrap: CSSProperties = { margin: "0 0 14px" };
const eyebrowStyle: CSSProperties = {
  fontSize: 13, letterSpacing: 4, opacity: 0.55, marginBottom: 6,
  color: "var(--terminal-green)", textTransform: "uppercase",
};
const row: CSSProperties = {
  display: "flex", alignItems: "baseline", justifyContent: "space-between",
  gap: 12, flexWrap: "wrap",
};
const titleStyle: CSSProperties = {
  fontSize: "clamp(26px,5vw,34px)", letterSpacing: 1.5, fontWeight: 700,
  margin: 0, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
  color: "var(--terminal-green)",
};
const tagStyle: CSSProperties = {
  fontSize: 13, letterSpacing: 2, opacity: 0.55, whiteSpace: "nowrap",
  border: "1px solid rgba(0,255,65,0.35)", padding: "2px 8px",
};

import type { CSSProperties, ReactNode } from "react";
import { space } from "./tokens";

/**
 * The standard staff page heading (audit §5 #1, mockup `.eyebrow` / `.h2` / `.tag`).
 *
 *   Section ▸ Page       ← eyebrow, Label role (the one role that stays UPPERCASE)
 *   Page title   [tag]   ← Display role, SENTENCE CASE, + optional right-hand slot
 *
 * BEAT 6 (PR 1): moved onto the token system. Two things changed here beyond colour:
 *  · `textTransform: "uppercase"` is GONE from the title. It was the app's ONE cascade
 *    caps rule, and §B reserves UPPERCASE for Label role; every other v2 caps string is
 *    authored caps and was changed at its call site (case is copy, not cascade).
 *  · size/face/colour now come from the `st-display` / `st-label` classes in
 *    theme/staff-tokens-v2.css. Colour CANNOT be inline: `.terminal-theme *` forces
 *    green with !important, which beats any inline value (PR #89 family).
 *
 * This primitive renders only inside the v2 shell (every consumer is a v2-only page),
 * so the token classes always have their scope.
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
  /** Small dim chip beside the title (e.g. a count or state). Label-role copy. */
  tag?: ReactNode;
  /** Right-aligned slot on the title row (e.g. a primary action). */
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...wrap, ...style }}>
      {eyebrow != null && <div className="st-label st-t2" style={eyebrowStyle}>{eyebrow}</div>}
      <div style={row}>
        {/* A heading-role div, not <h2>: `.terminal-theme h2 { font-size: 2rem !important }`
            would pin an <h2> at 32px and silently defeat the responsive type role. */}
        <div role="heading" aria-level={2} className="u-head st-display st-t1" style={titleStyle}>
          {title}
          {tag != null && <span className="st-chip st-label st-t2" style={tagStyle}>{tag}</span>}
        </div>
        {right != null && <div style={{ display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" }}>{right}</div>}
      </div>
    </div>
  );
}

const wrap: CSSProperties = { margin: `0 0 ${space.s4}px` };
const eyebrowStyle: CSSProperties = { marginBottom: space.s1 };
const row: CSSProperties = {
  display: "flex", alignItems: "baseline", justifyContent: "space-between",
  gap: space.s3, flexWrap: "wrap",
};
const titleStyle: CSSProperties = {
  margin: 0, display: "flex", alignItems: "baseline", gap: space.s2, flexWrap: "wrap",
};
const tagStyle: CSSProperties = {
  whiteSpace: "nowrap", padding: "3px 10px", alignSelf: "center",
};

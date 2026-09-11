import type { CSSProperties, ReactNode } from "react";
import { radius, space, TAP } from "./tokens";

/**
 * A one-line record row: leading label block (title + optional sub), a middle meta
 * slot, trailing actions. Generalises the hub's `.schedrow` / queue-row shape so a
 * list never has to be a 720px-wide table on a 390px phone (audit finding #1).
 *
 * Stacks vertically below `stackAt` (default 640px, the app-wide phone breakpoint) —
 * the caller passes `stacked` from the shared `useIsMobile` hook so there is exactly
 * ONE breakpoint source. Every action slot the caller passes must keep the 44px tap
 * floor itself (the shell does not shrink controls).
 *
 * BEAT 6 (PR 1): on the tokens — surface-1 fill, hairline frame, 6px radius, Heading
 * role title, Body role sub. Colour comes from the `st-*` classes, never inline: the
 * base theme forces green with !important and an inline colour loses silently.
 *
 * BEAT 6 (PR 3): `footer` — a full-width strip under a hairline, below everything else.
 * It exists for the danger-geography rule (§B): a destructive control never shares a row
 * with a routine one, so "Remove group" / "Remove access" leaves the action cluster and
 * lands here instead. Undefined for every other caller ⇒ no element is rendered and the
 * row's markup is unchanged.
 */
export function ListRow({
  title,
  sub,
  meta,
  actions,
  footer,
  stacked = false,
  onClick,
  style,
}: {
  title: ReactNode;
  /** Secondary line under the title (dim). */
  sub?: ReactNode;
  /** Middle slot: chips, counts, status. */
  meta?: ReactNode;
  /** Trailing controls. */
  actions?: ReactNode;
  /** Full-width strip under a hairline (the row's own danger zone). Never a routine control. */
  footer?: ReactNode;
  /** True on phones — stacks the three slots into one column. */
  stacked?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const cluster = (
    <>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div className="st-heading st-t1" style={titleStyle}>{title}</div>
        {sub != null && <div className="st-body st-t2" style={subStyle}>{sub}</div>}
      </div>
      {meta != null && (
        <div style={{ display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap", minWidth: 0 }}>{meta}</div>
      )}
      {actions != null && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap",
            marginLeft: stacked ? 0 : "auto",
          }}
        >
          {actions}
        </div>
      )}
    </>
  );

  // With a footer the row becomes: [cluster][hairline][footer]. The cluster keeps the
  // exact flex it had before, in its own box, so nothing about the no-footer case moves.
  const clusterStyle: CSSProperties = {
    display: "flex",
    flexDirection: stacked ? "column" : "row",
    alignItems: stacked ? "stretch" : "center",
    gap: stacked ? space.s2 : space.s3,
  };
  const body = footer == null ? cluster : (
    <>
      <div style={clusterStyle}>{cluster}</div>
      {/* Hairline colour comes from the token scope (`[data-st-page] * { border-color:
          hairline !important }`); the width/offset are geometry and stay inline. */}
      <div style={footerStyle}>{footer}</div>
    </>
  );

  const base: CSSProperties = {
    ...(footer == null ? clusterStyle : { display: "block" }),
    padding: `${space.s3}px ${space.s4}px`,
    borderRadius: radius.control,
    minHeight: TAP,
    ...style,
  };

  if (onClick) {
    return (
      <button type="button" className="st-row" onClick={onClick} style={{ ...base, textAlign: "left", cursor: "pointer", width: "100%" }}>
        {body}
      </button>
    );
  }
  return <div className="st-row" style={base}>{body}</div>;
}

const titleStyle: CSSProperties = {
  overflow: "hidden", textOverflow: "ellipsis",
};
const subStyle: CSSProperties = { marginTop: 2 };
const footerStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: space.s3, flexWrap: "wrap",
  marginTop: space.s3, paddingTop: space.s3, borderTop: "1px solid",
};

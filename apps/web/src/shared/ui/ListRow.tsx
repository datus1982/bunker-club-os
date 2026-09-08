import type { CSSProperties, ReactNode } from "react";

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
 * BEAT 1 STATUS: built + exported, deliberately used nowhere yet. Beat 2 swaps the
 * `/admin/users` table onto it (owner decision C). Do not wire it into a page here.
 */
export function ListRow({
  title,
  sub,
  meta,
  actions,
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
  /** True on phones — stacks the three slots into one column. */
  stacked?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const body = (
    <>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={titleStyle}>{title}</div>
        {sub != null && <div style={subStyle}>{sub}</div>}
      </div>
      {meta != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>{meta}</div>
      )}
      {actions != null && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
            marginLeft: stacked ? 0 : "auto",
          }}
        >
          {actions}
        </div>
      )}
    </>
  );

  const base: CSSProperties = {
    display: "flex",
    flexDirection: stacked ? "column" : "row",
    alignItems: stacked ? "stretch" : "center",
    gap: stacked ? 8 : 12,
    padding: "10px 12px",
    border: "1px solid rgba(0,255,65,0.28)",
    background: "#020402",
    minHeight: 44,
    ...style,
  };

  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ ...base, textAlign: "left", cursor: "pointer", width: "100%" }}>
        {body}
      </button>
    );
  }
  return <div style={base}>{body}</div>;
}

const titleStyle: CSSProperties = {
  fontSize: 18, letterSpacing: 0.5, color: "var(--terminal-green)",
  overflow: "hidden", textOverflow: "ellipsis",
};
const subStyle: CSSProperties = {
  fontSize: 15, opacity: 0.6, marginTop: 2, color: "var(--terminal-green)",
};

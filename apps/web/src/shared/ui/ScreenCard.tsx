import type { CSSProperties, ReactNode } from "react";

/**
 * The ON AIR NOW card FRAME (audit §5 #11) — reused for the Media PANEL cards.
 *
 * A FRAME ONLY. It computes nothing: the hub keeps resolving mode, effective program,
 * health and the rotation summary with the SAME resolver the TVs run (the hub/TV parity
 * invariant), and hands the finished nodes in. Moving that resolution in here would put
 * a second opinion about what a screen is showing into the app, which is exactly the
 * class of bug the parity rule exists to prevent.
 *
 * Layout (Variant A, the owner-ratified full-width control ROW):
 *   [ identity + chips ]  [ status, grows ]  [ actions, right ]
 *   ──────────────────────────────────────────────────────────
 *   [ sub-strip: program · schedule · transport                ]
 *   [ overflow: kiosk url · preview · health                   ]
 * Below `stacked` (the caller passes the shared useIsMobile result — ONE breakpoint
 * source) the three columns become one column and actions go full width.
 *
 * Sizes are inline px: nothing inherits font-size under `.terminal-theme` (PR #89).
 */
export function ScreenCard({
  name,
  meta,
  chips,
  badge,
  status,
  actions,
  subStrip,
  overflow,
  stacked = false,
  style,
}: {
  name: ReactNode;
  /** Dim identity line (orientation · terminal · location). */
  meta?: ReactNode;
  /** StatusChips: health, mode, dayparts. */
  chips?: ReactNode;
  /** A chip pinned beside the name (e.g. PANEL). */
  badge?: ReactNode;
  /** Plain-language "what this screen is doing" line. */
  status?: ReactNode;
  /** The control row — the page's own buttons, passed through untouched. */
  actions?: ReactNode;
  /** Secondary control strip (PROGRAM · SCHEDULE · transport). */
  subStrip?: ReactNode;
  /** Rendered under the card when the caller's overflow is open. */
  overflow?: ReactNode;
  /** True on phones — one column. */
  stacked?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="terminal-border" style={{ ...card, ...style }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: stacked ? "1 1 100%" : "0 0 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flexWrap: "wrap" }}>
            <span style={nameStyle}>{name}</span>
            {badge}
          </div>
          {meta != null && <div style={metaStyle}>{meta}</div>}
          {chips != null && <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{chips}</div>}
        </div>

        {status != null && (
          <div style={{ flex: "1 1 260px", minWidth: 0, alignSelf: stacked ? "auto" : "center", ...statusStyle }}>
            {status}
          </div>
        )}

        {actions != null && (
          <div style={{ flex: "0 0 auto", marginLeft: stacked ? 0 : "auto", width: stacked ? "100%" : undefined }}>
            {actions}
          </div>
        )}
      </div>

      {subStrip != null && (
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "stretch", borderTop: "1px solid rgba(0,255,65,0.2)", paddingTop: 11 }}>
          {subStrip}
        </div>
      )}

      {overflow}
    </div>
  );
}

const card: CSSProperties = {
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
};
const nameStyle: CSSProperties = {
  fontSize: 24, fontWeight: 700, letterSpacing: 1,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  color: "var(--terminal-green)",
};
const metaStyle: CSSProperties = { fontSize: 15, opacity: 0.55, color: "var(--terminal-green)" };
const statusStyle: CSSProperties = { fontSize: 15, opacity: 0.8, lineHeight: 1.5, color: "var(--terminal-green)" };

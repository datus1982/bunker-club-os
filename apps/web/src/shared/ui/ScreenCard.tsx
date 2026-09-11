import type { CSSProperties, ReactNode } from "react";
import { radius, space, staffHairline } from "./tokens";

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
 * BEAT 6 (PR 1): surface-1 fill + hairline + 6px radius instead of the 2px green
 * `terminal-border` frame; name on the Heading role, meta/status on Body. This
 * primitive is v2-only — the classic hub renders its OWN local ScreenCard
 * (SignageHub.tsx), which is untouched.
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
    <div className="st-card" style={{ ...card, ...style }}>
      <div style={{ display: "flex", gap: space.s6, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: stacked ? "1 1 100%" : "0 0 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: space.s2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, flexWrap: "wrap" }}>
            <span className="st-heading st-t1" style={nameStyle}>{name}</span>
            {badge}
          </div>
          {meta != null && <div className="st-body st-t2">{meta}</div>}
          {chips != null && <div style={{ display: "flex", gap: space.s1 + 2, alignItems: "center", flexWrap: "wrap" }}>{chips}</div>}
        </div>

        {status != null && (
          <div className="st-body st-t2" style={{ flex: "1 1 260px", minWidth: 0, alignSelf: stacked ? "auto" : "center" }}>
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
        <div style={{ display: "flex", gap: space.s2, flexWrap: "wrap", alignItems: "stretch", borderTop: `1px solid ${staffHairline}`, paddingTop: space.s3 }}>
          {subStrip}
        </div>
      )}

      {overflow}
    </div>
  );
}

const card: CSSProperties = {
  padding: `${space.s4}px ${space.s4}px`,
  borderRadius: radius.control,
  display: "flex",
  flexDirection: "column",
  gap: space.s3,
  minWidth: 0,
};
const nameStyle: CSSProperties = {
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};

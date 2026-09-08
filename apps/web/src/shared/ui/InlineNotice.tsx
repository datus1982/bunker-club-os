import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";

/**
 * A boxed one-liner: "this moved", "heads up", a save confirmation (audit §5 #9).
 * `info` = green frame; `warn` = amber frame + amber ink (the app's warning ink).
 * The optional link is an in-app route (react-router `Link`), 44px tall so it stays
 * tappable on a phone.
 */
export function InlineNotice({
  kind = "info",
  message,
  to,
  label,
  style,
}: {
  kind?: "info" | "warn";
  message: ReactNode;
  /** In-app destination for the trailing link. */
  to?: string;
  label?: ReactNode;
  style?: CSSProperties;
}) {
  const warn = kind === "warn";
  return (
    <div
      className={warn ? "u-amber" : ""}
      role={warn ? "alert" : undefined}
      style={{
        ...box,
        borderColor: warn ? "var(--terminal-amber, #ffb000)" : "rgba(0,255,65,0.45)",
        ...style,
      }}
    >
      <span style={messageStyle}>{message}</span>
      {to && label != null && (
        <Link
          to={to}
          className={warn ? "u-amber" : ""}
          style={{
            ...link,
            borderColor: warn ? "var(--terminal-amber, #ffb000)" : "var(--terminal-green)",
          }}
        >
          {label}
        </Link>
      )}
    </div>
  );
}

const box: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, flexWrap: "wrap",
  padding: "12px 14px",
  border: "1px solid",
};
const messageStyle: CSSProperties = { fontSize: 17, lineHeight: 1.45, minWidth: 0 };
const link: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 14px",
  border: "1px solid", textDecoration: "none", fontSize: 16, letterSpacing: 1,
  whiteSpace: "nowrap",
};

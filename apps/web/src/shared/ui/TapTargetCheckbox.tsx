import type { CSSProperties, ReactNode } from "react";

/**
 * A native checkbox inside a ≥44px label row (audit §5 #10, finding #11).
 *
 * The app's tap floor for checkboxes is currently a GLOBAL rule in terminal-theme.css
 * plus a hand-padded wrapper label copy-pasted per page — so a new control silently
 * regresses the moment someone forgets the padding. This is that padding, once, with
 * the label included so the whole row is the target (a bare 20px box is not).
 *
 * The native input is kept (not a styled div): it carries checkbox semantics, Space to
 * toggle and `indeterminate`-free simplicity for free. `boxed` draws the chip frame the
 * invite panel uses; without it the control is a plain row.
 *
 * Sizes are px on the element that renders the text — nothing inherits font-size under
 * `.terminal-theme` (PR #89).
 */
export function TapTargetCheckbox({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  boxed = false,
  style,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible caption. Omit for a bare box (then `ariaLabel` is required). */
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  /** Chip treatment: framed, tinted when on. */
  boxed?: boolean;
  style?: CSSProperties;
}) {
  return (
    <label
      style={{
        ...row,
        justifyContent: label == null ? "center" : "flex-start",
        padding: label == null ? 10 : "0 12px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...(boxed
          ? {
              border: "1px solid var(--terminal-green)",
              background: checked ? "rgba(0,255,65,0.12)" : "transparent",
            }
          : null),
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label == null ? ariaLabel : undefined}
        style={{ width: 20, height: 20, cursor: disabled ? "default" : "pointer", accentColor: "var(--terminal-green)" }}
      />
      {label != null && <span style={labelStyle}>{label}</span>}
    </label>
  );
}

const row: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minWidth: 44,
  minHeight: 44,
};
const labelStyle: CSSProperties = { fontSize: 17, letterSpacing: 0.5 };

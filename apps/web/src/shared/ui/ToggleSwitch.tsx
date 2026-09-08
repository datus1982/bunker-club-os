import type { CSSProperties, ReactNode } from "react";
import "@/theme/staff-form.css";

/**
 * An on/off control that reads at a glance on a phone (audit §5 #5).
 *
 * SHAPE — and why it is not a `<button role="switch">`: terminal-theme.css carries a
 * legacy Radix-switch rule, `.terminal-theme button[role="switch"] span { background:
 * var(--terminal-green) !important }`, which paints EVERY span inside such a button
 * solid green — a caption inside one renders as an unreadable green bar (seen live
 * while building this). That rule may not be touched (RULE #1) and !important cannot
 * be out-specified. So the control is the other documented ARIA switch: a native
 * `<input type="checkbox" role="switch">`, visually hidden inside its label, with the
 * track drawn beside it. Native keyboard (Space), native `disabled`, native focus, and
 * `aria-checked` derived from `checked` — nothing hand-rolled.
 *
 * The visible ON/OFF word is deliberate: a coloured track alone is not a state anyone
 * can read across a bar on a monochrome green theme.
 *
 * `disabled` renders dim + LOCKED — used for "admin implies every module": the grant
 * is genuinely on, and genuinely not editable.
 *
 * Row is ≥44px (the app's tap floor). Motion is a 120ms transform, matching the shell
 * drawer; nothing here animates forever.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  lockedHint = "LOCKED",
  style,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible caption to the left of the track. */
  label?: ReactNode;
  /** Required when there is no visible label. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Trailing word shown instead of ON/OFF when disabled (e.g. an implied grant). */
  lockedHint?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label
      className="bui-switch"
      style={{
        ...row,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label != null && <span style={labelStyle}>{label}</span>}
      <span style={{ ...state, color: checked ? "var(--terminal-green)" : "#8a8f8a" }}>
        {disabled ? lockedHint : checked ? "ON" : "OFF"}
      </span>
      <span
        aria-hidden="true"
        style={{
          ...track,
          borderColor: checked ? "var(--terminal-green)" : "rgba(0,255,65,0.35)",
          background: checked ? "rgba(0,255,65,0.14)" : "transparent",
        }}
      >
        <span
          style={{
            ...knob,
            background: checked ? "var(--terminal-green)" : "#8a8f8a",
            transform: checked ? "translateX(20px)" : "translateX(0)",
          }}
        />
      </span>
    </label>
  );
}

const row: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  minHeight: 44,
  padding: "0 10px",
  boxSizing: "border-box",
  border: "1px solid rgba(0,255,65,0.28)",
};
const labelStyle: CSSProperties = { fontSize: 17, letterSpacing: 0.5, flex: "1 1 auto", minWidth: 0 };
const state: CSSProperties = { fontSize: 14, letterSpacing: 1.5, minWidth: 44, textAlign: "right" };
const track: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flex: "0 0 auto",
  width: 44,
  height: 22,
  padding: 1,
  boxSizing: "border-box",
  border: "1px solid",
};
const knob: CSSProperties = {
  display: "block",
  width: 18,
  height: 18,
  transition: "transform 120ms ease-out, background 120ms ease-out",
};

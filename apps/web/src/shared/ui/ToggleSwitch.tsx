import type { CSSProperties, ReactNode } from "react";

/**
 * An on/off control that reads at a glance on a phone (audit §5 #5).
 *
 * A real `<button role="switch" aria-checked>` — so Space/Enter toggle it for free and
 * a screen reader announces the state — with a visible ON/OFF word beside the track.
 * The word matters: a bare coloured track on a monochrome green terminal theme is not
 * a state anyone can read across a bar.
 *
 * `disabled` renders dim + LOCKED and is used for "admin implies every module": the
 * grant is genuinely on, and genuinely not editable.
 *
 * Whole row is ≥44px (the app's tap floor). Motion is a 120ms transform, matching the
 * shell drawer; nothing here animates forever (display-route rule, kept app-wide).
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        ...row,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >
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
    </button>
  );
}

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  minHeight: 44,
  padding: "0 10px",
  textAlign: "left",
  background: "transparent",
  color: "var(--terminal-green)",
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
  border: "1px solid",
};
const knob: CSSProperties = {
  display: "block",
  width: 18,
  height: 18,
  transition: "transform 120ms ease-out, background 120ms ease-out",
};

import type { CSSProperties, ReactNode } from "react";
import { radius, space, staffAccentColors, staffText, TAP } from "./tokens";
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
 * can read across a bar on a monochrome theme.
 *
 * `disabled` renders dim + LOCKED — used for "admin implies every module": the grant
 * is genuinely on, and genuinely not editable.
 *
 * Row is ≥44px (the app's tap floor). Motion is the token hover step, matching the
 * shell drawer; nothing here animates forever.
 *
 * BEAT 6 (PR 1): the ON track/knob become the calmed accent; the row is a surface-1
 * card with the hairline and 6px radius. The track/knob colours ARE inline here — they
 * are `background`, not `color`, and the base theme's !important only owns `color` on
 * a span (it does force `background: transparent` on BUTTONS and INPUTS, neither of
 * which these spans are).
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
      className="bui-switch st-row"
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
      {label != null && <span className="st-body st-t1" style={labelStyle}>{label}</span>}
      {/* Colour by CLASS: `.terminal-theme * { color: green !important }` beats any
          inline colour, so the ON/OFF word rides the token classes. */}
      <span className={checked ? "st-label st-accent" : "st-label st-t3"} style={state}>
        {disabled ? lockedHint : checked ? "ON" : "OFF"}
      </span>
      <span
        aria-hidden="true"
        className={"st-pill" + (checked ? " st-on" : "")}
        style={{
          ...track,
          borderColor: checked ? staffAccentColors.accent : "rgba(255,255,255,0.16)",
          background: checked ? "rgba(127,230,168,0.18)" : "transparent",
        }}
      >
        <span
          className="st-pill"
          style={{
            ...knob,
            background: checked ? staffAccentColors.accent : staffText.disabled,
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
  gap: space.s3,
  width: "100%",
  minHeight: TAP,
  padding: `0 ${space.s3}px`,
  boxSizing: "border-box",
  borderRadius: radius.control,
};
const labelStyle: CSSProperties = { flex: "1 1 auto", minWidth: 0 };
const state: CSSProperties = { minWidth: 44, textAlign: "right" };
const track: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flex: "0 0 auto",
  width: 44,
  height: 22,
  padding: 1,
  boxSizing: "border-box",
  border: "1px solid",
  borderRadius: 9999,
  transition: "background 140ms ease-out, border-color 140ms ease-out",
};
const knob: CSSProperties = {
  display: "block",
  width: 18,
  height: 18,
  borderRadius: 9999,
  transition: "transform 140ms ease-out, background 140ms ease-out",
};

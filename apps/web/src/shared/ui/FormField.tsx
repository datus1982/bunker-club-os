import type { CSSProperties, ReactNode } from "react";
import "@/theme/staff-form.css";

/**
 * Label + one native control + optional hint/error (audit §5 #4, closes finding #13).
 *
 * The control is a plain `<input>` / `<select>` / `<textarea>` passed as children —
 * this repo does not use Radix for these, and the base theme already pins the staff
 * font scale (19px controls, 20px buttons) with !important. What the pages kept
 * re-inventing was the BOX: background, border, padding and the 44px tap floor. Those
 * live once in `theme/staff-form.css`, scoped to `.bui-field`.
 *
 * Two shapes:
 *  - default → renders a `<label>`, so the caption is click-to-focus for its control.
 *  - `group` → renders a labelled `role="group"` div, for a SET of controls (module
 *    checkboxes, switch stacks) where a `<label>` would be wrong (a label may caption
 *    exactly one control). Group children get no automatic 44px floor — the controls
 *    inside are already TapTargetCheckbox/ToggleSwitch, which carry their own.
 *
 * Sizes are px because NOTHING inherits font-size under `.terminal-theme` (a class
 * rule sets it on every element; inheritance has zero specificity — PR #89). BEAT 6
 * (PR 1) moves the caption/hint onto the token TYPE ROLE classes, which carry those px
 * (with the responsive md: step) in theme/staff-tokens-v2.css — still not inherited,
 * just declared once instead of per-component.
 */
export function FormField({
  label,
  hint,
  error,
  htmlFor,
  group = false,
  children,
  style,
}: {
  label: ReactNode;
  /** Dim helper line under the control. */
  hint?: ReactNode;
  /** Amber problem line under the control. Replaces the hint when present. */
  error?: ReactNode;
  /** Set when the control carries its own id (otherwise the wrapping label is enough). */
  htmlFor?: string;
  /** True when the field holds a SET of controls rather than one. */
  group?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  // Text sizes are INLINE, not in the stylesheet: `.terminal-theme *` sets
  // font-size: 1.5rem at the same specificity a class rule has, and wins the tie by
  // order — only an inline style (or !important, which this phase forbids) beats it.
  // The stylesheet therefore carries only geometry the theme leaves alone.
  const foot =
    error != null ? (
      <span className="st-body st-amber" style={footStyle}>
        {error}
      </span>
    ) : hint != null ? (
      <span className="st-body st-t3" style={footStyle}>{hint}</span>
    ) : null;

  if (group) {
    return (
      <div
        className="bui-field"
        role="group"
        aria-label={typeof label === "string" ? label : undefined}
        style={style}
      >
        <span className="st-label st-t2" style={labelStyle}>{label}</span>
        {children}
        {foot}
      </div>
    );
  }

  return (
    <label className="bui-field" htmlFor={htmlFor} style={style}>
      <span className="st-label st-t2" style={labelStyle}>{label}</span>
      {children}
      {foot}
    </label>
  );
}

// Label/hint sizes ride the token TYPE ROLES (`st-label` / `st-body` in
// theme/staff-tokens-v2.css), which carry the px + the responsive step. Only the
// geometry the roles do not own stays here.
const labelStyle: CSSProperties = {};
const footStyle: CSSProperties = { marginTop: 2 };

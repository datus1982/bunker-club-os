import { type CSSProperties, type ReactNode } from "react";

/**
 * Deliberately-basic display formatting for signage/event copy (Phase 8 — owner ask:
 * "expand some formatting controls, basic stuff, bold, alignment"). Two knobs only:
 *
 *   • inline bold — `**text**` markdown-lite, parsed to real <strong> nodes. NEVER
 *     dangerouslySetInnerHTML: the string is split and rebuilt as React children, so no
 *     markup a manager types can execute. Only `**` is honoured — nothing else.
 *   • alignment — fields.align ("left" | "center"), applied by the card renderers.
 *
 * Shared by the display templates (SignageTemplates / EventStages) AND, for the Align
 * type, the staff form controls. This module imports no react-dom form deps, so it can be
 * pulled into both the display board and the admin console without a cycle.
 */

export type Align = "left" | "center";

/**
 * Read fields.align. Only "left"/"center" are honoured; anything else falls back to the
 * template's historical default (`fallback`) so existing cards don't shift when this ships
 * — centered cards pass "center" (the default), left-leaning templates pass "left".
 */
export function alignOf(fields: Record<string, unknown> | undefined, fallback: Align = "center"): Align {
  return fields?.align === "left" ? "left" : fields?.align === "center" ? "center" : fallback;
}

/** Cross-axis + text alignment for a flex column card from an Align value. */
export function alignStyle(align: Align): Pick<CSSProperties, "alignItems" | "textAlign"> {
  return align === "left"
    ? { alignItems: "flex-start", textAlign: "left" }
    : { alignItems: "center", textAlign: "center" };
}

/**
 * Parse one line of copy, turning `**bold**` spans into <strong>. fontSize:inherit on the
 * strong is load-bearing on the display boards — the global `.terminal-theme span{font-size:
 * 1.5rem}` rule clamps un-sized inline elements, and while <strong> isn't a <span> we keep
 * the guard so a themed <strong> rule could never shrink it either. Returns the raw text in
 * a single-element array when there is no markup (stable, cheap).
 */
export function parseInline(text: string): ReactNode[] {
  if (!text.includes("**")) return [text];
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={k++} style={{ fontWeight: 900, fontSize: "inherit" }}>{m[1]}</strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

/**
 * Multi-line rich text: `\n` → block spans (matching the display boards' line handling),
 * `**bold**` within each line → <strong>. fontSize:inherit on the block span mirrors the
 * existing EventStages `Lines` helper so a multi-line hero keeps its size.
 */
export function RichText({ text }: { text: string }): ReactNode {
  return text.split("\n").map((line, i) => (
    <span key={i} style={{ display: "block", fontSize: "inherit" }}>{parseInline(line)}</span>
  ));
}

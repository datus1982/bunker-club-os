import type { CSSProperties } from "react";
import { cx, useTriviaV2 } from "./triviaV2";

/**
 * Shared terminal-theme primitives for the trivia host tools (docs/01). The earlier
 * ported pages each re-declared these inline; the Scoring decomposition pulls the
 * common set here so RoundGrid / QuestionPanel / DisplayStageControl / BoardStageControl /
 * TeamEditorDialog stay visually identical without copy-pasting styles.
 *
 * POLISH ARC 2 (PR 3): the style OBJECTS below are untouched — `modules/signage/
 * ItemEditor.tsx` imports four of them and must keep rendering byte-identically. The
 * v2 look is added as CLASS NAMES via `useTriviaBtn()` plus two components (Modal,
 * Field) that read the context themselves, so classic call sites that pass nothing
 * stay exactly as they are.
 *
 * WHY CLASSES AND NOT NEW STYLE OBJECTS: `staff-tokens-v2.css` re-points colour,
 * border, radius and hover for every control inside `[data-st-page]` with `!important`,
 * and an author `!important` beats a normal inline declaration. So a v2 trivia button
 * is already a clean hairline ghost button for free; the only things that have to be
 * ASKED for are the states the blanket flattens — the accent fill (`st-btn-primary`)
 * and the destructive ink (`st-btn-danger`).
 */

const MONO = "'VT323','Share Tech Mono',monospace";

/**
 * The v2 class for each button role, or `undefined` in classic.
 *
 * `active` maps to the same accent fill as `primary`: in the token system "selected"
 * and "primary" are one filled treatment, and the stage-control pills (DISPLAY / BOARD)
 * read as selected exactly the way `u-fill u-ink` reads in classic.
 */
export function useTriviaBtn(): {
  v2: boolean;
  primary?: string;
  active?: string;
  danger?: string;
  /** Compose a v2 class onto whatever the call site already passes. */
  cx: typeof cx;
} {
  const v2 = useTriviaV2();
  return {
    v2,
    primary: v2 ? "st-btn-primary" : undefined,
    active: v2 ? "st-btn-primary" : undefined,
    danger: v2 ? "st-btn-danger" : undefined,
    cx,
  };
}

export const input: CSSProperties = {
  background: "#000",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 10px",
  fontSize: 22,
  fontFamily: MONO,
};

// Canonical staff-button geometry (owner-ratified consistency pass, 2026-07-13): one
// primary (filled), one secondary (ghost/outlined), one danger (amber outline), all at
// minHeight 44 with matching padding. Font-size + letter-spacing come from the staff-ui
// theme rules (.staff-ui button → 20px), so they're intentionally not re-set here.
export const btnPrimary: CSSProperties = {
  background: "var(--terminal-green)",
  color: "#000",
  border: "1px solid var(--terminal-green)",
  padding: "10px 20px",
  minHeight: 44,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: MONO,
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "10px 18px",
  minHeight: 44,
  cursor: "pointer",
  fontFamily: MONO,
};

/** Filled/active variant of a ghost button (mirrors legacy toggle "on" state). */
export const btnActive: CSSProperties = {
  ...btnGhost,
  background: "var(--terminal-green)",
  color: "#000",
  fontWeight: 700,
};

export const btnDanger: CSSProperties = {
  ...btnGhost,
  borderColor: "var(--terminal-amber, #ffb000)",
  color: "var(--terminal-amber, #ffb000)",
};

export const checkRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 22,
  cursor: "pointer",
  minHeight: 44, // whole label row is a ≥44px tap target (Phase 4c)
  padding: "4px 0",
};

/**
 * Centered modal overlay in the terminal theme.
 *
 * v2 (polish arc 2): the overlay root takes `st-sheet` and the panel takes `st-panel`
 * — the two hooks the token sheet already answers for ConfirmDialog, which is why a
 * v2 trivia dialog lands on surface-4 with the sheet radius and the hairline edge
 * without a single new rule. Geometry, structure, the pinned header/footer and the
 * scroll region are identical in both looks; only fill, edge and ink move.
 */
export function Modal({ title, onClose, children, footer, v2: v2Override }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** BEAT 8 (PR 5) — an explicit override of the trivia context. `TriviaV2Context` defaults
   *  to `false` with no provider BY DESIGN (triviaV2.ts), which is exactly right for every
   *  trivia caller and exactly wrong for `modules/signage/ItemEditor.tsx`: it mounts this
   *  Modal from a v2 signage page that sits outside any trivia provider, so it rendered the
   *  classic frame on a tokened page (overlay inventory §D finding 2). A caller that KNOWS its
   *  presentation passes it here; a caller that passes nothing reads the context, so every
   *  existing call site — classic and v2 trivia alike — is byte-identical. */
  v2?: boolean;
}) {
  const ctx = useTriviaV2();
  const v2 = v2Override ?? ctx;
  return (
    <div
      onClick={onClose}
      className={v2 ? "st-sheet" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: MONO,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx("terminal-border", v2 && "st-panel")}
        style={{ background: "#000", width: "min(560px, 92vw)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        {/* Header — pinned (does not scroll) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 12px" }}>
          {/* `.terminal-theme h2 { font-size: 2rem !important }` beats the inline 30px, so
              in v2 the Heading role has to be asked for by class (it carries !important
              of its own at higher specificity). */}
          <h2 className={v2 ? "st-heading st-t1" : undefined} style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>{title}</h2>
          <button type="button" onClick={onClose} style={btnGhost} aria-label="Close">✕</button>
        </div>
        <div className="terminal-separator" style={{ margin: 0 }} />
        {/* Body — the only scrolling region. gap 16 restores the pre-pinned-footer spacing for
            callers that pass bare siblings (e.g. AddTeamPicker's two Fields). */}
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
        {/* Footer — pinned bottom, themed background, so CANCEL/SAVE stay visible while the
            body scrolls (Phase 4c). The black fill is what makes it opaque in classic; in
            v2 the panel itself is surface-4 and the footer sits OUTSIDE the scroll region,
            so transparent is both opaque enough and honest — a black strip under a
            surface-4 sheet would read as a seam.
            v2 (Beat 8 PR 5): `flexWrap` lets a three-button footer (DELETE · CANCEL · SAVE in the
            slide editor) fold onto two rows on a narrow phone instead of squeezing a verb out
            of its box; a footer that fits — every trivia dialog's pair — never wraps, so
            nothing moves for them. Whole-object ternary: the classic literal is untouched. */}
        {footer && (
          <div style={v2 ? { display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--terminal-green)", background: "transparent" } : { display: "flex", gap: 12, justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--terminal-green)", background: "#000" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children, v2: v2Override }: {
  label: string;
  children: React.ReactNode;
  /** Same override as `Modal` (Beat 8 PR 5): undefined = read the trivia context. */
  v2?: boolean;
}) {
  const ctx = useTriviaV2();
  const v2 = v2Override ?? ctx;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Label role in v2: 12px uppercase at the Secondary tier, instead of a 20px green
          line at 0.8 opacity. The inline size stays for the classic path; the inline
          OPACITY is dropped in v2 because the tier already carries its own alpha —
          0.6α × 0.8 would land the label under AA. */}
      <span className={v2 ? "st-label st-t2" : undefined} style={{ fontSize: 20, opacity: v2 ? 1 : 0.8 }}>{label}</span>
      {children}
    </div>
  );
}

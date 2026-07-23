import type { CSSProperties } from "react";

/**
 * Shared terminal-theme primitives for the trivia host tools (docs/01). The earlier
 * ported pages each re-declared these inline; the Scoring decomposition pulls the
 * common set here so RoundGrid / QuestionPanel / DisplayStageControl / BoardStageControl /
 * TeamEditorDialog stay visually identical without copy-pasting styles.
 */

const MONO = "'VT323','Share Tech Mono',monospace";

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

/** Centered modal overlay in the terminal theme. */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
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
        className="terminal-border"
        style={{ background: "#000", width: "min(560px, 92vw)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        {/* Header — pinned (does not scroll) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 12px" }}>
          <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>{title}</h2>
          <button type="button" onClick={onClose} style={btnGhost} aria-label="Close">✕</button>
        </div>
        <div className="terminal-separator" style={{ margin: 0 }} />
        {/* Body — the only scrolling region. gap 16 restores the pre-pinned-footer spacing for
            callers that pass bare siblings (e.g. AddTeamPicker's two Fields). */}
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
        {/* Footer — pinned bottom, themed background, so CANCEL/SAVE stay visible while the body scrolls (Phase 4c). */}
        {footer && (
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--terminal-green)", background: "#000" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 20, opacity: 0.8 }}>{label}</span>
      {children}
    </div>
  );
}

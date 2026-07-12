import type { CSSProperties } from "react";

/**
 * Shared terminal-theme primitives for the trivia host tools (docs/01). The earlier
 * ported pages each re-declared these inline; the Scoring decomposition pulls the
 * common set here so RoundGrid / QuestionPanel / VideoControls / LeaderboardToggle /
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

export const btnPrimary: CSSProperties = {
  background: "var(--terminal-green)",
  color: "#000",
  border: "1px solid var(--terminal-green)",
  padding: "10px 18px",
  fontSize: 24,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: MONO,
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 14px",
  fontSize: 22,
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
        style={{ background: "#000", padding: 24, width: "min(560px, 92vw)", maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>{title}</h2>
          <button type="button" onClick={onClose} style={btnGhost} aria-label="Close">✕</button>
        </div>
        <div className="terminal-separator" />
        {children}
        {footer && <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>{footer}</div>}
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

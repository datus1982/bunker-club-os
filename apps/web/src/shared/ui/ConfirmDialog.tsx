import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * The ratified pinned-footer confirm (audit §5 #8) — the shared replacement for the raw
 * `window.confirm()` calls scattered through the staff pages.
 *
 * Shape matches the trivia `Modal` idiom (pinned header, scrolling body, pinned footer,
 * backdrop + Esc close) so a manager sees ONE dialog language across the app. It is
 * self-contained rather than built on that Modal: `modules/trivia/ui.tsx` is host-console
 * code, and a shared primitive must not depend on a module.
 *
 * `danger` paints CONFIRM amber — the app's warning ink (the codebase convention since
 * the 2026-07-13 consistency pass; red is reserved for a live alert state).
 *
 * Both buttons clear the 44px tap floor. Focus moves to CANCEL on open, so the
 * destructive button is never the one a stray Return key presses.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "CONFIRM",
  cancelLabel = "CANCEL",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Destructive action — CONFIRM renders in the amber warning ink. */
  danger?: boolean;
  /** Disables both buttons while the mutation is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div onClick={onCancel} className="terminal-theme staff-ui" style={backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="terminal-border"
        style={panel}
      >
        <div style={head}>
          <div role="heading" aria-level={2} className="u-head" style={titleStyle}>{title}</div>
        </div>
        <div className="terminal-separator" style={{ margin: 0 }} />
        {body != null && <div style={bodyStyle}>{body}</div>}
        <div style={foot}>
          <button type="button" ref={cancelRef} onClick={onCancel} disabled={busy} style={btn}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={danger ? "u-amber" : "u-fill u-ink"}
            style={danger
              ? { ...btn, borderColor: "var(--terminal-amber, #ffb000)" }
              : { ...btn, background: "var(--terminal-green)", color: "#000", fontWeight: 700 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 1100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const panel: CSSProperties = {
  background: "#000", width: "min(520px, 94vw)", maxHeight: "88vh",
  display: "flex", flexDirection: "column", overflow: "hidden",
};
const head: CSSProperties = { padding: "18px 20px 12px" };
const titleStyle: CSSProperties = {
  fontSize: 24, fontWeight: 700, letterSpacing: 1, color: "var(--terminal-green)",
};
const bodyStyle: CSSProperties = {
  flex: "1 1 auto", overflowY: "auto", padding: "14px 20px",
  fontSize: 17, lineHeight: 1.5, color: "var(--terminal-green)",
};
const foot: CSSProperties = {
  display: "flex", gap: 12, justifyContent: "flex-end",
  padding: "14px 20px", borderTop: "1px solid var(--terminal-green)", background: "#000",
};
const btn: CSSProperties = {
  minHeight: 44, minWidth: 44, padding: "0 18px", cursor: "pointer",
  background: "transparent", color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", letterSpacing: 1,
};

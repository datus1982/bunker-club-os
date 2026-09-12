import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { radius, space, TAP } from "./tokens";

/**
 * The ratified pinned-footer confirm (audit §5 #8) — the shared replacement for the raw
 * `window.confirm()` calls scattered through the staff pages.
 *
 * Shape matches the trivia `Modal` idiom (pinned header, scrolling body, pinned footer,
 * backdrop + Esc close) so a manager sees ONE dialog language across the app. It is
 * self-contained rather than built on that Modal: `modules/trivia/ui.tsx` is host-console
 * code, and a shared primitive must not depend on a module.
 *
 * Both buttons clear the 44px tap floor. Focus moves to CANCEL on open, so the
 * destructive button is never the one a stray Return key presses.
 *
 * BEAT 6 (PR 3): both buttons carry `st-body`. Without it `.staff-ui button { font-size:
 * 1.25rem !important }` beat the inline 15px and the buttons rendered at 20px, which folded
 * every verb-named label onto two lines at 390px ("Remove / access"). The class is the only
 * thing that can win — an inline size cannot beat an !important — so it is load-bearing, not
 * decoration (the PR #89 lesson, again). `whiteSpace: nowrap` on the shared button style
 * keeps a two-word verb one word; the widest pair in the app today ("Keep access" +
 * "Remove access") measures well inside a 390px sheet.
 *
 * BEAT 6 (PR 1): the sheet tier — surface-4 panel, 10px radius, hairline. `st-sheet`
 * on the backdrop is the token scope hook (a dialog is a v2-only overlay that may sit
 * outside a `[data-st-page]` root). `danger` now paints CONFIRM with the §B danger
 * token instead of borrowing the amber warning ink — amber is for ambient/pending,
 * red is the destructive budget. The tiered confirm patterns themselves (hold-to-
 * confirm, text-swap) are PR 3, not here.
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
  /** Destructive action — CONFIRM renders in the danger ink. */
  danger?: boolean;
  /** Disables both buttons while the mutation is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  // Latest onCancel via a ref: callers pass inline arrows, and the hub re-renders every 60s,
  // so keying the effect on onCancel would re-run it (and yank focus back to CANCEL) while open.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    cancelRef.current?.focus(); // once, on mount
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancelRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div onClick={onCancel} className="terminal-theme staff-ui st-sheet" style={backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="st-panel"
        style={panel}
      >
        <div style={head}>
          {/* overflowWrap: a title can carry a raw email, and an address with no hyphen or
              space has no break opportunity — it would run under the sheet edge. */}
          <div role="heading" aria-level={2} className="u-head st-heading st-t1" style={{ overflowWrap: "anywhere" }}>{title}</div>
        </div>
        {body != null && <div className="st-body st-t2" style={bodyStyle}>{body}</div>}
        <div style={foot}>
          <button type="button" ref={cancelRef} onClick={onCancel} disabled={busy} className="st-btn st-body st-t2" style={btn}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={danger ? "st-btn st-body st-btn-danger" : "st-btn st-body st-btn-primary"}
            style={btn}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: space.s4,
};
const panel: CSSProperties = {
  width: "min(520px, 94vw)", maxHeight: "88vh", borderRadius: radius.sheet,
  display: "flex", flexDirection: "column", overflow: "hidden",
};
const head: CSSProperties = { padding: `${space.s6}px ${space.s6}px ${space.s3}px` };
const bodyStyle: CSSProperties = {
  flex: "1 1 auto", overflowY: "auto", padding: `0 ${space.s6}px ${space.s4}px`,
};
const foot: CSSProperties = {
  display: "flex", gap: space.s3, justifyContent: "flex-end",
  padding: `${space.s4}px ${space.s6}px`, borderTop: "1px solid",
};
const btn: CSSProperties = {
  minHeight: TAP, minWidth: TAP, padding: `0 ${space.s4 + 2}px`, cursor: "pointer",
  letterSpacing: 0.5, fontSize: 15, whiteSpace: "nowrap",
};

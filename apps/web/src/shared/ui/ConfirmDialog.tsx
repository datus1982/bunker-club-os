import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { radius, space, TAP } from "./tokens";

/** The exit animation's own duration — must stay equal to the `st-sheet-exit` /
 *  `st-backdrop-exit` timing in theme/staff-tokens-v2.css (§B reuses 140ms for an exit
 *  rather than adding a fifth constant to the motion scale). The timeout below is only a
 *  FALLBACK for the case where `animationend` never arrives (the animation was suppressed,
 *  the tab was backgrounded mid-exit); the event, when it fires, wins the race. */
const EXIT_MS = 140;

/** A viewer who asked for less motion gets the dismissal instantly instead of a 140ms
 *  hold — the reduced-motion CSS zeroes the animation, so there would be nothing to watch,
 *  only a delay. Wrapped because `matchMedia` can be absent in a non-DOM test environment. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

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
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Latest onCancel via a ref: callers pass inline arrows, and the hub re-renders every 60s,
  // so keying the effect on onCancel would re-run it (and yank focus back to CANCEL) while open.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // ARC 2 §B — the dialog plays its own exit before the caller unmounts it.
  //  entering → exiting → closed. `closed` renders NOTHING: a caller that (wrongly) keeps
  //  the dialog mounted after its dismiss callback therefore cannot strand a transparent
  //  click-blocker over the page, which is the failure mode a fill-mode'd exit invites.
  const [phase, setPhase] = useState<"entering" | "exiting" | "closed">("entering");
  // The dismiss callback to run once the exit has played.
  const pendingRef = useRef<(() => void) | null>(null);

  /** Dismiss: play the exit, then hand control back to the caller.
   *  Re-entrant presses (Escape, then the backdrop, then CANCEL, inside 140ms) are no-ops,
   *  so a rapid open→close→open can never double-fire `onCancel` or strand a dialog. */
  const beginExit = (after: () => void) => {
    if (phase !== "entering") return;
    if (prefersReducedMotion()) { setPhase("closed"); after(); return; }
    pendingRef.current = after;
    setPhase("exiting");
  };
  // Escape is registered mount-once (re-keying it would yank focus back to CANCEL on every
  // parent re-render), so it reaches the CURRENT beginExit through a ref, like onCancel.
  const beginExitRef = useRef(beginExit);
  beginExitRef.current = beginExit;

  useEffect(() => {
    cancelRef.current?.focus(); // once, on mount
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") beginExitRef.current(() => onCancelRef.current());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (phase !== "exiting") return;
    const el = panelRef.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPhase("closed");
      const cb = pendingRef.current;
      pendingRef.current = null;
      cb?.();
    };
    // `animationend` BUBBLES, so a body that animates something of its own would otherwise
    // end the exit early — only the panel's own animation counts.
    const onEnd = (e: AnimationEvent) => { if (e.target === el) finish(); };
    el?.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(finish, EXIT_MS + 60);
    return () => {
      el?.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
    };
  }, [phase]);

  if (phase === "closed") return null;

  return (
    <div onClick={() => beginExit(onCancel)} className="terminal-theme staff-ui st-sheet" style={backdrop}>
      <div
        ref={panelRef}
        data-state={phase}
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
          <button type="button" ref={cancelRef} onClick={() => beginExit(onCancel)} disabled={busy} className="st-btn st-body st-t2" style={btn}>
            {cancelLabel}
          </button>
          {/* DECISION: CONFIRM does NOT play the exit. It hands off to a mutation the
              caller may keep this dialog open for (`busy`), so delaying it by 140ms would
              delay the write, and animating the panel away while `busy` is still true
              would fade out a dialog that is deliberately still on screen. Dismissal —
              CANCEL, the backdrop, Escape — is the path that animates out; a confirmed
              action leaves exactly as abruptly as it did before this beat. */}
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

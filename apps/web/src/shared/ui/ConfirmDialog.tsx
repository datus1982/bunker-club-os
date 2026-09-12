import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { radius, space, TAP } from "./tokens";
// BEAT 8 (PR 2 scope-add): the phase machine that used to live in this file is now
// `useSheetPhase` — ONE definition, shared with SlideOver's v2 drawer. Identical
// behaviour: same three phases, the same `animationend`-vs-fallback-timer race, the same
// reduced-motion short-circuit, the same retarget-on-`title`, and the same "render
// nothing when closed" guarantee. Nothing about this dialog's timings or attributes moved.
import { useSheetPhase } from "./useSheetPhase";

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

  // ARC 2 §B — the dialog plays its own exit before the caller unmounts it.
  //  entering → exiting → closed. `closed` renders NOTHING: a caller that (wrongly) keeps
  //  the dialog mounted after its dismiss callback therefore cannot strand a transparent
  //  click-blocker over the page, which is the failure mode a fill-mode'd exit invites.
  //
  //  `title` is the RETARGET key (arc 2 review NOTE-1): every caller mounts this as
  //  `{target && <ConfirmDialog …/>}` with no `key`, so React REUSES this instance when the
  //  parent opens a dialog for a different target — and landing that inside the 140ms exit
  //  would leave the second dialog invisible. `title` always names the target (an email, a
  //  group, a screen), so a change to it re-enters and drops the stale dismiss callback.
  const { phase, panelRef, beginExit, beginExitRef } = useSheetPhase(title);

  useEffect(() => {
    cancelRef.current?.focus(); // once, on mount
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") beginExitRef.current(() => onCancelRef.current());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A RETARGETED dialog (see NOTE-1 above) is a new dialog to the viewer, so focus returns
  // to CANCEL exactly as it does on a fresh mount — the destructive button is never the one
  // a stray Return press finds. Skips the first run: the mount effect above already did it.
  const firstTitle = useRef(true);
  useEffect(() => {
    if (firstTitle.current) { firstTitle.current = false; return; }
    cancelRef.current?.focus();
  }, [title]);

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
/* `flexWrap` is load-bearing, not tidiness (arc 2 review, raised from the PR 2 lane).
 * The buttons carry `whiteSpace: nowrap` (a two-word verb must stay one line) and
 * `minWidth: TAP`, and a min-width overrides flex's default `min-width: auto` — so a flex
 * row could NOT shrink them and could not break them either. A long pair therefore spilled
 * its text past its own borders: "Keep playlist" (159.5px) + "Delete playlist" (178.5px) +
 * 12px gap = 350px natural against 308px of sheet interior at 390 (+4.5px over at 390,
 * +12.5px at 375). Wrapping lets an over-long pair stack, still right-aligned, instead of
 * overflowing; the Beat 6 pairs are well inside one row and are untouched. */
const foot: CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: space.s3, justifyContent: "flex-end",
  padding: `${space.s4}px ${space.s6}px`, borderTop: "1px solid",
};
/* DECISION (arc 2 review fold) — the horizontal padding drops 18px → 14px, and it is the
 * `flexWrap` above that makes it necessary. MEASURED at 390: the Beat 6 pair "Keep access"
 * (140.5px) + "Remove access" (159.5px) + a 12px gap is 312px NATURAL against 308px of
 * sheet interior. It never fit. `minWidth: TAP` let flex shrink both by ~2px and
 * `whiteSpace: nowrap` pushed the text out past the borders instead — the same silent
 * spill the PR 2 lane measured on the longer DELETE PLAYLIST pair, just small enough that
 * nobody caught it. Once wrapping is on, "doesn't fit" stops being a spill and becomes a
 * STACK, which would have changed the shipped look of the app's most common dialog. 14px
 * gives the short pair 296px — back on one row at 390, as shipped — while the long pair
 * still measures 334px and correctly stacks. Both 44px floors are untouched.
 * Below 390 (checked at 375: 293px interior) the short pair stacks; that is the honest
 * outcome for a screen narrower than the design target, and it stacks cleanly now rather
 * than spilling. */
const btn: CSSProperties = {
  minHeight: TAP, minWidth: TAP, padding: `0 ${space.s3 + 2}px`, cursor: "pointer",
  letterSpacing: 0.5, fontSize: 15, whiteSpace: "nowrap",
};

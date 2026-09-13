import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, EXIT_MS, EXIT_SLACK_MS } from "./motion";

export type SheetPhase = "entering" | "exiting" | "closed";

/**
 * THE SHARED SHEET PHASE (Beat 8 PR 2 scope-add) — one definition of "play the exit, THEN
 * hand control back to the caller".
 *
 * WHY IT IS A HOOK AND NOT A SECOND COPY. `ConfirmDialog` has carried this machine since
 * polish arc 2: entering → exiting → closed, an `animationend` listener racing a
 * `EXIT_MS + EXIT_SLACK_MS` fallback timer, a reduced-motion short-circuit, a retarget
 * when the surface is reused for a different subject, and a cleanup that cannot fire the
 * dismiss callback twice. Beat 8 PR 1 gave `SlideOver` an ENTER only, and said so in its
 * header: an exit means a deferred unmount, and a SECOND hand-rolled copy of this machine
 * is how one of them ends up subtly wrong — the failure mode being a transparent
 * click-blocker stranded over the hub. So the machine moves here, unchanged, and both
 * surfaces call it.
 *
 * THE CONTRACT, and the parts of it that are load-bearing:
 *  · `phase === "closed"` means RENDER NOTHING. Every caller is mounted as
 *    `{open && <Surface/>}` and unmounts synchronously on its own dismiss callback; a
 *    caller that (wrongly) keeps the surface mounted afterwards still cannot strand an
 *    invisible overlay, because the surface itself renders null.
 *  · `beginExit(after)` is a no-op unless the phase is `entering`. Escape, then the
 *    backdrop, then CANCEL inside the same 140ms therefore cannot double-fire `after`, and
 *    a rapid open→close→open cannot leave two pending callbacks.
 *  · REDUCED MOTION short-circuits to `closed` and calls `after` SYNCHRONOUSLY. For a
 *    viewer who asked for less motion there is no exit to wait for (both stylesheets zero
 *    the duration), so holding the element for the same window would be a dead pause.
 *  · `animationend` BUBBLES, so only an event whose `target` is the panel itself ends the
 *    exit — a body that animates something of its own must not cut the exit short.
 *  · `resetKey` is the RETARGET signal. Callers mount these surfaces with no `key`, so
 *    React reuses one instance when the parent opens the surface for a different subject.
 *    Land that inside the exit window and the instance is still `exiting`/`closed` and
 *    renders nothing — the second dialog never appears. Changing `resetKey` re-enters and
 *    DROPS the pending callback, which belonged to the surface the viewer just left. The
 *    check runs during render, exactly where `ConfirmDialog` ran it.
 *
 * `panelRef` must be attached to the element that carries `data-state`, because that is
 * the element whose animation ends the exit.
 */
export function useSheetPhase(resetKey?: unknown) {
  const [phase, setPhase] = useState<SheetPhase>("entering");
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** The dismiss callback to run once the exit has played. */
  const pendingRef = useRef<(() => void) | null>(null);

  const beginExit = (after: () => void) => {
    if (phase !== "entering") return;
    if (prefersReducedMotion()) { setPhase("closed"); after(); return; }
    pendingRef.current = after;
    setPhase("exiting");
  };
  /** Escape is registered mount-once by both consumers (re-keying it would yank focus back
   *  to CANCEL on every parent re-render), so it reaches the CURRENT beginExit via a ref. */
  const beginExitRef = useRef(beginExit);
  beginExitRef.current = beginExit;

  const lastKey = useRef(resetKey);
  if (resetKey !== lastKey.current) {
    lastKey.current = resetKey;
    if (phase !== "entering") {
      pendingRef.current = null;
      setPhase("entering");
    }
  }

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
    const onEnd = (e: AnimationEvent) => { if (e.target === el) finish(); };
    el?.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(finish, EXIT_MS + EXIT_SLACK_MS);
    return () => {
      el?.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
    };
  }, [phase]);

  return { phase, panelRef, beginExit, beginExitRef };
}

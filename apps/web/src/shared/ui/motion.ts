/**
 * Motion helpers shared by the v2 primitives that defer an unmount (polish arc 2 §B).
 *
 * A surface that plays an exit has to keep itself mounted for the duration of that exit.
 * For a viewer who asked for less motion there IS no exit — `theme/staff-tokens-v2.css`
 * zeroes the animation duration and `theme/staff-shell-v2.css` sets `animation: none` on
 * the drawer — so holding the element for the same window is not a shorter animation, it
 * is a dead pause with nothing to watch. Both consumers short-circuit on this check and
 * unmount immediately instead.
 *
 * ONE definition, two consumers (ConfirmDialog, SectionNav): the duplicate was arc 2
 * review NOTE-2. Wrapped in try/catch because `matchMedia` can be absent or throw in a
 * non-DOM environment, and a motion preference must never be the thing that breaks a
 * render.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/** The exit duration shared by the sheet and the drawer — must stay equal to the
 *  `st-sheet-exit` / `st-backdrop-exit` / `sv2-drawer-out` timings in the two v2
 *  stylesheets. §B reuses 140ms for an exit rather than adding a fifth constant to the
 *  motion scale. */
export const EXIT_MS = 140;

/** Slack added to the fallback timer so a late frame cannot clip the last one. Both
 *  exits hold their final keyframe (`animation-fill-mode: both`) across this window, so
 *  the element cannot snap back to its open state while it waits to be unmounted. */
export const EXIT_SLACK_MS = 60;

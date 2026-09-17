import { useLayoutEffect, useState } from "react";

/*
 * Extracted VERBATIM from modules/trivia/GameDisplay.tsx (2026-09-17, host-screen notes).
 * The host SCORING console's question pane now fits its text the same way the audience
 * board does, and the PR #89 rule is ONE copy of this algorithm — the picture round
 * taught us what a second copy costs (its answer key sat at a hardcoded 40px for weeks
 * while FitBox scaled). The function below is a byte-identical move: only the `export`
 * keyword and this header are new, so GameDisplay renders exactly what it rendered before.
 *
 * CALLER CONTRACT — the trap that makes or breaks a fit: the node this hook MEASURES must
 * not carry a class the cascade sizes with `!important`. On a TV that is
 * `.terminal-theme * { font-size: 1.5rem }` (no !important — an inline px beats it). On a
 * v2 staff page it is `[data-st-page] .st-body { font-size: 15px !important }`, which an
 * inline px does NOT beat: a fitted node may take an INK class (`st-t1`) but never a SIZE
 * class. Nothing inherits font-size under this theme, so any nested size must be `em`.
 */
/**
 * useFitSize — the shared measure-based fit. Binary-searches the largest integer font size in
 * [minSize, maxSize] at which the CONTENT node fits inside the BOX on BOTH axes (width and
 * height), wrapping allowed, and returns it.
 *
 * Because it runs in a useLayoutEffect (before paint, not an effect), the correct size is
 * applied before the frame is shown: no flicker on question change or answer reveal.
 *
 * Measurement reads the content node's intrinsic scrollWidth/scrollHeight (independent of how
 * the flex box centers/top-aligns it) against the box's content area (clientWidth/Height
 * minus computed padding). The 1920×1080 canvas is fixed (DisplayCanvas scales the whole
 * surface), so the box's client size is a stable layout metric — same reason
 * TickerReprint/FitText in SlotDisplay/SignageTemplates read client size with no resize
 * listener.
 *
 * The effect has NO dependency array: it re-runs on every commit and only calls setSize when
 * the best size actually changes, so it self-stabilises (one extra measure pass, then quiet)
 * AND it re-fits whenever the box or its content changes — e.g. revealing the answer removes
 * the 200px strip, shrinking the question box, and the question re-fits smaller on that
 * re-render.
 *
 * The content node must be em-driven below its own font size (any nested sizes in `em`), so
 * setting one px size on it scales the whole block — that is what lets the picture-round
 * answer key fit header + all ten rows to ONE shared size in a single search.
 */
export function useFitSize(
  boxRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  { minSize, maxSize }: { minSize: number; maxSize: number },
): number {
  const [size, setSize] = useState(maxSize);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const txt = contentRef.current;
    if (!box || !txt) return;
    const cs = getComputedStyle(box);
    const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const capW = Math.floor(availW);
    const capH = Math.floor(availH);
    const fits = (fs: number) => {
      txt.style.fontSize = `${fs}px`;
      return txt.scrollWidth <= capW && txt.scrollHeight <= capH;
    };
    let lo = minSize;
    let hi = maxSize;
    let best = minSize;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    txt.style.fontSize = `${best}px`; // keep the DOM at the fitted size before paint
    if (best !== size) setSize(best);
  });
  return size;
}

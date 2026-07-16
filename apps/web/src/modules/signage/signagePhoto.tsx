import type { CSSProperties } from "react";
import type { Orientation } from "./useSignage";
import { SUPPORT_TEXT } from "./supportText";

/**
 * Square 1:1 photo viewport, matching the drink-photo crop in docs/signage-redesign-mockup
 * view 1 (the same `.sig-viewport .sig-sq` treatment DrinkSquare uses). Shared so the event
 * cards (EventStages) and any other surface render a custom image with identical framing.
 *
 * `live` greens the feed cap (a live Toast optical feed); a custom manager upload is NOT
 * live, so it stays ambient amber. `size` is the square edge in fixed-canvas px; it never
 * exceeds the column (maxWidth:100%).
 *
 * The feed cap is a supporting label, so it renders at the shared SUPPORT_TEXT floor for the
 * given `orientation` (2026-07-15 label-floor pass — was a hardcoded 20, the "split-brain seam"
 * where a drink card's OPTICAL FEED cap showed at 40 but a moment card's at 20).
 *
 * DECISION: `fit` defaults to "cover" so existing callers (drink-photo parity with Toast's own
 * square crop) are byte-identical. Event/moment cards pass fit="contain" (owner note
 * 2026-07-14) — manager uploads are arbitrary aspect ratios, so letterbox rather than crop.
 */
export function SquarePhoto({
  src, size, orientation, live = false, feed = "OPTICAL FEED", fit = "cover",
}: {
  src: string;
  size: number;
  orientation: Orientation;
  live?: boolean;
  feed?: string;
  fit?: "cover" | "contain";
}) {
  const sizing: CSSProperties = { width: size, maxWidth: "100%", flexShrink: 0 };
  return (
    <div className={`sig-viewport sig-sq${fit === "contain" ? " sig-contain" : ""}`} style={sizing}>
      <span className={`sig-feedcap${live ? " sig-live" : ""}`} style={{ fontSize: SUPPORT_TEXT[orientation] }}>{feed}</span>
      <img src={src} alt="" />
    </div>
  );
}

import type { CSSProperties } from "react";

/**
 * Square 1:1 photo viewport, matching the drink-photo crop in docs/signage-redesign-mockup
 * view 1 (the same `.sig-viewport .sig-sq` treatment DrinkSquare uses). Shared so the event
 * cards (EventStages) and any other surface render a custom image with identical framing.
 *
 * `live` greens the feed cap (a live Toast optical feed); a custom manager upload is NOT
 * live, so it stays ambient amber. `size` is the square edge in fixed-canvas px; it never
 * exceeds the column (maxWidth:100%).
 */
export function SquarePhoto({
  src, size, live = false, feed = "OPTICAL FEED",
}: {
  src: string;
  size: number;
  live?: boolean;
  feed?: string;
}) {
  const sizing: CSSProperties = { width: size, maxWidth: "100%", flexShrink: 0 };
  return (
    <div className="sig-viewport sig-sq" style={sizing}>
      <span className={`sig-feedcap${live ? " sig-live" : ""}`} style={{ fontSize: 20 }}>{feed}</span>
      <img src={src} alt="" />
    </div>
  );
}

import { useLayoutEffect, useRef, useState } from "react";
import type { Orientation, SignageItem, ToastCacheRow } from "./useSignage";
import { TemplateView } from "./SignageTemplates";
import "./signage.css";

/**
 * Inline live preview of a signage item (docs/09 Admin: "live preview at exact aspect").
 * Renders the ACTUAL template component at the fixed DisplayCanvas dimensions, then
 * CSS-scales it to fit the available width — so what staff see building the item is
 * pixel-faithful to the slot board. Amber ambient ink by default; `.sig-live` inside
 * still renders Toast-sourced values green, exactly as the board does.
 */

const CANVAS: Record<Orientation, { w: number; h: number; pad: string }> = {
  // Matches SlotDisplay's Rotation content-zone padding EXACTLY (top/right/bottom) so the framing is
  // identical to the board. Kept in sync with SlotDisplay's `padByOrientation` — the top edge was
  // tightened 56→26 / 44→20 (2026-07-15 buffer beat); bottom stays full for the drink category row.
  portrait: { w: 1080, h: 1920, pad: "26px 48px 56px" },
  landscape: { w: 1920, h: 1080, pad: "20px 56px 44px" },
};

export function SignagePreview({
  item,
  toast,
  orientation,
  venueName,
  maxWidth = 340,
}: {
  item: SignageItem;
  toast: Map<string, ToastCacheRow>;
  orientation: Orientation;
  /** Venue mark for the drink_special card's brand line — threaded so the preview shows
   *  the same footer the real board does (venue-scope; never hardcoded here). */
  venueName?: string;
  maxWidth?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(maxWidth);
  const c = CANVAS[orientation];

  // Fit to the container's real width (mobile: the modal body; desktop: the column).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setW(Math.min(maxWidth, el.clientWidth || maxWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  const scale = w / c.w;
  const previewH = c.h * scale;

  return (
    <div ref={boxRef} style={{ width: "100%" }}>
      <div
        className="signage-slot signage-amber"
        style={{
          position: "relative",
          width: w,
          height: previewH,
          overflow: "hidden",
          background: "#000",
          border: "2px solid var(--terminal-green)",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: c.w,
            height: c.h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            padding: c.pad,
            display: "flex",
            flexDirection: "column",
            color: "var(--terminal-green)",
          }}
        >
          <TemplateView item={item} toast={toast} orientation={orientation} venueName={venueName} />
        </div>
      </div>
    </div>
  );
}

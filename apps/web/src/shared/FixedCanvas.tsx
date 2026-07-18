import type { ReactNode } from "react";

/**
 * A side-effect-FREE fixed logical canvas — for NESTING a fixed-px surface inside another (docs/15
 * M3 multiview panel). Unlike DisplayCanvas (which owns the whole viewport), FixedCanvas takes an
 * explicit box and scales its logical canvas to fit — no <meta viewport> mutation, no nightly
 * reload, no window.innerWidth read. It is therefore safe to nest INSIDE DisplayCanvas, which
 * DisplayCanvas is not (its global side-effects would fight a second instance — the M3 finding).
 *
 * Uniform scale (min of the two ratios) preserves aspect; the remainder is a black letterbox. The
 * multiview panel uses width=1080 height=1920 (the real portrait canvas) into a 608×1080 box →
 * scale 0.5625, a ~0.25px hairline letterbox (docs/15 D1).
 */
export function FixedCanvas({
  width, height, boxWidth, boxHeight, children,
}: {
  /** Logical canvas the children are laid out in (fixed px). */
  width: number;
  height: number;
  /** The px box to fit the canvas into (the parent region's size on the 1920×1080 stage). */
  boxWidth: number;
  boxHeight: number;
  children: ReactNode;
}) {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const left = (boxWidth - width * scale) / 2;
  const top = (boxHeight - height * scale) / 2;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

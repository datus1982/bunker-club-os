import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";

type Orientation = "landscape" | "portrait";

interface DisplayCanvasProps {
  orientation: Orientation;
  children: ReactNode;
  /** Per-slot overscan compensation (signage_slots.overscan_inset_pct). */
  overscanInsetPct?: number;
  /** Per-slot fine scale trim (signage_slots.scale_adjust). */
  scaleAdjust?: number;
}

const DIMS: Record<Orientation, { w: number; h: number }> = {
  landscape: { w: 1920, h: 1080 },
  portrait: { w: 1080, h: 1920 },
};

/**
 * docs/01 Display canvas system (non-negotiable for ALL display routes).
 *
 * Fixed logical canvas (1920×1080 / 1080×1920) laid out in absolute px, then a
 * single transform: scale() to fit the real viewport. NO responsive design, no
 * media queries, no vw/vh font sizing. Browsers rasterize transformed text at
 * device resolution → 4K renders sharper, never blurrier. Remainder is black
 * letterbox. Add `?calibrate` to any display URL for the test pattern.
 */
export function DisplayCanvas({
  orientation,
  children,
  overscanInsetPct = 0,
  scaleAdjust = 1,
}: DisplayCanvasProps) {
  const { w, h } = DIMS[orientation];
  const [vp, setVp] = useState({ vw: window.innerWidth, vh: window.innerHeight });
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);

  useLayoutEffect(() => {
    const onResize = () => {
      setVp({ vw: window.innerWidth, vh: window.innerHeight });
      setDpr(window.devicePixelRatio || 1);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Nightly self-reload at 04:00 local time (docs/12 display resilience).
  useNightlyReload();

  // Kiosk viewport lock (a11y trade-off, Phase 3.5 task 3). The static index.html
  // ships a zoomable viewport so the public site + staff app can pinch-zoom. Display
  // routes are always-on TVs where user scaling would be a liability, so DisplayCanvas
  // — used ONLY by display routes — re-applies the restrictive viewport on mount and
  // restores the default on unmount (SPA nav away from a display route).
  useKioskViewport();

  const insetFactor = 1 - Math.max(0, overscanInsetPct) / 100;
  const scale = Math.min(vp.vw / w, vp.vh / h) * scaleAdjust * insetFactor;
  const left = (vp.vw - w * scale) / 2;
  const top = (vp.vh - h * scale) / 2;

  const calibrate = new URLSearchParams(window.location.search).has("calibrate");

  return (
    <div
      className="terminal-theme"
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: w,
          height: h,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {calibrate ? (
          <CalibrationPattern
            w={w}
            h={h}
            insetPct={overscanInsetPct}
            vw={vp.vw}
            vh={vp.vh}
            dpr={dpr}
            scale={scale}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

const DEFAULT_VIEWPORT = "width=device-width, initial-scale=1.0";
const KIOSK_VIEWPORT =
  "width=device-width, initial-scale=1.0, user-scalable=no, maximum-scale=1.0";

/**
 * Mount-scoped kiosk viewport. Swaps the <meta name="viewport"> content to the
 * no-scaling kiosk value while a display route is mounted, and restores whatever
 * was there before on unmount. Idempotent — mutates the existing meta if present,
 * creates one only if the document somehow lacks it.
 */
function useKioskViewport() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    let created = false;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
      created = true;
    }
    const prev = meta.getAttribute("content") ?? DEFAULT_VIEWPORT;
    meta.setAttribute("content", KIOSK_VIEWPORT);
    return () => {
      if (created) {
        meta!.remove();
      } else {
        meta!.setAttribute("content", prev);
      }
    };
  }, []);
}

function useNightlyReload() {
  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(4, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    const id = window.setTimeout(() => window.location.reload(), ms);
    return () => window.clearTimeout(id);
  }, []);
}

/**
 * ?calibrate test pattern (docs/01): edge markers at 0% and at the slot's inset,
 * corner targets, a font-size ladder, and a live readout of reported viewport,
 * devicePixelRatio, and computed scale. Install procedure: stand at each screen,
 * confirm edges + crispness, set inset if needed.
 */
function CalibrationPattern({
  w,
  h,
  insetPct,
  vw,
  vh,
  dpr,
  scale,
}: {
  w: number;
  h: number;
  insetPct: number;
  vw: number;
  vh: number;
  dpr: number;
  scale: number;
}) {
  const insetPx = (Math.max(0, insetPct) / 100) * Math.min(w, h);
  const corner = (style: CSSProperties) => (
    <div
      style={{
        position: "absolute",
        width: 80,
        height: 80,
        border: "3px solid var(--terminal-green)",
        ...style,
      }}
    />
  );
  return (
    <div style={{ position: "absolute", inset: 0, color: "var(--terminal-green)" }}>
      {/* 0% edge frame */}
      <div style={{ position: "absolute", inset: 0, border: "2px solid var(--terminal-green)" }} />
      {/* inset frame */}
      {insetPx > 0 && (
        <div
          style={{
            position: "absolute",
            inset: insetPx,
            border: "2px dashed var(--terminal-amber, #ffb000)",
          }}
        />
      )}
      {/* corner targets */}
      {corner({ top: 0, left: 0 })}
      {corner({ top: 0, right: 0 })}
      {corner({ bottom: 0, left: 0 })}
      {corner({ bottom: 0, right: 0 })}

      {/* font-size ladder */}
      <div style={{ position: "absolute", top: h / 2 - 160, left: 80 }}>
        {[24, 32, 48, 64, 96].map((size) => (
          <div key={size} style={{ fontSize: size, lineHeight: 1.1 }}>
            {size}px — SHELTER AUTHORITY CALIBRATION 0123456789
          </div>
        ))}
      </div>

      {/* live readout */}
      <div style={{ position: "absolute", top: 100, left: "50%", transform: "translateX(-50%)", textAlign: "center", fontSize: 28 }}>
        <div>BUNKER UNIFIED OS — CALIBRATION</div>
        <div>canvas {w}×{h}</div>
        <div>viewport {vw}×{vh}</div>
        <div>devicePixelRatio {dpr}</div>
        <div>computed scale {scale.toFixed(4)}</div>
        <div>overscan inset {insetPct}%</div>
      </div>
    </div>
  );
}

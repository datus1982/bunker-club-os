import { useMemo, type ReactNode } from "react";
import { FixedCanvas } from "@/shared/FixedCanvas";
import { MainMediaStage } from "./MainMediaStage";
import { RotationSurface } from "./SlotDisplay";
import {
  usePanelSlot, resolveRotation, teaseMoment,
  type ToastCacheRow, type LiveEvent,
} from "./useSignage";
import type { TickerLine } from "./useTicker";
import type { MultiviewMain } from "./mediaProgram";

/**
 * MULTIVIEW program renderer (docs/15 M3 — D1/D6/D7/D8/D9). A 16:9 MAIN region (playlist or live
 * capture) beside a true-portrait PANEL running the existing rotation, so promos keep advertising
 * while a game/movie plays.
 *
 * Geometry (D1, to the pixel, on the 1920×1080 canvas):
 *   • MAIN region 1312×1080 — a 171px chrome header + a 1312×738 16:9 stage + a 171px ticker.
 *     The stage is CONTAINED (never crop); a true-16:9 source fills it exactly (D8).
 *   • PANEL 608×1080 — the real 1080×1920 portrait canvas scaled ×0.5625 (FixedCanvas), rendering
 *     the panel slot's rotation via RotationSurface (same templates, POS/86 gates — D2).
 *
 * D6: audio is the MAIN region only (the panel is silent slides). D7: always framed — chrome +
 * ticker + panel all survive (the maximal-ads program; there is no full-bleed multiview). D9:
 * rendered ONLY while mode === 'rotation', so a takeover/MOMENT/live game unmounts the WHOLE
 * multiview (main <video>/capture tracks stop, panel unmounts) exactly like any program.
 *
 * The panel reuses the host's already-fetched toast/liveEvents/now/ticker (no second fetch of those);
 * only the panel slot row + its queue are fetched here (usePanelSlot).
 */
export function MultiviewProgram({
  main, panelSlotId, hostSlug, base, header, footer,
  venueName, timezone, toast, liveEvents, ticker, now,
}: {
  main: MultiviewMain;
  panelSlotId: string;
  /** The host (landscape) slug — the main video's Q-SYS transport channel rides it. */
  hostSlug: string;
  base: string;
  /** Host chrome nodes for the MAIN region (built by SlotScreen so ink/venue/clock match). */
  header: ReactNode;
  footer: ReactNode;
  venueName: string;
  timezone: string;
  toast: Map<string, ToastCacheRow>;
  liveEvents: LiveEvent[];
  ticker: TickerLine[];
  now: Date;
}) {
  const { slot: panelSlotQ, items: panelItemsQ } = usePanelSlot(panelSlotId);
  const panelSlot = panelSlotQ.data ?? null;
  const panelItems = useMemo(() => panelItemsQ.data ?? [], [panelItemsQ.data]);

  const panelRotation = useMemo(
    () => resolveRotation(panelItems, toast, now, liveEvents),
    [panelItems, toast, now, liveEvents],
  );
  const panelTease = useMemo(() => teaseMoment(liveEvents, now), [liveEvents, now]);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "row", background: "#000" }}>
      {/* ── MAIN region: 1312 wide (171 header + 738 16:9 stage + 171 ticker) ── */}
      <div style={{ width: 1312, height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "2px solid var(--sig-rule)" }}>
        <div style={{ height: 171, flexShrink: 0, overflow: "hidden" }}>{header}</div>
        <div style={{ height: 738, flexShrink: 0, position: "relative", overflow: "hidden", background: "#000" }}>
          <MainMediaStage main={main} slug={hostSlug} base={base} />
        </div>
        <div style={{ height: 171, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>{footer}</div>
      </div>

      {/* ── PANEL: 608 wide — the real portrait canvas (1080×1920) scaled ×0.5625 ── */}
      <div style={{ width: 608, height: "100%", flexShrink: 0, position: "relative" }}>
        {panelSlot ? (
          <FixedCanvas width={1080} height={1920} boxWidth={608} boxHeight={1080}>
            <RotationSurface
              slot={panelSlot}
              venueName={venueName}
              timezone={timezone}
              rotation={panelRotation}
              toast={toast}
              tease={panelTease}
              ticker={ticker}
            />
          </FixedCanvas>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18, color: "var(--terminal-green)" }}>
            <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: 3 }}>{panelSlotQ.isPending ? "SYNCING" : "NO PANEL"}</div>
            <div style={{ fontSize: 26, opacity: 0.6 }}>◊ {panelSlotQ.isPending ? "PANEL UPLINK" : "PANEL SLOT NOT SET"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

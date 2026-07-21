import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PlaylistProgram } from "./PlaylistProgram";
import { useCarouselPlaylists, type CarouselOrder, type CarouselPlaylist } from "./mediaProgram";
import type { Slot } from "./useSignage";
import { SUPPORT_TEXT } from "./supportText";

/**
 * PLAYLIST CAROUSEL program renderer (owner beat 2026-07-20, docs/15) — play one whole playlist
 * through, then hop to the next.
 *
 * Rendered from SlotDisplay ONLY while mode === 'rotation' && the effective program is a carousel,
 * so a takeover / MOMENT / live game preempts it exactly like a plain playlist (the <video> stops
 * with it). Each leg is just the M1 PlaylistProgram playing ONE playlist — so that playlist's own
 * shuffle + presentation (framed/fullbleed) + subtitles all apply, NOW SHOWING flows into the
 * chrome header for a framed leg, Q-SYS pause/resume/next drive the current video, and
 * report_now_playing keeps stamping on actual playback (all inherited unchanged).
 *
 * The hop fires from PlaylistProgram's `onPassComplete` (the last present clip ended, or a Q-SYS
 * `next` at the last clip). ORDERED walks the venue's playlists alphabetically by name; RANDOM
 * picks a different playlist each hop (no immediate repeat). A `leg` counter is folded into the
 * PlaylistProgram key so even a same-playlist repeat (a single-playlist venue) remounts fresh and
 * replays from the top. Only playlists with ≥1 present file are in the cycle (useCarouselPlaylists),
 * so a hop never lands on a stalling empty playlist.
 *
 * Perf: no timers of its own — the hop is event-driven off the native `ended`; the only
 * continuously-moving element is the leg's <video>, exactly as a plain playlist program.
 */
export function CarouselProgram({
  slot, order, base, renderHeader, footer,
}: {
  slot: Slot;
  order: CarouselOrder;
  /** Media host base URL (resolveMediaBase — 127.0.0.1:{port} or ?mediahost override). */
  base: string;
  /** Same render props as PlaylistProgram — a framed leg uses them, a fullbleed leg ignores them. */
  renderHeader: (nowShowing: ReactNode) => ReactNode;
  footer: ReactNode;
}) {
  const { data } = useCarouselPlaylists();
  const list = data ?? [];

  // The playlist currently playing + a monotonic leg counter (forces a fresh remount even when the
  // next pick is the SAME playlist, so it replays instead of sitting on its last frame).
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [leg, setLeg] = useState(0);

  // The live list in a ref so `hop` reads the freshest playlists without re-identifying on every
  // realtime list change (which would tear down the leg mid-play).
  const listRef = useRef<CarouselPlaylist[]>(list);
  listRef.current = list;

  // Seed the first playlist once the list is known (ordered → first alphabetically; random → any).
  useEffect(() => {
    if (currentId === null && list.length > 0) {
      setCurrentId(order === "ordered" ? list[0].id : pickRandom(list, null));
    }
  }, [currentId, list, order]);

  const hop = useCallback(() => {
    const l = listRef.current;
    if (l.length === 0) { setCurrentId(null); return; }
    setCurrentId((cur) => {
      if (order === "ordered") {
        const i = l.findIndex((p) => p.id === cur);
        return l[i < 0 ? 0 : (i + 1) % l.length].id; // cur gone (deleted) → restart at the top
      }
      return pickRandom(l, cur);
    });
    setLeg((n) => n + 1);
  }, [order]);

  if (list.length === 0 || !currentId) {
    return (
      <>
        {renderHeader(null)}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#000" }}>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 20, color: "var(--terminal-green)" }}>
            <div style={{ fontSize: slot.orientation === "portrait" ? 84 : 72, fontWeight: 700, letterSpacing: 3 }}>CAROUSEL STANDBY</div>
            <div style={{ fontSize: SUPPORT_TEXT[slot.orientation], letterSpacing: 3, opacity: 0.6 }}>◊ NO PLAYLISTS WITH MEDIA ON THE HOST</div>
          </div>
        </div>
        {footer}
      </>
    );
  }

  return (
    <PlaylistProgram
      key={`carousel:${currentId}:${leg}`}
      slot={slot}
      playlistId={currentId}
      base={base}
      renderHeader={renderHeader}
      footer={footer}
      onPassComplete={hop}
    />
  );
}

// Deterministic-per-hop random pick with no immediate repeat. A small module-level LCG (the
// shuffleSeeded precedent) rather than Math.random-per-call, so the sequence is reproducible within
// a session; a hop is a discrete event (never a per-render call), so advancing the seed is fine.
let carouselSeq = 1;
function pickRandom(list: CarouselPlaylist[], exclude: string | null): string {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0].id;
  const pool = exclude ? list.filter((p) => p.id !== exclude) : list;
  const src = pool.length ? pool : list;
  let seed = (carouselSeq++ * 2654435761) >>> 0;
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return src[Math.floor((seed / 0x100000000) * src.length)].id;
}

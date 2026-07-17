import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  installAudioAutoArm, isAudioUnlocked, markAudioUnlocked, subscribeArmed,
} from "@/shared/videoAudio";
import { usePlaylistProgram, mediaFileUrl, type MediaFile } from "./mediaProgram";
import { useTransportCommands } from "./mediaTransport";
import type { Slot } from "./useSignage";
import { SUPPORT_TEXT } from "./supportText";

/**
 * PLAYLIST program renderer (docs/15 M1) — a media-library playlist looping on a slot.
 *
 * Rendered from SlotDisplay ONLY while mode === 'rotation' && slot.program.kind === 'playlist'.
 * Because a takeover / MOMENT / live game flips `mode` off 'rotation', this component unmounts
 * the instant any of them preempt — the native <video> stops with it (no cover-and-keep-playing).
 *
 * Presentation (per-playlist, ratified toggle):
 *   • framed    — video letterboxed (object-fit: contain) in the normal content zone, with the
 *                 slot's chrome header + ticker footer intact (chrome suits archival/odd-ratio).
 *   • fullbleed — video fills the whole canvas (object-fit: cover), chrome hidden (movies).
 *
 * Files are fetched from the Electron shell over `{base}/media/{hash}` (127.0.0.1 by default —
 * a secure context). On a machine that is NOT the media PC (staff preview, hub), the fetch fails
 * and the player shows a skinned MEDIA HOST OFFLINE / FEED INTERRUPTED card instead of a black
 * screen — previews stay honest without the files present.
 *
 * Perf: the only continuously-moving element is the <video> (display rule); advance is driven by
 * the native `ended` event (no interval), error/stall recovery by FINITE timeouts.
 */
export function PlaylistProgram({
  slot, playlistId, base, header, footer,
}: {
  slot: Slot;
  playlistId: string;
  /** Media host base URL (resolveMediaBase — 127.0.0.1:{port} or ?mediahost override). */
  base: string;
  /** Chrome nodes rendered around the video in `framed` mode (hidden in `fullbleed`). */
  header: ReactNode;
  footer: ReactNode;
}) {
  const { data, isPending, isError } = usePlaylistProgram(playlistId);
  const playlist = data?.playlist ?? null;
  const files = data?.files ?? [];
  // Default framed until the row loads (never flash fullbleed while unknown).
  const fullbleed = playlist?.presentation === "fullbleed";

  const video = (
    <PlaylistVideo
      key={playlistId}
      slug={slot.slug}
      files={files}
      base={base}
      shuffle={!!playlist?.shuffle}
      fullbleed={fullbleed}
      orientation={slot.orientation}
      loading={isPending}
      loadError={isError}
    />
  );

  if (fullbleed) {
    // Full canvas, no chrome — the video owns the whole surface.
    return <div style={{ position: "absolute", inset: 0, background: "#000" }}>{video}</div>;
  }

  // Framed: chrome header + video in the content zone + ticker footer (mirrors SlotScreen's
  // rotation layout so the frame reads identically to a normal slide).
  return (
    <>
      {header}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#000" }}>
        {video}
      </div>
      {footer}
    </>
  );
}

const PLAYING_MIN_READY = 3; // HTMLMediaElement.readyState HAVE_FUTURE_DATA — actually playing

/**
 * The looping native <video>. One clip element at a time (keyed by index+retry so each clip is a
 * fresh element with clean lifecycle). `ended` → next (wraps to loop). error / load-stall →
 * FEED INTERRUPTED for 5s then skip; a first-load failure or zero present files → MEDIA HOST
 * OFFLINE (retries the current clip every 8s so it recovers when the shell comes back).
 */
function PlaylistVideo({
  slug, files, base, shuffle, fullbleed, orientation, loading, loadError,
}: {
  slug: string;
  files: MediaFile[];
  base: string;
  shuffle: boolean;
  fullbleed: boolean;
  orientation: "portrait" | "landscape";
  loading: boolean;
  loadError: boolean;
}) {
  // Shuffle deterministically per mount via a session-monotonic seed (top_sellers precedent —
  // no Math.random-per-render). A stable order per mount keeps the loop predictable.
  const order = useMemo(() => (shuffle ? shuffleSeeded(files) : files), [files, shuffle]);

  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  // Monotonic play counter — bumped on every advance so the <video> key ALWAYS changes and the
  // element remounts to replay. Without it a SINGLE-item playlist can't loop (index stays 0 →
  // same key → the ended element just sits on its last frame) — the loop needs a fresh element.
  const [plays, setPlays] = useState(0);
  const [phase, setPhase] = useState<"ok" | "interrupted" | "offline">("ok");
  const videoRef = useRef<HTMLVideoElement>(null);
  const everPlayed = useRef(false);
  const loadTimer = useRef<number | null>(null);

  // Keep index in range if the playlist shrinks under us (a file went missing).
  useEffect(() => {
    if (index >= order.length && order.length > 0) setIndex(0);
  }, [order.length, index]);

  const current = order.length ? order[index % order.length] : null;

  const advance = useCallback(() => {
    setPhase("ok");
    setPlays((p) => p + 1);
    setIndex((i) => (order.length ? (i + 1) % order.length : 0));
  }, [order.length]);

  const onError = useCallback(() => {
    // First clip never reached 'playing' → the host is unreachable; else a mid-loop hiccup.
    setPhase(everPlayed.current ? "interrupted" : "offline");
  }, []);

  // Q-SYS transport (docs/15 M2): pause/resume toggle the native <video>, next advances the loop.
  // Subscribed here, so it cleans up the instant a takeover/moment/game unmounts the program tier.
  useTransportCommands(slug, {
    onPause: () => videoRef.current?.pause(),
    onResume: () => { videoRef.current?.play().catch(() => {}); },
    onNext: advance,
  });

  // FEED INTERRUPTED → finite 5s hold, then skip to the next clip (perf: no infinite state).
  useEffect(() => {
    if (phase !== "interrupted") return;
    const id = window.setTimeout(advance, 5000);
    return () => window.clearTimeout(id);
  }, [phase, advance]);

  // MEDIA HOST OFFLINE → retry the current clip every 8s (remount via `retry`), so the screen
  // self-heals the moment the shell starts serving. Finite one-shot, re-armed each cycle.
  useEffect(() => {
    if (phase !== "offline") return;
    const id = window.setTimeout(() => { setRetry((r) => r + 1); setPhase("ok"); }, 8000);
    return () => window.clearTimeout(id);
  }, [phase, retry]);

  // Per-clip load watchdog: if a fresh clip hasn't reached 'playing' within 6s, treat it as a
  // stall (host offline on a first load, interrupted mid-loop). Cleared on 'playing'.
  useEffect(() => {
    if (phase !== "ok" || !current) return;
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
    loadTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.readyState < PLAYING_MIN_READY) {
        setPhase(everPlayed.current ? "interrupted" : "offline");
      }
    }, 6000);
    return () => { if (loadTimer.current) window.clearTimeout(loadTimer.current); };
  }, [phase, index, retry, plays, current]);

  // Audio: boot unmuted only if a probe already proved sound works this session (the Electron
  // shell allows unmuted autoplay so it just works there); else boot muted and probe once the
  // clip is really playing. A native <video> lets us toggle .muted directly (unlike the
  // cross-origin YouTube iframe), so the probe is a plain unmute-and-verify.
  const bootMuted = useRef(!isAudioUnlocked());
  const probe = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isAudioUnlocked()) { v.muted = false; return; }
    v.muted = false;
    v.play().then(() => {
      // Still playing after the unmute request → the browser allows sound this session.
      if (!v.paused) markAudioUnlocked();
      else { v.muted = true; v.play().catch(() => {}); }
    }).catch(() => {
      // Browser blocked unmuted playback → recover muted (correct for a plain browser preview).
      v.muted = true;
      v.play().catch(() => {});
    });
  }, []);

  useEffect(() => {
    installAudioAutoArm();
    return subscribeArmed(() => probe());
  }, [probe]);

  const onPlaying = useCallback(() => {
    everPlayed.current = true;
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
    if (bootMuted.current) probe();
  }, [probe]);

  const objectFit = fullbleed ? "cover" : "contain";
  const bigText = orientation === "portrait" ? 88 : 76;

  if (order.length === 0) {
    // No present files (empty playlist, or every file missing) → honest offline/empty card.
    return <StatusCard kind="offline" support={SUPPORT_TEXT[orientation]} bigText={bigText} thumb={null}
      note={loadError ? "PLAYLIST UNREADABLE" : loading ? "LOADING PROGRAM…" : "NO MEDIA PRESENT ON THE HOST"} />;
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {phase !== "offline" && current && (
        <video
          ref={videoRef}
          key={`${index}-${retry}-${plays}`}
          src={mediaFileUrl(base, current.hash)}
          poster={current.thumb ?? undefined}
          autoPlay
          playsInline
          // NOTE-6: init muted per-CLIP from the live unlock state, not a mount-captured ref — so a
          // clip that mounts AFTER audio was unlocked this session starts unmuted (no muted pop-in).
          muted={!isAudioUnlocked()}
          onEnded={advance}
          onError={onError}
          onPlaying={onPlaying}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit, background: "#000" }}
        />
      )}
      {phase === "interrupted" && (
        <StatusCard kind="interrupted" support={SUPPORT_TEXT[orientation]} bigText={bigText} thumb={current?.thumb ?? null} note="RESUMING FEED…" />
      )}
      {phase === "offline" && (
        <StatusCard kind="offline" support={SUPPORT_TEXT[orientation]} bigText={bigText} thumb={current?.thumb ?? null} note="◊ CHECK THE MEDIA HOST" />
      )}
    </div>
  );
}

/** In-world skinned error card — the thumb (if any) as dim poster art behind terminal text. */
function StatusCard({ kind, support, bigText, thumb, note }: {
  kind: "interrupted" | "offline";
  support: number;
  bigText: number;
  thumb: string | null;
  note: string;
}) {
  const title = kind === "offline" ? "MEDIA HOST OFFLINE" : "FEED INTERRUPTED";
  return (
    <div className="sig-enter" style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 22 }}>
      {thumb && (
        <img src={thumb} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.22, filter: "grayscale(0.4)" }} />
      )}
      <div className={kind === "offline" ? "u-amber" : ""} style={{ position: "relative", fontSize: bigText, fontWeight: 700, letterSpacing: 3, lineHeight: 0.98, textShadow: "0 0 16px var(--terminal-glow)" }}>{title}</div>
      <div style={{ position: "relative", fontSize: support, letterSpacing: 4, opacity: 0.6 }}>{note}</div>
    </div>
  );
}

/**
 * Deterministic shuffle keyed by a session-monotonic seed (top_sellers precedent). Each mount
 * takes the next seed, so a re-mounted program starts from a different order — but the order is
 * stable within a mount (no reshuffle-per-render). Resets on the nightly reload; fine, it's
 * session-scoped. A small LCG keeps it dependency-free.
 */
let playlistShuffleSeq = 1;
function shuffleSeeded<T>(items: T[]): T[] {
  const arr = [...items];
  let seed = (playlistShuffleSeq++ * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

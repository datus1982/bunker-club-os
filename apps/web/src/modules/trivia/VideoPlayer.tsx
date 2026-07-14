import { useCallback, useEffect, useRef, useState } from "react";
import { armAudio, installAudioAutoArm, isAudioUnlocked, markAudioUnlocked, subscribeArmed } from "@/shared/videoAudio";

/**
 * Inter-round video (docs/04 port of VideoPlayer.tsx). YouTube URLs are normalised to an
 * embed with autoplay + chrome stripped (no controls/branding/related/kbd), so an
 * unattended display can't be navigated away. A black bar hides the YouTube title card
 * for the first 7s.
 *
 * AUTOPLAY WITH SOUND — the venue A/V rounds, audio matters. Browsers block UNMUTED
 * autoplay without a gesture; MUTED autoplay always works. Behaviour verified against real
 * Chrome under both `--autoplay-policy` values:
 *   • Boot the embed MUTED (`mute=1&autoplay=1&playsinline=1&enablejsapi=1`) → it ALWAYS
 *     starts, which is the fix for the "video isn't autoplaying" report (the old embed set
 *     `autoplay=1` with no `mute`, so the browser blocked it and nothing played).
 *   • On the YouTube IFrame API `onReady`, "probe" for sound: send `unMute` + `playVideo`,
 *     then check the player state ~700ms later. If it is still PLAYING, the browser allows
 *     sound → keep it unmuted, hide the prompt, and mark the session audio-unlocked (so the
 *     next video boots unmuted directly). If it stalled/paused, the browser blocked it →
 *     revert to `mute` + `playVideo` (recovers muted playback with no visible hitch) and
 *     show an in-world "AUDIO CHANNEL SEALED — TAP TO OPEN COMMS" prompt.
 *   • A tap arms the session and re-probes (best-effort; some headful/webview browsers
 *     propagate the gesture) — and the safe revert guarantees the screen never freezes.
 *
 * DECISION: a parent-page tap cannot force sound on a *cross-origin* YouTube embed (the
 * user activation does not cross the frame boundary — verified in Chrome). The reliable
 * hands-off audio path on a kiosk TV is a browser autoplay allowance (Chrome
 * `--autoplay-policy=no-user-gesture-required` or Site Settings → Sound → Allow; Firefox
 * Autoplay → Allow Audio and Video). With that set, the probe unmutes automatically and no
 * prompt ever appears. This is documented in the README "VIDEO SOUND ON TVs" note.
 *
 * Lifecycle: this component only mounts while game_display_state.show_video is true
 * (GameDisplayBoard early-returns it), so every flip-on is a fresh mount and every flip-off
 * a full unmount — no stuck prompt, no double-play. A mid-video kiosk reload re-mounts with
 * show_video already true and autoplays again. Shared verbatim by the /game-display route
 * AND the signage landscape slot (GameDisplayBoard reuse).
 */

const PLAYING = 1;
const BUFFERING = 3;

export function VideoPlayer({ videoUrl, autoplay = true }: { videoUrl: string; autoplay?: boolean }) {
  const [showTitleCover, setShowTitleCover] = useState(true);
  const [sealed, setSealed] = useState(false); // audio prompt visible (muted, browser blocked sound)
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastState = useRef<number | null>(null);
  const probeTimer = useRef<number | null>(null);

  const yt = parseYouTubeUrl(videoUrl);
  const controllable = autoplay && !!yt;
  // Boot unmuted only if a probe already proved sound works this session; else boot muted.
  const bootMuted = useRef<boolean>(!isAudioUnlocked());

  // targetOrigin for IFrame-API messages: the embed's own origin (review N2). Derived,
  // not hardcoded — a pass-through embed URL may use a different YouTube host (no-www,
  // music.youtube.com); a mismatched targetOrigin drops the message silently.
  const ytOrigin = (() => {
    try { return yt ? new URL(yt, window.location.href).origin : ""; } catch { return ""; }
  })();

  const command = useCallback((func: string, args: unknown[] = []) => {
    if (!ytOrigin) return;
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), ytOrigin);
  }, [ytOrigin]);

  // Attempt sound, then verify: keep it if the player is really playing, else revert to
  // muted playback and raise the prompt. Self-corrects wherever the browser blocks sound.
  const probe = useCallback(() => {
    if (!controllable) return;
    command("unMute");
    command("setVolume", [100]);
    command("playVideo");
    if (probeTimer.current) window.clearTimeout(probeTimer.current);
    probeTimer.current = window.setTimeout(() => {
      const st = lastState.current;
      if (st === PLAYING || st === BUFFERING) {
        markAudioUnlocked();
        setSealed(false);
      } else {
        command("mute");
        command("playVideo");
        setSealed(true);
      }
    }, 700);
  }, [controllable, command]);

  // Black title-card cover for the first 7s (ported behaviour), re-armed per video.
  useEffect(() => {
    setShowTitleCover(true);
    const t = window.setTimeout(() => setShowTitleCover(false), 7000);
    return () => window.clearTimeout(t);
  }, [videoUrl]);

  // Global first-gesture arming + re-probe the live video when a gesture arms the session.
  useEffect(() => {
    installAudioAutoArm();
    return subscribeArmed(() => {
      if (controllable) probe();
    });
  }, [controllable, probe]);

  // YouTube IFrame API: send the `listening` handshake so YT streams state, track player
  // state, and probe on ready (unless we already booted unmuted from a proven-unlocked
  // session — then just verify it didn't stall).
  useEffect(() => {
    if (!controllable) return;
    const win = () => iframeRef.current?.contentWindow ?? null;
    const listen = () => { if (ytOrigin) win()?.postMessage(JSON.stringify({ event: "listening" }), ytOrigin); };

    const onMessage = (e: MessageEvent) => {
      // Anchored: host must BE youtube.com or a subdomain (review N1 — suffix regex
      // would also match e.g. evilnotyoutube.com).
      if (e.source !== win() || !/(^|\.)youtube\.com$/.test(safeHost(e.origin))) return;
      let data: unknown;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const msg = data as { event?: string; info?: { playerState?: number } };
      if (msg.event === "infoDelivery" && msg.info && typeof msg.info.playerState === "number") {
        lastState.current = msg.info.playerState;
      } else if (msg.event === "onReady") {
        if (bootMuted.current) {
          probe();
        } else {
          // Booted unmuted on a proven session — verify it actually plays; if not, recover muted.
          if (probeTimer.current) window.clearTimeout(probeTimer.current);
          probeTimer.current = window.setTimeout(() => {
            const st = lastState.current;
            if (st !== PLAYING && st !== BUFFERING) {
              command("mute");
              command("playVideo");
              setSealed(true);
            }
          }, 900);
        }
      }
    };

    window.addEventListener("message", onMessage);
    const el = iframeRef.current;
    el?.addEventListener("load", listen);
    const kick = window.setTimeout(listen, 500); // covers the already-loaded / mount-after-true case

    return () => {
      window.removeEventListener("message", onMessage);
      el?.removeEventListener("load", listen);
      window.clearTimeout(kick);
      if (probeTimer.current) window.clearTimeout(probeTimer.current);
    };
  }, [controllable, probe, command, ytOrigin]);

  const handleTap = useCallback(() => {
    armAudio(); // arms every subsequent video this session; re-probes the live one
    probe();
  }, [probe]);

  const embedUrl = getEmbedUrl(videoUrl, autoplay, bootMuted.current);

  return (
    <div style={{ width: "100%", height: "100%", background: "#000", position: "relative" }}>
      <iframe
        ref={iframeRef}
        width="100%"
        height="100%"
        src={embedUrl}
        title="Inter-round video"
        frameBorder={0}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        style={{ width: "100%", height: "100%", border: 0 }}
      />
      {/* Title-card cover — hides YouTube's title/branding for the first 7s. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background: "#000",
          pointerEvents: "none",
          transition: "opacity 1s",
          opacity: showTitleCover ? 1 : 0,
        }}
      />
      {/* AUDIO CHANNEL SEALED prompt — a full-surface catcher guarantees the tap is ours, not
          swallowed by the cross-origin iframe. Distance-readable; no infinite animation
          (display perf rule). Only shown when the browser blocked sound. */}
      {sealed && (
        <button
          type="button"
          onClick={handleTap}
          aria-label="Open audio channel"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            paddingBottom: "8%",
            background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0) 55%)",
            border: 0,
            cursor: "pointer",
            fontFamily: "'VT323','Share Tech Mono',monospace",
            color: "var(--terminal-green, #00ff41)",
            textShadow: "0 0 18px rgba(0,255,65,0.7)",
          }}
        >
          <div style={{ fontSize: "3.2vw", fontWeight: 700, letterSpacing: 4 }}>⚠ AUDIO CHANNEL SEALED</div>
          <div style={{ fontSize: "2vw", opacity: 0.9, letterSpacing: 3 }}>◊ TAP SCREEN TO OPEN COMMS</div>
        </button>
      )}
    </div>
  );
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function parseYouTubeUrl(url: string): string | null {
  if (!url) return null;
  if (url.includes("youtube.com/embed/")) return url;
  const watch = url.match(/youtube\.com\/watch\?v=([^&]+)/);
  if (watch) return `https://www.youtube.com/embed/${watch[1]}`;
  const short = url.match(/youtu\.be\/([^?]+)/);
  if (short) return `https://www.youtube.com/embed/${short[1]}`;
  return null;
}

function getEmbedUrl(url: string, autoplay: boolean, startMuted: boolean): string {
  const yt = parseYouTubeUrl(url);
  if (!yt) return url; // non-YouTube URL: passed through unchanged (not API-controllable)
  const sep = yt.includes("?") ? "&" : "?";
  // enablejsapi lets us drive mute/unMute over the IFrame API; playsinline keeps it inline
  // on mobile/kiosk webviews; `origin` is required for enablejsapi to accept commands.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const params = [
    `autoplay=${autoplay ? "1" : "0"}`,
    `mute=${startMuted ? "1" : "0"}`,
    "playsinline=1",
    "enablejsapi=1",
    origin ? `origin=${encodeURIComponent(origin)}` : "",
    "controls=0",
    "modestbranding=1",
    "rel=0",
    "loop=0",
    "disablekb=1",
    "fs=0",
    "iv_load_policy=3",
  ].filter(Boolean);
  return `${yt}${sep}${params.join("&")}`;
}

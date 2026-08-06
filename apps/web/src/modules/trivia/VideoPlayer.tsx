import { useCallback, useEffect, useRef, useState } from "react";
import {
  armAudio, installAudioAutoArm, isAudioUnlocked, isTrustedAutoplayEnv, markAudioUnlocked, subscribeArmed,
} from "@/shared/videoAudio";
import { evaluateProbe, PROBE_INTERVAL_MS, PROBE_WINDOW_MS } from "./audioVerdict";

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
 *     then WAIT PATIENTLY — sample the player state every 300ms for up to 8s. PLAYING or
 *     BUFFERING at any sample proves the browser allows sound → keep it unmuted, hide the
 *     prompt, mark audio unlocked (persisted, so later videos boot unmuted directly).
 *     `null`/UNSTARTED/CUED/PAUSED are "I don't know yet", NEVER a verdict. Only a fully
 *     elapsed 8s window with no evidence of playback justifies `mute` + `playVideo`
 *     (recovers muted playback with no visible hitch) and the in-world
 *     "AUDIO CHANNEL SEALED — TAP TO OPEN COMMS" prompt. All of that decision logic is the
 *     pure, unit-tested `audioVerdict.ts` (`pnpm test:audioverdict`).
 *     ⚠ REGRESSION HISTORY: this used to be a single fixed 700ms read. `lastState` is fed
 *     asynchronously by `infoDelivery`, so a slow start on a busy bar network read as
 *     "blocked" and muted a perfectly good video — the 2026-08-05 trivia-night bug.
 *   • Inside the BUNKER MEDIA SHELL (Electron, `autoplay-policy=no-user-gesture-required`)
 *     there is nothing to probe: boot unmuted, never seal. Detected web-side via the UA.
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
 * show_video already true and autoplays again. Shared verbatim by the signage landscape
 * slot and /game/preview (GameDisplayBoard reuse).
 */

const ENDED = 0;

export function VideoPlayer({ videoUrl, autoplay = true, onEnded }: { videoUrl: string; autoplay?: boolean; onEnded?: () => void }) {
  const [showTitleCover, setShowTitleCover] = useState(true);
  const [sealed, setSealed] = useState(false); // audio prompt visible (muted, browser blocked sound)
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastState = useRef<number | null>(null);
  const probeTimer = useRef<number | null>(null); // bounded poll interval id
  const gotInfo = useRef(false); // first infoDelivery arrived → the `listening` handshake took
  // onEnded via a ref so the message-handler effect doesn't re-subscribe each render; fired
  // ONCE when the YouTube player reaches ENDED (state 0). Reset per videoUrl.
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const endedFired = useRef(false);
  useEffect(() => {
    endedFired.current = false;
    lastState.current = null; // a new clip's state is unknown again — never inherit the old one
    gotInfo.current = false;
  }, [videoUrl]);

  const yt = parseYouTubeUrl(videoUrl);
  const controllable = autoplay && !!yt;
  // The Electron media shell allows unmuted autoplay outright — nothing to probe, never seal.
  const trusted = useRef<boolean>(isTrustedAutoplayEnv());
  // Boot unmuted if the shell is trusted or a probe already proved sound works; else muted.
  const bootMuted = useRef<boolean>(!(isAudioUnlocked() || trusted.current));

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

  const stopProbe = useCallback(() => {
    if (probeTimer.current) window.clearInterval(probeTimer.current);
    probeTimer.current = null;
  }, []);

  /**
   * Bounded, self-terminating audio poll (finite — display perf rule). `sendUnmute` is the
   * difference between the two callers:
   *   • true  — the muted-boot probe: ask for sound, then wait for proof.
   *   • false — the unmuted-boot verification: it booted with sound already; this only exists
   *             to recover a genuinely STALLED player, so it never sends `unMute`.
   * Both share one rule: mute ONLY on positive absence of playback across the whole window.
   */
  const startProbe = useCallback((sendUnmute: boolean) => {
    if (!controllable) return;
    stopProbe();
    if (sendUnmute) {
      command("unMute");
      command("setVolume", [100]);
    }
    command("playVideo");
    // Trusted shell: unmuted autoplay is permitted process-wide. Do not poll, do not seal.
    // DECISION: deliberately a hard short-circuit rather than a "poll but never prompt" safety
    // net. On the bar TV the worst failure of a safety net is the exact bug this fix exists to
    // kill — a lost `listening` handshake would make the poll conclude "blocked" and mute a
    // video that is playing perfectly. The cost is that an Electron-based *browser* that does
    // NOT set the autoplay switch would boot unmuted and may not start; that is a staff-preview
    // inconvenience, never the room's audio.
    if (trusted.current) {
      markAudioUnlocked();
      setSealed(false);
      return;
    }
    const startedAt = Date.now();
    probeTimer.current = window.setInterval(() => {
      const verdict = evaluateProbe({
        state: lastState.current,
        elapsedMs: Date.now() - startedAt,
        windowMs: PROBE_WINDOW_MS,
      });
      if (verdict === "unknown") return; // still no answer — keep waiting, touch nothing
      stopProbe();
      if (verdict === "unlocked") {
        markAudioUnlocked();
        setSealed(false);
      } else if (verdict === "blocked") {
        // The window fully elapsed with no evidence the video ever played. Only now.
        command("mute");
        command("playVideo");
        setSealed(true);
      }
      // "abandon" (the clip ended under us) → stop quietly; sealing an ended video is noise.
    }, PROBE_INTERVAL_MS);
  }, [controllable, command, stopProbe]);

  /** Ask for sound and wait for proof (the muted-boot path, and every gesture re-probe). */
  const probe = useCallback(() => startProbe(true), [startProbe]);

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
        gotInfo.current = true; // the handshake took — stop re-kicking it
        lastState.current = msg.info.playerState;
        // Natural end → fire onEnded once (the landscape auto-returns to UP NEXT).
        if (msg.info.playerState === ENDED && !endedFired.current) {
          endedFired.current = true;
          onEndedRef.current?.();
        }
      } else if (msg.event === "onReady") {
        // Muted boot → ask for sound. Unmuted boot → it already has sound; the poll exists only
        // to recover a genuinely stalled player, and it waits just as patiently before muting.
        startProbe(bootMuted.current);
      }
    };

    window.addEventListener("message", onMessage);
    const el = iframeRef.current;
    el?.addEventListener("load", listen);
    // The `listening` handshake is what makes YouTube stream infoDelivery at all; without it
    // lastState stays null FOREVER and the probe can only ever time out. One `load` listener
    // plus a single 500ms kick both raced the iframe on slow mounts, so retry on a bounded
    // schedule until the first infoDelivery answers (then stop). Finite: 20 × 500ms = 10s.
    let kicks = 0;
    listen();
    const kick = window.setInterval(() => {
      if (gotInfo.current || ++kicks >= 20) {
        window.clearInterval(kick);
        return;
      }
      listen();
    }, 500);

    return () => {
      window.removeEventListener("message", onMessage);
      el?.removeEventListener("load", listen);
      window.clearInterval(kick);
      stopProbe();
    };
  }, [controllable, startProbe, stopProbe, ytOrigin]);

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

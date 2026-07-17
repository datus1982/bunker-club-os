import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  installAudioAutoArm, isAudioUnlocked, markAudioUnlocked, subscribeArmed,
} from "@/shared/videoAudio";
import type { Slot } from "./useSignage";
import { SUPPORT_TEXT } from "./supportText";

/**
 * CAPTURE program renderer (docs/15 M2) — the live UVC input (the Roku) on a landscape slot.
 *
 * Rendered from SlotDisplay ONLY while mode === 'rotation' && slot.program.kind === 'capture'.
 * A takeover / MOMENT / live game flips `mode` off 'rotation', so this component unmounts the
 * instant any of them preempt — and unmount STOPS the MediaStream tracks (camera light off, the
 * capture device released for the next program), same discipline as PlaylistProgram's <video>.
 *
 * Device selection (docs/15): enumerate videoinput devices and pick the first whose label
 * contains `device_match` (case-insensitive); blank/absent = the first camera. No match, a denied
 * permission, or a track that ends → a skinned NO SIGNAL — CHANNEL 1 card (never a black frame,
 * never a browser permission prompt loop). Finite 8s re-probe recovers when the source returns.
 *
 * Presentation: fullbleed is the capture DEFAULT (the feed owns the canvas, no chrome); a
 * program-level `presentation:'framed'` override letterboxes it (object-fit: contain) inside the
 * slot's chrome header + ticker footer, exactly like a framed playlist.
 *
 * Capture IGNORES transport commands (pause/resume/next ride the broadcast channel but only the
 * playlist reacts) — a live passthrough has nothing to pause.
 *
 * Perf: the only continuously-moving element is the <video> (display rule); the re-probe is a
 * FINITE one-shot timeout re-armed each NO-SIGNAL cycle, never an interval left running healthy.
 */
export function CaptureProgram({
  slot, deviceMatch, presentation, header, footer,
}: {
  slot: Slot;
  deviceMatch: string | undefined;
  presentation: "framed" | "fullbleed" | undefined;
  /** Chrome nodes rendered around the feed in `framed` mode (hidden in fullbleed). */
  header: ReactNode;
  footer: ReactNode;
}) {
  // Capture defaults FULLBLEED (ratified); only an explicit 'framed' override keeps the chrome.
  const fullbleed = presentation !== "framed";

  const feed = (
    <CaptureVideo deviceMatch={deviceMatch} fullbleed={fullbleed} orientation={slot.orientation} />
  );

  if (fullbleed) {
    return <div style={{ position: "absolute", inset: 0, background: "#000" }}>{feed}</div>;
  }
  return (
    <>
      {header}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#000" }}>
        {feed}
      </div>
      {footer}
    </>
  );
}

const PROBE_INTERVAL_MS = 8000; // finite re-probe cadence while NO SIGNAL

/**
 * The live <video> bound to a capture MediaStream. Acquires once on mount (and on each device_match
 * change / re-probe), renders the stream, and shows NO SIGNAL whenever acquisition fails or the
 * track ends. Tracks are stopped on every re-acquire and on unmount.
 */
function CaptureVideo({
  deviceMatch, fullbleed, orientation,
}: {
  deviceMatch: string | undefined;
  fullbleed: boolean;
  orientation: "portrait" | "landscape";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"acquiring" | "live" | "nosignal">("acquiring");
  const [probe, setProbe] = useState(0);

  // Stop and drop whatever stream we currently hold (release the capture device + camera light).
  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
      streamRef.current = null;
    }
  }, []);

  // Audio passthrough: boot muted unless a probe already proved sound this session, then unmute
  // once the feed is live (same muted-boot pattern as PlaylistVideo — a MediaStream lets us
  // toggle .muted directly). Always-on at the PC; staff gate the room at QSYS.
  const armAudio = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isAudioUnlocked()) { v.muted = false; return; }
    v.muted = false;
    v.play().then(() => {
      if (!v.paused) markAudioUnlocked();
      else { v.muted = true; v.play().catch(() => {}); }
    }).catch(() => {
      v.muted = true;
      v.play().catch(() => {});
    });
  }, []);

  useEffect(() => {
    installAudioAutoArm();
    return subscribeArmed(() => armAudio());
  }, [armAudio]);

  // Acquire the capture stream. Runs on mount, whenever device_match changes, and on each re-probe.
  useEffect(() => {
    let cancelled = false;
    setPhase("acquiring");

    async function acquire() {
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) { if (!cancelled) setPhase("nosignal"); return; }
      try {
        // A permissive first grab both unlocks labels (blank until permission) and, when no
        // device_match is given, IS the feed. On the kiosk shell permission is pre-granted so
        // this resolves instantly; in a plain browser it prompts once.
        let stream = await md.getUserMedia({ video: true, audio: true });
        const cams = (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (cams.length === 0) throw new Error("no videoinput");

        const wanted = deviceMatch?.trim().toLowerCase();
        const target = wanted
          ? cams.find((c) => c.label.toLowerCase().includes(wanted))
          : cams[0];
        // device_match given but nothing matched → NO SIGNAL (don't fall back to a wrong camera).
        if (!target) throw new Error("no device matches");

        // Re-acquire the exact device unless the generic grab already landed on it.
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (target.deviceId && target.deviceId !== activeId) {
          for (const t of stream.getTracks()) t.stop();
          stream = await md.getUserMedia({
            video: { deviceId: { exact: target.deviceId } },
            audio: true,
          });
        }

        if (cancelled) { for (const t of stream.getTracks()) t.stop(); return; }

        stopStream();
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = !isAudioUnlocked();
          v.play().catch(() => {});
        }
        // A source that ends (Roku powered off, cable pulled) → NO SIGNAL + re-probe.
        for (const t of stream.getVideoTracks()) {
          t.addEventListener("ended", () => { if (!cancelled) setPhase("nosignal"); });
        }
        setPhase("live");
        if (!isAudioUnlocked()) armAudio();
      } catch {
        if (!cancelled) setPhase("nosignal");
      }
    }
    acquire();

    return () => { cancelled = true; };
    // `probe` is a dependency so a re-probe re-runs acquisition with a fresh attempt.
  }, [deviceMatch, probe, stopStream, armAudio]);

  // Release the device when the program tier unmounts (takeover/moment/game preempt).
  useEffect(() => () => stopStream(), [stopStream]);

  // NO SIGNAL → finite 8s one-shot re-probe (re-armed each cycle), so the feed self-heals when
  // the capture source returns. Never an interval left running while healthy.
  useEffect(() => {
    if (phase !== "nosignal") return;
    const id = window.setTimeout(() => setProbe((p) => p + 1), PROBE_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  const onPlaying = useCallback(() => {
    if (!isAudioUnlocked()) armAudio();
  }, [armAudio]);

  const objectFit = fullbleed ? "cover" : "contain";

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {phase !== "nosignal" && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={!isAudioUnlocked()}
          onPlaying={onPlaying}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit, background: "#000" }}
        />
      )}
      {phase === "nosignal" && (
        <NoSignalCard support={SUPPORT_TEXT[orientation]} bigText={orientation === "portrait" ? 88 : 76} />
      )}
    </div>
  );
}

/** In-world skinned NO SIGNAL card — matches PlaylistProgram's FEED INTERRUPTED / OFFLINE cards. */
function NoSignalCard({ support, bigText }: { support: number; bigText: number }) {
  return (
    <div className="sig-enter" style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 22 }}>
      <div className="u-amber" style={{ position: "relative", fontSize: bigText, fontWeight: 700, letterSpacing: 3, lineHeight: 0.98, textShadow: "0 0 16px var(--terminal-glow)" }}>NO SIGNAL</div>
      <div style={{ position: "relative", fontSize: support, letterSpacing: 4, opacity: 0.6 }}>◊ CHANNEL 1 — CHECK THE CAPTURE SOURCE</div>
    </div>
  );
}

/**
 * Session audio state for display-surface video (docs/04 trivia A/V rounds).
 *
 * Browser reality (verified against real Chrome under both autoplay policies): a video
 * ALWAYS autoplays MUTED; UNMUTED playback of a cross-origin YouTube embed only happens
 * when the browser's autoplay policy is permissive (a kiosk launch flag or a site sound
 * permission). A tap on the parent page does NOT propagate activation into the
 * cross-origin YouTube frame, so we cannot force sound from JS alone. The player is
 * therefore booted muted and "probed" to unmute — it upgrades to sound automatically
 * wherever the browser permits, and stays muted (with an on-screen prompt) where it does
 * not. See the README "VIDEO SOUND ON TVs" note for the reliable hands-off audio path.
 *
 * This module holds two process-wide signals shared across every video surface:
 *   • armed    — a real user gesture happened on the page (transient trigger to re-probe
 *                the live video, in case a headful browser propagates the activation).
 *   • unlocked — a probe has PROVEN this session that unmuted autoplay actually plays, so
 *                subsequent videos may boot unmuted directly (no muted-first probe).
 */

let armed = false;
let unlocked = false;
let installed = false;
const armSubs = new Set<() => void>();

/** A real user gesture has occurred this session. */
export function isAudioArmed(): boolean {
  return armed;
}

/** Mark a user gesture and notify subscribers so a live muted video can re-attempt sound. */
export function armAudio(): void {
  armed = true;
  for (const cb of armSubs) {
    try {
      cb();
    } catch {
      /* a bad subscriber must not break arming for the rest */
    }
  }
}

/** Subscribe to arm events (fires on every gesture). Returns an unsubscribe fn. */
export function subscribeArmed(cb: () => void): () => void {
  armSubs.add(cb);
  return () => {
    armSubs.delete(cb);
  };
}

/** True once a probe has confirmed unmuted autoplay works in this browser session. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}

/** Record that unmuted autoplay was proven to play — future videos may boot unmuted. */
export function markAudioUnlocked(): void {
  unlocked = true;
}

/**
 * Install the one-time global first-gesture listener that arms the session. Capture-phase
 * + `once` so it costs nothing after firing. Safe to call from every surface (installs once).
 */
export function installAudioAutoArm(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onGesture = () => armAudio();
  const opts: AddEventListenerOptions = { capture: true, once: true, passive: true };
  window.addEventListener("pointerdown", onGesture, opts);
  window.addEventListener("touchstart", onGesture, opts);
  window.addEventListener("keydown", onGesture, opts);
}

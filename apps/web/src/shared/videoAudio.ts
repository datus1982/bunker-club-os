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
 *   • unlocked — a probe has PROVEN that unmuted autoplay actually plays, so subsequent
 *                videos may boot unmuted directly (no muted-first probe). PERSISTED to
 *                localStorage: the autoplay policy is a stable per-profile fact on a kiosk,
 *                but the flag used to be memory-only, so the nightly 04:00 reload and every
 *                shell relaunch threw the answer away and re-ran the guessing game.
 */

const UNLOCKED_KEY = "bunker.audio.unlocked";

let armed = false;
let installed = false;

/** Read the persisted unlock flag. localStorage can throw (kiosk/private modes) — degrade to false. */
function readUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(UNLOCKED_KEY) === "1";
  } catch {
    return false; // storage unavailable → behave exactly like the old in-memory default
  }
}

let unlocked = readUnlocked();
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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UNLOCKED_KEY, "1");
  } catch {
    /* storage unavailable → in-memory only, exactly the old behaviour. Never throw here:
       this runs inside a probe callback on a live bar TV. */
  }
}

/**
 * True when the page runs in an environment whose autoplay policy is known-permissive, so a
 * "did it play?" probe can never be a real question — the BUNKER MEDIA SHELL (Electron),
 * which sets `autoplay-policy=no-user-gesture-required` before window creation
 * (apps/media-shell/src/main.js). Detected WEB-SIDE ONLY from the user agent: Electron's
 * default UA carries `Electron/<version>` and the shell sets no UA override and injects no
 * preload (verified in apps/media-shell/src/kioskWindow.js — the only injected script is the
 * cursor-hide CSS helper). Deliberately web-side: the v0.2.0 shell is installed in the field
 * and must not need a reinstall for this fix.
 */
export function isTrustedAutoplayEnv(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bElectron\/\d/.test(navigator.userAgent || "");
}

/**
 * Install the global gesture listeners that arm the session. Capture-phase + passive, and
 * deliberately NOT `once`: they used to self-remove after the first stray click of a page
 * load, so a later, deliberate tap on a sealed video could no longer re-arm anything. Safe to
 * call from every surface (installs exactly once per page).
 */
export function installAudioAutoArm(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onGesture = () => armAudio();
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", onGesture, opts);
  window.addEventListener("touchstart", onGesture, opts);
  window.addEventListener("keydown", onGesture, opts);
}

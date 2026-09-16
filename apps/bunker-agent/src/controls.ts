/**
 * THE CONTROL CONTRACT — the read-back set the agent mirrors into audio_live.
 *
 * Every component + control name below is copied EXACTLY from the pinned inventory
 *   ~/Marvin/projects/bunker/qsys/qrc-inventory-2026-09-16-final.json
 *   (design BunkerClub_v03.20260329, code vyysM4BoQKaY, captured 2026-09-16 — card §1)
 * and the test fixture test/fixtures/inventory-slice.json is a cut of that same file, so a
 * rename in Designer breaks the tests AND fails loudly at boot (index.ts verifies every
 * component exists; mirror.ts records a missing control per name in snapshot.errors[]).
 *
 * Re-run the 5-second inventory (qrc-inventory.ps1, read-only) before every PR that touches
 * this file — the names here are the contract with the room.
 *
 * READ-ONLY. Nothing in this file (or this agent) names a method that changes a control.
 */

export interface ControlRef {
  /** exact Q-SYS component name */
  component: string;
  /** exact control name within that component */
  control: string;
}

/** One contract entry per component: the controls we subscribe to. */
export interface ComponentContract {
  component: string;
  controls: readonly string[];
}

const range = (prefix: string, from: number, to: number, suffix = ""): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}${suffix}`);

/** Sonos favorites 1..31 are the approved station list (FavName 32 exists but is empty — not contract). */
export const SONOS_FAVORITE_COUNT = 31;

export const CONTRACT: readonly ComponentContract[] = [
  // ── Source per zone: 1 = Sonos · 2 = Booth (DJ, Dante) · 3 = HDMI (video) ────────
  { component: "Inside Router_8x8", controls: ["select.1"] },
  { component: "Patio Router_8x8", controls: ["select.1"] },
  { component: "Listen Tech Router_8x8", controls: ["select.1"] },

  // ── Inside level + the two mics (host / karaoke) + the two other SOURCE gains (PR C) ──
  // DECISION (PR C): the brief said the four source gains were "already in" the contract — only
  // input.1/2.gain were. input.5.gain ("Selected_Source": whatever select.1 routes — Sonos /
  // Booth / HDMI) and input.8.gain ("Verb" return) are ADDED here so the nudge bar can show a
  // live level and a recall can reset a nudge. Both are on an ALREADY-contracted component and
  // verified by exact name in the pinned inventory (Inside Mixer, 178 controls). No new component.
  { component: "Inside Mixer", controls: ["output.1.gain", "output.1.mute", "input.1.mute", "input.2.mute", "input.1.gain", "input.2.gain", "input.5.gain", "input.8.gain"] },

  // ── Inside trims: the 1x3 — surface mounts / subwoofer / ceiling ────────────────
  { component: "Mixer_8x8", controls: ["output.1.gain", "output.2.gain", "output.3.gain"] },

  // ── Patio + assistive listening ───────────────────────────────────────────────────
  { component: "Patio Mixer", controls: ["output.1.gain", "output.1.mute"] },
  { component: "Listen Tech Mixer", controls: ["output.1.gain", "output.1.mute"] },

  // ── Music (Sonos plugin) — transport + track + the 31 favorite names ─────────────
  {
    component: "SonosSonosControl",
    controls: ["TransportState", "TrackName", "TrackArtist", "AlbumArtURL", "Status", ...range("FavName ", 1, SONOS_FAVORITE_COUNT)],
  },

  // ── Video: what each HDMI out is showing + whether each source has signal ────────
  { component: "HDMI_I/O_Bunker-Core", controls: ["hdmi.out.1.select.active.source.name", "hdmi.out.2.select.active.source.name"] },
  { component: "Bunker Feed", controls: ["channel.1.input.signal", "5v"] },
  { component: "Roku", controls: ["channel.1.input.signal", "5v"] },
  { component: "Booth HDMI", controls: ["channel.1.input.signal", "5v"] },
  { component: "HDMI 3", controls: ["channel.1.input.signal", "5v"] },

  // ── Effects (read-only display in v1) ─────────────────────────────────────────────
  { component: "Lush_Reverb_Effect", controls: ["bypass"] },
  { component: "Priority_Ducker", controls: ["bypass"] },

  // ── Meters: inputs (1/2 mics, 9/10 Sonos, Booth, HDMI, Verb) + zones (Inside/Ceiling/Sub/Patio)
  { component: "True_Peak/RMS_Meter_(dBFS)", controls: range("meter.", 1, 13) },
  { component: "True_Peak/RMS_Meter_(dBFS)_1", controls: range("meter.", 1, 4) },

  // ── Amp — STATUS ONLY, forever read-only (owner limit: no amp output control from the app)
  // DECISION: the card names `channel.N.clip`; the inventory has no such control — the amp's
  // clip indicator is `channel.N.input.clip.led` (Boolean). Using the exact inventory name.
  {
    component: "Amp_Output_bunker-amp-1_CX-Q_2K4",
    controls: ["status", ...range("channel.", 1, 4, ".temperature"), ...range("channel.", 1, 4, ".input.clip.led")],
  },
];

/** Every component name in the contract (what index.ts verifies against Component.GetComponents). */
export const CONTRACT_COMPONENTS: readonly string[] = CONTRACT.map((c) => c.component);

/** Flat list of every (component, control) pair. */
export const CONTRACT_REFS: readonly ControlRef[] = CONTRACT.flatMap((c) => c.controls.map((control) => ({ component: c.component, control })));

/** Router select.1 values → source names (card §1). */
export const ROUTER_SOURCE_NAMES: Readonly<Record<number, string>> = { 1: "Sonos", 2: "Booth", 3: "HDMI" };

// ── SCENE LEVERS — what a CAPTURE stores as a scene payload (card §1 "Lever" rows) ──────────
// The WRITABLE levers only: sources, levels, trims, mics, reverb. Read-backs (meters, amp,
// Sonos track info, HDMI signal flags) and the Priority Ducker ("not a scene lever in v1") are
// deliberately NOT part of a scene. Captured via Component.Get — read-only, like everything else
// in PR A; PR B's recall is what will eventually write these back with a Ramp.
// DECISION: `WetLevel` is captured (card §1 names it beside `bypass`) although the live mirror
// contract above does not subscribe to it — a scene needs the number, the dashboard does not.
export const SCENE_LEVERS: readonly ComponentContract[] = [
  { component: "Inside Router_8x8", controls: ["select.1"] },
  { component: "Patio Router_8x8", controls: ["select.1"] },
  { component: "Listen Tech Router_8x8", controls: ["select.1"] },
  // PR C: input.5.gain + input.8.gain join the levers (see the DECISION on the mirror contract
  // above) — a scene captures the source levels too, so a recall resets any nudge (ruling 3).
  { component: "Inside Mixer", controls: ["output.1.gain", "output.1.mute", "input.1.mute", "input.2.mute", "input.1.gain", "input.2.gain", "input.5.gain", "input.8.gain"] },
  { component: "Mixer_8x8", controls: ["output.1.gain", "output.2.gain", "output.3.gain"] },
  { component: "Patio Mixer", controls: ["output.1.gain", "output.1.mute"] },
  { component: "Listen Tech Mixer", controls: ["output.1.gain", "output.1.mute"] },
  { component: "Lush_Reverb_Effect", controls: ["bypass", "WetLevel"] },
];

/** Sonos controls a capture reads to resolve "which favorite is playing" (all read-only Text). */
export const SONOS_CAPTURE_CONTROLS: readonly string[] = [
  "TransportState",
  "TrackName",
  "TrackArtist",
  "TrackAlbum",
  "TrackSource",
  "CurrentSource",
  "AlbumArtURL",
  ...range("FavName ", 1, SONOS_FAVORITE_COUNT),
];

/** The two HDMI outputs' active source names (what each TV feed is showing right now). */
export const HDMI_CAPTURE_CONTROLS: readonly string[] = ["hdmi.out.1.select.active.source.name", "hdmi.out.2.select.active.source.name"];

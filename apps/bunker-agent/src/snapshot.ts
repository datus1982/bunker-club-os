/**
 * Snapshot — the shape the agent mirrors into audio_live.snapshot (docs/16 §Snapshot).
 *
 *   {
 *     venue_id, agent_id, agent_version, at,           // identity + freshness
 *     connected, core: { host, design_name, design_code, platform, state, status },
 *     errors: [ { kind, component?, control?, message } ],   // loud, never silent
 *     controls: { "<Component>": { "<control>": { v, s, p, at } } },   // raw read-backs
 *     derived: { zones, inside_trims, mics, sonos, video, effects, meters, amp }  // UI-ready
 *   }
 *
 * `controls` is the source of truth (exact Q-SYS names/values); `derived` is a pure projection
 * of it so the hub chip, /audio page and the iPad never re-implement the mapping. Pure module —
 * no I/O — so the fake-core tests can assert the shape byte-for-byte.
 */
import { CONTRACT, ROUTER_SOURCE_NAMES, SONOS_FAVORITE_COUNT } from "./controls.js";

export const AGENT_VERSION = "0.1.0";

export interface ControlState {
  /** Value as Q-SYS reports it (number | boolean | string | null) */
  v: unknown;
  /** String as Q-SYS formats it ("-44.5dB", "muted", …) */
  s: string | null;
  /** Position 0..1 when the control has one */
  p: number | null;
  /** epoch ms of the last update we saw */
  at: number;
}

export type ControlsMap = Record<string, Record<string, ControlState>>;

export type SnapshotErrorKind = "design_mismatch" | "missing_component" | "missing_control" | "disconnected" | "core_error";

export interface SnapshotError {
  kind: SnapshotErrorKind;
  component?: string;
  control?: string;
  message: string;
}

export interface CoreInfo {
  host: string;
  design_name: string | null;
  design_code: string | null;
  platform: string | null;
  state: string | null;
  status: string | null;
}

export interface ZoneDerived {
  source: number | null;
  source_name: string | null;
  gain_db: number | null;
  mute: boolean | null;
}

export interface Derived {
  zones: { inside: ZoneDerived; patio: ZoneDerived; listen: ZoneDerived };
  inside_trims: { surface_db: number | null; sub_db: number | null; ceiling_db: number | null };
  mics: Record<"1" | "2", { mute: boolean | null; gain_db: number | null }>;
  sonos: {
    transport: string | null;
    track: string | null;
    artist: string | null;
    album_art_url: string | null;
    status: string | null;
    favorites: Array<{ n: number; name: string }>;
  };
  video: {
    outputs: Record<"1" | "2", { active_source: string | null }>;
    sources: Record<string, { signal: boolean | null; plugged: boolean | null }>;
  };
  effects: { reverb_bypass: boolean | null; ducker_bypass: boolean | null };
  meters: { inputs_db: Array<number | null>; zones_db: Array<number | null> };
  amp: { status: string | null; temperatures_c: Array<number | null>; clip: Array<boolean | null> };
}

export interface Snapshot {
  venue_id: string;
  agent_id: string;
  agent_version: string;
  at: string;
  connected: boolean;
  core: CoreInfo;
  errors: SnapshotError[];
  controls: ControlsMap;
  derived: Derived;
}

// ── state store ─────────────────────────────────────────────────────────────────
export class ControlStore {
  private map: ControlsMap = {};
  private _dirty = false;

  constructor() {
    for (const c of CONTRACT) this.map[c.component] = {};
  }

  get dirty(): boolean {
    return this._dirty;
  }

  clearDirty(): void {
    this._dirty = false;
  }

  /** Apply one read-back (initial Component.Get or a ChangeGroup change). Returns true if changed. */
  set(component: string, control: string, v: unknown, s: string | null | undefined, p: number | null | undefined, at = Date.now()): boolean {
    const comp = this.map[component] ?? (this.map[component] = {});
    const prev = comp[control];
    const next: ControlState = { v: v ?? null, s: s ?? null, p: typeof p === "number" ? p : null, at };
    if (prev && prev.v === next.v && prev.s === next.s && prev.p === next.p) return false;
    comp[control] = next;
    this._dirty = true;
    return true;
  }

  get(component: string, control: string): ControlState | undefined {
    return this.map[component]?.[control];
  }

  /** Deep copy for the snapshot (the store keeps mutating under the poller). */
  snapshotControls(): ControlsMap {
    const out: ControlsMap = {};
    for (const [c, ctrls] of Object.entries(this.map)) {
      out[c] = {};
      for (const [k, st] of Object.entries(ctrls)) out[c][k] = { ...st };
    }
    return out;
  }
}

// ── derivation (pure) ───────────────────────────────────────────────────────────
const num = (st?: ControlState): number | null => (st && typeof st.v === "number" && Number.isFinite(st.v) ? st.v : null);
const bool = (st?: ControlState): boolean | null => (st && typeof st.v === "boolean" ? st.v : null);
const str = (st?: ControlState): string | null => (st && typeof st.s === "string" ? st.s : st && typeof st.v === "string" ? st.v : null);

export function derive(c: ControlsMap): Derived {
  const g = (component: string, control: string): ControlState | undefined => c[component]?.[control];

  const zone = (router: string, mixer: string): ZoneDerived => {
    const sel = num(g(router, "select.1"));
    return {
      source: sel,
      source_name: sel === null ? null : (ROUTER_SOURCE_NAMES[sel] ?? `input ${sel}`),
      gain_db: num(g(mixer, "output.1.gain")),
      mute: bool(g(mixer, "output.1.mute")),
    };
  };

  const favorites: Array<{ n: number; name: string }> = [];
  for (let n = 1; n <= SONOS_FAVORITE_COUNT; n++) {
    const name = str(g("SonosSonosControl", `FavName ${n}`));
    if (name && name.trim() !== "") favorites.push({ n, name });
  }

  const sources: Derived["video"]["sources"] = {};
  for (const name of ["Bunker Feed", "Roku", "Booth HDMI", "HDMI 3"]) {
    sources[name] = { signal: bool(g(name, "channel.1.input.signal")), plugged: bool(g(name, "5v")) };
  }

  const AMP = "Amp_Output_bunker-amp-1_CX-Q_2K4";
  return {
    zones: {
      inside: zone("Inside Router_8x8", "Inside Mixer"),
      patio: zone("Patio Router_8x8", "Patio Mixer"),
      listen: zone("Listen Tech Router_8x8", "Listen Tech Mixer"),
    },
    inside_trims: {
      surface_db: num(g("Mixer_8x8", "output.1.gain")),
      sub_db: num(g("Mixer_8x8", "output.2.gain")),
      ceiling_db: num(g("Mixer_8x8", "output.3.gain")),
    },
    mics: {
      "1": { mute: bool(g("Inside Mixer", "input.1.mute")), gain_db: num(g("Inside Mixer", "input.1.gain")) },
      "2": { mute: bool(g("Inside Mixer", "input.2.mute")), gain_db: num(g("Inside Mixer", "input.2.gain")) },
    },
    sonos: {
      transport: str(g("SonosSonosControl", "TransportState")),
      track: str(g("SonosSonosControl", "TrackName")),
      artist: str(g("SonosSonosControl", "TrackArtist")),
      album_art_url: str(g("SonosSonosControl", "AlbumArtURL")),
      status: str(g("SonosSonosControl", "Status")),
      favorites,
    },
    video: {
      outputs: {
        "1": { active_source: str(g("HDMI_I/O_Bunker-Core", "hdmi.out.1.select.active.source.name")) },
        "2": { active_source: str(g("HDMI_I/O_Bunker-Core", "hdmi.out.2.select.active.source.name")) },
      },
      sources,
    },
    effects: {
      reverb_bypass: bool(g("Lush_Reverb_Effect", "bypass")),
      ducker_bypass: bool(g("Priority_Ducker", "bypass")),
    },
    meters: {
      inputs_db: Array.from({ length: 13 }, (_, i) => num(g("True_Peak/RMS_Meter_(dBFS)", `meter.${i + 1}`))),
      zones_db: Array.from({ length: 4 }, (_, i) => num(g("True_Peak/RMS_Meter_(dBFS)_1", `meter.${i + 1}`))),
    },
    amp: {
      status: str(g(AMP, "status")),
      temperatures_c: Array.from({ length: 4 }, (_, i) => num(g(AMP, `channel.${i + 1}.temperature`))),
      clip: Array.from({ length: 4 }, (_, i) => bool(g(AMP, `channel.${i + 1}.input.clip.led`))),
    },
  };
}

export interface BuildSnapshotInput {
  venueId: string;
  agentId: string;
  connected: boolean;
  core: CoreInfo;
  errors: SnapshotError[];
  controls: ControlsMap;
  now?: Date;
}

export function buildSnapshot(input: BuildSnapshotInput): Snapshot {
  return {
    venue_id: input.venueId,
    agent_id: input.agentId,
    agent_version: AGENT_VERSION,
    at: (input.now ?? new Date()).toISOString(),
    connected: input.connected,
    core: input.core,
    errors: input.errors.map((e) => ({ ...e })),
    controls: input.controls,
    derived: derive(input.controls),
  };
}

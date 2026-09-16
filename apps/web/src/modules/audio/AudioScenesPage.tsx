import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useUiVersion } from "@/shared/useUiVersion";
import { ConfirmDialog, FormField, InlineNotice, StaffPageHeader, StatusChip, ToggleSwitch } from "@/shared/ui";
import {
  deriveAgentHealth, fmtAge, summarizePayload, useArmWrites, useAudioLive, useAudioRealtime, useAudioScenes,
  useAudioState, useNowTick, useRecentCommands, useSendCommand, useUpdatePreset, useUpdateScene, useWritesArmed,
  useZonePresets, type AudioScene, type Level, type Zone,
} from "./useAudio";
import { MONO } from "@/modules/signage/signageAdminShared";

/**
 * BAR OPS ▸ AUDIO ▸ SCENE EDITOR (docs/16, PR B) — admin only (App.tsx wraps it in RequireRole).
 *
 * The owner authors here and NEVER types a level from memory: scenes are filled by CAPTURE FROM
 * ROOM (a `capture_scene` command the agent answers by reading the live Core into the payload),
 * zone presets by SET FROM CURRENT (the live gain from audio_live). A numeric field exists for
 * a deliberate nudge after a capture, never as a first value. ARM WRITES is the platform half
 * of the agent's double gate (0068 header) and auto-expires at the venue's 04:00 rollover.
 */

const btn: CSSProperties = { minHeight: 44, minWidth: 44, padding: "0 14px", fontFamily: MONO, cursor: "pointer" };
const card: CSSProperties = { padding: 14, display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 };
const input: CSSProperties = { minHeight: 44, padding: "0 10px", fontSize: 15, fontFamily: MONO, width: "100%", boxSizing: "border-box" };
const LEVELS: Level[] = ["low", "med", "high"];
const ZONES: Zone[] = ["inside", "patio"];

export function AudioScenesPage() {
  const [version] = useUiVersion();
  if (version !== "v2") {
    return (
      <div className="terminal-theme staff-ui" style={{ padding: "24px clamp(16px,4vw,40px)", fontFamily: MONO }}>
        <div className="u-head" style={{ fontSize: 26, marginBottom: 10 }}>AUDIO SCENES</div>
        <div style={{ fontSize: 18, marginBottom: 14 }}>The scene editor lives in the new layout — use TRY THE NEW LAYOUT → in the menu to open it.</div>
        <Link to="/dashboard" style={{ fontSize: 18 }}>← HOME</Link>
      </div>
    );
  }
  return <ScenesV2 />;
}

function ScenesV2() {
  useAudioRealtime();
  const scenesQ = useAudioScenes();
  const presetsQ = useZonePresets();
  const stateQ = useAudioState();
  const liveQ = useAudioLive();
  const cmdsQ = useRecentCommands();
  const now = useNowTick(5_000);
  const state = stateQ.data ?? null;
  const health = deriveAgentHealth(liveQ.data, now);
  const d = health.snap?.derived;
  const { armed: writesArmed } = useWritesArmed(state, now);
  const armedBy = writesArmed ? state?.writes_armed_by ?? null : null;
  const send = useSendCommand(armedBy);
  const updateScene = useUpdateScene();
  const updatePreset = useUpdatePreset();
  const armWrites = useArmWrites();
  const [confirmArm, setConfirmArm] = useState(false);

  const scenes = scenesQ.data ?? [];
  const presets = presetsQ.data ?? [];
  const presetFor = (zone: Zone, level: Level) => presets.find((p) => p.zone === zone && p.level === level);
  const liveGain = (zone: Zone): number | null => d?.zones?.[zone]?.gain_db ?? null;

  /** The most recent capture command per scene — so the editor can say "capturing…" / "failed". */
  const lastCaptureFor = (sceneId: string) => cmdsQ.data?.find((c) => c.kind === "capture_scene" && c.payload?.scene_id === sceneId);

  return (
    <div className="sv2-page" data-st-page="">
      <div className="sv2-page-inner" style={{ maxWidth: 1100 }}>
        <StaffPageHeader
          eyebrow="BAR OPS ▸ AUDIO ▸ SCENE EDITOR"
          title="Audio scenes"
          tag="ADMIN"
          right={
            <Link to="/audio" className="st-btn st-body" style={{ ...btn, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              ← Audio
            </Link>
          }
        />

        {/* ARM WRITES — the platform half of the double gate */}
        <div className="st-card" style={card}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <StatusChip tone={health.online ? "live" : "alert"} dot label={health.online ? "AGENT ONLINE" : "AGENT OFFLINE"} />
            <StatusChip tone={writesArmed ? "warn" : "neutral"} label={writesArmed ? "WRITES ARMED" : "WRITES OFF"} />
          </div>
          <ToggleSwitch
            label="Arm writes to the room"
            checked={writesArmed}
            disabled={armWrites.isPending}
            onChange={(next) => (next ? setConfirmArm(true) : armWrites.mutate(false))}
          />
          <div className="st-body st-t2" style={{ fontSize: 14 }}>
            {writesArmed
              ? `Armed by ${state?.writes_armed_by ?? "?"} ${state?.writes_armed_at ? fmtAge(Math.max(0, now - new Date(state.writes_armed_at).getTime())) + " ago" : ""} — clears itself at the 4 AM rollover. The agent ALSO needs writesEnabled in its config; with either off, every press is refused and logged.`
              : "Off — the agent refuses every recall / preset / mute press and logs it as writes_disabled. Reads and CAPTURE FROM ROOM never need this."}
          </div>
          {armWrites.isError && <InlineNotice kind="danger" role="alert" message={`Could not change the arm: ${(armWrites.error as Error).message}`} />}
        </div>

        {!health.online && (
          <InlineNotice kind="warn" role="status" style={{ margin: "0 0 12px" }} message={`${health.reason}. CAPTURE FROM ROOM and SET FROM CURRENT need a fresh mirror; renames and ramps still save.`} />
        )}

        {/* SCENES */}
        {scenesQ.isLoading ? (
          <div className="st-body st-t2" style={{ fontSize: 15 }}>Loading scenes…</div>
        ) : (
          scenes.map((s) => (
            <SceneRow
              key={s.id}
              scene={s}
              online={health.online}
              busy={send.isPending || updateScene.isPending}
              lastCapture={lastCaptureFor(s.id)}
              now={now}
              onSave={(patch) => updateScene.mutate({ id: s.id, ...patch })}
              onCapture={() => send.mutate({ kind: "capture_scene", payload: { scene_id: s.id } })}
            />
          ))
        )}
        {updateScene.isError && <InlineNotice kind="danger" role="alert" message={`Could not save: ${(updateScene.error as Error).message}`} />}

        {/* ZONE PRESETS */}
        <div className="st-card" style={card}>
          <div className="st-label st-t1" style={{ fontSize: 14, letterSpacing: "0.08em" }}>ZONE PRESETS</div>
          <div className="st-body st-t2" style={{ fontSize: 14 }}>Each level is a gain in dB the room fades to. SET FROM CURRENT copies the live level; the field is for a nudge afterwards. Nothing here is invented — an unset level stays disabled on the audio page.</div>
          {ZONES.map((zone) => (
            <div key={zone} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="st-label st-t2" style={{ fontSize: 13 }}>
                {zone.toUpperCase()} — live {liveGain(zone) === null ? "?" : `${liveGain(zone)!.toFixed(1)} dB`}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                {LEVELS.map((level) => {
                  const p = presetFor(zone, level);
                  return (
                    <PresetCell
                      key={level}
                      zone={zone}
                      level={level}
                      gain={p?.gain_db ?? null}
                      ramp={p?.ramp_seconds ?? 2}
                      live={liveGain(zone)}
                      online={health.online}
                      busy={updatePreset.isPending}
                      onSave={(gain, ramp) => updatePreset.mutate({ zone, level, gain_db: gain, ramp_seconds: ramp })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {updatePreset.isError && <InlineNotice kind="danger" role="alert" message={`Could not save preset: ${(updatePreset.error as Error).message}`} />}
        </div>
      </div>

      {confirmArm && (
        <ConfirmDialog
          title="Arm writes to the room"
          body={<span className="st-body">Until the 4 AM rollover, staff presses on the audio page will change the room's levels, sources and mutes (if the agent's own writesEnabled is also on). Nothing is written by arming itself.</span>}
          confirmLabel="Arm writes"
          cancelLabel="Keep off"
          busy={armWrites.isPending}
          onCancel={() => setConfirmArm(false)}
          onConfirm={() => {
            setConfirmArm(false);
            armWrites.mutate(true);
          }}
        />
      )}
    </div>
  );
}

function SceneRow({ scene, online, busy, lastCapture, now, onSave, onCapture }: {
  scene: AudioScene;
  online: boolean;
  busy: boolean;
  lastCapture: { status: string; result: Record<string, unknown> | null; requested_at: string } | undefined;
  now: number;
  onSave: (patch: { name?: string; ramp_seconds?: number; requires_confirm?: boolean }) => void;
  onCapture: () => void;
}) {
  const [name, setName] = useState(scene.name);
  const [ramp, setRamp] = useState(String(scene.ramp_seconds));
  const sum = summarizePayload(scene.payload);
  const captured = sum.controls > 0;
  const rampNum = Number(ramp);
  const dirty = name.trim() !== scene.name || (Number.isFinite(rampNum) && rampNum !== Number(scene.ramp_seconds));
  const capState = lastCapture
    ? lastCapture.status === "done" ? null
      : lastCapture.status === "error" ? `Capture failed: ${String(lastCapture.result?.reason ?? lastCapture.result?.message ?? "error")}`
      : `Capturing… (${fmtAge(Math.max(0, now - new Date(lastCapture.requested_at).getTime()))})`
    : null;
  return (
    <div className="st-card" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="st-label st-t1" style={{ fontSize: 14, letterSpacing: "0.08em" }}>{scene.name}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {scene.is_default && <StatusChip tone="neutral" label="DEFAULT" />}
          <StatusChip tone={captured ? "live" : "warn"} label={captured ? `CAPTURED · ${sum.controls} CONTROLS` : "NOT CAPTURED YET"} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <FormField label="Name" htmlFor={`scene-name-${scene.id}`}>
          <input id={`scene-name-${scene.id}`} className="st-input" style={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </FormField>
        <FormField label="Ramp (seconds)" htmlFor={`scene-ramp-${scene.id}`} hint="How long the Core fades the gains on recall">
          <input id={`scene-ramp-${scene.id}`} className="st-input" style={input} inputMode="decimal" value={ramp} onChange={(e) => setRamp(e.target.value)} />
        </FormField>
      </div>
      <ToggleSwitch label="Ask before switching" checked={scene.requires_confirm} disabled={busy} onChange={(next) => onSave({ requires_confirm: next })} />
      <div className="st-body st-t2" style={{ fontSize: 14 }}>
        {captured
          ? `Captured ${sum.capturedAt ? fmtAge(Math.max(0, now - new Date(sum.capturedAt).getTime())) + " ago" : ""}${sum.sonos ? ` · Sonos: ${sum.sonos}` : ""}${sum.video ? ` · ${sum.video}` : ""}`
          : "Set the room the way this scene should sound, then press CAPTURE FROM ROOM. The button on the audio page stays disabled until then."}
      </div>
      {capState && <div className={`st-body ${capState.startsWith("Capture failed") ? "st-danger" : "st-amber"}`} style={{ fontSize: 14 }}>{capState}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="st-btn st-btn-primary st-body"
          style={btn}
          disabled={!online || busy}
          title={online ? "Reads every lever from the Core into this scene" : "Audio agent offline"}
          onClick={onCapture}
        >
          Capture from room
        </button>
        <button
          type="button"
          className="st-btn st-body"
          style={btn}
          disabled={!dirty || busy || name.trim() === "" || !Number.isFinite(rampNum) || rampNum < 0 || rampNum > 60}
          onClick={() => onSave({ name: name.trim(), ramp_seconds: rampNum })}
        >
          Save name / ramp
        </button>
      </div>
    </div>
  );
}

function PresetCell({ zone, level, gain, ramp, live, online, busy, onSave }: {
  zone: Zone; level: Level; gain: number | null; ramp: number; live: number | null; online: boolean; busy: boolean;
  onSave: (gain: number | null, ramp: number) => void;
}) {
  const [draft, setDraft] = useState(gain === null ? "" : String(gain));
  const [rampDraft, setRampDraft] = useState(String(ramp));
  const n = draft.trim() === "" ? null : Number(draft);
  const r = Number(rampDraft);
  const valid = (n === null || (Number.isFinite(n) && n >= -100 && n <= 10)) && Number.isFinite(r) && r >= 0 && r <= 60;
  const dirty = (n ?? null) !== (gain ?? null) || r !== ramp;
  return (
    <div className="st-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="st-label st-t1" style={{ fontSize: 13 }}>{level.toUpperCase()}</span>
        <StatusChip tone={gain === null ? "warn" : "neutral"} label={gain === null ? "NOT SET" : `${gain} dB`} />
      </div>
      <button
        type="button"
        className="st-btn st-body"
        style={btn}
        disabled={!online || live === null || busy}
        title={live === null ? "No live level to copy" : `Copy ${live.toFixed(1)} dB into ${zone.toUpperCase()} ${level.toUpperCase()}`}
        onClick={() => {
          const v = Math.round(live! * 10) / 10;
          setDraft(String(v));
          onSave(v, r);
        }}
      >
        Set from current{live === null ? "" : ` (${live.toFixed(1)} dB)`}
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <FormField label="dB" htmlFor={`p-${zone}-${level}`}>
          <input id={`p-${zone}-${level}`} className="st-input" style={input} inputMode="decimal" placeholder="—" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </FormField>
        <FormField label="Ramp s" htmlFor={`r-${zone}-${level}`}>
          <input id={`r-${zone}-${level}`} className="st-input" style={input} inputMode="decimal" value={rampDraft} onChange={(e) => setRampDraft(e.target.value)} />
        </FormField>
      </div>
      <button type="button" className="st-btn st-body" style={btn} disabled={!dirty || !valid || busy} onClick={() => onSave(n, r)}>
        Save
      </button>
    </div>
  );
}

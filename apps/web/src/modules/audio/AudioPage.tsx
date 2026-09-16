import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useUiVersion } from "@/shared/useUiVersion";
import { useRole } from "@/shared/useRole";
import { ConfirmDialog, InlineNotice, StaffPageHeader, StatusChip, ToggleSwitch } from "@/shared/ui";
import { useIsMobile } from "@/shared/useIsMobile";
import {
  capturedCount, deriveAgentHealth, fmtAge, sceneDisagrees, useAudioLive, useAudioRealtime, useAudioScenes, useAudioState,
  useNowTick, useRecentCommands, useSceneMap, useSendCommand, useWritesArmed, useZonePresets,
  type AudioScene, type Level, type Zone,
} from "./useAudio";
import { MONO } from "@/modules/signage/signageAdminShared";

/**
 * BAR OPS ▸ AUDIO (docs/16, PR B) — the staff room-control page, v2 shell only.
 *
 * Every control is a COMMAND (one row in audio_commands) that the NUC agent executes behind
 * its double gate; the page shows what the room IS (audio_live) and what was last recalled
 * (audio_state). When the agent's mirror is absent or stale, every command control disables
 * and the status line says why — the page never pretends the room is reachable.
 *
 * PRIORITY set (owner in the room this afternoon): SCENES row + active chip, INSIDE / PATIO
 * LOW·MED·HIGH with live meter, MICS mute toggles, REVERB, status line. MUSIC (favorites
 * picker) and VIDEO (per-out source) are OPTIONAL — see the TODO at the bottom of this file.
 *
 * Sizes are inline px: nothing inherits font-size under `.terminal-theme` (PR #89).
 */

const LEVELS: Level[] = ["low", "med", "high"];
const LEVEL_LABEL: Record<Level, string> = { low: "LOW", med: "MED", high: "HIGH" };
const ZONE_LABEL: Record<Zone, string> = { inside: "INSIDE", patio: "PATIO" };
/** meter index into derived.meters.zones_db (agent contract: Inside / Ceiling / Sub / Patio). */
const ZONE_METER: Record<Zone, number> = { inside: 0, patio: 3 };

const btn: CSSProperties = { minHeight: 44, minWidth: 44, padding: "0 14px", fontFamily: MONO, cursor: "pointer" };
const card: CSSProperties = { padding: 14, display: "flex", flexDirection: "column", gap: 10 };
const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 };

/** v2-only: a classic device sees a MovedRoute-style notice, never the page. */
function ClassicNotice() {
  return (
    <div className="terminal-theme staff-ui" style={{ padding: "24px clamp(16px,4vw,40px)", fontFamily: MONO }}>
      <div className="u-head" style={{ fontSize: 26, marginBottom: 10 }}>AUDIO</div>
      <div style={{ fontSize: 18, marginBottom: 14 }}>Audio lives in the new layout — use TRY THE NEW LAYOUT → in the menu to open it.</div>
      <Link to="/dashboard" style={{ fontSize: 18 }}>← HOME</Link>
    </div>
  );
}

export function AudioPage() {
  const [version] = useUiVersion();
  if (version !== "v2") return <ClassicNotice />;
  return <AudioPageV2 />;
}

function AudioPageV2() {
  useAudioRealtime();
  const scenesQ = useAudioScenes();
  const presetsQ = useZonePresets();
  const stateQ = useAudioState();
  const liveQ = useAudioLive();
  const cmdsQ = useRecentCommands();
  const { role } = useRole();
  const narrow = useIsMobile();
  const now = useNowTick(5_000);

  const scenes = scenesQ.data ?? [];
  const sceneMap = useSceneMap(scenes);
  const state = stateQ.data ?? null;
  const health = deriveAgentHealth(liveQ.data, now);
  const snap = health.snap;
  const d = snap?.derived;
  const { armed: writesArmed } = useWritesArmed(state, now);
  const armedBy = writesArmed ? state?.writes_armed_by ?? null : null;
  const send = useSendCommand(armedBy);

  const loading = scenesQ.isLoading || stateQ.isLoading || liveQ.isLoading;
  /** Commands are allowed only when the agent is online. (The arm gate is the AGENT's to
   *  enforce — a press with writes disarmed still lands as a row and comes back `error:
   *  writes_disabled`, which is the honest audit trail the owner asked for.) */
  const canCommand = health.online && !send.isPending;
  const disabledReason = health.online ? null : health.reason;

  const [confirm, setConfirm] = useState<AudioScene | null>(null);
  const activeScene = state?.active_scene_id ? sceneMap.get(state.active_scene_id) : undefined;
  const activeDisagrees = sceneDisagrees(activeScene, snap);

  const recall = (scene: AudioScene) => {
    if (scene.requires_confirm) {
      setConfirm(scene);
      return;
    }
    send.mutate({ kind: "recall_scene", payload: { scene_id: scene.id } });
  };

  const presets = presetsQ.data ?? [];
  const presetFor = (zone: Zone, level: Level) => presets.find((p) => p.zone === zone && p.level === level);

  const lastCmd = cmdsQ.data?.[0];
  const lastCmdLine = useMemo(() => {
    if (!lastCmd) return null;
    const when = fmtAge(Math.max(0, now - new Date(lastCmd.requested_at).getTime()));
    const label = describeCommand(lastCmd.kind, lastCmd.payload, sceneMap);
    if (lastCmd.status === "done") return { tone: "live" as const, text: `${label} — done ${when} ago` };
    if (lastCmd.status === "error") {
      const reason = String((lastCmd.result as { reason?: unknown } | null)?.reason ?? (lastCmd.result as { message?: unknown } | null)?.message ?? "error");
      return { tone: "alert" as const, text: `${label} — ${reason === "writes_disabled" ? "refused: writes are not armed" : `error: ${reason}`} (${when} ago)` };
    }
    return { tone: "warn" as const, text: `${label} — ${lastCmd.status} (${when} ago)` };
  }, [lastCmd, now, sceneMap]);

  return (
    <div className="sv2-page" data-st-page="">
      <div className="sv2-page-inner" style={{ maxWidth: 1100 }}>
        <StaffPageHeader
          eyebrow="BAR OPS ▸ AUDIO"
          title="Audio"
          tag={health.online ? "LIVE" : "OFFLINE"}
          right={
            role === "admin" ? (
              <Link to="/audio/scenes" className="st-btn st-body" style={{ ...btn, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                Scene editor →
              </Link>
            ) : undefined
          }
        />

        {/* STATUS LINE — read-only, always visible, never green when the agent is gone. */}
        <div className="st-card" style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <StatusChip tone={health.online ? "live" : "alert"} dot label={health.online ? `AGENT ONLINE · ${health.ageMs === null ? "" : fmtAge(health.ageMs) + " ago"}` : "AGENT OFFLINE"} />
            <StatusChip tone={writesArmed ? "warn" : "neutral"} label={writesArmed ? "WRITES ARMED" : "WRITES OFF"} title={writesArmed ? `Armed by ${state?.writes_armed_by}` : "An admin arms writes in the scene editor"} />
            {snap?.core?.design_name && <StatusChip tone="neutral" label={`DESIGN ${snap.core.design_name}`} />}
            {snap?.errors && snap.errors.length > 0 && <StatusChip tone="warn" label={`${snap.errors.length} CONTRACT ERROR${snap.errors.length === 1 ? "" : "S"}`} title={snap.errors.map((e) => e.message).join("\n")} />}
          </div>
          <div className="st-body st-t2" style={{ fontSize: 15 }}>
            {health.online
              ? `Sonos: ${d?.sonos?.transport ?? "?"}${d?.sonos?.track ? ` — ${d.sonos.track}${d.sonos.artist ? ` · ${d.sonos.artist}` : ""}` : ""}`
              : health.reason}
          </div>
          {lastCmdLine && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <StatusChip tone={lastCmdLine.tone} label="LAST PRESS" />
              <span className="st-body st-t2" style={{ fontSize: 15 }}>{lastCmdLine.text}</span>
            </div>
          )}
        </div>

        {disabledReason && (
          <InlineNotice kind="warn" role="status" style={{ margin: "0 0 12px" }} message={`${disabledReason}. Every control below is disabled until the agent's mirror is fresh.`} />
        )}
        {health.online && !writesArmed && (
          <InlineNotice kind="info" style={{ margin: "0 0 12px" }} message="Writes are not armed — presses are recorded but the agent will refuse them until an admin presses ARM WRITES in the scene editor." to={role === "admin" ? "/audio/scenes" : undefined} label={role === "admin" ? "SCENE EDITOR →" : undefined} />
        )}

        {/* SCENES */}
        <Section title="Scenes" sub={activeScene ? `Active: ${activeScene.name}${activeDisagrees ? " — UNVERIFIED" : ""}${state?.recalled_at ? ` · recalled ${fmtAge(Math.max(0, now - new Date(state.recalled_at).getTime()))} ago` : ""}` : "No scene recalled yet"}>
          {scenesQ.isError ? (
            <div className="st-body st-danger" style={{ fontSize: 15 }}>Could not load scenes: {(scenesQ.error as Error).message}</div>
          ) : loading ? (
            <div className="st-body st-t2" style={{ fontSize: 15 }}>Loading…</div>
          ) : scenes.length === 0 ? (
            <div className="st-body st-t2" style={{ fontSize: 15 }}>No scenes — the migration seeds four; an admin names them in the scene editor.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {scenes.map((s) => {
                const isActive = state?.active_scene_id === s.id;
                const captured = capturedCount(s.payload) > 0;
                const unverified = isActive && activeDisagrees === true;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`st-btn st-body ${isActive ? "st-btn-primary" : ""}`}
                    style={{ ...btn, minHeight: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}
                    disabled={!canCommand || !captured}
                    aria-pressed={isActive}
                    title={!captured ? "Not captured yet — an admin captures it from the room" : s.requires_confirm ? "Asks before switching" : undefined}
                    onClick={() => recall(s)}
                  >
                    <span style={{ fontSize: 17, fontWeight: 700 }}>{s.name}</span>
                    {!captured ? (
                      <span className="st-t3" style={{ fontSize: 12 }}>not captured yet</span>
                    ) : unverified ? (
                      <span className="st-amber" style={{ fontSize: 12 }}>— UNVERIFIED</span>
                    ) : isActive ? (
                      <span style={{ fontSize: 12 }}>● ACTIVE</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* INSIDE / PATIO */}
        <div style={grid2}>
          {(["inside", "patio"] as Zone[]).map((zone) => {
            const z = d?.zones?.[zone];
            const meter = d?.meters?.zones_db?.[ZONE_METER[zone]] ?? null;
            return (
              <Section key={zone} title={ZONE_LABEL[zone]} sub={z ? `${z.source_name ?? "?"} · ${z.gain_db === null ? "?" : `${z.gain_db.toFixed(1)} dB`}${z.mute ? " · MUTED" : ""}` : "—"}>
                <Meter db={meter} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                  {LEVELS.map((level) => {
                    const p = presetFor(zone, level);
                    const set = p?.gain_db !== null && p?.gain_db !== undefined;
                    return (
                      <button
                        key={level}
                        type="button"
                        className="st-btn st-body"
                        style={{ ...btn, minHeight: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
                        disabled={!canCommand || !set}
                        title={set ? `${p!.gain_db} dB over ${p!.ramp_seconds}s` : "not set — an admin sets it from the current level"}
                        onClick={() => send.mutate({ kind: "zone_preset", payload: { zone, level } })}
                      >
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{LEVEL_LABEL[level]}</span>
                        <span className="st-t3" style={{ fontSize: 12 }}>{set ? `${p!.gain_db} dB` : "not set"}</span>
                      </button>
                    );
                  })}
                </div>
              </Section>
            );
          })}
        </div>

        {/* MICS + REVERB */}
        <div style={{ ...grid2, marginTop: 12 }}>
          <Section title="Mics" sub="Inside mixer inputs 1 (host) and 2 (karaoke)">
            {(["1", "2"] as const).map((n) => {
              const m = d?.mics?.[n];
              const level = d?.meters?.inputs_db?.[Number(n) - 1] ?? null;
              const open = m?.mute === false;
              return (
                <div key={n} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <ToggleSwitch
                    label={`MIC ${n} ${m?.mute === null || m?.mute === undefined ? "" : open ? "· OPEN" : "· MUTED"}`}
                    checked={open}
                    disabled={!canCommand || m?.mute === null || m?.mute === undefined}
                    lockedHint={health.online ? "?" : "OFFLINE"}
                    onChange={(next) => send.mutate({ kind: "mic_mute", payload: { mic: Number(n), mute: !next } })}
                  />
                  <Meter db={level} compact />
                </div>
              );
            })}
          </Section>
          <Section title="Effects" sub="Reverb on for karaoke, off for trivia">
            <ToggleSwitch
              label={`REVERB ${d?.effects?.reverb_bypass === null || d?.effects?.reverb_bypass === undefined ? "" : d.effects.reverb_bypass ? "· OFF" : "· ON"}`}
              checked={d?.effects?.reverb_bypass === false}
              disabled={!canCommand || d?.effects?.reverb_bypass === null || d?.effects?.reverb_bypass === undefined}
              lockedHint={health.online ? "?" : "OFFLINE"}
              onChange={(next) => send.mutate({ kind: "reverb_bypass", payload: { bypass: !next } })}
            />
            <div className="st-body st-t3" style={{ fontSize: 13 }}>
              Ducker: {d?.effects?.ducker_bypass === null || d?.effects?.ducker_bypass === undefined ? "?" : d.effects.ducker_bypass ? "bypassed (read-only)" : "active (read-only)"}
            </div>
          </Section>
        </div>

        {/* TODO (optional, not built this PR): MUSIC panel = now playing + the Sonos favorites
            picker (derived.sonos.favorites → command sonos_favorite {n}); VIDEO panel = two
            outs × the sources with signal (derived.video → command video_source {out, source}).
            The command kinds and the agent executor already accept both. */}

        {send.isError && (
          <InlineNotice kind="danger" role="alert" style={{ marginTop: 12 }} message={`Could not send: ${(send.error as Error).message}`} />
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={`Switch to ${confirm.name}`}
          body={<span className="st-body">The room will fade over {confirm.ramp_seconds}s to the {confirm.name} scene{activeScene ? ` (currently ${activeScene.name})` : ""}.</span>}
          confirmLabel={`Switch to ${confirm.name}`}
          cancelLabel={activeScene ? `Keep ${activeScene.name}` : "Keep as is"}
          busy={send.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const s = confirm;
            setConfirm(null);
            send.mutate({ kind: "recall_scene", payload: { scene_id: s.id } });
          }}
        />
      )}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-card" style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div className="st-label st-t1" style={{ fontSize: 14, letterSpacing: "0.08em" }}>{title.toUpperCase()}</div>
        {sub && <div className="st-body st-t2" style={{ fontSize: 14 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** A live level bar: −60 dBFS → 0 dBFS mapped to 0–100 %. No animation — the mirror ticks ≤ 1 Hz. */
function Meter({ db, compact = false }: { db: number | null; compact?: boolean }) {
  const pct = db === null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  return (
    <div title={db === null ? "no meter" : `${db.toFixed(1)} dBFS`} style={{ height: compact ? 6 : 10, width: "100%", background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
      <div className={pct > 90 ? "st-danger" : "st-live"} style={{ height: "100%", width: `${pct}%`, background: "currentColor", transition: "width 300ms linear" }} />
    </div>
  );
}

function describeCommand(kind: string, payload: Record<string, unknown>, scenes: Map<string, AudioScene>): string {
  switch (kind) {
    case "recall_scene": return `Scene ${scenes.get(String(payload.scene_id))?.name ?? "?"}`;
    case "zone_preset": return `${ZONE_LABEL[payload.zone as Zone] ?? String(payload.zone)} ${LEVEL_LABEL[payload.level as Level] ?? String(payload.level)}`;
    case "mic_mute": return `Mic ${String(payload.mic)} ${payload.mute ? "mute" : "open"}`;
    case "reverb_bypass": return `Reverb ${payload.bypass ? "off" : "on"}`;
    case "capture_scene": return `Capture ${scenes.get(String(payload.scene_id))?.name ?? "?"}`;
    case "sonos_favorite": return `Sonos favorite ${String(payload.n)}`;
    case "video_source": return `Video out ${String(payload.out)} → ${String(payload.source)}`;
    default: return kind;
  }
}


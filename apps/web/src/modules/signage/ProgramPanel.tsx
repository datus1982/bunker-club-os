import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useMediaPlaylists, setSlotProgram, resumeSchedule, createPanelSlot, type WritableProgram,
} from "./useMediaAdmin";
import { formatDuration } from "./mediaProgram";
import type { ProgramHold } from "./scheduleResolve";
import type { AdminSlot } from "./useSignageAdmin";
import { MONO } from "./signageAdminShared";
import { SlideOver } from "./SlideOver";

/**
 * SWITCH PROGRAM control (docs/15 M1–M3) — the media-capable (landscape) screen card's program
 * picker. Writes signage_slots.program (+ the M3 hold pair): null = ROTATION / follow the schedule,
 * else a playlist / capture / multiview OVERRIDE. Realtime — the TV flips the instant this saves.
 *
 * D4 hold tiers (only meaningful when the slot has a schedule):
 *   • a plain flip is a 'boundary' hold — yields at the next daypart.
 *   • SPECIAL EVENT (the toggle) is an 'event' hold — survives daypart boundaries, expires at the
 *     04:00 rollover (the owner's overtime case).
 *   • no schedule ⇒ a flip is a permanent 'pin' (unchanged from M1/M2), toggle hidden.
 * RESUME SCHEDULE clears the override so the daypart schedule takes over again.
 */
export function ProgramPanel({
  slot, hasSchedule, panelChoices, onClose, onChanged,
}: {
  slot: AdminSlot;
  /** Does this slot have any dayparts? Decides the default hold + whether SPECIAL EVENT shows. */
  hasSchedule: boolean;
  /** Portrait + panel slots a multiview can point its PANEL at (dedicated or mirror — D2). */
  panelChoices: AdminSlot[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const playlistsQ = useMediaPlaylists();
  const playlists = playlistsQ.data ?? [];
  const currentPlaylistId = slot.program?.kind === "playlist" ? slot.program.playlist_id : null;
  const captureSelected = slot.program?.kind === "capture";
  const multiviewSelected = slot.program?.kind === "multiview";
  const rotationSelected = !slot.program;

  // SPECIAL EVENT hold toggle (D4). Default off = a plain 'boundary' flip.
  const [specialEvent, setSpecialEvent] = useState(slot.program_hold === "event");
  const holdFor = (): ProgramHold => (!hasSchedule ? "pin" : specialEvent ? "event" : "boundary");

  const write = useMutation({
    mutationFn: (program: WritableProgram | null) => setSlotProgram(slot.id, program, holdFor()),
    onSuccess: () => { onChanged(); },
  });
  const resume = useMutation({ mutationFn: () => resumeSchedule(slot.id), onSuccess: () => { onChanged(); } });

  // LIVE INPUT draft state.
  const [deviceMatch, setDeviceMatch] = useState(slot.program?.kind === "capture" ? slot.program.device_match ?? "" : "");
  const [captureFramed, setCaptureFramed] = useState(slot.program?.kind === "capture" ? slot.program.presentation === "framed" : false);

  // MULTIVIEW draft state (D1/D2/D8).
  const [mvMain, setMvMain] = useState<"playlist" | "capture">(slot.program?.kind === "multiview" && slot.program.main.kind === "capture" ? "capture" : "playlist");
  const [mvPlaylistId, setMvPlaylistId] = useState(slot.program?.kind === "multiview" && slot.program.main.kind === "playlist" ? slot.program.main.playlist_id : "");
  const [mvPanelMode, setMvPanelMode] = useState<"new" | "mirror">("new");
  const [mvPanelName, setMvPanelName] = useState("BAR PANEL");
  const [mvMirrorId, setMvMirrorId] = useState(slot.program?.kind === "multiview" ? slot.program.panel_slot_id : (panelChoices[0]?.id ?? ""));

  const applyMultiview = useMutation({
    mutationFn: async () => {
      const panelId = mvPanelMode === "new" ? await createPanelSlot(mvPanelName) : mvMirrorId;
      const program: WritableProgram = mvMain === "capture"
        ? { kind: "multiview", main: { kind: "capture" }, panel_slot_id: panelId }
        : { kind: "multiview", main: { kind: "playlist", playlist_id: mvPlaylistId }, panel_slot_id: panelId };
      await setSlotProgram(slot.id, program, holdFor());
    },
    onSuccess: () => { onChanged(); },
  });
  const mvValid = (mvMain === "capture" || !!mvPlaylistId) && (mvPanelMode === "new" ? !!mvPanelName.trim() : !!mvMirrorId);

  const busy = write.isPending || applyMultiview.isPending || resume.isPending;

  return (
    <SlideOver eyebrow={`${slot.name} ▸ PROGRAM`} title="SWITCH PROGRAM" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, opacity: 0.7, lineHeight: 1.5 }}>
          What this screen plays at the bottom of the ladder. A live game, takeover or scheduled MOMENT still preempts any program.
        </div>

        {/* schedule state + RESUME (D4) */}
        {hasSchedule && (
          <div className="terminal-border" style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>
              This screen has a <span className="u-amber">daypart schedule</span>. A program you set here is an OVERRIDE — {specialEvent ? "a SPECIAL EVENT hold (survives dayparts, ends at 4 AM)." : "it yields at the next daypart."}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
              <span onClick={() => setSpecialEvent((v) => !v)} className={specialEvent ? "u-fill u-ink" : ""} style={{ width: 22, height: 22, border: "1px solid var(--terminal-green)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: specialEvent ? "var(--terminal-green)" : "transparent", color: specialEvent ? "#000" : "var(--terminal-green)", flexShrink: 0 }}>{specialEvent ? "✓" : ""}</span>
              <span onClick={() => setSpecialEvent((v) => !v)}>SPECIAL EVENT — hold through dayparts (e.g. a game running long)</span>
            </label>
            {!rotationSelected && (
              <button type="button" disabled={busy} onClick={() => resume.mutate()} className="u-amber" style={{ ...opt, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)", justifyContent: "center" }}>↺ RESUME SCHEDULE</button>
            )}
          </div>
        )}

        {/* ROTATION */}
        <ProgramOption selected={rotationSelected} label={hasSchedule ? "FOLLOW SCHEDULE / ROTATION" : "ROTATION"} sub={hasSchedule ? "clear the override — dayparts + rotation take over" : "the signage rotation — drinks, promos, events, ★ featured (the default)"} disabled={busy} onSelect={() => { if (!rotationSelected) write.mutate(null); }} />

        {/* PLAYLIST */}
        <div style={{ marginTop: 4 }}>
          <div style={label2}>PLAYLIST · loop a media library playlist</div>
          {playlistsQ.isLoading ? (
            <div style={{ opacity: 0.6, fontSize: 15 }}>LOADING PLAYLISTS…</div>
          ) : playlists.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 15 }}>No playlists yet — build one in the MEDIA LIBRARY section.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {playlists.map((p) => {
                const selected = currentPlaylistId === p.playlist.id;
                return (
                  <ProgramOption key={p.playlist.id} selected={selected}
                    label={p.playlist.name}
                    sub={`${p.presentCount} clip${p.presentCount === 1 ? "" : "s"} · ${formatDuration(p.runtimeSeconds)} · ${p.playlist.presentation === "fullbleed" ? "full frame" : "framed"}${p.playlist.shuffle ? " · shuffle" : ""}`}
                    disabled={busy}
                    onSelect={() => { if (!selected) write.mutate({ kind: "playlist", playlist_id: p.playlist.id }); }} />
                );
              })}
            </div>
          )}
        </div>

        {/* LIVE INPUT (capture) */}
        <div style={{ marginTop: 4 }}>
          <div style={label2}>LIVE INPUT · HDMI capture passthrough</div>
          <ProgramOption selected={captureSelected} label="LIVE INPUT" sub="the capture card feed (the Roku) — full frame, no chrome by default" disabled={busy}
            onSelect={() => write.mutate({ kind: "capture", ...(deviceMatch.trim() ? { device_match: deviceMatch.trim() } : {}), ...(captureFramed ? { presentation: "framed" as const } : {}) })} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 2px 2px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, opacity: 0.75 }}>
              <span style={{ letterSpacing: 1 }}>DEVICE MATCH (optional — capture-card label contains)</span>
              <input type="text" value={deviceMatch} onChange={(e) => setDeviceMatch(e.target.value)} placeholder="e.g. USB Video — blank = first camera" style={input} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {([["FULL FRAME", false], ["FRAMED", true]] as const).map(([label, framed]) => {
                const on = captureFramed === framed;
                return <button key={label} type="button" onClick={() => setCaptureFramed(framed)} className={on ? "u-fill u-ink" : ""} style={{ ...opt, flex: 1, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>{on ? "● " : "◦ "}{label}</button>;
              })}
            </div>
          </div>
        </div>

        {/* MULTIVIEW (M3) */}
        <div style={{ marginTop: 4 }}>
          <div style={label2}>MULTIVIEW · 16:9 media/capture + a portrait slide panel</div>
          {multiviewSelected && <div className="u-amber" style={{ fontSize: 13, marginBottom: 6 }}>● Currently running MULTIVIEW.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid rgba(0,255,65,0.35)", padding: "10px 11px" }}>
            <div style={fl}>MAIN REGION (16:9)</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["playlist", "capture"] as const).map((k) => {
                const on = mvMain === k;
                return <button key={k} type="button" onClick={() => setMvMain(k)} className={on ? "u-fill u-ink" : ""} style={{ ...opt, flex: 1, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>{k === "playlist" ? "PLAYLIST" : "LIVE INPUT"}</button>;
              })}
            </div>
            {mvMain === "playlist" && (
              <select value={mvPlaylistId} onChange={(e) => setMvPlaylistId(e.target.value)} style={input}>
                <option value="">— pick a playlist —</option>
                {playlists.map((p) => <option key={p.playlist.id} value={p.playlist.id}>{p.playlist.name}</option>)}
              </select>
            )}

            <div style={{ ...fl, marginTop: 4 }}>PANEL (portrait slides)</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["new", "mirror"] as const).map((k) => {
                const on = mvPanelMode === k;
                return <button key={k} type="button" onClick={() => setMvPanelMode(k)} className={on ? "u-fill u-ink" : ""} style={{ ...opt, flex: 1, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>{k === "new" ? "NEW PANEL" : "MIRROR A SCREEN"}</button>;
              })}
            </div>
            {mvPanelMode === "new" ? (
              <input type="text" value={mvPanelName} onChange={(e) => setMvPanelName(e.target.value)} placeholder="Panel name (its own queue)" style={input} />
            ) : (
              <select value={mvMirrorId} onChange={(e) => setMvMirrorId(e.target.value)} style={input}>
                <option value="">— pick a portrait screen —</option>
                {panelChoices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === "panel" ? " (panel)" : ""}</option>)}
              </select>
            )}

            <button type="button" disabled={!mvValid || busy} onClick={() => applyMultiview.mutate()} className="u-fill u-ink" style={{ ...opt, justifyContent: "center", background: "var(--terminal-green)", color: "#000", fontWeight: 700, opacity: mvValid ? 1 : 0.5 }}>
              {multiviewSelected ? "UPDATE MULTIVIEW" : "START MULTIVIEW"}
            </button>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

function ProgramOption({ selected, label, sub, disabled, onSelect }: { selected: boolean; label: string; sub: string; disabled?: boolean; onSelect?: () => void }) {
  const reserved = !onSelect;
  return (
    <button type="button" onClick={onSelect} disabled={disabled || reserved} className={selected ? "u-fill u-ink" : ""}
      style={{ ...opt, flexDirection: "column", alignItems: "flex-start", gap: 3, textAlign: "left", cursor: reserved ? "default" : "pointer", background: selected ? "var(--terminal-green)" : "transparent", color: selected ? "#000" : "var(--terminal-green)", opacity: reserved ? 0.4 : 1 }}>
      <span style={{ fontSize: 20, fontWeight: selected ? 700 : 400, letterSpacing: 1 }}>{selected ? "● " : reserved ? "○ " : "◦ "}{label}</span>
      <span style={{ fontSize: 13, opacity: 0.75 }}>{sub}</span>
    </button>
  );
}

const label2 = { fontSize: 14, letterSpacing: 2, opacity: 0.55, margin: "4px 0 6px" } as const;
const fl = { fontSize: 12, letterSpacing: 2, opacity: 0.6 } as const;
const opt = { display: "flex", alignItems: "center", fontFamily: MONO, fontSize: 14, letterSpacing: 1, minHeight: 44, padding: "11px 13px", border: "1px solid var(--terminal-green)", background: "transparent", color: "var(--terminal-green)", cursor: "pointer" } as const;
const input = { fontFamily: MONO, fontSize: 15, padding: "9px 11px", minHeight: 44, background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.35)", width: "100%" } as const;

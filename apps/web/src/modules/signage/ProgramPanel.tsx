import { useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useMediaPlaylists, setSlotProgram, resumeSchedule, createPanelSlot, type WritableProgram,
} from "./useMediaAdmin";
import { formatDuration, ALL_MEDIA_PLAYLIST_ID, ALL_MEDIA_NAME, type CarouselOrder } from "./mediaProgram";
import type { ProgramHold } from "./scheduleResolve";
import type { AdminSlot } from "./useSignageAdmin";
import { MONO } from "./signageAdminShared";
import { SlideOver } from "./SlideOver";
import { TAP } from "@/shared/ui/tokens";
import { TapTargetCheckbox } from "@/shared/ui";

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
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 2) — `variant`.
 *
 * Stephen's bug: "I clicked to open the schedule modal and the old style was still
 * present… same with the switch program function". A v2 page opened this panel and got the
 * classic green drawer, because `/media/screens` and the v2 hub deliberately mount their
 * slide-overs OUTSIDE the `[data-st-page]` token scope (they are SHARED with the classic
 * hub). `variant="v2"` is how a v2 caller says "token this one" — the frame becomes PR 1's
 * `.st-sheet` drawer, and the leaves below swap their green literals for the token roles.
 *
 * ONE component, one tree, a `v2` branch at each LEAF — not a v2 twin of the panel. Two
 * copies of the control that writes `signage_slots.program` is how the hub and the media
 * page would start disagreeing about a live bar screen.
 *
 * CLASSIC IS BYTE-IDENTICAL, and the shape of the edit is what makes that claim cheap to
 * audit: every branched `style` is a WHOLE-OBJECT ternary whose classic arm is the shipped
 * object literal, key for key. Merging one v2 key into the classic object would reorder the
 * serialised `style` attribute — invisible on screen, and a diff in the innerHTML hash the
 * harness compares.
 *
 * NOTHING ABOUT BEHAVIOUR MOVES: same mutations, same `holdFor()` tiers, same
 * `device_match` handling, same `busy` gating, same selection derivation. The v2 leg adds
 * `aria-pressed` to the option rows and segmented toggles (a selectable list should say so
 * to a screen reader); that is the only new attribute.
 * ──────────────────────────────────────────────────────────────────────────────────── */
export function ProgramPanel({
  slot, hasSchedule, overrideActive, panelChoices, onClose, onChanged, variant = "classic", openKey,
}: {
  slot: AdminSlot;
  /** Does this slot have any dayparts? Decides the default hold + whether SPECIAL EVENT shows. */
  hasSchedule: boolean;
  /** Is a manual override LIVE right now (WARN-1)? An expired override's DB row lingers but the TV
   *  has yielded — so the pre-selected state must come from this, not the raw slot.program row. */
  overrideActive: boolean;
  /** Portrait + panel slots a multiview can point its PANEL at (dedicated or mirror — D2). */
  panelChoices: AdminSlot[];
  onClose: () => void;
  onChanged: () => void;
  /** "v2" renders the tokened sheet (Beat 8 PR 2). Defaults to the shipped classic drawer. */
  variant?: "classic" | "v2";
  /** Identity of the open request — forwarded to SlideOver's phase machine. */
  openKey?: unknown;
}) {
  const v2 = variant === "v2";
  const playlistsQ = useMediaPlaylists();
  const playlists = playlistsQ.data ?? [];
  // Selection reflects the LIVE override only (parity — an expired override is not "selected"; the
  // slot is following its schedule/rotation, so FOLLOW SCHEDULE / ROTATION is the highlighted state).
  const ovProgram = overrideActive ? slot.program : null;
  const currentPlaylistId = ovProgram?.kind === "playlist" ? ovProgram.playlist_id : null;
  const allMediaSelected = currentPlaylistId === ALL_MEDIA_PLAYLIST_ID;
  const captureSelected = ovProgram?.kind === "capture";
  const multiviewSelected = ovProgram?.kind === "multiview";
  const carouselSelected = ovProgram?.kind === "carousel";
  const carouselOrder: CarouselOrder | null = ovProgram?.kind === "carousel" ? ovProgram.order : null;
  const rotationSelected = !overrideActive;

  // SPECIAL EVENT hold toggle (D4). Default on only when a LIVE 'event' override is active.
  const [specialEvent, setSpecialEvent] = useState(overrideActive && slot.program_hold === "event");
  const holdFor = (): ProgramHold => (!hasSchedule ? "pin" : specialEvent ? "event" : "boundary");

  const write = useMutation({
    mutationFn: (program: WritableProgram | null) => setSlotProgram(slot.id, program, holdFor()),
    onSuccess: () => { onChanged(); },
  });
  const resume = useMutation({ mutationFn: () => resumeSchedule(slot.id), onSuccess: () => { onChanged(); } });

  // LIVE INPUT draft state (seeded from the LIVE override only — parity).
  const [deviceMatch, setDeviceMatch] = useState(ovProgram?.kind === "capture" ? ovProgram.device_match ?? "" : "");
  const [captureFramed, setCaptureFramed] = useState(ovProgram?.kind === "capture" ? ovProgram.presentation === "framed" : false);

  // MULTIVIEW draft state (D1/D2/D8).
  const [mvMain, setMvMain] = useState<"playlist" | "capture">(ovProgram?.kind === "multiview" && ovProgram.main.kind === "capture" ? "capture" : "playlist");
  const [mvPlaylistId, setMvPlaylistId] = useState(ovProgram?.kind === "multiview" && ovProgram.main.kind === "playlist" ? ovProgram.main.playlist_id : "");
  const [mvPanelMode, setMvPanelMode] = useState<"new" | "mirror">("new");
  const [mvPanelName, setMvPanelName] = useState("BAR PANEL");
  const [mvMirrorId, setMvMirrorId] = useState(ovProgram?.kind === "multiview" ? ovProgram.panel_slot_id : (panelChoices[0]?.id ?? ""));

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

  // v2 leaf kit. `inputV2`/`optV2` (bottom of file) carry GEOMETRY only — ink, face and size come from the
  // classes. An inline colour loses to `.terminal-theme * { color: green !important }`, so
  // a token value spent here would render green and quietly lie (the PR #89 lesson).
  const inputS: CSSProperties = v2 ? inputV2 : input;
  /** A segmented/toggle control: primary fill when on, plain when off. */
  // `u-ink` rides along on the ON state: `.st-sheet .st-btn-primary` paints the BUTTON's
  // own colour, but a child <span> is matched by the blanket `.st-sheet *` text tier and
  // would stay white-on-accent. `.st-sheet .u-ink *` is the (0,4,0) rule that reaches them.
  const segCls = (on: boolean) => (v2 ? (on ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (on ? "u-fill u-ink" : ""));
  /** v2 only — a pressed state a screen reader can read. Classic markup stays frozen. */
  const pressed = (on: boolean) => (v2 ? { "aria-pressed": on } : null);

  return (
    <SlideOver eyebrow={`${slot.name} ▸ PROGRAM`} title={v2 ? "Switch program" : "SWITCH PROGRAM"} onClose={onClose} variant={variant} openKey={openKey}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { lineHeight: 1.5 } : { fontSize: 15, opacity: 0.7, lineHeight: 1.5 }}>
          What this screen plays at the bottom of the ladder. A live game, takeover or scheduled MOMENT still preempts any program.
        </div>

        {/* schedule state + RESUME (D4) */}
        {hasSchedule && (
          <div className={v2 ? "st-card" : "terminal-border"} style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { lineHeight: 1.5 } : { fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>
              This screen has a <span className={v2 ? "st-body st-amber" : "u-amber"}>daypart schedule</span>. A program you set here is an OVERRIDE — {specialEvent ? "a SPECIAL EVENT hold (survives dayparts, ends at 4 AM)." : "it yields at the next daypart."}
            </div>
            {/* NOTE-1 (review): v2 uses the real primitive. The hand-rolled version was a
                22×22 NON-FOCUSABLE <span> whose only affordance on v2 was an 8%-alpha
                hairline — unreachable by keyboard and barely visible. `TapTargetCheckbox`
                is a native <input> in a 44px label row, which is the whole reason it
                exists. The CLASSIC arm below is the shipped markup, untouched. */}
            {v2 ? (
              <TapTargetCheckbox
                checked={specialEvent}
                onChange={setSpecialEvent}
                label="Special event — hold through dayparts (e.g. a game running long)"
              />
            ) : (
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                <span onClick={() => setSpecialEvent((v) => !v)} className={specialEvent ? "u-fill u-ink" : ""} style={{ width: 22, height: 22, border: "1px solid var(--terminal-green)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: specialEvent ? "var(--terminal-green)" : "transparent", color: specialEvent ? "#000" : "var(--terminal-green)", flexShrink: 0 }}>{specialEvent ? "✓" : ""}</span>
                <span onClick={() => setSpecialEvent((v) => !v)}>SPECIAL EVENT — hold through dayparts (e.g. a game running long)</span>
              </label>
            )}
            {!rotationSelected && (
              <button type="button" disabled={busy} onClick={() => resume.mutate()} className={v2 ? "st-btn st-amber st-body" : "u-amber"} style={v2 ? { ...optV2, justifyContent: "center" } : { ...opt, color: "var(--terminal-amber, #ffb000)", borderColor: "var(--terminal-amber, #ffb000)", justifyContent: "center" }}>{v2 ? "↺ Resume schedule" : "↺ RESUME SCHEDULE"}</button>
            )}
          </div>
        )}

        {/* ROTATION */}
        <ProgramOption v2={v2} selected={rotationSelected}
          label={v2 ? (hasSchedule ? "Follow schedule / rotation" : "Rotation") : (hasSchedule ? "FOLLOW SCHEDULE / ROTATION" : "ROTATION")}
          sub={hasSchedule ? "clear the override — dayparts + rotation take over" : "the signage rotation — drinks, promos, events, ★ featured (the default)"} disabled={busy} onSelect={() => { if (!rotationSelected) write.mutate(null); }} />

        {/* PLAYLIST */}
        <div style={{ marginTop: 4 }}>
          <GroupLabel v2={v2} label="PLAYLIST" note="loop a media library playlist" v2Note="Loop a media library playlist" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* ALL MEDIA (virtual): every present file, shuffled — always offered, above the real
                playlists. Writes a `playlist` program pointed at the sentinel id. */}
            <ProgramOption v2={v2} selected={allMediaSelected} label={ALL_MEDIA_NAME}
              sub="every clip in the library, shuffled · framed" disabled={busy}
              onSelect={() => { if (!allMediaSelected) write.mutate({ kind: "playlist", playlist_id: ALL_MEDIA_PLAYLIST_ID }); }} />
          </div>
          {playlistsQ.isLoading ? (
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { marginTop: 6 } : { opacity: 0.6, fontSize: 15, marginTop: 6 }}>{v2 ? "Loading playlists…" : "LOADING PLAYLISTS…"}</div>
          ) : playlists.length === 0 ? (
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { marginTop: 6 } : { opacity: 0.6, fontSize: 15, marginTop: 6 }}>No custom/folder playlists yet — build one in the MEDIA LIBRARY section.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {playlists.map((p) => {
                const selected = currentPlaylistId === p.playlist.id;
                return (
                  <ProgramOption key={p.playlist.id} v2={v2} selected={selected}
                    label={p.playlist.name}
                    sub={`${p.presentCount} clip${p.presentCount === 1 ? "" : "s"} · ${formatDuration(p.runtimeSeconds)} · ${p.playlist.presentation === "fullbleed" ? "full frame" : "framed"}${p.playlist.shuffle ? " · shuffle" : ""}`}
                    disabled={busy}
                    onSelect={() => { if (!selected) write.mutate({ kind: "playlist", playlist_id: p.playlist.id }); }} />
                );
              })}
            </div>
          )}
        </div>

        {/* CAROUSEL · play a whole playlist, then hop to the next */}
        <div style={{ marginTop: 4 }}>
          <GroupLabel v2={v2} label="CAROUSEL" note="a whole playlist, then the next one" v2Note="A whole playlist, then the next one" />
          {carouselSelected && <div className={v2 ? "st-amber st-body" : "u-amber"} style={v2 ? { marginBottom: 6 } : { fontSize: 13, marginBottom: 6 }}>● Currently running CAROUSEL ({carouselOrder === "random" ? "random" : "ordered"}).</div>}
          <div style={{ display: "flex", gap: 8 }}>
            {(["ordered", "random"] as CarouselOrder[]).map((o) => {
              const on = carouselSelected && carouselOrder === o;
              const sub = o === "ordered" ? "A → Z by name" : "shuffle playlists";
              return (
                <button key={o} type="button" disabled={busy} onClick={() => { if (!on) write.mutate({ kind: "carousel", order: o }); }}
                  {...pressed(on)}
                  className={segCls(on)}
                  style={v2 ? { ...optV2, flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 2 } : { ...opt, flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 2, background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>
                  <span className={v2 ? "st-heading" : undefined} style={v2 ? { fontWeight: on ? 700 : 600 } : { fontWeight: on ? 700 : 400, letterSpacing: 1 }}>{on ? "● " : "◦ "}{v2 ? (o === "ordered" ? "Ordered" : "Random") : (o === "ordered" ? "ORDERED" : "RANDOM")}</span>
                  <span className={v2 ? "st-body" : undefined} style={v2 ? { opacity: 0.8 } : { fontSize: 12, opacity: 0.75 }}>{sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* LIVE INPUT (capture) */}
        <div style={{ marginTop: 4 }}>
          <GroupLabel v2={v2} label="LIVE INPUT" note="HDMI capture passthrough" v2Note="HDMI capture passthrough" />
          <ProgramOption v2={v2} selected={captureSelected} label={v2 ? "Live input" : "LIVE INPUT"} sub="the capture card feed (the Roku) — full frame, no chrome by default" disabled={busy}
            onSelect={() => write.mutate({ kind: "capture", ...(deviceMatch.trim() ? { device_match: deviceMatch.trim() } : {}), ...(captureFramed ? { presentation: "framed" as const } : {}) })} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 2px 2px" }}>
            <label style={v2 ? { display: "flex", flexDirection: "column", gap: 4 } : { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, opacity: 0.75 }}>
              {/* v2 splits the Label role (uppercase by definition) from its hint, so
                  `text-transform: uppercase` never shouts a lowercase parenthetical. */}
              <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : { letterSpacing: 1 }}>{v2 ? "DEVICE MATCH" : "DEVICE MATCH (optional — capture-card label contains)"}</span>
              {v2 && <span className="st-body st-t3">Optional — the capture-card label contains this</span>}
              <input type="text" value={deviceMatch} onChange={(e) => setDeviceMatch(e.target.value)} placeholder="e.g. USB Video — blank = first camera" className={v2 ? "st-body" : undefined} style={inputS} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {([["FULL FRAME", false], ["FRAMED", true]] as const).map(([label, framed]) => {
                const on = captureFramed === framed;
                return <button key={label} type="button" onClick={() => setCaptureFramed(framed)} {...pressed(on)} className={segCls(on)} style={v2 ? { ...optV2, flex: 1, justifyContent: "center" } : { ...opt, flex: 1, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>{on ? "● " : "◦ "}{v2 ? (framed ? "Framed" : "Full frame") : label}</button>;
              })}
            </div>
          </div>
        </div>

        {/* MULTIVIEW (M3) */}
        <div style={{ marginTop: 4 }}>
          <GroupLabel v2={v2} label="MULTIVIEW" note="16:9 media/capture + a portrait slide panel" v2Note="16:9 media/capture + a portrait slide panel" />
          {multiviewSelected && <div className={v2 ? "st-amber st-body" : "u-amber"} style={v2 ? { marginBottom: 6 } : { fontSize: 13, marginBottom: 6 }}>● Currently running MULTIVIEW.</div>}
          <div className={v2 ? "st-card" : undefined} style={v2 ? { display: "flex", flexDirection: "column", gap: 8, padding: "10px 11px" } : { display: "flex", flexDirection: "column", gap: 8, border: "1px solid rgba(0,255,65,0.35)", padding: "10px 11px" }}>
            <div className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : fl}>MAIN REGION (16:9)</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["playlist", "capture"] as const).map((k) => {
                const on = mvMain === k;
                return <button key={k} type="button" onClick={() => setMvMain(k)} {...pressed(on)} className={segCls(on)} style={v2 ? { ...optV2, flex: 1, justifyContent: "center" } : { ...opt, flex: 1, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>{v2 ? (k === "playlist" ? "Playlist" : "Live input") : (k === "playlist" ? "PLAYLIST" : "LIVE INPUT")}</button>;
              })}
            </div>
            {mvMain === "playlist" && (
              <select value={mvPlaylistId} onChange={(e) => setMvPlaylistId(e.target.value)} className={v2 ? "st-body" : undefined} style={inputS}>
                <option value="">— pick a playlist —</option>
                {playlists.map((p) => <option key={p.playlist.id} value={p.playlist.id}>{p.playlist.name}</option>)}
              </select>
            )}

            {/* NOTE-2 (review): same split as DEVICE MATCH — `.st-label` is the all-caps
                role, so the lowercase hint becomes its own Body line instead of being
                shouted as "PANEL (PORTRAIT SLIDES)". */}
            <div className={v2 ? "st-label st-t2" : undefined} style={v2 ? { marginTop: 4 } : { ...fl, marginTop: 4 }}>{v2 ? "PANEL" : "PANEL (portrait slides)"}</div>
            {v2 && <div className="st-body st-t3">Portrait slides</div>}
            <div style={{ display: "flex", gap: 8 }}>
              {(["new", "mirror"] as const).map((k) => {
                const on = mvPanelMode === k;
                return <button key={k} type="button" onClick={() => setMvPanelMode(k)} {...pressed(on)} className={segCls(on)} style={v2 ? { ...optV2, flex: 1, justifyContent: "center" } : { ...opt, flex: 1, justifyContent: "center", background: on ? "var(--terminal-green)" : "transparent", color: on ? "#000" : "var(--terminal-green)" }}>{v2 ? (k === "new" ? "New panel" : "Mirror a screen") : (k === "new" ? "NEW PANEL" : "MIRROR A SCREEN")}</button>;
              })}
            </div>
            {mvPanelMode === "new" ? (
              <input type="text" value={mvPanelName} onChange={(e) => setMvPanelName(e.target.value)} placeholder="Panel name (its own queue)" className={v2 ? "st-body" : undefined} style={inputS} />
            ) : (
              <select value={mvMirrorId} onChange={(e) => setMvMirrorId(e.target.value)} className={v2 ? "st-body" : undefined} style={inputS}>
                <option value="">— pick a portrait screen —</option>
                {panelChoices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === "panel" ? " (panel)" : ""}</option>)}
              </select>
            )}

            <button type="button" disabled={!mvValid || busy} onClick={() => applyMultiview.mutate()} className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"} style={v2 ? { ...optV2, justifyContent: "center", fontWeight: 700, opacity: mvValid ? 1 : 0.5 } : { ...opt, justifyContent: "center", background: "var(--terminal-green)", color: "#000", fontWeight: 700, opacity: mvValid ? 1 : 0.5 }}>
              {v2 ? (multiviewSelected ? "Update multiview" : "Start multiview") : (multiviewSelected ? "UPDATE MULTIVIEW" : "START MULTIVIEW")}
            </button>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

/**
 * One selectable program. v2 makes the list a real selectable row list: `aria-pressed`
 * says which one is current (the glyph alone said it to sighted users only), the label
 * takes the Heading role and the fill comes from `st-btn-primary`.
 */
function ProgramOption({ selected, label, sub, disabled, onSelect, v2 = false }: { selected: boolean; label: string; sub: string; disabled?: boolean; onSelect?: () => void; v2?: boolean }) {
  const reserved = !onSelect;
  return (
    <button type="button" onClick={onSelect} disabled={disabled || reserved}
      {...(v2 ? { "aria-pressed": selected } : null)}
      className={v2 ? (selected ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (selected ? "u-fill u-ink" : "")}
      style={v2
        ? { ...optV2, flexDirection: "column", alignItems: "flex-start", gap: 3, textAlign: "left", cursor: reserved ? "default" : "pointer", opacity: reserved ? 0.4 : 1 }
        : { ...opt, flexDirection: "column", alignItems: "flex-start", gap: 3, textAlign: "left", cursor: reserved ? "default" : "pointer", background: selected ? "var(--terminal-green)" : "transparent", color: selected ? "#000" : "var(--terminal-green)", opacity: reserved ? 0.4 : 1 }}>
      {/* No tier class on either span: inside a PRIMARY row the ink is `u-ink`'s ground,
          and `st-t2` would paint the sub-line secondary-white on the accent fill. */}
      <span className={v2 ? "st-heading" : undefined} style={v2 ? { fontWeight: selected ? 700 : 600 } : { fontSize: 20, fontWeight: selected ? 700 : 400, letterSpacing: 1 }}>{selected ? "● " : reserved ? "○ " : "◦ "}{label}</span>
      <span className={v2 ? "st-body" : undefined} style={v2 ? { opacity: 0.8 } : { fontSize: 13, opacity: 0.75 }}>{sub}</span>
    </button>
  );
}

/**
 * A section eyebrow. Classic keeps its single dim line (`LABEL · note`, byte-identical);
 * v2 splits it, because `.st-label` is the all-caps role by definition and would shout a
 * sentence-case note. `v2Note` carries the sentence-case wording of the same words.
 */
function GroupLabel({ v2, label, note, v2Note }: { v2: boolean; label: string; note: string; v2Note?: string }) {
  if (!v2) return <div style={label2}>{`${label} · ${note}`}</div>;
  return (
    <div style={{ margin: "4px 0 6px" }}>
      <div className="st-label st-t2">{label}</div>
      <div className="st-body st-t3" style={{ marginTop: 2 }}>{v2Note ?? note}</div>
    </div>
  );
}

const label2 = { fontSize: 14, letterSpacing: 2, opacity: 0.55, margin: "4px 0 6px" } as const;
const fl = { fontSize: 12, letterSpacing: 2, opacity: 0.6 } as const;
const opt = { display: "flex", alignItems: "center", fontFamily: MONO, fontSize: 14, letterSpacing: 1, minHeight: 44, padding: "11px 13px", border: "1px solid var(--terminal-green)", background: "transparent", color: "var(--terminal-green)", cursor: "pointer" } as const;
const input = { fontFamily: MONO, fontSize: 15, padding: "9px 11px", minHeight: 44, background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.35)", width: "100%" } as const;

/* v2 twins: the same boxes, geometry only. No `fontFamily` (the role classes own the
 * face), no `background`/`color` (an inline colour cannot beat the theme's !important
 * green — the classes are what actually paint), and `border: "1px solid"` with no colour
 * so the token blanket paints the hairline (the ConfirmDialog idiom). `minWidth: TAP`
 * joins `minHeight` because the 44px floor is measured on BOTH axes (#103 NOTE-6). */
const optV2 = { display: "flex", alignItems: "center", fontSize: 15, minWidth: TAP, minHeight: TAP, padding: "11px 13px", border: "1px solid", cursor: "pointer" } as const;
const inputV2 = { fontSize: 15, padding: "9px 11px", minHeight: TAP, border: "1px solid", width: "100%" } as const;

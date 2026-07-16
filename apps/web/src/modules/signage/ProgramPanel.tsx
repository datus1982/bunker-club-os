import { useMutation } from "@tanstack/react-query";
import { useMediaPlaylists, setSlotProgram } from "./useMediaAdmin";
import { formatDuration } from "./mediaProgram";
import type { AdminSlot } from "./useSignageAdmin";
import { MONO } from "./signageAdminShared";
import { SlideOver } from "./SlideOver";

/**
 * SWITCH PROGRAM control (docs/15 M1) — the media-capable (landscape) screen card's program
 * picker. Writes signage_slots.program: null = ROTATION (today's default), or a `playlist`
 * program. Realtime, no reload — the TV flips the instant this saves (useSignage watches
 * signage_slots). LIVE INPUT (M2) and MULTIVIEW (M3) are shown greyed so the shape of the
 * feature is visible but nothing half-built is switchable.
 *
 * The program tier is the BOTTOM of the mode ladder — a live game / takeover / MOMENT still
 * preempts whatever program is set (resolveSlotMode is unchanged), so switching a program here
 * never overrides Wednesday trivia.
 */
export function ProgramPanel({ slot, onClose, onChanged }: { slot: AdminSlot; onClose: () => void; onChanged: () => void }) {
  const playlistsQ = useMediaPlaylists();
  const playlists = playlistsQ.data ?? [];
  const currentPlaylistId = slot.program?.kind === "playlist" ? slot.program.playlist_id : null;

  const write = useMutation({
    mutationFn: (program: { kind: "playlist"; playlist_id: string } | null) => setSlotProgram(slot.id, program),
    onSuccess: () => { onChanged(); },
  });

  const rotationSelected = !slot.program;

  return (
    <SlideOver eyebrow={`${slot.name} ▸ PROGRAM`} title="SWITCH PROGRAM" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, opacity: 0.7, lineHeight: 1.5 }}>
          What this screen plays at the bottom of the ladder. A live game, takeover or scheduled MOMENT still preempts any program.
        </div>

        {/* ROTATION */}
        <ProgramOption
          selected={rotationSelected}
          label="ROTATION"
          sub="the signage rotation — drinks, promos, events, ★ featured (the default)"
          disabled={write.isPending}
          onSelect={() => { if (!rotationSelected) write.mutate(null); }}
        />

        {/* PLAYLIST */}
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 14, letterSpacing: 2, opacity: 0.55, margin: "4px 0 6px" }}>PLAYLIST · loop a media library playlist</div>
          {playlistsQ.isLoading ? (
            <div style={{ opacity: 0.6, fontSize: 15 }}>LOADING PLAYLISTS…</div>
          ) : playlists.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 15 }}>No playlists yet — build one in the MEDIA LIBRARY section.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {playlists.map((p) => {
                const selected = currentPlaylistId === p.playlist.id;
                return (
                  <ProgramOption
                    key={p.playlist.id}
                    selected={selected}
                    label={p.playlist.name}
                    sub={`${p.presentCount} clip${p.presentCount === 1 ? "" : "s"} · ${formatDuration(p.runtimeSeconds)} · ${p.playlist.presentation === "fullbleed" ? "full frame" : "framed"}${p.playlist.shuffle ? " · shuffle" : ""}`}
                    disabled={write.isPending}
                    onSelect={() => { if (!selected) write.mutate({ kind: "playlist", playlist_id: p.playlist.id }); }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* reserved */}
        <ProgramOption selected={false} disabled label="LIVE INPUT" sub="HDMI capture passthrough — coming in M2" />
        <ProgramOption selected={false} disabled label="MULTIVIEW" sub="16:9 media/capture + a portrait slide panel — coming in M3" />
      </div>
    </SlideOver>
  );
}

function ProgramOption({ selected, label, sub, disabled, onSelect }: {
  selected: boolean;
  label: string;
  sub: string;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const reserved = !onSelect;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || reserved}
      className={selected ? "u-fill u-ink" : ""}
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3,
        textAlign: "left", fontFamily: MONO, cursor: reserved ? "default" : "pointer",
        border: `1px solid ${selected ? "var(--terminal-green)" : "rgba(0,255,65,0.35)"}`,
        background: selected ? "var(--terminal-green)" : "transparent",
        color: selected ? "#000" : "var(--terminal-green)",
        padding: "11px 13px", minHeight: 44, opacity: reserved ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: selected ? 700 : 400, letterSpacing: 1 }}>
        {selected ? "● " : reserved ? "○ " : "◦ "}{label}
      </span>
      <span style={{ fontSize: 13, opacity: 0.75 }}>{sub}</span>
    </button>
  );
}

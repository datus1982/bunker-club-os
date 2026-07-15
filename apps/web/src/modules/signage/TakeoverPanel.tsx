import { useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  sendTakeover, dismissTakeover, activeTakeoverForSlot,
  type AdminSlot, type AdminTakeover,
} from "./useSignageAdmin";
import { Countdown, ghost, primary, field, chip } from "./signageAdminShared";

/**
 * TAKEOVER panel (docs/signage-hub-consolidation-mockup.html view 5, D2) — the retired
 * BROADCAST tab's whole job, launched per-screen from a hub card's TAKEOVER button.
 *
 * Scoped to `slot` by default (writes screen_takeovers.slot_id = the slot); the ALL SCREENS
 * toggle sends venue-wide (slot_id null) — the old Broadcast behaviour. The public SlotDisplay
 * reader already scopes takeovers per slot (0045), so a scoped send lands on exactly one TV.
 */
const MONO = "'VT323','Share Tech Mono',monospace";

export function TakeoverPanel({
  slot, takeovers, onChanged,
}: {
  slot: AdminSlot;
  takeovers: AdminTakeover[];
  onChanged: () => void;
}) {
  // The takeover currently holding THIS screen (venue-wide or scoped to it) — same rule the TV
  // scopes by, so the panel's ON AIR state matches the screen.
  const active = activeTakeoverForSlot(takeovers, slot.id);

  const [message, setMessage] = useState("");
  const [sub, setSub] = useState("");
  const [duration, setDuration] = useState<number | null>(5);
  const [allScreens, setAllScreens] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      sendTakeover({
        message: message.trim(),
        sub_message: sub.trim() || null,
        durationMinutes: duration,
        slotId: allScreens ? null : slot.id,
      }),
    onSuccess: () => { setMessage(""); setSub(""); onChanged(); },
  });
  const dismiss = useMutation({ mutationFn: (id: string) => dismissTakeover(id), onSuccess: onChanged });

  const target = allScreens ? "EVERY SCREEN" : slot.name;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 15, opacity: 0.65 }}>
        Overrides the screen instantly with a priority message. Use for LAST CALL, TRIVIA STARTS, a shout-out.
      </div>

      {active && (
        <div className="terminal-border" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, letterSpacing: 2, opacity: 0.6 }}>
            ■ ON AIR NOW{active.slot_id === null ? " · ALL SCREENS" : ` · ${slot.name}`}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{active.message}</div>
          {active.sub_message && <div style={{ fontSize: 17, opacity: 0.8 }}>{active.sub_message}</div>}
          <div style={{ fontSize: 14, opacity: 0.6 }}><Countdown endsAt={active.ends_at} /></div>
          <button type="button" onClick={() => dismiss.mutate(active.id)} className="u-amber" style={{ ...ghost, alignSelf: "flex-start" }}>DISMISS NOW</button>
        </div>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={miniLabel}>MESSAGE</span>
        <input placeholder="LAST CALL — GET YOUR FINAL ROUND IN" value={message} onChange={(e) => setMessage(e.target.value)} style={field} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={miniLabel}>SUB-MESSAGE (optional)</span>
        <input placeholder="optional second line" value={sub} onChange={(e) => setSub(e.target.value)} style={field} />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...miniLabel, marginRight: 2 }}>HOLD FOR</span>
        {[2, 5, 10].map((m) => (
          <button key={m} type="button" onClick={() => setDuration(m)} className={duration === m ? "u-fill u-ink" : ""} style={{ ...chip, ...(duration === m ? bold : null) }}>{m} MIN</button>
        ))}
        <button type="button" onClick={() => setDuration(null)} className={duration === null ? "u-fill u-ink" : ""} style={{ ...chip, ...(duration === null ? bold : null) }}>UNTIL DISMISSED</button>
      </div>

      {/* ALL SCREENS toggle (D2): off = just this screen; on = venue-wide (old Broadcast). */}
      <button
        type="button"
        onClick={() => setAllScreens((v) => !v)}
        className="terminal-border"
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", background: "transparent", color: "var(--terminal-green)", cursor: "pointer", fontFamily: MONO, textAlign: "left" }}
      >
        <span className={allScreens ? "u-fill u-ink" : ""} style={{ width: 24, height: 24, border: "1px solid var(--terminal-green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15 }}>{allScreens ? "✓" : ""}</span>
        <span>
          <span style={{ fontSize: 17, letterSpacing: 1 }}>ALL SCREENS</span>
          <span style={{ display: "block", fontSize: 13, opacity: 0.6 }}>
            off = just {slot.name} · on = every screen in the venue
          </span>
        </span>
      </button>

      <button
        type="button"
        disabled={!message.trim() || send.isPending}
        onClick={() => { if (confirm(`Push "${message.trim()}" to ${target}?`)) send.mutate(); }}
        className="u-fill u-ink"
        style={{ ...primary, minHeight: 54, fontSize: 22, opacity: !message.trim() || send.isPending ? 0.5 : 1 }}
      >
        {send.isPending ? "SENDING…" : "■ PUSH TAKEOVER →"}
      </button>
      <div style={{ fontSize: 13, opacity: 0.6, textAlign: "center", letterSpacing: 1 }}>
        Scoped to <b style={{ color: "var(--terminal-green)" }}>{target}</b>.
      </div>
    </div>
  );
}

const miniLabel: CSSProperties = { fontSize: 12, letterSpacing: 2, opacity: 0.55 };
const bold: CSSProperties = { fontWeight: 700 };

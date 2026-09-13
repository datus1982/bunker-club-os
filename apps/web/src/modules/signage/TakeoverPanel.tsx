import { useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  sendTakeover, dismissTakeover, activeTakeoverForSlot,
  type AdminSlot, type AdminTakeover,
} from "./useSignageAdmin";
import { Countdown, ghost, primary, field, chip } from "./signageAdminShared";
import { ConfirmDialog, ToggleSwitch } from "@/shared/ui";
import { TAP } from "@/shared/ui/tokens";

/**
 * TAKEOVER panel (docs/signage-hub-consolidation-mockup.html view 5, D2) — the retired
 * BROADCAST tab's whole job, launched per-screen from a hub card's TAKEOVER button.
 *
 * Scoped to `slot` by default (writes screen_takeovers.slot_id = the slot); the ALL SCREENS
 * toggle sends venue-wide (slot_id null) — the old Broadcast behaviour. The public SlotDisplay
 * reader already scopes takeovers per slot (0045), so a scoped send lands on exactly one TV.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 4) — `variant`.
 *
 * A v2 page opens this panel outside the `[data-st-page]` token scope (it is SHARED with
 * the classic hub), so it arrived green. `variant="v2"` is the caller saying "token this
 * one": the frame is PR 1's `.st-sheet` drawer (mounted by HubOverlays), and the leaves
 * below swap their green literals for the token roles — the PR 2 template, leaf for leaf.
 *
 * ONE component, one tree, a `v2` branch at each LEAF. Every branched `style` is a
 * WHOLE-OBJECT ternary whose classic arm is the shipped object literal, key for key, so
 * classic's serialised `style` attribute does not even reorder.
 *
 * BEHAVIOUR IS BYTE-IDENTICAL: same `sendTakeover` / `dismissTakeover` calls with the same
 * args, same `slotId` scoping, same `busy` gating. The ONE addition is v2-only and
 * write-PREVENTING: the push guard is the ratified `ConfirmDialog` (plain tier — it changes
 * the bar TVs but is not data loss) instead of `window.confirm`. Classic keeps its
 * `confirm()`.
 * ──────────────────────────────────────────────────────────────────────────────────── */
const MONO = "'VT323','Share Tech Mono',monospace";

export function TakeoverPanel({
  slot, takeovers, onChanged, variant = "classic",
}: {
  slot: AdminSlot;
  takeovers: AdminTakeover[];
  onChanged: () => void;
  /** "v2" renders the tokened leaves (Beat 8 PR 4). Defaults to the shipped classic panel. */
  variant?: "classic" | "v2";
}) {
  const v2 = variant === "v2";
  // The takeover currently holding THIS screen (venue-wide or scoped to it) — same rule the TV
  // scopes by, so the panel's ON AIR state matches the screen.
  const active = activeTakeoverForSlot(takeovers, slot.id);

  const [message, setMessage] = useState("");
  const [sub, setSub] = useState("");
  const [duration, setDuration] = useState<number | null>(5);
  const [allScreens, setAllScreens] = useState(false);
  // v2 only — the push the ConfirmDialog is asking about.
  const [confirmPush, setConfirmPush] = useState(false);

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
  // v2 copy is sentence case; the slot name is authored data and stays as written.
  const targetV2 = allScreens ? "every screen" : slot.name;

  // v2 leaf kit (the PR 2 idiom). `u-ink` rides with `st-btn-primary` because the class
  // paints the BUTTON's ink and a child <span> would otherwise be caught by the `.st-sheet *`
  // text tier. `aria-pressed` is v2-only — classic markup stays frozen.
  const segCls = (on: boolean) => (v2 ? (on ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (on ? "u-fill u-ink" : ""));
  const pressed = (on: boolean) => (v2 ? { "aria-pressed": on } : null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 15, opacity: 0.65 }}>
        Overrides the screen instantly with a priority message. Use for LAST CALL, TRIVIA STARTS, a shout-out.
      </div>

      {active && (
        <div className={v2 ? "st-card" : "terminal-border"} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* v2: a takeover holding the screen is a true LIVE state — the reserved live ink. */}
          <div className={v2 ? "st-label st-live" : undefined} style={v2 ? undefined : { fontSize: 13, letterSpacing: 2, opacity: 0.6 }}>
            ■ ON AIR NOW{active.slot_id === null ? " · ALL SCREENS" : ` · ${slot.name}`}
          </div>
          <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? { fontWeight: 700 } : { fontSize: 24, fontWeight: 700 }}>{active.message}</div>
          {active.sub_message && <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 17, opacity: 0.8 }}>{active.sub_message}</div>}
          <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}><Countdown endsAt={active.ends_at} /></div>
          <button type="button" onClick={() => dismiss.mutate(active.id)} className={v2 ? "st-btn st-amber st-body" : "u-amber"} style={v2 ? { ...ghostV2, alignSelf: "flex-start" } : { ...ghost, alignSelf: "flex-start" }}>{v2 ? "Dismiss now" : "DISMISS NOW"}</button>
        </div>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : miniLabel}>MESSAGE</span>
        <input placeholder="LAST CALL — GET YOUR FINAL ROUND IN" value={message} onChange={(e) => setMessage(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? fieldV2 : field} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {/* v2 splits the Label role (uppercase by definition) from its lowercase hint. */}
        <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : miniLabel}>{v2 ? "SUB-MESSAGE" : "SUB-MESSAGE (optional)"}</span>
        {v2 && <span className="st-body st-t3">Optional second line</span>}
        <input placeholder="optional second line" value={sub} onChange={(e) => setSub(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? fieldV2 : field} />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? { marginRight: 2 } : { ...miniLabel, marginRight: 2 }}>HOLD FOR</span>
        {[2, 5, 10].map((m) => (
          <button key={m} type="button" onClick={() => setDuration(m)} {...pressed(duration === m)} className={segCls(duration === m)} style={v2 ? { ...chipV2, ...(duration === m ? bold : null) } : { ...chip, ...(duration === m ? bold : null) }}>{v2 ? `${m} min` : <>{m} MIN</>}</button>
        ))}
        <button type="button" onClick={() => setDuration(null)} {...pressed(duration === null)} className={segCls(duration === null)} style={v2 ? { ...chipV2, ...(duration === null ? bold : null) } : { ...chip, ...(duration === null ? bold : null) }}>{v2 ? "Until dismissed" : "UNTIL DISMISSED"}</button>
      </div>

      {/* ALL SCREENS toggle (D2): off = just this screen; on = venue-wide (old Broadcast). */}
      {v2 ? (
        // v2: the shared ToggleSwitch (the Users page's on/off idiom) — a native
        // `role=switch` checkbox with a readable ON/OFF word, on the 44px row.
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ToggleSwitch checked={allScreens} onChange={setAllScreens} label="All screens" />
          {/* The hint sits UNDER the switch row (not inside its label) so the row stays one
              line at 390 with the ON/OFF word and track beside it. */}
          <span className="st-body st-t3" style={{ padding: "0 12px" }}>Off = just {slot.name} · on = every screen in the venue</span>
        </div>
      ) : (
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
      )}

      <button
        type="button"
        disabled={!message.trim() || send.isPending}
        // v2 asks through the ratified ConfirmDialog (plain tier); classic keeps confirm().
        onClick={() => { if (v2) { setConfirmPush(true); return; } if (confirm(`Push "${message.trim()}" to ${target}?`)) send.mutate(); }}
        className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"}
        style={v2 ? { ...primaryV2, minHeight: 54, opacity: !message.trim() || send.isPending ? 0.5 : 1 } : { ...primary, minHeight: 54, fontSize: 22, opacity: !message.trim() || send.isPending ? 0.5 : 1 }}
      >
        {v2 ? (send.isPending ? "Sending…" : "■ Push takeover →") : (send.isPending ? "SENDING…" : "■ PUSH TAKEOVER →")}
      </button>
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? { textAlign: "center" } : { fontSize: 13, opacity: 0.6, textAlign: "center", letterSpacing: 1 }}>
        Scoped to <b className={v2 ? "st-body st-t1" : undefined} style={v2 ? undefined : { color: "var(--terminal-green)" }}>{v2 ? targetV2 : target}</b>.
      </div>

      {confirmPush && (
        <ConfirmDialog
          title="Push this takeover?"
          // DECISION: plain tier (owner ruling — it changes the bar TVs but is not data
          // loss); the body names the target the way the classic confirm() sentence did.
          body={`“${message.trim()}” goes onto ${targetV2} right now${duration === null ? " and stays until dismissed" : ` for ${duration} min`}.`}
          confirmLabel="Push to screens"
          cancelLabel="Keep drafting"
          busy={send.isPending}
          onConfirm={() => { setConfirmPush(false); send.mutate(); }}
          onCancel={() => setConfirmPush(false)}
        />
      )}
    </div>
  );
}

const miniLabel: CSSProperties = { fontSize: 12, letterSpacing: 2, opacity: 0.55 };
const bold: CSSProperties = { fontWeight: 700 };

/* v2 twins: the same boxes, geometry only. No `fontFamily` (the role classes own the
 * face), no `background`/`color` (an inline colour cannot beat the theme's !important
 * green — the classes are what actually paint), and `border: "1px solid"` with no colour
 * so the token blanket paints the hairline. `minWidth: TAP` joins `minHeight` because the
 * 44px floor is measured on BOTH axes (#103 NOTE-6). */
const fieldV2: CSSProperties = { padding: "10px 12px", minHeight: TAP, border: "1px solid", width: "100%", boxSizing: "border-box" };
const chipV2: CSSProperties = { padding: "8px 12px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer" };
const ghostV2: CSSProperties = { padding: "8px 12px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer" };
const primaryV2: CSSProperties = { padding: "10px 18px", minWidth: TAP, minHeight: TAP, border: "1px solid", fontWeight: 700, cursor: "pointer" };

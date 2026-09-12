import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ConfirmDialog, EmptyState, FormField, ListRow, StaffPageHeader, StatusChip,
} from "@/shared/ui";
import type { AvailableGroup, Config, ConfiguredGroup } from "./drinksAdminShared";

/**
 * /admin/drinks (nav label TOP SELLERS), v2 presentation — UX overhaul Beat 3.
 *
 * PRESENTATION ONLY. Every query, mutation and Supabase call lives in `DrinksAdmin.tsx`
 * and arrives here as a callback; this file must never touch the client. Classic renders
 * byte-identically to before — this view only exists when `ui_version` is `v2` (RULE #1).
 *
 * What changes, and why:
 *  • The page `<h1>` becomes the shared StaffPageHeader, so this page carries the same
 *    eyebrow/title/tag as every other v2 staff screen.
 *  • Each rotation group becomes a ListRow — the phone stacks it instead of squeezing a
 *    name and four controls onto one 390px line (audit findings #1/#2).
 *  • REMOVE asks first. Classic deletes a group on a single tap with NO confirmation at
 *    all (there is no window.confirm on this page) — a mis-tap on a phone silently drops
 *    a rotation group. DECISION (tagged): v2 puts the ratified ConfirmDialog in front of
 *    it. This is the one behavioural ADDITION in this view; it only ever prevents a
 *    write, never performs one, and classic is left exactly as it is.
 *  • The add-group picker becomes one FormField + ADD instead of a wrapping row of
 *    "+ Group" buttons (at 20 discovered groups that row was the page's worst phone
 *    overflow risk). Same `onAdd` payload: guid + name.
 *
 * DECISION (tagged): ToggleSwitch is NOT used here. The audit's "any on/off →
 * ToggleSwitch" applies to the DISPLAY form, and `drinks_display_config` has no boolean
 * at all (header/footer text, a mode enum, two intervals). The per-group on/off keeps the
 * spec'd shape — a StatusChip that reports state plus the same ON/OFF button that
 * classic's `toggleGroup` mutation is wired to.
 *
 * BEAT 6 (PR 1) — token pass, presentation only:
 *  • the page root carries `data-st-page`, the opt-in hook the token sheet hangs off;
 *  • text sizes/colour come from the type-role + tier classes (an inline colour can
 *    never beat `.terminal-theme * { color: green !important }`);
 *  • the DOUBLED state readout is gone (audit A3): the row reported ON twice — once as
 *    a StatusChip and again as the `● ON` button's own label. The chip keeps the state
 *    (top-right, where every v2 row reports state) and the button becomes a VERB
 *    ("Turn off" / "Turn on"). Same `onToggle` call, same mutation, nothing else moved.
 *
 * BEAT 6 (PR 3) — the danger pattern (§B "Danger language", owner letter D1 as amended):
 *  • REMOVE leaves the ▲▼/Turn-off cluster entirely. Those three are reversible, routine
 *    controls; a destructive one must not read as their same-weight peer (the "danger has
 *    no geography" failure mode). Each group row now ends in its own footer strip under a
 *    hairline holding ONE red, VERB-named control: "Remove group".
 *  • Red, not the calmed amber it used to borrow: amber is this system's ambient/pending
 *    ink (it is what "OFF TODAY" and "sync stale" are painted in), so spending it on the
 *    one destructive control made the two indistinguishable at a glance.
 *  • The ratified ConfirmDialog stays (PR #103's DECISION; D1's text-swap/hold variants
 *    were ruled out for Beat 6). Its buttons are now verb-named too — "Remove group" /
 *    "Keep group", never a bare REMOVE and never Yes/No — so the confirm answers the
 *    question it asks. Same `onRemove(id)` call, same single mutation in DrinksAdmin.tsx.
 *  • The OFF chip moves to the `neutral` tone (Secondary tier). PR 1 put it on the
 *    Disabled tier via `off`; here the chip is the readable state of a control someone
 *    came to check, not de-emphasis — see the tone note in StatusChip.
 *
 * Sizes are inline px: nothing inherits font-size under `.terminal-theme` (PR #89).
 */
export function DrinksAdminV2({
  configured,
  addable,
  cfg,
  cfgLoaded,
  cfgFailed,
  narrow,
  msg,
  saving,
  onAdd,
  onToggle,
  onRemove,
  onMove,
  onSave,
}: {
  configured: ConfiguredGroup[];
  addable: Pick<AvailableGroup, "toast_menu_guid" | "name">[];
  cfg: Config;
  /** False until the saved config has loaded — the form must not seed from defaults. */
  cfgLoaded: boolean;
  /** The saved-config read failed — never seed the form from defaults in that state. */
  cfgFailed: boolean;
  /** Phone (<640px) — from the page's shared useIsMobile, so there is ONE breakpoint. */
  narrow: boolean;
  msg: string | null;
  saving: boolean;
  onAdd: (g: { toast_menu_guid: string; name: string }) => void;
  onToggle: (g: ConfiguredGroup) => void;
  onRemove: (id: string) => void;
  onMove: (g: ConfiguredGroup, dir: -1 | 1) => void;
  onSave: (c: Config) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState<ConfiguredGroup | null>(null);
  const [pick, setPick] = useState("");
  const enabled = configured.filter((g) => g.enabled).length;

  return (
    <div data-st-page="" style={{ padding: "24px clamp(16px, 4vw, 48px) 48px", maxWidth: 900, margin: "0 auto" }}>
      <StaffPageHeader
        eyebrow="BAR OPS ▸ TOP SELLERS"
        title="Top Sellers"
        tag={`${enabled} OF ${configured.length} GROUP${configured.length === 1 ? "" : "S"} ON`}
        right={
          <>
            <Link to="/drinks" className="st-btn st-body st-t2" style={linkBtn}>Open board</Link>
            <Link to="/dashboard" className="st-btn st-body st-t2" style={linkBtn}>Dashboard</Link>
          </>
        }
      />
      <p className="st-body st-t2" style={intro}>
        Toast credentials are server-side only — nothing sensitive is entered here. Sales refresh
        automatically from the scheduled sync.
      </p>

      {/* ── ROTATION GROUPS ─────────────────────────────────────────────── */}
      <div className="st-label st-t2" style={sectionLabel}>ROTATION GROUPS</div>
      {configured.length === 0 ? (
        <EmptyState
          eyebrow="NO GROUPS YET"
          message="Add one below. The board shows a group once the sync has sales for it."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {configured.map((g, i, arr) => (
            <ListRow
              key={g.id}
              stacked={narrow}
              title={`${g.name}${g.toast_menu_guid === "MAIN_MENU_ALL" ? " ★" : ""}`}
              meta={<StatusChip tone={g.enabled ? "info" : "neutral"} dot={g.enabled} label={g.enabled ? "ON" : "OFF"} />}
              actions={
                <>
                  <button type="button" className="st-btn st-body" style={btn} onClick={() => onMove(g, -1)} disabled={i === 0} aria-label={`Move ${g.name} up`}>▲</button>
                  <button type="button" className="st-btn st-body" style={btn} onClick={() => onMove(g, 1)} disabled={i === arr.length - 1} aria-label={`Move ${g.name} down`}>▼</button>
                  {/* VERB, not a second state readout — the StatusChip in `meta` owns the state. */}
                  <button type="button" className="st-btn st-body" style={btn} onClick={() => onToggle(g)}>{g.enabled ? "Turn off" : "Turn on"}</button>
                </>
              }
              footer={
                // The row's own danger zone: a hairline, a quiet kicker, and one red verb.
                // Nothing reversible may join it (§B geography).
                <>
                  <span className="st-label st-t2">DANGER ZONE</span>
                  <button type="button" className="st-btn st-btn-danger st-body" style={btnDanger} onClick={() => setConfirmRemove(g)}>
                    Remove group
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}

      <form
        style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          const g = addable.find((a) => a.toast_menu_guid === pick);
          if (g) { onAdd({ toast_menu_guid: g.toast_menu_guid, name: g.name }); setPick(""); }
        }}
      >
        <FormField
          label="ADD A GROUP"
          hint={addable.length === 0 ? "All discovered groups added. (Run the sync to discover more.)" : undefined}
          style={{ flex: "1 1 260px", minWidth: 0 }}
        >
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={addable.length === 0}>
            <option value="" style={{ background: "#000" }}>— pick a group —</option>
            {addable.map((g) => (
              <option key={g.toast_menu_guid} value={g.toast_menu_guid} style={{ background: "#000" }}>{g.name}</option>
            ))}
          </select>
        </FormField>
        <button type="submit" disabled={!pick} className={pick ? "st-btn st-btn-primary st-body" : "st-btn st-body"} style={btn}>+ Add</button>
      </form>

      {/* ── DISPLAY ─────────────────────────────────────────────────────── */}
      <div className="terminal-separator" style={{ margin: "26px 0 16px" }} />
      <div className="st-label st-t2" style={sectionLabel}>DISPLAY</div>
      {cfgLoaded
        ? <ConfigFormV2 initial={cfg} onSave={onSave} busy={saving} />
        : cfgFailed
          ? <p className="st-body st-amber">Could not load saved settings — reload the page before editing.</p>
          : <p className="st-body st-t2">Loading saved settings…</p>}
      {msg && <div className="st-body st-t2" style={{ marginTop: 12 }}>{msg}</div>}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove this group?"
          body={<>“{confirmRemove.name}” stops rotating on the TOP SELLERS board. Nothing in Toast changes — you can add the group back from the picker.</>}
          confirmLabel="Remove group"
          cancelLabel="Keep group"
          danger
          onConfirm={() => { onRemove(confirmRemove.id); setConfirmRemove(null); }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

/** The DISPLAY settings form on the shared FormField. Same fields, same parsing, same
 *  `onSave(Config)` payload as classic's ConfigForm — only the boxes are shared now. */
function ConfigFormV2({ initial, onSave, busy }: { initial: Config; onSave: (c: Config) => void; busy: boolean }) {
  const [c, setC] = useState<Config>(initial);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(c); }}
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}
    >
      <FormField label="HEADER TEXT">
        <input value={c.header_text} onChange={(e) => setC({ ...c, header_text: e.target.value })} />
      </FormField>
      <FormField label="FOOTER TEXT">
        <input value={c.footer_text} onChange={(e) => setC({ ...c, footer_text: e.target.value })} />
      </FormField>
      <FormField label="MODE">
        <select value={c.display_mode} onChange={(e) => setC({ ...c, display_mode: e.target.value })}>
          <option value="rotate" style={{ background: "#000" }}>rotate</option>
          <option value="single" style={{ background: "#000" }}>single (first group)</option>
        </select>
      </FormField>
      <FormField label="ROTATE EVERY (SECONDS)">
        <input type="number" min={3} value={c.auto_rotate_seconds} onChange={(e) => setC({ ...c, auto_rotate_seconds: parseInt(e.target.value) || 10 })} />
      </FormField>
      <FormField label="SYNC CADENCE HINT (SECONDS)" hint="How often the board re-reads the sync cache.">
        <input type="number" min={30} value={c.refresh_interval} onChange={(e) => setC({ ...c, refresh_interval: parseInt(e.target.value) || 60 })} />
      </FormField>
      <button type="submit" disabled={busy} className="st-btn st-btn-primary st-body" style={{ ...btn, alignSelf: "flex-start" }}>
        {busy ? "Saving…" : "Save display config"}
      </button>
    </form>
  );
}

/* Geometry only — size/colour ride the token classes (`st-label`, `st-body`, `st-btn`). */
const sectionLabel: CSSProperties = { margin: "0 0 10px" };
const intro: CSSProperties = { margin: "0 0 22px" };
const btn: CSSProperties = {
  padding: "0 16px", minHeight: 44, minWidth: 44, cursor: "pointer",
};
const btnDanger: CSSProperties = { ...btn };
const linkBtn: CSSProperties = {
  ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center",
};

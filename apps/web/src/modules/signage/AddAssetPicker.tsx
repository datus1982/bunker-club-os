import { useState } from "react";
import type { Template, ToastCacheRow } from "./useSignage";
import type { AdminItem, AdminSlot, AssetWithPlacements } from "./useSignageAdmin";
import { ITEM_TEMPLATES } from "./ItemEditor";
import { summarize, templateIcon, templateBadge, isSmartTemplate } from "./signageAdminShared";
import { TAP } from "@/shared/ui/tokens";

/**
 * + ADD picker (docs/signage-hub-consolidation-mockup.html view 3, D6) — the one-click add
 * launched from a screen card. Two paths, one tap either way:
 *   • NEW ASSET   — template tiles; picking one opens the asset editor pre-set to that
 *     template with this screen as the destination (queued on save).
 *   • FROM LIBRARY — assets NOT already on this screen; picking one queues it here (append).
 *     Assets already queued here show greyed as "ON THIS SCREEN" (D6) — never re-added.
 *
 * This is what makes "the same asset on both screens, different queues" a single tap.
 *
 * BEAT 8 (PR 3) — `variant`. Shared with the classic hub and mounted outside the
 * `[data-st-page]` scope, so a v2 page opened it green. `variant="v2"` tokens the leaves
 * (the PR 2 pattern: one tree, a `v2` branch per leaf, whole-object `style` ternaries whose
 * classic arm is the shipped literal key for key). Same two callbacks, same args:
 * `onPickTemplate` still opens the slide editor (PR 5's territory — until PR 5 lands that
 * editor renders CLASSIC on top of this v2 sheet, by design), `onQueueExisting` still hands
 * the page its own `queueExisting` mutation. The active tab carries `aria-pressed` on v2.
 */
const MONO = "'VT323','Share Tech Mono',monospace";

type Tab = "new" | "library";

export function AddAssetPicker({
  slot, assets, toastRows, busyItemId, onPickTemplate, onQueueExisting, variant = "classic",
}: {
  slot: AdminSlot;
  assets: AssetWithPlacements[];
  toastRows: ToastCacheRow[];
  /** id of an asset currently being queued (row shows QUEUEING…). */
  busyItemId: string | null;
  onPickTemplate: (t: Template) => void;
  onQueueExisting: (a: AssetWithPlacements) => void;
  /** "v2" renders the tokened leaves (Beat 8 PR 3). Defaults to the shipped classic picker. */
  variant?: "classic" | "v2";
}) {
  const v2 = variant === "v2";
  const [tab, setTab] = useState<Tab>("new");

  // Library assets not yet on THIS screen come first (the actionable ones); already-queued
  // ones follow, greyed. Idle assets (no placements) are eligible everywhere.
  const onThisScreen = (a: AssetWithPlacements) => a.placements.some((p) => p.slot_id === slot.id);
  const available = assets.filter((a) => !onThisScreen(a));
  const already = assets.filter(onThisScreen);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* tabs */}
      <div style={{ display: "flex", gap: 8 }}>
        <TabBtn v2={v2} on={tab === "new"} onClick={() => setTab("new")}>{v2 ? "New asset" : "NEW ASSET"}</TabBtn>
        <TabBtn v2={v2} on={tab === "library"} onClick={() => setTab("library")}>{v2 ? "From library" : "FROM LIBRARY"}</TabBtn>
      </div>

      {tab === "new" ? (
        <div>
          {/* v2: this line carries the screen's NAME, so it is Body (sentence case) rather
              than a Label — `text-transform: uppercase` would shout "Bar TV" as "BAR TV". */}
          {v2
            ? <div className="st-body st-t2" style={{ marginBottom: 9 }}>Create a new asset and queue it on {slot.name}</div>
            : <div style={label}>CREATE A NEW ASSET AND QUEUE IT ON {slot.name}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            {ITEM_TEMPLATES.map((t) => (
              // DECISION: (Beat 8 PR 3) a SMART tile keeps its amber edge on v2 via
              // `st-callout-warn` — the only amber-edge class the sheet scope defines (an
              // inline borderColor loses to `.st-sheet button { border-color: … !important }`),
              // and the label alone takes `st-amber`, as classic paints label + edge only.
              <button key={t.key} type="button" onClick={() => onPickTemplate(t.key)}
                className={v2 ? (isSmartTemplate(t.key) ? "st-btn st-body st-callout-warn" : "st-btn st-body") : undefined}
                style={v2 ? tileV2 : { ...tile, ...(isSmartTemplate(t.key) ? smartTile : null) }}>
                <span style={{ fontSize: 26 }}>{t.icon}</span>
                <span className={v2 ? (isSmartTemplate(t.key) ? "st-heading st-amber" : "st-heading") : undefined} style={v2 ? { fontWeight: 700 } : { fontSize: 16, fontWeight: 700, letterSpacing: 1, ...(isSmartTemplate(t.key) ? { color: "var(--terminal-amber, #ffb000)" } : null) }}>{t.label}</span>
                <span className={v2 ? "st-body st-t2" : undefined} style={v2 ? { lineHeight: 1.35 } : { fontSize: 12, opacity: 0.6, lineHeight: 1.35 }}>{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {v2
            ? <div className="st-body st-t2" style={{ marginBottom: 9 }}>Pull one you already built (not yet on this screen)</div>
            : <div style={label}>PULL ONE YOU ALREADY BUILT (NOT YET ON THIS SCREEN)</div>}
          {available.length === 0 && already.length === 0 ? (
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { padding: "8px 0" } : { opacity: 0.6, fontSize: 16, padding: "8px 0" }}>
              {v2 ? "No assets in the library yet — build one from the New asset tab." : "No assets in the library yet — build one from the NEW ASSET tab."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {available.map((a) => (
                <LibraryRow key={a.asset.id} v2={v2} a={a} toastRows={toastRows} slot={slot} busy={busyItemId === a.asset.id} onQueue={() => onQueueExisting(a)} />
              ))}
              {available.length === 0 && (
                <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? { padding: "4px 0" } : { opacity: 0.6, fontSize: 15, padding: "4px 0" }}>Every asset is already on this screen.</div>
              )}
              {already.map((a) => (
                <LibraryRow key={a.asset.id} v2={v2} a={a} toastRows={toastRows} slot={slot} here busy={false} onQueue={() => {}} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LibraryRow({
  a, toastRows, slot, here, busy, onQueue, v2 = false,
}: {
  a: AssetWithPlacements;
  toastRows: ToastCacheRow[];
  slot: AdminSlot;
  here?: boolean;
  busy: boolean;
  onQueue: () => void;
  v2?: boolean;
}) {
  const item = a.asset as unknown as AdminItem;
  const name = summarize(item, toastRows);
  const where = a.placements.length === 0
    ? "idle — not on any screen"
    : `on ${a.placements.length} screen${a.placements.length === 1 ? "" : "s"}`;

  return (
    <div className={v2 ? "st-row" : "terminal-border"} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", opacity: here ? 0.5 : 1 }}>
      <span className={v2 ? "st-box" : undefined} style={v2 ? thumbV2 : thumb}>{templateIcon(item.template)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { fontSize: 19, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 12, opacity: 0.6 }}>{templateBadge(item.template).toLowerCase()} · {here ? "already queued here" : where}</div>
      </div>
      {here ? (
        <span className={v2 ? "st-chip st-label st-t3" : undefined} style={v2 ? { whiteSpace: "nowrap", padding: "6px 10px" } : { fontSize: 13, letterSpacing: 1, opacity: 0.6, whiteSpace: "nowrap", border: "1px solid var(--terminal-green)", padding: "6px 10px" }}>ON THIS SCREEN</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onQueue}
          className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"}
          title={`Queue on ${slot.name}`}
          style={v2 ? { fontWeight: 700, padding: "7px 12px", border: "1px solid", cursor: "pointer", whiteSpace: "nowrap", minHeight: TAP, minWidth: TAP, opacity: busy ? 0.5 : 1 } : { fontSize: 14, letterSpacing: 1, fontWeight: 700, padding: "7px 12px", background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap", minHeight: 44, opacity: busy ? 0.5 : 1 }}
        >
          {v2 ? (busy ? "Queueing…" : "+ Queue") : (busy ? "QUEUEING…" : "+ QUEUE")}
        </button>
      )}
    </div>
  );
}

function TabBtn({ on, onClick, children, v2 = false }: { on: boolean; onClick: () => void; children: React.ReactNode; v2?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // v2: a segmented control — `aria-pressed` says which tab is current (the fill said it
      // to sighted users only); `u-ink` rides with `st-btn-primary` for the label ink.
      {...(v2 ? { "aria-pressed": on } : null)}
      className={v2 ? (on ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (on ? "u-fill u-ink" : "")}
      style={v2 ? {
        flex: 1, textAlign: "center", padding: "10px", border: "1px solid",
        fontWeight: on ? 700 : 400, cursor: "pointer", minHeight: TAP, minWidth: TAP,
      } : {
        flex: 1, textAlign: "center", fontSize: 15, letterSpacing: 2, padding: "10px",
        border: "1px solid var(--terminal-green)", background: on ? "var(--terminal-green)" : "transparent",
        color: on ? "#000" : "var(--terminal-green)", fontWeight: on ? 700 : 400, cursor: "pointer",
        fontFamily: MONO, minHeight: 44,
      }}
    >
      {children}
    </button>
  );
}

const label = { fontSize: 12, letterSpacing: 2, opacity: 0.6, marginBottom: 9 } as const;
const tile = {
  display: "flex", flexDirection: "column" as const, gap: 5, alignItems: "flex-start" as const,
  textAlign: "left" as const, padding: "12px 11px", background: "transparent", color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", cursor: "pointer", fontFamily: MONO, minHeight: 96,
};
const smartTile = { borderColor: "var(--terminal-amber, #ffb000)" };
const thumb = {
  width: 36, height: 36, border: "1px solid var(--terminal-green)", display: "flex",
  alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, background: "#030803",
} as const;

/* v2 twins — geometry only (the role classes own ink, face and size; an inline colour
 * cannot beat the theme's !important green). `border: "1px solid"` with no colour lets the
 * sheet blanket paint the hairline; `minWidth: TAP` because the 44px floor is both axes. */
const tileV2 = {
  display: "flex", flexDirection: "column" as const, gap: 5, alignItems: "flex-start" as const,
  textAlign: "left" as const, padding: "12px 11px", border: "1px solid", cursor: "pointer", minHeight: 96, minWidth: TAP,
};
const thumbV2 = {
  width: 36, height: 36, border: "1px solid", display: "flex",
  alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
} as const;

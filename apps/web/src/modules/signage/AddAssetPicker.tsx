import { useState } from "react";
import type { Template, ToastCacheRow } from "./useSignage";
import type { AdminItem, AdminSlot, AssetWithPlacements } from "./useSignageAdmin";
import { ITEM_TEMPLATES } from "./ItemEditor";
import { summarize, templateIcon, templateBadge, isSmartTemplate } from "./signageAdminShared";

/**
 * + ADD picker (docs/signage-hub-consolidation-mockup.html view 3, D6) — the one-click add
 * launched from a screen card. Two paths, one tap either way:
 *   • NEW ASSET   — template tiles; picking one opens the asset editor pre-set to that
 *     template with this screen as the destination (queued on save).
 *   • FROM LIBRARY — assets NOT already on this screen; picking one queues it here (append).
 *     Assets already queued here show greyed as "ON THIS SCREEN" (D6) — never re-added.
 *
 * This is what makes "the same asset on both screens, different queues" a single tap.
 */
const MONO = "'VT323','Share Tech Mono',monospace";

type Tab = "new" | "library";

export function AddAssetPicker({
  slot, assets, toastRows, busyItemId, onPickTemplate, onQueueExisting,
}: {
  slot: AdminSlot;
  assets: AssetWithPlacements[];
  toastRows: ToastCacheRow[];
  /** id of an asset currently being queued (row shows QUEUEING…). */
  busyItemId: string | null;
  onPickTemplate: (t: Template) => void;
  onQueueExisting: (a: AssetWithPlacements) => void;
}) {
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
        <TabBtn on={tab === "new"} onClick={() => setTab("new")}>NEW ASSET</TabBtn>
        <TabBtn on={tab === "library"} onClick={() => setTab("library")}>FROM LIBRARY</TabBtn>
      </div>

      {tab === "new" ? (
        <div>
          <div style={label}>CREATE A NEW ASSET AND QUEUE IT ON {slot.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            {ITEM_TEMPLATES.map((t) => (
              <button key={t.key} type="button" onClick={() => onPickTemplate(t.key)} style={{ ...tile, ...(isSmartTemplate(t.key) ? smartTile : null) }}>
                <span style={{ fontSize: 26 }}>{t.icon}</span>
                <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, ...(isSmartTemplate(t.key) ? { color: "var(--terminal-amber, #ffb000)" } : null) }}>{t.label}</span>
                <span style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.35 }}>{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div style={label}>PULL ONE YOU ALREADY BUILT (NOT YET ON THIS SCREEN)</div>
          {available.length === 0 && already.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 16, padding: "8px 0" }}>
              No assets in the library yet — build one from the NEW ASSET tab.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {available.map((a) => (
                <LibraryRow key={a.asset.id} a={a} toastRows={toastRows} slot={slot} busy={busyItemId === a.asset.id} onQueue={() => onQueueExisting(a)} />
              ))}
              {available.length === 0 && (
                <div style={{ opacity: 0.6, fontSize: 15, padding: "4px 0" }}>Every asset is already on this screen.</div>
              )}
              {already.map((a) => (
                <LibraryRow key={a.asset.id} a={a} toastRows={toastRows} slot={slot} here busy={false} onQueue={() => {}} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LibraryRow({
  a, toastRows, slot, here, busy, onQueue,
}: {
  a: AssetWithPlacements;
  toastRows: ToastCacheRow[];
  slot: AdminSlot;
  here?: boolean;
  busy: boolean;
  onQueue: () => void;
}) {
  const item = a.asset as unknown as AdminItem;
  const name = summarize(item, toastRows);
  const where = a.placements.length === 0
    ? "idle — not on any screen"
    : `on ${a.placements.length} screen${a.placements.length === 1 ? "" : "s"}`;

  return (
    <div className="terminal-border" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", opacity: here ? 0.5 : 1 }}>
      <span style={thumb}>{templateIcon(item.template)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 19, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>{templateBadge(item.template).toLowerCase()} · {here ? "already queued here" : where}</div>
      </div>
      {here ? (
        <span style={{ fontSize: 13, letterSpacing: 1, opacity: 0.6, whiteSpace: "nowrap", border: "1px solid var(--terminal-green)", padding: "6px 10px" }}>ON THIS SCREEN</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onQueue}
          className="u-fill u-ink"
          title={`Queue on ${slot.name}`}
          style={{ fontSize: 14, letterSpacing: 1, fontWeight: 700, padding: "7px 12px", background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap", minHeight: 44, opacity: busy ? 0.5 : 1 }}
        >
          {busy ? "QUEUEING…" : "+ QUEUE"}
        </button>
      )}
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={on ? "u-fill u-ink" : ""}
      style={{
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

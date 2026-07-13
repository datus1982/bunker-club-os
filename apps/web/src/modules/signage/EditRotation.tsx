import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  useAdminSlots, useAllItems, useToastCache,
  screenHealth,
  type AdminItem,
} from "./useSignageAdmin";
import {
  MONO, SectionLabel, HealthDot, KioskUrl, ItemRow, sourceHideReason, ghost, primary,
} from "./signageAdminShared";
import { ItemEditor } from "./ItemEditor";
import "./signage.css";

/**
 * /signage/screens/:slug — EDIT ROTATION for a single screen. This is the old single-page
 * templater's per-slot item list (add / edit / delete / reorder / active-toggle, with OOS +
 * POS hide reasons), now scoped to ONE slot and reached from the Signage Hub. The list
 * behaviour + ItemEditor are unchanged — only the framing (back link, slot header, health,
 * kiosk URL) is new. Mobile-first: one column, ≥44px controls.
 */
export function EditRotation() {
  const { slug = "" } = useParams();
  const qc = useQueryClient();
  const slotsQ = useAdminSlots();
  const itemsQ = useAllItems();
  const toastQ = useToastCache();

  const slot = (slotsQ.data ?? []).find((s) => s.slug === slug) ?? null;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminItem | null>(null);

  const slotItems = useMemo(() => {
    if (!slot) return [];
    return (itemsQ.data ?? [])
      .filter((it) => it.slot_id === slot.id)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [itemsQ.data, slot]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["signage-admin", "items"] });
  };
  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (it: AdminItem) => { setEditing(it); setEditorOpen(true); };

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <Link to="/signage" style={{ ...ghost, textDecoration: "none", fontSize: 16, display: "inline-block", marginBottom: 12 }}>← SIGNAGE HUB</Link>

        {slotsQ.isLoading ? (
          <div style={{ fontSize: 20 }}>LOADING SLOT…</div>
        ) : !slot ? (
          <div style={{ opacity: 0.7, fontSize: 20 }}>
            No slot with slug “{slug}”. <Link to="/signage" style={{ textDecoration: "underline" }}>Back to the hub.</Link>
          </div>
        ) : (
          <>
            {/* ── slot header: name · health · kiosk URL ── */}
            <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BAR OPS · SIGNAGE ▸ EDIT ROTATION</div>
            <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "clamp(26px,5vw,38px)", fontWeight: 700, letterSpacing: 2 }}>{slot.name}</h1>
                <HealthDot health={screenHealth(slot.last_seen)} />
              </div>
              <div style={{ fontSize: 14, opacity: 0.65 }}>
                {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
              </div>
              <KioskUrl slug={slot.slug} />
              <a href={`/signage/s/${slot.slug}?preview=1`} target="_blank" rel="noreferrer" title="Staff preview only — NEVER point a TV at a ?preview=1 URL (it never shows takeovers or game mode)." style={{ ...ghost, textDecoration: "none", fontSize: 15, padding: "6px 10px", alignSelf: "flex-start" }}>
                PREVIEW (rotation only) →
              </a>
            </div>

            {/* ── item list ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 26 }}>
              <SectionLabel style={{ margin: 0 }}>ROTATION ITEMS</SectionLabel>
              <button type="button" onClick={openNew} className="u-fill u-ink" style={primary}>+ ADD ITEM</button>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {slotItems.length === 0 && <div style={{ opacity: 0.6, fontSize: 18 }}>No items yet — ADD ITEM to build this screen’s rotation.</div>}
              {slotItems.map((it, i, arr) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  first={i === 0}
                  last={i === arr.length - 1}
                  hideReason={sourceHideReason(it, toastQ.data)}
                  onEdit={() => openEdit(it)}
                  onChanged={invalidate}
                  prev={arr[i - 1]}
                  next={arr[i + 1]}
                />
              ))}
            </div>
            <div style={{ fontSize: 14, opacity: 0.55, marginTop: 12 }}>
              ★ SCREENS items flipped In-Stock at the POS also rotate here automatically — manage those at the register, not here.
            </div>
          </>
        )}
      </div>

      {editorOpen && slot && (
        <ItemEditor
          slots={slotsQ.data ?? []}
          toastRows={toastQ.data ?? []}
          defaultSlotId={slot.id}
          editing={editing}
          nextSortOrder={(targetSlotId) => {
            // Append after the target slot's current max sort_order (not the row count —
            // a count collides once a delete has left a gap). The editor's SLOT dropdown
            // can reassign, so compute against the chosen slot, not just this page's slot.
            const inTarget = (itemsQ.data ?? []).filter((i) => i.slot_id === targetSlotId);
            return inTarget.length ? Math.max(...inTarget.map((i) => i.sort_order)) + 1 : 0;
          }}
          onClose={() => setEditorOpen(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

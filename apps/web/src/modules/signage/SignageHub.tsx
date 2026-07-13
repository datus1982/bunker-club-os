import { useMemo, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  useAdminSlots, useAllItems, useTakeovers, useToastCache, useScheduledEvents,
  screenHealth, activeTakeover, featuredItems, toastMap,
  type AdminItem, type AdminSlot, type ScheduledEvent,
} from "./useSignageAdmin";
import {
  resolveRotation, resolveSlotMode,
  type SlotMode, type SignageItem, type ToastCacheRow, type Template,
} from "./useSignage";
import { useTonight } from "@/modules/dashboard/useDashboard";
import {
  MONO, SectionLabel, HealthDot, CopyKioskButton,
  ghost, badge, summarize, scheduleLabel, recurrencePhrase,
} from "./signageAdminShared";
import { ItemEditor } from "./ItemEditor";
import "./signage.css";

/**
 * /signage — the SIGNAGE HUB (docs/ux-refinement-mockup.html view 2/4, owner-ratified).
 * The landing answers "what is the room showing right NOW", then gives the actions to
 * change it, then everything scheduled. The old per-slot templater moved one level down to
 * /signage/screens/:slug (EDIT ROTATION); BROADCAST moved to /signage/broadcast.
 *
 * Sections: A ON AIR NOW (live screen cards) · B quick actions · C RUNNING & UPCOMING ·
 * D ★ FEATURED ON POS (read-only). Mobile-first — the owner runs this from his phone.
 */
export function SignageHub() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const slotsQ = useAdminSlots();
  const itemsQ = useAllItems();
  const takeoversQ = useTakeovers();
  const toastQ = useToastCache();
  const eventsQ = useScheduledEvents();
  const tonightQ = useTonight();

  const slots = slotsQ.data ?? [];
  const items = itemsQ.data ?? [];
  const toastRows = toastQ.data ?? [];
  const tmap = useMemo(() => toastMap(toastRows), [toastRows]);

  // Mode ladder inputs are venue-wide (a takeover and a live game each override EVERY
  // screen), so every slot resolves to the same mode — the same precedence SlotDisplay
  // renders (resolveSlotMode is the single source of that ladder).
  const active = activeTakeover(takeoversQ.data ?? []);
  const tonight = tonightQ.data ?? null;
  const liveGame = !!tonight && (tonight.status === "active" || tonight.status === "paused");
  const mode: SlotMode = resolveSlotMode({ takeover: !!active, liveGame });

  // Quick-action editor: preset a template, skip the picker.
  const [editorOpen, setEditorOpen] = useState(false);
  const [preset, setPreset] = useState<Template | null>(null);
  const openQuick = (template: Template) => { setPreset(template); setEditorOpen(true); };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["signage-admin", "items"] });
    qc.invalidateQueries({ queryKey: ["signage-admin", "takeovers"] });
  };

  const itemsBySlot = useMemo(() => {
    const m = new Map<string | null, AdminItem[]>();
    for (const it of items) {
      if (!m.has(it.slot_id)) m.set(it.slot_id, []);
      m.get(it.slot_id)!.push(it);
    }
    return m;
  }, [items]);

  const [editItem, setEditItem] = useState<AdminItem | null>(null);
  const openEdit = (it: AdminItem) => { setEditItem(it); setPreset(null); setEditorOpen(true); };

  // RUNNING & UPCOMING: signage_items with a schedule/recurrence + any scheduled_events.
  const scheduledItems = useMemo(
    () => items.filter((it) => it.recurrence || it.starts_at || it.ends_at),
    [items],
  );
  const events = eventsQ.data ?? [];
  const nothingScheduled = scheduledItems.length === 0 && events.length === 0;

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BAR OPS ▸ SIGNAGE HUB</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: "clamp(28px,6vw,44px)", fontWeight: 700, letterSpacing: 2 }}>SIGNAGE HUB</h1>
          <Link to="/dashboard" style={{ ...ghost, textDecoration: "none", fontSize: 16 }}>← DASHBOARD</Link>
        </div>
        <div className="terminal-separator" style={{ margin: "12px 0 20px" }} />

        {/* ── A · ON AIR NOW ─────────────────────────────────────────────── */}
        <SectionLabel>◉ ON AIR NOW · what the room is showing this second</SectionLabel>
        {slotsQ.isLoading ? (
          <div style={{ fontSize: 20 }}>LOADING SCREENS…</div>
        ) : slots.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No screens provisioned. Seed one in signage_slots.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,300px),1fr))", gap: 12 }}>
            {slots.map((s) => (
              <ScreenCard
                key={s.id}
                slot={s}
                mode={mode}
                takeoverMessage={active?.message ?? null}
                slotItems={itemsBySlot.get(s.id) ?? []}
                tmap={tmap}
              />
            ))}
          </div>
        )}

        {/* ── B · QUICK ACTIONS ──────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={() => openQuick("drink_special")} className="u-fill u-ink" style={quickPrimary}>★ PROMO A DRINK</button>
          <button type="button" onClick={() => openQuick("announcement")} style={quickBtn}>📅 SCHEDULE A MESSAGE</button>
          <button type="button" onClick={() => navigate("/signage/broadcast")} style={quickBtn}>📢 BROADCAST NOW</button>
        </div>
        <div style={{ fontSize: 13, opacity: 0.5, textAlign: "center", marginTop: 8, letterSpacing: 1 }}>
          THE MANAGER TEST — promo a drink or schedule a message in minutes, from your phone at the bar.
        </div>

        {/* ── C · RUNNING & UPCOMING ─────────────────────────────────────── */}
        <div style={{ marginTop: 30 }}>
          <SectionLabel>RUNNING &amp; UPCOMING · promos &amp; events, live and scheduled</SectionLabel>
          {eventsQ.isLoading || itemsQ.isLoading ? (
            <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING…</div>
          ) : nothingScheduled ? (
            <div className="terminal-border" style={{ padding: "18px 16px", opacity: 0.7, fontSize: 17, lineHeight: 1.5 }}>
              NOTHING SCHEDULED — the events engine (windows, moments, recurring promos) lands in the next phase.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scheduledItems.map((it) => (
                <ItemScheduleRow key={it.id} item={it} onEdit={() => openEdit(it)} />
              ))}
              {events.map((ev) => (
                <EventScheduleRow key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>

        {/* ── D · ★ FEATURED ON POS (read-only) ──────────────────────────── */}
        <div style={{ marginTop: 30 }}>
          <FeaturedPanel featured={featuredItems(toastRows)} />
        </div>
      </div>

      {editorOpen && (
        <ItemEditor
          slots={slots}
          toastRows={toastRows}
          defaultSlotId={slots[0]?.id ?? null}
          editing={editItem}
          presetTemplate={preset}
          nextSortOrder={(slotId) => {
            const list = itemsBySlot.get(slotId) ?? [];
            return list.length ? Math.max(...list.map((i) => i.sort_order)) + 1 : 0;
          }}
          onClose={() => { setEditorOpen(false); setEditItem(null); setPreset(null); }}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

/* ── A · screen card ────────────────────────────────────────────────────────── */
function ScreenCard({
  slot, mode, takeoverMessage, slotItems, tmap,
}: {
  slot: AdminSlot;
  mode: SlotMode;
  takeoverMessage: string | null;
  slotItems: AdminItem[];
  tmap: Map<string, ToastCacheRow>;
}) {
  const health = screenHealth(slot.last_seen);
  const summary = useMemo(() => rotationSummary(slotItems, tmap), [slotItems, tmap]);

  return (
    <div className="terminal-border" style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.name}</span>
        <HealthDot health={health} />
      </div>
      <div style={{ fontSize: 13, opacity: 0.55 }}>
        {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
      </div>

      <ModeChip mode={mode} />

      {/* Body varies by mode — the same ladder SlotDisplay renders. */}
      {mode === "rotation" ? (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>{summary}</div>
      ) : mode === "game" ? (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>
          <span className="u-amber">Showing the game display.</span> Returns to rotation automatically when the game ends.
        </div>
      ) : (
        <div style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.5, minHeight: 40 }}>
          <span className="u-red">Priority broadcast overriding all screens</span>{takeoverMessage ? `: “${takeoverMessage}”` : ""}. Dismiss from BROADCAST.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
        <a
          href={`/signage/s/${slot.slug}?preview=1`}
          target="_blank"
          rel="noreferrer"
          title="Staff preview only — NEVER point a TV at a ?preview=1 URL (it never shows takeovers or game mode)."
          style={{ ...miniBtn, textDecoration: "none" }}
        >
          PREVIEW
        </a>
        <Link to={`/signage/screens/${slot.slug}`} style={{ ...miniBtn, ...miniKey, textDecoration: "none" }}>EDIT ROTATION</Link>
        <CopyKioskButton slug={slot.slug} style={miniBtn} />
      </div>
    </div>
  );
}

function ModeChip({ mode }: { mode: SlotMode }) {
  const label = mode === "rotation" ? "MODE: ROTATION" : mode === "game" ? "MODE: LIVE GAME" : "MODE: TAKEOVER";
  const cls = mode === "game" ? "u-amber" : mode === "takeover" ? "u-red" : "";
  return (
    <span className={cls} style={{ display: "inline-block", alignSelf: "flex-start", fontSize: 12, letterSpacing: 2, border: "1px solid currentColor", padding: "2px 8px", opacity: mode === "rotation" ? 0.7 : 1 }}>
      {label}
    </span>
  );
}

/** "N items rotating: a · b · c · +K more" (+ ★ featured). Counts only currently-visible
 *  authored items — resolveRotation applies the exact in-window + OOS/POS-hide rules the
 *  screen uses; the ★ SCREENS materialization is reported separately. */
function rotationSummary(slotItems: AdminItem[], tmap: Map<string, ToastCacheRow>): string {
  const activeItems = slotItems.filter((it) => it.active);
  const rotation = resolveRotation(activeItems as SignageItem[], tmap, new Date());
  const authored = rotation.filter((r) => !r.materialized);
  const hasFeatured = rotation.some((r) => r.materialized);
  const names = authored.map((it) => rotationName(it, tmap));

  if (authored.length === 0 && !hasFeatured) return "Nothing rotating yet — EDIT ROTATION to add an item.";
  if (authored.length === 0) return "★ featured items only (flipped in at the POS).";

  const shown = names.slice(0, 3).join(" · ");
  const more = authored.length > 3 ? ` · +${authored.length - 3} more` : "";
  const featured = hasFeatured ? " · + ★ featured" : "";
  return `${authored.length} item${authored.length === 1 ? "" : "s"} rotating: ${shown}${more}${featured}`;
}

function rotationName(it: SignageItem, tmap: Map<string, ToastCacheRow>): string {
  const f = it.fields ?? {};
  const nm = typeof f.name === "string" && f.name.trim() ? (f.name as string).trim() : "";
  if (nm) return nm;
  const guid = typeof f.source_toast_guid === "string" ? (f.source_toast_guid as string) : "";
  if (guid) {
    const r = tmap.get(guid);
    if (r?.name) return r.name;
  }
  return summarize(it as AdminItem);
}

/* ── C · schedule rows ──────────────────────────────────────────────────────── */
function ItemScheduleRow({ item, onEdit }: { item: AdminItem; onEdit: () => void }) {
  const type = typeBadge(item);
  const rec = recurrencePhrase(item.recurrence);
  const when = [scheduleLabel(item), rec].filter((x) => x && x !== "EVERGREEN").join(" · ") || "evergreen";
  const status = itemStatus(item);
  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summarize(item)}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{when}</div>
      </div>
      <span style={badge}>{type}</span>
      <span style={{ fontSize: 13, whiteSpace: "nowrap", letterSpacing: 1, opacity: status.active ? 1 : 0.6 }}>{status.label}</span>
      <button type="button" onClick={onEdit} style={{ ...ghost, fontSize: 14, padding: "6px 12px" }}>EDIT</button>
    </div>
  );
}

function EventScheduleRow({ event }: { event: ScheduledEvent }) {
  const rec = event.recurrence?.daysOfWeek?.length
    ? `${event.recurrence.daysOfWeek.join(" · ")}${event.recurrence.time ? ` ${event.recurrence.time}` : ""}`
    : event.fire_at
      ? new Date(event.fire_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "one-shot";
  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", opacity: event.status === "completed" || event.status === "aborted" ? 0.6 : 1 }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{event.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{event.skin} · {rec}{event.interrupt_game ? " · interrupts game" : ""}</div>
      </div>
      <span className="u-amber" style={{ ...badge, borderColor: "currentColor" }}>MOMENT</span>
      <span style={{ fontSize: 13, whiteSpace: "nowrap", letterSpacing: 1, opacity: 0.7 }}>{event.status.toUpperCase()}</span>
      {/* No EDIT — scheduled_events are read-only until the events engine ships. */}
    </div>
  );
}

function typeBadge(item: AdminItem): string {
  switch (item.template) {
    case "drink_special": return "PROMO";
    case "event": return "EVENT";
    case "announcement": return "MESSAGE";
    case "image_only": return "IMAGE";
    case "celebration": return "MESSAGE";
    default: return "ITEM";
  }
}

function itemStatus(item: AdminItem): { label: string; active: boolean } {
  const t = Date.now();
  const started = !item.starts_at || new Date(item.starts_at).getTime() <= t;
  const ended = !!item.ends_at && new Date(item.ends_at).getTime() <= t;
  if (item.active && started && !ended) return { label: "● ACTIVE NOW", active: true };
  if (!ended && item.starts_at && new Date(item.starts_at).getTime() > t) {
    return { label: `next ${new Date(item.starts_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}`, active: false };
  }
  if (item.recurrence) return { label: "recurring", active: false };
  if (ended) return { label: "ended", active: false };
  return { label: item.active ? "scheduled" : "paused", active: false };
}

/* ── D · ★ SCREENS featured (read-only) ─────────────────────────────────────── */
function FeaturedPanel({ featured }: { featured: ReturnType<typeof featuredItems> }) {
  return (
    <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>★ FEATURED ON POS <span style={{ fontSize: 13, opacity: 0.5, letterSpacing: 2 }}>read-only — flipped at the register</span></div>
      <div style={{ fontSize: 15, opacity: 0.65, marginTop: -4 }}>
        In-stock items in the Toast ★ SCREENS group auto-rotate onto every screen. Toggle these at the POS
        (Quick Edit → In/Out of Stock) — there is no button here (Toast access is read-only).
      </div>
      {featured.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 17 }}>Nothing featured right now. Mark an item In Stock in the POS ★ SCREENS group.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))", gap: 8 }}>
          {featured.map((f) => (
            <div key={f.guid} className="terminal-border" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", minWidth: 0 }}>
              {f.image
                ? <img src={f.image} alt="" style={{ width: 40, height: 40, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                : <span style={{ width: 40, height: 40, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
              <span className="sig-live" style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 18 }}>{f.name}</span>
              {f.price != null && <span className="sig-live" style={{ fontSize: 17 }}>${f.price}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────────── */
const quickBtn: CSSProperties = {
  minHeight: 56, border: "1px solid var(--terminal-green)", background: "rgba(0,255,65,0.06)",
  color: "var(--terminal-green)", fontFamily: MONO, fontSize: 22, letterSpacing: 1,
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer",
  textAlign: "center", padding: "8px 12px",
};
const quickPrimary: CSSProperties = { ...quickBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700 };
const miniBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "8px 10px",
  minHeight: 44, cursor: "pointer", display: "inline-flex", alignItems: "center",
};
const miniKey: CSSProperties = { fontWeight: 700 };

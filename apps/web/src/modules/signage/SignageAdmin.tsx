import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  useAdminSlots, useAllItems, useTakeovers, useToastCache,
  screenHealth, activeTakeover, featuredItems,
  deleteItem, setItemActive, reorderItem, sendTakeover, dismissTakeover,
  type AdminItem, type AdminSlot, type AdminTakeover, type ScreenHealth,
} from "./useSignageAdmin";
import { ItemEditor } from "./ItemEditor";
import "./signage.css";

/**
 * /signage — STAFF signage templater (docs/09 Admin). Mobile-first (the owner runs
 * this from his phone at the bar): one column, ≥44px controls, everything reachable
 * one-handed. Terminal theme; StaffLayout provides the nav. Writes gate on
 * has_module('signage') (RLS 0024). Toast is READ-ONLY — no feature-write button
 * (docs/09 amendment: ★ SCREENS is toggled at the POS via Quick Edit).
 *
 * Sections: A slot overview + health · B/C per-slot item list + add/edit · D takeover
 * broadcast console · E ★ SCREENS read-only featured panel.
 */

const MONO = "'VT323','Share Tech Mono',monospace";

export function SignageAdmin() {
  const qc = useQueryClient();
  const slotsQ = useAdminSlots();
  const itemsQ = useAllItems();
  const takeoversQ = useTakeovers();
  const toastQ = useToastCache();

  const slots = slotsQ.data ?? [];
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminItem | null>(null);

  const currentSlotId = selectedSlot ?? slots[0]?.id ?? null;
  const currentSlot = slots.find((s) => s.id === currentSlotId) ?? null;

  const itemsBySlot = useMemo(() => {
    const m = new Map<string | null, AdminItem[]>();
    for (const it of itemsQ.data ?? []) {
      const key = it.slot_id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [itemsQ.data]);

  const slotItems = itemsBySlot.get(currentSlotId) ?? [];
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["signage-admin", "items"] });
    qc.invalidateQueries({ queryKey: ["signage-admin", "takeovers"] });
  };

  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (it: AdminItem) => { setEditing(it); setEditorOpen(true); };

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 3 }}>BUNKER UNIFIED OS · SIGNAGE</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: "clamp(28px,6vw,44px)", fontWeight: 700, letterSpacing: 2 }}>SIGNAGE TEMPLATER</h1>
          <Link to="/dashboard" style={{ ...ghost, textDecoration: "none", fontSize: 16 }}>← DASHBOARD</Link>
        </div>
        <div className="terminal-separator" style={{ margin: "12px 0 20px" }} />

        {/* ── A · SLOT OVERVIEW ─────────────────────────────────────────── */}
        <SectionLabel>SCREENS</SectionLabel>
        {slotsQ.isLoading ? (
          <div style={{ fontSize: 20 }}>LOADING SLOTS…</div>
        ) : slots.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No slots provisioned. Seed one in signage_slots.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))", gap: 10 }}>
            {slots.map((s) => (
              <SlotCard
                key={s.id}
                slot={s}
                count={(itemsBySlot.get(s.id) ?? []).length}
                selected={s.id === currentSlotId}
                onSelect={() => setSelectedSlot(s.id)}
              />
            ))}
          </div>
        )}

        {/* ── B/C · ITEMS FOR THE SELECTED SLOT ─────────────────────────── */}
        {currentSlot && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 26 }}>
              <SectionLabel style={{ margin: 0 }}>{currentSlot.name.toUpperCase()} — ITEMS</SectionLabel>
              <button type="button" onClick={openNew} className="u-fill u-ink" style={primary}>+ ADD ITEM</button>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {slotItems.length === 0 && <div style={{ opacity: 0.6, fontSize: 18 }}>No items yet — ADD ITEM to build this screen's rotation.</div>}
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
          </>
        )}

        {/* ── D · TAKEOVER CONSOLE ──────────────────────────────────────── */}
        <div style={{ marginTop: 34 }}>
          <TakeoverConsole takeovers={takeoversQ.data ?? []} onChanged={invalidate} />
        </div>

        {/* ── E · ★ SCREENS (read-only featured) ────────────────────────── */}
        <div style={{ marginTop: 34 }}>
          <FeaturedPanel featured={featuredItems(toastQ.data)} />
        </div>
      </div>

      {editorOpen && (
        <ItemEditor
          slots={slots}
          toastRows={toastQ.data ?? []}
          defaultSlotId={currentSlotId}
          editing={editing}
          nextSortOrder={(slotId) => {
            const items = itemsBySlot.get(slotId) ?? [];
            // Append after the current max, not the row count — a count collides with an
            // existing sort_order once a delete has left a gap (N7).
            return items.length ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0;
          }}
          onClose={() => setEditorOpen(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

/* ── A · slot card ──────────────────────────────────────────────────────── */
function SlotCard({ slot, count, selected, onSelect }: { slot: AdminSlot; count: number; selected: boolean; onSelect: () => void }) {
  const health = screenHealth(slot.last_seen);
  return (
    <div
      onClick={onSelect}
      className="terminal-border"
      style={{ padding: "12px 14px", cursor: "pointer", background: selected ? "rgba(0,255,65,0.08)" : "transparent", borderWidth: selected ? 2 : 1, display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.name}</span>
        <HealthDot health={health} />
      </div>
      <div style={{ fontSize: 14, opacity: 0.65 }}>
        {slot.orientation.toUpperCase()} · TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")}{slot.location_label ? ` — ${slot.location_label}` : ""}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, opacity: 0.7 }}>{count} ITEM{count === 1 ? "" : "S"}</span>
        <a
          href={`/signage/s/${slot.slug}?preview=1`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ ...ghost, textDecoration: "none", fontSize: 15, padding: "6px 10px" }}
        >
          PREVIEW (rotation only) →
        </a>
      </div>
      <KioskUrl slug={slot.slug} />
    </div>
  );
}

/** The clean kiosk URL for a slot (NO ?preview=1 — a preview link on a TV never shows
 *  takeovers or game mode). COPY writes to the clipboard, with a legacy fallback. W3. */
function KioskUrl({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/signage/s/${slug}`;

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.55 }}>KIOSK URL — point the TV at this</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</span>
        <button type="button" onClick={copy} className={copied ? "u-fill u-ink" : ""} style={{ ...ghost, fontSize: 14, padding: "0 12px", flexShrink: 0 }}>
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
    </div>
  );
}

function HealthDot({ health }: { health: ScreenHealth }) {
  const label = health === "online" ? "● ONLINE" : health === "stale" ? "◐ STALE" : "○ OFFLINE";
  const cls = health === "online" ? "" : health === "stale" ? "u-amber" : "u-red";
  return <span className={cls} style={{ fontSize: 14, whiteSpace: "nowrap" }}>{label}</span>;
}

/* ── B · item row ───────────────────────────────────────────────────────── */
function ItemRow({
  item, first, last, hideReason, prev, next, onEdit, onChanged,
}: {
  item: AdminItem; first: boolean; last: boolean; hideReason: string | null;
  prev?: AdminItem; next?: AdminItem;
  onEdit: () => void; onChanged: () => void;
}) {
  const toggle = useMutation({ mutationFn: () => setItemActive(item.id, !item.active), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => deleteItem(item.id), onSuccess: onChanged });
  const up = useMutation({ mutationFn: () => reorderItem(item, prev!), onSuccess: onChanged });
  const down = useMutation({ mutationFn: () => reorderItem(item, next!), onSuccess: onChanged });

  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", opacity: item.active ? 1 : 0.5 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={badge}>{item.template.replace("_", " ").toUpperCase()}</span>
          {item.recurrence && <span className="u-amber" style={{ fontSize: 13, letterSpacing: 1 }}>↻ RECURS</span>}
          {item.show_on_website && <span style={{ fontSize: 13, letterSpacing: 1 }} title="Published to the public website">🌐 WEB</span>}
          {hideReason && <span className="u-amber" style={{ fontSize: 13 }}>{hideReason}</span>}
        </div>
        <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summarize(item)}</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>{scheduleLabel(item)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <button type="button" onClick={() => up.mutate()} disabled={first} style={iconBtn} aria-label="Move up">▲</button>
        <button type="button" onClick={() => down.mutate()} disabled={last} style={iconBtn} aria-label="Move down">▼</button>
        <button type="button" onClick={() => toggle.mutate()} className={item.active ? "u-fill u-ink" : ""} style={{ ...iconBtn, minWidth: 62 }}>{item.active ? "● ON" : "○ OFF"}</button>
        <button type="button" onClick={onEdit} style={iconBtn}>EDIT</button>
        <button type="button" onClick={() => { if (confirm("Delete this item?")) del.mutate(); }} className="u-amber" style={iconBtn}>DEL</button>
      </div>
    </div>
  );
}

/* ── D · takeover console ───────────────────────────────────────────────── */
function TakeoverConsole({ takeovers, onChanged }: { takeovers: AdminTakeover[]; onChanged: () => void }) {
  const active = activeTakeover(takeovers);
  const [message, setMessage] = useState("");
  const [sub, setSub] = useState("");
  const [duration, setDuration] = useState<number | null>(5);

  const send = useMutation({
    mutationFn: () => sendTakeover({ message: message.trim(), sub_message: sub.trim() || null, durationMinutes: duration }),
    onSuccess: () => { setMessage(""); setSub(""); onChanged(); },
  });
  const dismiss = useMutation({ mutationFn: (id: string) => dismissTakeover(id), onSuccess: onChanged });
  const resend = useMutation({
    mutationFn: (t: AdminTakeover) => sendTakeover({ message: t.message, sub_message: t.sub_message, durationMinutes: 5 }),
    onSuccess: onChanged,
  });

  return (
    <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 0 18px var(--terminal-glow)" }}>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>■ BROADCAST — TAKEOVER</div>
      <div style={{ fontSize: 15, opacity: 0.65, marginTop: -6 }}>Overrides every screen instantly. Use for LAST CALL, TRIVIA STARTS, a shout-out.</div>

      {active ? (
        <div className="terminal-border" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 14, letterSpacing: 2, opacity: 0.6 }}>■ ON AIR NOW</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{active.message}</div>
          {active.sub_message && <div style={{ fontSize: 18, opacity: 0.8 }}>{active.sub_message}</div>}
          <div style={{ fontSize: 15, opacity: 0.6 }}><Countdown endsAt={active.ends_at} /></div>
          <button type="button" onClick={() => dismiss.mutate(active.id)} className="u-amber" style={{ ...ghost, alignSelf: "flex-start" }}>DISMISS NOW</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="MESSAGE (e.g. LAST CALL)" value={message} onChange={(e) => setMessage(e.target.value)} style={field} />
          <input placeholder="sub-message (optional)" value={sub} onChange={(e) => setSub(e.target.value)} style={field} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 15, opacity: 0.7 }}>DURATION:</span>
            {[2, 5, 10].map((m) => (
              <button key={m} type="button" onClick={() => setDuration(m)} className={duration === m ? "u-fill u-ink" : ""} style={{ ...chip, ...(duration === m ? { fontWeight: 700 } : null) }}>{m} MIN</button>
            ))}
            <button type="button" onClick={() => setDuration(null)} className={duration === null ? "u-fill u-ink" : ""} style={{ ...chip, ...(duration === null ? { fontWeight: 700 } : null) }}>UNTIL DISMISSED</button>
          </div>
          <button
            type="button"
            disabled={!message.trim() || send.isPending}
            onClick={() => { if (confirm(`Broadcast "${message.trim()}" to every screen?`)) send.mutate(); }}
            className="u-fill u-ink"
            style={{ ...primary, opacity: !message.trim() ? 0.5 : 1 }}
          >
            {send.isPending ? "SENDING…" : "SEND BROADCAST →"}
          </button>
        </div>
      )}

      {takeovers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={caption}>RECENT</div>
          {takeovers.slice(0, 5).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.85 }}>
                {t.signage_item_id ? "★ " : ""}{t.message}
              </span>
              <span style={{ fontSize: 13, opacity: 0.5, whiteSpace: "nowrap" }}>{new Date(t.starts_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <button type="button" onClick={() => resend.mutate(t)} style={{ ...ghost, fontSize: 13, padding: "4px 8px" }}>RESEND</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: string | null }) {
  if (!endsAt) return <>Until dismissed.</>;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return <>Ending…</>;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return <>Ends in {mins}:{String(secs).padStart(2, "0")}</>;
}

/* ── E · ★ SCREENS featured (read-only) ─────────────────────────────────── */
function FeaturedPanel({ featured }: { featured: ReturnType<typeof featuredItems> }) {
  return (
    <div className="terminal-border" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>★ SCREENS — AUTO-FEATURED</div>
      <div style={{ fontSize: 15, opacity: 0.65, marginTop: -4 }}>
        In-stock items in the Toast ★ SCREENS group auto-rotate onto every screen. Toggle these at the POS
        (Quick Edit → In/Out of Stock) — there is no button here (Toast access is read-only).
      </div>
      {featured.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 17 }}>Nothing featured right now. Mark an item In Stock in the POS ★ SCREENS group.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {featured.map((f) => (
            <div key={f.guid} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {f.image
                ? <img src={f.image} alt="" style={{ width: 40, height: 40, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                : <span style={{ width: 40, height: 40, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
              <span className="sig-live" style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 19 }}>{f.name}</span>
              {f.price != null && <span className="sig-live" style={{ fontSize: 18 }}>${f.price}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────────────────── */
// Why the slot page auto-hides an item's Toast source, if at all: 86'd (out of
// stock) or POS-HIDDEN (not active on the POS view — 0034). Either reason hides it
// on-screen, so the admin row badges the actual cause.
function sourceHideReason(item: AdminItem, rows: ReturnType<typeof featuredItems> | undefined): string | null {
  const guid = typeof item.fields?.source_toast_guid === "string" ? (item.fields.source_toast_guid as string) : undefined;
  if (!guid || !rows) return null;
  // rows here is the full toast cache list passed as toastQ.data; find the guid.
  const r = (rows as { guid: string; out_of_stock?: boolean; pos_visible?: boolean }[]).find((x) => x.guid === guid);
  if (!r) return null;
  if (r.out_of_stock) return "86'D — HIDDEN";
  if (r.pos_visible === false) return "POS-HIDDEN";
  return null;
}

function summarize(item: AdminItem): string {
  const f = item.fields ?? {};
  const g = (k: string) => (typeof f[k] === "string" ? (f[k] as string).trim() : "");
  switch (item.template) {
    case "drink_special": return g("name") || (g("source_toast_guid") ? "Toast-sourced special" : "Drink special");
    case "event": return g("title") || "Event";
    case "announcement": return g("text") || g("message") || "Announcement";
    case "image_only": return g("caption") || "Image";
    case "celebration": return `${(g("skin") || "celebration").toUpperCase()} — ${g("honoree") || "guest"}`;
    default: return item.template;
  }
}

function scheduleLabel(item: AdminItem): string {
  if (!item.starts_at && !item.ends_at) return "EVERGREEN";
  const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (item.starts_at && item.ends_at) return `${fmt(item.starts_at)} → ${fmt(item.ends_at)}`;
  if (item.starts_at) return `FROM ${fmt(item.starts_at)}`;
  return `UNTIL ${fmt(item.ends_at!)}`;
}

/* ── shared bits / styles ───────────────────────────────────────────────── */
function SectionLabel({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ fontSize: 20, letterSpacing: 3, opacity: 0.7, margin: "0 0 10px", ...style }}>{children}</div>;
}

const ghost: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 12px", fontSize: 18, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const primary: CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 18px", fontSize: 20, fontWeight: 700, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const iconBtn: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "0 10px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44, minWidth: 44 };
const field: CSSProperties = { background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", fontSize: 20, fontFamily: MONO, minHeight: 44 };
const chip: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 12px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const badge: CSSProperties = { fontSize: 13, letterSpacing: 1, border: "1px solid var(--terminal-green)", padding: "2px 6px", opacity: 0.85 };
const caption: CSSProperties = { fontSize: 14, letterSpacing: 2, opacity: 0.55 };

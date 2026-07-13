import { useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  activeTakeover, dismissTakeover, sendTakeover, deleteItem, setItemActive, reorderItem, featuredItems,
  type AdminItem, type AdminTakeover, type Recurrence, type ScreenHealth,
} from "./useSignageAdmin";

/**
 * Shared staff-signage UI, lifted verbatim out of the old single-page templater so the
 * Signage Hub (/signage), the per-slot EDIT ROTATION page (/signage/screens/:slug) and the
 * BROADCAST page (/signage/broadcast) all render the SAME rows/console with identical
 * behavior. Nothing here changed semantics when it moved — it was only relocated.
 */

export const MONO = "'VT323','Share Tech Mono',monospace";

/* ── shared styles ──────────────────────────────────────────────────────────── */
export const ghost: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 12px", fontSize: 18, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
export const primary: CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 18px", fontSize: 20, fontWeight: 700, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
export const iconBtn: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "0 10px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44, minWidth: 44 };
export const field: CSSProperties = { background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", fontSize: 20, fontFamily: MONO, minHeight: 44 };
export const chip: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 12px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
export const badge: CSSProperties = { fontSize: 13, letterSpacing: 1, border: "1px solid var(--terminal-green)", padding: "2px 6px", opacity: 0.85 };
export const caption: CSSProperties = { fontSize: 14, letterSpacing: 2, opacity: 0.55 };

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ fontSize: 20, letterSpacing: 3, opacity: 0.7, margin: "0 0 10px", ...style }}>{children}</div>;
}

/* ── screen health dot ──────────────────────────────────────────────────────── */
export function HealthDot({ health }: { health: ScreenHealth }) {
  const label = health === "online" ? "● LIVE" : health === "stale" ? "◐ STALE" : "○ DOWN";
  const cls = health === "online" ? "" : health === "stale" ? "u-amber" : "u-red";
  return <span className={cls} style={{ fontSize: 14, whiteSpace: "nowrap" }}>{label}</span>;
}

/* ── clipboard helper (navigator.clipboard + legacy textarea fallback, W3) ────── */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    return true;
  } catch {
    return false;
  }
}

/** The clean kiosk URL for a slot (NO ?preview=1 — a preview link on a TV never shows
 *  takeovers or game mode). Full URL display + COPY, used in the EDIT ROTATION header. */
export function KioskUrl({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/signage/s/${slug}`;
  const copy = async () => {
    if (await copyToClipboard(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
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

/** Compact COPY KIOSK URL button (hub screen cards — no inline URL, just the action). */
export function CopyKioskButton({ slug, style }: { slug: string; style?: CSSProperties }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/signage/s/${slug}`;
  const copy = async () => {
    if (await copyToClipboard(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <button type="button" onClick={copy} className={copied ? "u-fill u-ink" : ""} style={{ ...ghost, fontSize: 14, padding: "6px 10px", ...style }}>
      {copied ? "COPIED ✓" : "COPY KIOSK URL"}
    </button>
  );
}

/* ── per-slot item row (EDIT ROTATION) ──────────────────────────────────────── */
export function ItemRow({
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

/* ── takeover / broadcast console (BROADCAST page) ──────────────────────────── */
export function TakeoverConsole({ takeovers, onChanged }: { takeovers: AdminTakeover[]; onChanged: () => void }) {
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

export function Countdown({ endsAt }: { endsAt: string | null }) {
  if (!endsAt) return <>Until dismissed.</>;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return <>Ending…</>;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return <>Ends in {mins}:{String(secs).padStart(2, "0")}</>;
}

/* ── item helpers ───────────────────────────────────────────────────────────── */
// Why the slot page auto-hides an item's Toast source, if at all: 86'd (out of stock) or
// POS-HIDDEN (not active on the POS view — 0034). Either reason hides it on-screen.
export function sourceHideReason(item: AdminItem, rows: ReturnType<typeof featuredItems> | undefined): string | null {
  const guid = typeof item.fields?.source_toast_guid === "string" ? (item.fields.source_toast_guid as string) : undefined;
  if (!guid || !rows) return null;
  const r = (rows as { guid: string; out_of_stock?: boolean; pos_visible?: boolean }[]).find((x) => x.guid === guid);
  if (!r) return null;
  if (r.out_of_stock) return "86'D — HIDDEN";
  if (r.pos_visible === false) return "POS-HIDDEN";
  return null;
}

export function summarize(item: AdminItem): string {
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

export function scheduleLabel(item: AdminItem): string {
  if (!item.starts_at && !item.ends_at) return "EVERGREEN";
  const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (item.starts_at && item.ends_at) return `${fmt(item.starts_at)} → ${fmt(item.ends_at)}`;
  if (item.starts_at) return `FROM ${fmt(item.starts_at)}`;
  return `UNTIL ${fmt(item.ends_at!)}`;
}

/** Human phrase for a persisted recurrence shape (RUNNING & UPCOMING). null = one-shot. */
export function recurrencePhrase(rec: Recurrence | null): string | null {
  if (!rec) return null;
  if (rec.kind === "weekly") return rec.daysOfWeek.length ? rec.daysOfWeek.join(" · ") : "weekly";
  if (rec.kind === "annual") return `annually ${rec.month}/${rec.day}`;
  return null;
}

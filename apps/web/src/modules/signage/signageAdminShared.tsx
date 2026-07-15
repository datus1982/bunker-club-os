import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  activeTakeover, dismissTakeover, sendTakeover, deleteItem, setItemActive, setItemDuration, reorderItem, featuredItems,
  uploadCustomImage,
  DURATION_CHOICES,
  type AdminItem, type AdminTakeover, type Recurrence, type ScreenHealth,
} from "./useSignageAdmin";
import type { EventKind, ToastCacheRow } from "./useSignage";
import type { Align } from "./richText";

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
export const caption: CSSProperties = { fontSize: 16, letterSpacing: 2, opacity: 0.55 };

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
  item, first, last, hideReason, prev, next, onEdit, onChanged, toastRows,
  live, windowReason,
}: {
  item: AdminItem; first: boolean; last: boolean; hideReason: string | null;
  prev?: AdminItem; next?: AdminItem;
  onEdit: () => void; onChanged: () => void; toastRows?: ToastCacheRow[];
  // Live-queue markers (EDIT ROTATION renders the same queue the TV resolves). `live` = the
  // TV would show this row this minute (● NOW, full brightness); `windowReason` = why an
  // active-but-not-live authored item is out of its time window (STARTS … / ENDED). Both are
  // optional — omitted, the row behaves byte-identically to the pre-live-queue editor.
  live?: boolean; windowReason?: string | null;
}) {
  const toggle = useMutation({ mutationFn: () => setItemActive(item.id, !item.active), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => deleteItem(item.id), onSuccess: onChanged });
  const up = useMutation({ mutationFn: () => reorderItem(item, prev!), onSuccess: onChanged });
  const down = useMutation({ mutationFn: () => reorderItem(item, next!), onSuccess: onChanged });
  const dur = useMutation({ mutationFn: (secs: number) => setItemDuration(item.id, secs), onSuccess: onChanged });

  // Dim any row the TV is NOT showing this minute: turned OFF, out of its time window, or
  // hidden by a 86'd / off-POS Toast source. When `live` isn't passed (no live-queue context)
  // fall back to the original active-only dimming so behaviour is unchanged.
  const onScreen = live === undefined ? item.active : item.active && live;

  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", opacity: onScreen ? 1 : 0.5 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={badge}>{item.template.replace(/_/g, " ").toUpperCase()}</span>
          {live && <span className="sig-live" style={{ fontSize: 13, letterSpacing: 1, whiteSpace: "nowrap" }} title="On the TV rotation right now">● NOW</span>}
          {item.recurrence && <span className="u-amber" style={{ fontSize: 13, letterSpacing: 1 }}>↻ RECURS</span>}
          {item.show_on_website && <span style={{ fontSize: 13, letterSpacing: 1 }} title="Published to the public website">🌐 WEB</span>}
          {windowReason && <span style={{ fontSize: 13, letterSpacing: 1, opacity: 0.7 }}>{windowReason}</span>}
          {hideReason && <span className="u-amber" style={{ fontSize: 13 }}>{hideReason}</span>}
        </div>
        <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summarize(item, toastRows)}</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>{scheduleLabel(item)} · {item.duration_seconds}s ON SCREEN</div>
      </div>
      {/* minWidth:0 + shrinkable so that when this control cluster wraps to its own line
          at ≤390px it is constrained to the row width and its own flexWrap engages (the
          wider JetBrains glyphs otherwise pushed it past the viewport — 2026-07-13). */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "1 1 auto", minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {/* Per-item on-screen SECONDS — the timing control (writes duration_seconds; the
            public rotation advance already honors it per-item, no fixed interval). */}
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, opacity: 0.85 }}>
          <span style={{ letterSpacing: 1 }} title="How long this slide stays on screen">SECS</span>
          <select
            value={DURATION_CHOICES.includes(item.duration_seconds as (typeof DURATION_CHOICES)[number]) ? item.duration_seconds : "custom"}
            onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) dur.mutate(n); }}
            aria-label="Seconds on screen"
            style={{ background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", fontFamily: MONO, fontSize: 15, minHeight: 44, padding: "0 6px", cursor: "pointer" }}
          >
            {!DURATION_CHOICES.includes(item.duration_seconds as (typeof DURATION_CHOICES)[number]) && (
              <option value="custom" style={{ background: "#000" }}>{item.duration_seconds}s</option>
            )}
            {DURATION_CHOICES.map((sc) => (
              <option key={sc} value={sc} style={{ background: "#000" }}>{sc}s</option>
            ))}
          </select>
        </label>
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

export function summarize(item: AdminItem, toastRows?: ToastCacheRow[]): string {
  const f = item.fields ?? {};
  const g = (k: string) => (typeof f[k] === "string" ? (f[k] as string).trim() : "");
  switch (item.template) {
    case "drink_special": {
      const guid = g("source_toast_guid");
      // Resolve the live Toast name so the row reads "Manhattan Project", not
      // "Toast-sourced special" (owner note, 2026-07-14).
      const live = guid ? toastRows?.find((r) => r.guid === guid)?.name : undefined;
      return g("name") || live || (guid ? "Toast-sourced special" : "Drink special");
    }
    case "event": return g("title") || "Event";
    case "announcement": return g("text") || g("message") || "Announcement";
    case "image_only": return g("caption") || "Image";
    case "celebration": return `${(g("skin") || "celebration").toUpperCase()} — ${g("honoree") || "guest"}`;
    case "top_sellers": return "Top sellers — live top-5 from the POS";
    case "instagram": {
      // No hardcoded venue handle (venue-scope rule) — summarize can't read the IG cache, so
      // use a neutral phrase; the account handle shows on the card itself (from the post data).
      const count = typeof f.post_count === "number" ? f.post_count : 5;
      return `Instagram — last ${count} post${count === 1 ? "" : "s"}`;
    }
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

/* ── scheduled-events kind badge (matches ux-refinement-mockup.html view 5) ──── */
// WINDOW = calm green-dim outline · MESSAGE = green outline · MOMENT = amber-filled
// (the choreographed one draws the eye). Shared so the hub strip + the events page
// never drift on colour/label.
export function EventKindBadge({ kind, style }: { kind: EventKind; style?: CSSProperties }) {
  const base: CSSProperties = {
    fontSize: 12, letterSpacing: 2, padding: "2px 7px", whiteSpace: "nowrap",
    border: "1px solid currentColor", ...style,
  };
  if (kind === "moment") {
    // Amber-filled — the choreographed one draws the eye (u-ink beats the theme's
    // color:green !important; a span isn't forced transparent like buttons are).
    return <span className="u-ink" style={{ ...base, background: "var(--terminal-amber,#ffb000)", borderColor: "var(--terminal-amber,#ffb000)", fontWeight: 700 }}>MOMENT</span>;
  }
  if (kind === "message") {
    return <span style={{ ...base, opacity: 1 }}>MESSAGE</span>;
  }
  return <span style={{ ...base, opacity: 0.72 }}>WINDOW</span>;
}

/* ── custom image upload (shared by EventEditor + ItemEditor) ─────────────────── */
// One control for every custom image field. Client-resizes/re-encodes to a ≤1600px JPEG
// (EXIF stripped by the canvas re-encode) and stores the public URL in fields.image_url.
// Shows a square thumbnail + REPLACE / REMOVE. Writes to the module-gated uploads/ prefix
// (RLS 0037). `url` is the current fields.image_url (undefined when none).
export function ImageUploadField({
  url, onChange, label = "IMAGE (optional)", note,
}: {
  url: string | undefined;
  onChange: (url: string) => void;
  label?: string;
  note?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadCustomImage(file));
    } catch (er) {
      setErr(er instanceof Error ? er.message : "upload failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={caption}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {url && <img src={url} alt="" style={{ width: 72, height: 72, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />}
        <input ref={ref} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} style={ghost}>
          {busy ? "UPLOADING…" : url ? "REPLACE" : "UPLOAD IMAGE"}
        </button>
        {url && <button type="button" onClick={() => onChange("")} style={ghost}>REMOVE</button>}
      </div>
      {note && <div style={{ fontSize: 14, opacity: 0.55 }}>{note}</div>}
      {err && <div className="u-red" style={{ fontSize: 15 }}>⚠ {err}</div>}
    </div>
  );
}

/* ── formatting controls (deliberately basic: alignment segmented + a bold hint) ── */
// Writes fields.align ("left" | "center"); inline **bold** is authored inline in the text
// fields and rendered by the display templates (richText.ts). One shared control so the
// EventEditor and ItemEditor never drift on label/behaviour.
export function FormatControls({ align, onAlign }: { align: Align; onAlign: (a: Align) => void }) {
  const opt = (a: Align, label: string) => (
    <button
      type="button"
      onClick={() => onAlign(a)}
      className={align === a ? "u-fill u-ink" : ""}
      style={{ ...chip, ...(align === a ? { fontWeight: 700 } : null) }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={caption}>ALIGN</span>
        {opt("left", "◧ LEFT")}
        {opt("center", "▣ CENTER")}
      </div>
      <div style={{ fontSize: 14, opacity: 0.55 }}>
        <code>**bold**</code> · alignment applies to this card.
      </div>
    </div>
  );
}

/* ── Toast source picker (live price + POS/86 warning state) ──────────────────── */
// The same read-only picker pattern ItemEditor uses for drink specials: pick a Toast
// item, its name/price render LIVE green, and an 86'd / off-POS item shows a warning so a
// manager sees why a linked promo would auto-hide on screen (docs/13 POS-visibility rule).
export function ToastSourcePicker({
  rows, selected, onSelect, label = "LINK A DRINK (optional)",
}: {
  rows: ToastCacheRow[];
  selected: string | null;
  onSelect: (guid: string | null) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = selected ? rows.find((r) => r.guid === selected) : undefined;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => r.menu_group !== "★ SCREENS") // featured duplicates aren't picker sources
      .filter((r) => !needle || (r.name ?? "").toLowerCase().includes(needle) || (r.menu_group ?? "").toLowerCase().includes(needle))
      .slice(0, 60);
  }, [rows, q]);

  const warn = sel?.out_of_stock ? "86'D — this card auto-hides on screen" : sel && !sel.pos_visible ? "OFF POS VIEW — this card auto-hides on screen" : null;

  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={caption}>{label}</span>
        {sel && <button type="button" onClick={() => onSelect(null)} style={{ ...ghost, fontSize: 15, padding: "4px 10px" }}>CLEAR</button>}
      </div>
      {sel ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {sel.image && <img src={sel.image} alt="" style={{ width: 44, height: 44, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sig-live" style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.name}</div>
              <div style={{ fontSize: 14, opacity: 0.6 }}>
                {sel.menu_group}{sel.price != null ? <> · <span className="sig-live">${sel.price}</span></> : null}
              </div>
            </div>
            <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...ghost, fontSize: 15 }}>CHANGE</button>
          </div>
          {warn && <div className="u-amber" style={{ fontSize: 14 }}>⚠ {warn}</div>}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} style={ghost}>{open ? "CLOSE PICKER" : "PICK A TOAST ITEM"}</button>
      )}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input autoFocus placeholder="search name or group…" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", fontSize: 18, fontFamily: MONO, minHeight: 44 }} />
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.length === 0 && <div style={{ opacity: 0.6, fontSize: 16 }}>No matches (has the menu synced yet?).</div>}
            {filtered.map((r) => (
              <button
                key={r.guid}
                type="button"
                onClick={() => { onSelect(r.guid); setOpen(false); }}
                style={{ display: "flex", gap: 10, alignItems: "center", background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.25)", padding: "6px 8px", cursor: "pointer", fontFamily: MONO, minHeight: 48, opacity: r.pos_visible ? 1 : 0.5 }}
              >
                {r.image
                  ? <img src={r.image} alt="" style={{ width: 36, height: 36, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                  : <span style={{ width: 36, height: 36, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
                <span style={{ flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 17 }}>{r.name}</span>
                <span style={{ fontSize: 13, opacity: 0.6, whiteSpace: "nowrap" }}>{r.menu_group}</span>
                {!r.pos_visible && <span className="u-amber" style={{ fontSize: 11, whiteSpace: "nowrap" }}>POS-HIDDEN</span>}
                {r.out_of_stock && <span className="u-amber" style={{ fontSize: 12 }}>86</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

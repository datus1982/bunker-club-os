import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Modal, Field, input as inputStyle, btnGhost } from "@/modules/trivia/ui";
import type { Orientation, SignageItem, Template, ToastCacheRow } from "./useSignage";
import {
  type AdminItem, type AdminSlot, type ItemDraft, type Recurrence,
  saveItem, uploadSignageImage, linkedMoment, saveMoment, toastMap,
} from "./useSignageAdmin";
import { SignagePreview } from "./SignagePreview";

/**
 * Add/edit a signage item (/signage — docs/09 Admin). Modal flow:
 *   new  → template picker (5 tiles) → template-specific form + live preview
 *   edit → straight to the form.
 *
 * Mobile-first (owner works from his phone at the bar): one column, ≥44px controls,
 * the live preview pinned under the header so field edits are visible immediately.
 * Toast is READ-ONLY (docs/09 amendment) — the source picker only stamps
 * source_toast_guid; name/price/photo then render LIVE (green) from the cache.
 */

const MONO = "'VT323','Share Tech Mono',monospace";
const TEMPLATES: { key: Template; label: string; blurb: string; icon: string }[] = [
  { key: "drink_special", label: "DRINK SPECIAL", blurb: "Featured pour — price + photo", icon: "🍺" },
  { key: "event", label: "EVENT", blurb: "Upcoming night — date + blurb", icon: "📅" },
  { key: "announcement", label: "ANNOUNCEMENT", blurb: "Text bulletin, typewriter", icon: "▮" },
  { key: "image_only", label: "IMAGE", blurb: "Full-frame photo / flyer", icon: "🖼" },
  { key: "celebration", label: "CELEBRATION", blurb: "Birthday, bachelor, congrats", icon: "✸" },
  { key: "top_sellers", label: "TOP SELLERS", blurb: "Live top-5 from the POS", icon: "📊" },
];

const SKINS = ["birthday", "bachelor", "bachelorette", "anniversary", "congrats"] as const;
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function ItemEditor({
  slots, toastRows, defaultSlotId, editing, presetTemplate, nextSortOrder, onClose, onSaved,
}: {
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  defaultSlotId: string | null;
  editing: AdminItem | null;
  /** Skip the template picker and open straight into this template (hub quick actions).
   *  Only applies when creating (editing === null); editing always uses its own template. */
  presetTemplate?: Template | null;
  nextSortOrder: (slotId: string | null) => number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [template, setTemplate] = useState<Template | null>(editing?.template ?? presetTemplate ?? null);

  if (!template) {
    return (
      <Modal title="NEW SIGNAGE ITEM" onClose={onClose}>
        <div style={{ fontSize: 18, opacity: 0.7 }}>Pick a template:</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTemplate(t.key)}
              style={tile}
            >
              <span style={{ fontSize: 34 }}>{t.icon}</span>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>{t.label}</span>
              <span style={{ fontSize: 14, opacity: 0.65 }}>{t.blurb}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <ItemForm
      template={template}
      slots={slots}
      toastRows={toastRows}
      defaultSlotId={defaultSlotId}
      editing={editing}
      nextSortOrder={nextSortOrder}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

/* ── the form ───────────────────────────────────────────────────────────── */
function ItemForm({
  template, slots, toastRows, defaultSlotId, editing, nextSortOrder, onClose, onSaved,
}: {
  template: Template;
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  defaultSlotId: string | null;
  editing: AdminItem | null;
  nextSortOrder: (slotId: string | null) => number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCeleb = template === "celebration";
  const [slotId, setSlotId] = useState<string | null>(editing?.slot_id ?? defaultSlotId ?? slots[0]?.id ?? null);
  const [active, setActive] = useState(editing?.active ?? true);
  const [showOnWebsite, setShowOnWebsite] = useState(editing?.show_on_website ?? false);
  const [duration, setDuration] = useState(editing?.duration_seconds ?? 12);
  const [fields, setFields] = useState<Record<string, unknown>>(() => {
    const base = { ...(editing?.fields ?? {}) };
    if (isCeleb && !editing) {
      base.skin = "birthday";
      base.date = todayLocal();
    }
    return base;
  });
  const [startsAt, setStartsAt] = useState<string>(toLocalInput(editing?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState<string>(toLocalInput(editing?.ends_at ?? null));
  const [recurrence, setRecurrence] = useState<Recurrence | null>(editing?.recurrence ?? null);

  // Celebration date is a single field that drives a whole-day schedule window.
  const [celebDate, setCelebDate] = useState<string>(
    isCeleb ? (str(editing?.fields?.date) ?? todayLocal()) : todayLocal(),
  );

  // Shout-out moment (celebration only) — a linked screen_takeovers row.
  const [momentOn, setMomentOn] = useState(false);
  const [momentTime, setMomentTime] = useState("21:00");
  const [momentDur, setMomentDur] = useState(60);
  // The linked-moment query is async. Until it resolves we must NOT write the moment —
  // an early save would call saveMoment(id, null) and silently delete an existing shout-out
  // (N8). For a new item or a non-celebration there is nothing to load, so start "loaded".
  const [momentLoaded, setMomentLoaded] = useState(!(isCeleb && editing));
  useEffect(() => {
    if (!isCeleb || !editing) return;
    linkedMoment(editing.id).then((m) => {
      if (m) {
        setMomentOn(true);
        const d = new Date(m.starts_at);
        setMomentTime(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
        if (m.ends_at) {
          setMomentDur(Math.round((new Date(m.ends_at).getTime() - d.getTime()) / 1000));
        }
      }
      setMomentLoaded(true);
    }).catch(() => setMomentLoaded(true));
  }, [isCeleb, editing]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const orientation: Orientation = slots.find((x) => x.id === slotId)?.orientation ?? "portrait";
  const tmap = useMemo(() => toastMap(toastRows), [toastRows]);

  const setField = (k: string, v: unknown) =>
    setFields((f) => {
      const next = { ...f };
      if (v === "" || v == null) delete next[k];
      else next[k] = v;
      return next;
    });

  const draftItem: SignageItem = {
    id: editing?.id ?? "draft",
    slot_id: slotId,
    template,
    fields: isCeleb ? { ...fields, date: celebDate } : fields,
    starts_at: null,
    ends_at: null,
    sort_order: 0,
    duration_seconds: duration,
    active,
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let ns = startsAt ? fromLocalInput(startsAt) : null;
      let ne = endsAt ? fromLocalInput(endsAt) : null;
      const outFields = { ...fields };
      if (isCeleb) {
        outFields.date = celebDate;
        // Celebration auto-shows for its whole day (docs/09: "date (default tonight)").
        ns = fromLocalInput(`${celebDate}T00:00`);
        ne = fromLocalInput(`${celebDate}T23:59`);
      }
      const draft: ItemDraft = {
        id: editing?.id,
        slot_id: slotId,
        template,
        fields: outFields,
        starts_at: ns,
        ends_at: ne,
        recurrence,
        duration_seconds: duration,
        active,
        show_on_website: showOnWebsite,
      };
      const id = await saveItem(draft, nextSortOrder(slotId));
      // Only touch the linked moment once its query has resolved (N8) — otherwise a save
      // that races the load would delete an existing shout-out. The submit button is also
      // disabled until momentLoaded, so this is belt-and-suspenders.
      if (isCeleb && momentLoaded) {
        const honoree = (str(outFields.honoree) ?? "OUR GUEST").toUpperCase();
        await saveMoment(
          id,
          momentOn
            ? {
                startsAt: fromLocalInput(`${celebDate}T${momentTime}`),
                durationSeconds: momentDur,
                message: `RAISE A GLASS FOR ${honoree}`,
                sub: str(outFields.occasion) ?? null,
              }
            : null,
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? "EDIT ITEM" : `NEW — ${labelFor(template)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost}>CANCEL</button>
          <button type="button" onClick={submit} disabled={busy || !momentLoaded} className="u-fill u-ink" style={{ ...btnPrimary, opacity: busy || !momentLoaded ? 0.5 : 1 }}>
            {busy ? "SAVING…" : !momentLoaded ? "LOADING…" : editing ? "SAVE" : "CREATE"}
          </button>
        </>
      }
    >
      {/* Live preview — pinned first so edits are visible immediately (docs/09). */}
      <div>
        <div style={caption}>LIVE PREVIEW · {orientation.toUpperCase()}</div>
        <SignagePreview item={draftItem} toast={tmap} orientation={orientation} maxWidth={orientation === "portrait" ? 240 : 380} />
      </div>

      {/* Template-specific fields */}
      {template === "drink_special" && (
        <DrinkSpecialFields fields={fields} setField={setField} toastRows={toastRows} tmap={tmap} />
      )}
      {template === "event" && <EventFields fields={fields} setField={setField} />}
      {template === "announcement" && <AnnouncementFields fields={fields} setField={setField} />}
      {template === "image_only" && <ImageOnlyFields fields={fields} setField={setField} />}
      {template === "top_sellers" && <TopSellersFields />}
      {template === "celebration" && (
        <CelebrationFields
          fields={fields}
          setField={setField}
          celebDate={celebDate}
          setCelebDate={setCelebDate}
          momentOn={momentOn}
          setMomentOn={setMomentOn}
          momentTime={momentTime}
          setMomentTime={setMomentTime}
          momentDur={momentDur}
          setMomentDur={setMomentDur}
        />
      )}

      {(template === "announcement" || template === "celebration") && (
        <RecurrenceField value={recurrence} onChange={setRecurrence} />
      )}

      <div className="terminal-separator" style={{ margin: "4px 0" }} />

      {/* Common placement / scheduling */}
      <Field label="SLOT">
        <select value={slotId ?? ""} onChange={(e) => setSlotId(e.target.value || null)} style={sel}>
          {slots.map((s) => (
            <option key={s.id} value={s.id} style={opt}>{s.name} ({s.orientation})</option>
          ))}
        </select>
      </Field>

      {!isCeleb && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="STARTS (blank = evergreen)">
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={sel} />
          </Field>
          <Field label="ENDS (blank = evergreen)">
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={sel} />
          </Field>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="ON SCREEN (SECONDS)">
          <input type="number" min={4} value={duration} onChange={(e) => setDuration(Math.max(4, parseInt(e.target.value) || 12))} style={{ ...sel, width: 120 }} />
        </Field>
        <label style={checkLabel}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={checkbox} />
          <span>ACTIVE</span>
        </label>
      </div>

      {/* Publish to the public marketing site /events page (0015 flag). */}
      <label style={{ ...checkLabel, alignItems: "flex-start" }}>
        <input type="checkbox" checked={showOnWebsite} onChange={(e) => setShowOnWebsite(e.target.checked)} style={{ ...checkbox, marginTop: 2 }} />
        <span>
          🌐 SHOW ON WEBSITE
          <span style={{ display: "block", fontSize: 14, opacity: 0.55, letterSpacing: 0 }}>
            Publishes this item to the public bunkerokc.com events page.
          </span>
        </span>
      </label>

      {err && <div className="u-red" style={{ fontSize: 18 }}>⚠ {err}</div>}
    </Modal>
  );
}

/* ── drink_special ──────────────────────────────────────────────────────── */
function DrinkSpecialFields({
  fields, setField, toastRows, tmap,
}: FieldProps & { toastRows: ToastCacheRow[]; tmap: Map<string, ToastCacheRow> }) {
  const guid = str(fields.source_toast_guid);
  const src = guid ? tmap.get(guid) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ToastPicker rows={toastRows} selected={guid} onSelect={(g) => setField("source_toast_guid", g)} />

      {src ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, opacity: 0.7 }}>
            LIVE from Toast (shown green on screen): <b>{src.name}</b>{src.price != null ? ` · $${src.price}` : ""}.
            Fields below OVERRIDE the live values — leave blank to keep live.
          </div>
          <Field label="NAME OVERRIDE"><input placeholder={src.name ?? ""} value={str(fields.name) ?? ""} onChange={(e) => setField("name", e.target.value)} style={sel} /></Field>
          <Field label="PRICE OVERRIDE"><input type="number" step="0.01" placeholder={src.price != null ? String(src.price) : ""} value={numStr(fields.price)} onChange={(e) => setField("price", e.target.value)} style={sel} /></Field>
          <Field label="TAGLINE / BLURB">
            <input placeholder={src.public_blurb ?? "no public blurb — write one"} value={str(fields.tagline) ?? ""} onChange={(e) => setField("tagline", e.target.value)} style={sel} />
          </Field>
          <div style={{ fontSize: 14, opacity: 0.6 }}>
            {src.public_blurb
              ? "A public blurb exists in Toast (text before ---); it shows unless you override here."
              : "No public blurb in Toast — Toast descriptions are never shown (recipe safety). Write one above."}
          </div>
          <PhotoOverride fields={fields} setField={setField} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 14, opacity: 0.6 }}>Manual — or pick a Toast source above to auto-fill name/price/photo.</div>
          <Field label="NAME"><input value={str(fields.name) ?? ""} onChange={(e) => setField("name", e.target.value)} style={sel} /></Field>
          <Field label="PRICE"><input type="number" step="0.01" value={numStr(fields.price)} onChange={(e) => setField("price", e.target.value)} style={sel} /></Field>
          <Field label="TAGLINE"><input value={str(fields.tagline) ?? ""} onChange={(e) => setField("tagline", e.target.value)} style={sel} /></Field>
          <ImageField fields={fields} setField={setField} />
        </div>
      )}
      <TreatmentToggle fields={fields} setField={setField} />
    </div>
  );
}

function PhotoOverride({ fields, setField }: FieldProps) {
  return (
    <div>
      <div style={{ fontSize: 15, opacity: 0.7, marginBottom: 4 }}>PHOTO OVERRIDE (blank = live Toast photo)</div>
      <ImageField fields={fields} setField={setField} />
    </div>
  );
}

/* ── event ──────────────────────────────────────────────────────────────── */
function EventFields({ fields, setField }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="TITLE"><input value={str(fields.title) ?? ""} onChange={(e) => setField("title", e.target.value)} style={sel} /></Field>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field label="DATE"><input type="date" value={str(fields.date) ?? ""} onChange={(e) => setField("date", e.target.value)} style={sel} /></Field>
        <Field label="TIME"><input placeholder="8:00 PM" value={str(fields.time) ?? ""} onChange={(e) => setField("time", e.target.value)} style={sel} /></Field>
      </div>
      <Field label="BLURB"><textarea rows={2} value={str(fields.blurb) ?? ""} onChange={(e) => setField("blurb", e.target.value)} style={{ ...sel, resize: "vertical" }} /></Field>
      <ImageField fields={fields} setField={setField} />
      <TreatmentToggle fields={fields} setField={setField} />
    </div>
  );
}

/* ── announcement ───────────────────────────────────────────────────────── */
function AnnouncementFields({ fields, setField }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="MESSAGE"><textarea rows={3} value={str(fields.text) ?? ""} onChange={(e) => setField("text", e.target.value)} style={{ ...sel, resize: "vertical" }} /></Field>
      <Field label="PRIORITY">
        <select value={str(fields.priority) ?? "LOW"} onChange={(e) => setField("priority", e.target.value)} style={sel}>
          <option style={opt} value="LOW">LOW</option>
          <option style={opt} value="MED">MED</option>
          <option style={opt} value="HIGH">HIGH</option>
        </select>
      </Field>
    </div>
  );
}

/* ── image_only ─────────────────────────────────────────────────────────── */
function TopSellersFields() {
  return (
    <div className="terminal-border" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 15, lineHeight: 1.5 }}>
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>📊 LIVE SLIDE — NOTHING TO FILL IN</div>
      <div style={{ opacity: 0.75 }}>
        Shows tonight's whole-menu <b>TOP 5</b> sellers straight from the POS, updating live as pours ring up.
        No name, price, or photo to set — just pick the slot, how long it lingers, and switch it ON.
      </div>
      <div style={{ opacity: 0.6, fontSize: 14 }}>
        Respects the POS-visibility rule automatically (a product pulled off the POS view never shows here).
        Tip: give it a longer duration than a quick promo so guests can read all five.
      </div>
    </div>
  );
}

function ImageOnlyFields({ fields, setField }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ImageField fields={fields} setField={setField} />
      <Field label="CAPTION"><input value={str(fields.caption) ?? ""} onChange={(e) => setField("caption", e.target.value)} style={sel} /></Field>
      <TreatmentToggle fields={fields} setField={setField} />
    </div>
  );
}

/* ── celebration ────────────────────────────────────────────────────────── */
function CelebrationFields({
  fields, setField, celebDate, setCelebDate,
  momentOn, setMomentOn, momentTime, setMomentTime, momentDur, setMomentDur,
}: FieldProps & {
  celebDate: string; setCelebDate: (v: string) => void;
  momentOn: boolean; setMomentOn: (v: boolean) => void;
  momentTime: string; setMomentTime: (v: string) => void;
  momentDur: number; setMomentDur: (v: number) => void;
}) {
  const skin = str(fields.skin) ?? "birthday";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={caption}>OCCASION</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SKINS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setField("skin", s)}
              className={skin === s ? "u-fill u-ink" : ""}
              style={{ ...chip, ...(skin === s ? chipActive : null) }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <Field label="HONOREE NAME"><input value={str(fields.honoree) ?? ""} onChange={(e) => setField("honoree", e.target.value)} style={sel} /></Field>
      <Field label="OCCASION LINE (optional)"><input placeholder="auto: skin default" value={str(fields.occasion) ?? ""} onChange={(e) => setField("occasion", e.target.value)} style={sel} /></Field>
      <Field label="MESSAGE (optional)"><textarea rows={2} value={str(fields.message) ?? ""} onChange={(e) => setField("message", e.target.value)} style={{ ...sel, resize: "vertical" }} /></Field>
      <Field label="DATE"><input type="date" value={celebDate} onChange={(e) => setCelebDate(e.target.value)} style={sel} /></Field>
      <div>
        <div style={{ fontSize: 15, opacity: 0.7, marginBottom: 4 }}>PHOTO (optional)</div>
        <ImageField fields={fields} setField={setField} />
      </div>

      {/* Shout-out moment — a scheduled, linked takeover (docs/09: sellable party line). */}
      <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={checkLabel}>
          <input type="checkbox" checked={momentOn} onChange={(e) => setMomentOn(e.target.checked)} style={checkbox} />
          <span>★ SHOUT-OUT MOMENT — their name on EVERY screen at their minute</span>
        </label>
        {momentOn && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="AT"><input type="time" value={momentTime} onChange={(e) => setMomentTime(e.target.value)} style={sel} /></Field>
            <Field label="FOR">
              <select value={momentDur} onChange={(e) => setMomentDur(parseInt(e.target.value))} style={sel}>
                <option style={opt} value={30}>30 sec</option>
                <option style={opt} value={60}>60 sec</option>
                <option style={opt} value={120}>120 sec</option>
              </select>
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared field bits ──────────────────────────────────────────────────── */
interface FieldProps {
  fields: Record<string, unknown>;
  setField: (k: string, v: unknown) => void;
}

function TreatmentToggle({ fields, setField }: FieldProps) {
  const t = str(fields.photo_treatment) ?? "viewport";
  if (!str(fields.image_url) && !str(fields.source_toast_guid)) return null;
  return (
    <div>
      <div style={caption}>PHOTO TREATMENT</div>
      <div style={{ display: "flex", gap: 8 }}>
        {(["viewport", "phosphor"] as const).map((opt2) => (
          <button
            key={opt2}
            type="button"
            onClick={() => setField("photo_treatment", opt2)}
            className={t === opt2 ? "u-fill u-ink" : ""}
            style={{ ...chip, ...(t === opt2 ? chipActive : null) }}
          >
            {opt2.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 14, opacity: 0.6, marginTop: 4 }}>
        Selling it → VIEWPORT (full colour). Setting a mood → PHOSPHOR (ink-tinted).
      </div>
    </div>
  );
}

function ImageField({ fields, setField }: FieldProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const url = str(fields.image_url);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const publicUrl = await uploadSignageImage(file);
      setField("image_url", publicUrl);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "upload failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {url && <img src={url} alt="" style={{ width: 64, height: 64, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />}
      <input ref={ref} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} style={btnGhost}>
        {busy ? "UPLOADING…" : url ? "REPLACE PHOTO" : "UPLOAD PHOTO"}
      </button>
      {url && <button type="button" onClick={() => setField("image_url", "")} style={btnGhost}>REMOVE</button>}
      {err && <span className="u-red" style={{ fontSize: 15 }}>⚠ {err}</span>}
    </div>
  );
}

// DECISION: recurrence is PERSISTED here (shape per 0009/0010 comments) and rendered as a
// RECURS badge, but the pg_cron re-arm job that recomputes starts_at/ends_at on completion
// is OUT of scope for this task — it ships with the events module (Phase 7). Until then a
// recurring item behaves as a one-shot on its next window; the stored shape is forward-compatible.
function RecurrenceField({ value, onChange }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const kind = value?.kind ?? "none";
  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={caption}>RECURRENCE</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["none", "annual", "weekly"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(
              k === "none" ? null
                : k === "annual" ? { kind: "annual", month: 1, day: 1 }
                : { kind: "weekly", daysOfWeek: [] },
            )}
            className={kind === k ? "u-fill u-ink" : ""}
            style={{ ...chip, ...(kind === k ? chipActive : null) }}
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      {value?.kind === "annual" && (
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="MONTH"><input type="number" min={1} max={12} value={value.month} onChange={(e) => onChange({ kind: "annual", month: clamp(parseInt(e.target.value) || 1, 1, 12), day: value.day })} style={{ ...sel, width: 90 }} /></Field>
          <Field label="DAY"><input type="number" min={1} max={31} value={value.day} onChange={(e) => onChange({ kind: "annual", month: value.month, day: clamp(parseInt(e.target.value) || 1, 1, 31) })} style={{ ...sel, width: 90 }} /></Field>
        </div>
      )}
      {value?.kind === "weekly" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DOW.map((d) => {
            const on = value.daysOfWeek.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => onChange({ kind: "weekly", daysOfWeek: on ? value.daysOfWeek.filter((x) => x !== d) : [...value.daysOfWeek, d] })}
                className={on ? "u-fill u-ink" : ""}
                style={{ ...chip, ...(on ? chipActive : null), minWidth: 44 }}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 13, opacity: 0.55 }}>Re-arm on completion ships with the events module — stored now, forward-compatible.</div>
    </div>
  );
}

/* ── Toast source picker ────────────────────────────────────────────────── */
function ToastPicker({ rows, selected, onSelect }: { rows: ToastCacheRow[]; selected: string | undefined; onSelect: (g: string) => void }) {
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

  return (
    <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={caption}>SOURCE FROM TOAST</span>
        {sel && <button type="button" onClick={() => onSelect("")} style={{ ...btnGhost, fontSize: 15, padding: "4px 10px", minHeight: 44 }}>CLEAR</button>}
      </div>
      {sel ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {sel.image && <img src={sel.image} alt="" style={{ width: 44, height: 44, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.name}</div>
            <div style={{ fontSize: 14, opacity: 0.6 }}>{sel.menu_group}{sel.price != null ? ` · $${sel.price}` : ""}{sel.out_of_stock ? " · 86'D" : ""}{sel.pos_visible ? "" : " · POS-HIDDEN"}</div>
          </div>
          <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...btnGhost, fontSize: 15, minHeight: 44 }}>CHANGE</button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} style={btnGhost}>{open ? "CLOSE PICKER" : "PICK A TOAST ITEM"}</button>
      )}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input autoFocus placeholder="search name or group…" value={q} onChange={(e) => setQ(e.target.value)} style={sel2} />
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.length === 0 && <div style={{ opacity: 0.6, fontSize: 16 }}>No matches (has the menu synced yet?).</div>}
            {filtered.map((r) => (
              <button
                key={r.guid}
                type="button"
                onClick={() => { onSelect(r.guid); setOpen(false); }}
                // POS-hidden items are shown (staff want to see why an item can't be
                // advertised) but dimmed + badged, and picking one auto-hides on-screen.
                style={{ ...pickRow, alignItems: "center", opacity: r.pos_visible ? 1 : 0.5 }}
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

/* ── helpers ────────────────────────────────────────────────────────────── */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function numStr(v: unknown): string {
  return typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
}
function pad2(n: number): string { return String(n).padStart(2, "0"); }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** ISO → value for <input type="datetime-local"> (local wall time, minute precision). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** datetime-local value (local wall time) → ISO (UTC). */
function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}
function labelFor(t: Template): string {
  return TEMPLATES.find((x) => x.key === t)?.label ?? t.toUpperCase();
}

/* ── styles ─────────────────────────────────────────────────────────────── */
const sel: CSSProperties = { ...inputStyle, fontSize: 20, minHeight: 44 };
const sel2: CSSProperties = { ...inputStyle, fontSize: 18, minHeight: 44 };
const opt: CSSProperties = { background: "#000" };
const caption: CSSProperties = { fontSize: 15, letterSpacing: 2, opacity: 0.6, marginBottom: 6 };
const checkLabel: CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 18, cursor: "pointer", minHeight: 44 };
const checkbox: CSSProperties = { width: 22, height: 22, accentColor: "var(--terminal-green)", cursor: "pointer" };
const btnPrimary: CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 20px", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: MONO, minHeight: 44 };
const tile: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center", padding: "18px 10px", background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", cursor: "pointer", fontFamily: MONO, minHeight: 110 };
const chip: CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 12px", fontSize: 16, cursor: "pointer", fontFamily: MONO, minHeight: 44, letterSpacing: 1 };
const chipActive: CSSProperties = { fontWeight: 700 };
const pickRow: CSSProperties = { display: "flex", gap: 10, background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.25)", padding: "6px 8px", cursor: "pointer", fontFamily: MONO, minHeight: 48 };

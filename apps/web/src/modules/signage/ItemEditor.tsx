import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import { Modal, Field, input as inputStyle, btnGhost } from "@/modules/trivia/ui";
import type { Orientation, SignageItem, Template, ToastCacheRow } from "./useSignage";
import { DEFAULT_NOW_PLAYING_SOURCE, useVenueClock, recurrenceSentence, daysInMonth } from "./useSignage";
import { DOW, DOW_LABEL } from "./useEventsAdmin";
import {
  type AdminItem, type AdminSlot, type ItemDraft, type Recurrence,
  saveItem, deleteItem, uploadCustomImage, linkedMoment, saveMoment, toastMap,
} from "./useSignageAdmin";
import { addToQueue } from "./slotQueue";
import { FormatControls } from "./signageAdminShared";
import { alignOf, type Align } from "./richText";
import { SignagePreview } from "./SignagePreview";
import { ConfirmDialog, TapTargetCheckbox } from "@/shared/ui";
import { TAP, staffSurface } from "@/shared/ui/tokens";

/**
 * Add/edit a signage ASSET (docs/signage-hub-consolidation-mockup.html, D7). Modal flow:
 *   new  → template picker (8 tiles) → template-specific form + live preview
 *   edit → straight to the form.
 *
 * The asset is VENUE-WIDE (slot_queue owns placement, 0045). This editor edits the asset's
 * CONTENT — never its per-screen placement (D7: editing a shared asset changes it on every
 * screen it runs; position + SECS are the only per-screen difference, and those live in the
 * QUEUE). So:
 *   • CREATE — saves the asset, then (when opened from a screen card's + ADD) queues it on
 *     that screen via addToQueue. From the library's + NEW ASSET it stays idle until queued.
 *   • EDIT   — saves content only; placements are untouched. DELETE removes the asset from
 *     EVERY screen (D4 — the destructive action lives here, behind a confirm, not on a queue row).
 *
 * Mobile-first (owner works from his phone at the bar): one column, ≥44px controls, the live
 * preview pinned under the header. Toast is READ-ONLY (docs/09 amendment) — the source picker
 * only stamps source_toast_guid; name/price/photo then render LIVE (green) from the cache.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 5) — `variant`.
 *
 * This editor is SHARED: the classic hub's QUEUE ▸ edit / + ADD ▸ template open it, and so do
 * the v2 hub and BAR OPS ▸ SLIDES. It is built on the trivia `Modal`, which reads
 * `TriviaV2Context` — and that context is `false` with no provider BY DESIGN, so on a v2 page
 * the editor arrived in the classic green frame (overlay inventory §D finding 2). The fix is
 * the same shape as PR 2: `variant="v2"` threaded from the page that knows it (never derived
 * here), the Modal told explicitly (`v2={…}`), and a v2 branch at each LEAF below.
 *
 * ONE component, one tree. CLASSIC IS BYTE-IDENTICAL: every branched `style` is a
 * WHOLE-OBJECT ternary whose classic arm is the shipped literal, key for key; every classic
 * className/text string is the shipped one. The v2 leaves take role classes (`st-label` /
 * `st-body` / `st-heading`), geometry-only twins (bottom of file), `st-btn` chips with
 * `aria-pressed`, `st-card` in place of `terminal-border`, `TapTargetCheckbox` in place of
 * the hand-padded checkbox rows, and the calmed accent (`st-accent`, never the reserved
 * `.st-live`) on the linked Toast name/price — PR 4's ruling for the same values.
 *
 * THE LIVE PREVIEW IS NOT TOUCHED. `SignagePreview` renders the real board under
 * `.signage-slot`, and the token sheet's blanket carves that subtree out (PR 1) — so it
 * stays VT323/amber inside a tokened sheet, which is the whole point of it.
 *
 * NOTHING ABOUT BEHAVIOUR MOVES: same `saveItem` / `deleteItem` / `uploadCustomImage` /
 * `addToQueue` / `saveMoment` calls with the same arguments, same `busy` gating, same
 * `noDaysPicked` guard. The ONE addition is v2-only and write-PREVENTING: DELETE is data
 * loss, so v2 routes it through the ratified `ConfirmDialog` in the danger ink ("Delete
 * slide" / "Keep slide"); classic keeps its `window.confirm`.
 * ──────────────────────────────────────────────────────────────────────────────────── */

const MONO = "'VT323','Share Tech Mono',monospace";
/** The asset templates a manager can create — shared with the hub's + ADD picker
 *  (docs/signage-hub-consolidation-mockup.html view 3 NEW ASSET tiles) so the two never drift. */
export const ITEM_TEMPLATES: { key: Template; label: string; blurb: string; icon: string }[] = [
  { key: "drink_special", label: "DRINK SPECIAL", blurb: "Featured pour — price + photo", icon: "🍺" },
  { key: "event", label: "EVENT", blurb: "Upcoming night — date + blurb", icon: "📅" },
  { key: "announcement", label: "ANNOUNCEMENT", blurb: "Text bulletin, typewriter", icon: "▮" },
  { key: "image_only", label: "IMAGE", blurb: "Full-frame photo / flyer", icon: "🖼" },
  { key: "celebration", label: "CELEBRATION", blurb: "Birthday, bachelor, congrats", icon: "✸" },
  { key: "top_sellers", label: "TOP SELLERS", blurb: "Live top-5 from the POS", icon: "📊" },
  { key: "instagram", label: "INSTAGRAM", blurb: "Recent @posts — caption + QR", icon: "▦" },
  { key: "smart_toast", label: "SMART TOAST", blurb: "Underdogs or the champion — auto", icon: "🎯" },
  { key: "now_playing", label: "NOW PLAYING", blurb: "Cross-promo from the movie screen", icon: "🎬" },
  { key: "menu_group", label: "MENU GROUP", blurb: "One menu section, listed full-screen", icon: "▤" },
];

const SKINS = ["birthday", "bachelor", "bachelorette", "anniversary", "congrats"] as const;
// (day chips now reuse useEventsAdmin's Mon-first DOW + DOW_LABEL — one day vocabulary for
//  both recurrence builders in this console; the stored tokens are unchanged.)

export function ItemEditor({
  slots, toastRows, editing, presetTemplate, venueName, queueOnSlotId, placementSlotIds, nextPosition, onClose, onSaved, onDeleted,
  variant = "classic",
}: {
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  editing: AdminItem | null;
  /** Skip the template picker and open straight into this template (card + ADD ▸ NEW ASSET).
   *  Only applies when creating (editing === null); editing always uses its own template. */
  presetTemplate?: Template | null;
  /** Venue mark for the live preview's drink_special footer (threaded to SignagePreview). */
  venueName?: string;
  /** Slot to QUEUE a NEW asset on after save (a screen card's + ADD). null/undefined = create
   *  it idle (library + NEW ASSET). Ignored on edit — placement is never touched there (D7). */
  queueOnSlotId?: string | null;
  /** Slots the edited asset currently runs on (read-only "on these screens" line). */
  placementSlotIds?: string[];
  /** Append position for the queue placement on create (max existing position + 1 on that slot). */
  nextPosition?: (slotId: string) => number;
  onClose: () => void;
  onSaved: () => void;
  /** Called after DELETE removes the asset from every screen. */
  onDeleted?: () => void;
  // DECISION: (Beat 8 PR 5) the variant is THREADED from the page/wrapper that already knows
  // it (AssetOverlay ← HubOverlays / SlidesPage), never re-derived here with `useUiVersion()`.
  /** "v2" renders the tokened sheet (Beat 8 PR 5). Defaults to the shipped classic modal. */
  variant?: "classic" | "v2";
}) {
  const v2 = variant === "v2";
  const [template, setTemplate] = useState<Template | null>(editing?.template ?? presetTemplate ?? null);

  if (!template) {
    return (
      <Modal title={v2 ? "New slide" : "NEW ASSET"} onClose={onClose} v2={v2}>
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 18, opacity: 0.7 }}>Pick a template:</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {ITEM_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTemplate(t.key)}
              className={v2 ? "st-btn st-card st-body" : undefined}
              style={v2 ? tileV2 : tile}
            >
              <span style={{ fontSize: 34 }}>{t.icon}</span>
              <span className={v2 ? "st-heading" : undefined} style={v2 ? undefined : { fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>{v2 ? (V2_LABEL[t.key] ?? t.label) : t.label}</span>
              <span className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.65 }}>{t.blurb}</span>
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
      editing={editing}
      venueName={venueName}
      queueOnSlotId={queueOnSlotId}
      placementSlotIds={placementSlotIds}
      nextPosition={nextPosition}
      onClose={onClose}
      onSaved={onSaved}
      onDeleted={onDeleted}
      v2={v2}
    />
  );
}

/* ── the form ───────────────────────────────────────────────────────────── */
function ItemForm({
  template, slots, toastRows, editing, venueName, queueOnSlotId, placementSlotIds, nextPosition, onClose, onSaved, onDeleted, v2,
}: {
  template: Template;
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  editing: AdminItem | null;
  venueName?: string;
  queueOnSlotId?: string | null;
  placementSlotIds?: string[];
  nextPosition?: (slotId: string) => number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
  v2: boolean;
}) {
  const isCeleb = template === "celebration";
  // Placement is NOT edited here (D7). The preview just needs an orientation to render at;
  // default to the slot we're queueing a new asset on, else the slot the edited asset already
  // runs on, else portrait. A toggle lets the manager check both orientations (the asset can
  // run on either screen).
  const queueSlot = slots.find((s) => s.id === queueOnSlotId);
  const firstPlacementSlot = slots.find((s) => (placementSlotIds ?? []).includes(s.id));
  const [previewOri, setPreviewOri] = useState<Orientation>(
    queueSlot?.orientation ?? firstPlacementSlot?.orientation ?? "portrait",
  );
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
  // CERTAIN DAYS chosen but no day ticked — an intent that would save as "every day". Gates SAVE.
  const noDaysPicked = recurrence?.kind === "weekly" && recurrence.daysOfWeek.length === 0;

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
  // DECISION: (Beat 8 PR 5) the delete confirm is v2-ONLY — a write-PREVENTING addition on the
  // tokened leg (the PR #103 / PR 2 precedent). Classic keeps its `window.confirm` verbatim.
  // v2 only — is the ratified ConfirmDialog up? Same `del.mutate()` behind it, same args.
  const [confirmDelete, setConfirmDelete] = useState(false);

  const orientation: Orientation = previewOri;
  const tmap = useMemo(() => toastMap(toastRows), [toastRows]);
  const del = useMutation({
    mutationFn: () => deleteItem(editing!.id),
    onSuccess: () => { onDeleted?.(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Delete failed."),
  });

  const setField = (k: string, v: unknown) =>
    setFields((f) => {
      const next = { ...f };
      if (v === "" || v == null) delete next[k];
      else next[k] = v;
      return next;
    });

  const draftItem: SignageItem = {
    id: editing?.id ?? "draft",
    slot_id: null,
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
        slot_id: null, // placement is on slot_queue now (0045); the asset row is venue-wide
        template,
        fields: outFields,
        starts_at: ns,
        ends_at: ne,
        recurrence,
        duration_seconds: duration,
        active,
        show_on_website: showOnWebsite,
      };
      const id = await saveItem(draft);
      // On CREATE from a screen card's + ADD, queue the new asset on that screen (append) with
      // the chosen dwell (D6). On EDIT we never touch placement (D7) — the queue owns position +
      // SECS per screen, so a content edit can't move or re-dwell a shared card.
      if (!editing && queueOnSlotId) {
        await addToQueue(queueOnSlotId, id, nextPosition ? nextPosition(queueOnSlotId) : 0, duration);
      }
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

  // v2 leaf kit (twins at the bottom of the file carry GEOMETRY only — ink, face and size come
  // from the role classes; an inline colour cannot beat `.terminal-theme * { color !important }`).
  // `u-ink` rides on the ON state: `.st-sheet .st-btn-primary` paints the BUTTON, a child
  // <span> is matched by the blanket `.st-sheet *` tier and would stay white-on-accent.
  const pressed = (on: boolean) => (v2 ? { "aria-pressed": on } : null);
  // DECISION: (Beat 8 PR 5) the v2 footer's destructive verb is "Delete", not "Delete slide" —
  // three buttons share a 311px footer at 390 and the two-word form (146px) pushed SAVE onto its
  // own row. The verb-named PAIR the danger pattern asks for lives on the ConfirmDialog it opens
  // ("Delete slide" / "Keep slide"). The Modal's v2 footer also wraps as a safety net below ~385px.

  return (
    <>
    <Modal
      title={v2 ? (editing ? "Edit slide" : `New slide · ${V2_LABEL[template] ?? labelFor(template)}`) : (editing ? "EDIT ASSET" : `NEW — ${labelFor(template)}`)}
      onClose={onClose}
      v2={v2}
      footer={
        <>
          {editing && (
            <button
              type="button"
              // v2: DELETE is data loss → the ratified danger ConfirmDialog (rendered as a sibling
              // of the Modal below, so its own backdrop never reaches the Modal's close handler).
              // Classic: the shipped `window.confirm`, verbatim.
              onClick={v2 ? () => setConfirmDelete(true) : () => { if (confirm("Delete this asset? It will be removed from EVERY screen it runs on. This can't be undone.")) del.mutate(); }}
              disabled={busy || del.isPending}
              className={v2 ? "st-btn st-btn-danger st-body" : "u-amber"}
              style={v2 ? { ...ghostV2, marginRight: "auto" } : { ...btnGhost, borderColor: "var(--terminal-amber, #ffb000)", color: "var(--terminal-amber, #ffb000)", marginRight: "auto" }}
            >
              {/* "Delete", not "Delete slide" — see the DECISION above `return`. */}
              {v2 ? (del.isPending ? "Deleting…" : "Delete") : (del.isPending ? "DELETING…" : "DELETE")}
            </button>
          )}
          <button type="button" onClick={onClose} className={v2 ? "st-btn st-body" : undefined} style={v2 ? ghostV2 : btnGhost}>{v2 ? "Cancel" : "CANCEL"}</button>
          <button
            type="button"
            onClick={submit}
            // CERTAIN DAYS with nothing picked would save as an every-day asset wearing a day
            // rule — the manager's intent silently dropped. Blocked here rather than coerced,
            // because either coercion (drop the rule / hide the asset) guesses at what he meant.
            disabled={busy || del.isPending || !momentLoaded || noDaysPicked}
            title={noDaysPicked ? "Pick at least one day under DAYS IT RUNS, or switch back to EVERY DAY." : undefined}
            className={v2 ? "st-btn st-btn-primary u-ink st-body" : "u-fill u-ink"}
            style={v2 ? { ...primaryV2, opacity: busy || !momentLoaded || noDaysPicked ? 0.5 : 1 } : { ...btnPrimary, opacity: busy || !momentLoaded || noDaysPicked ? 0.5 : 1 }}
          >
            {v2
              ? (busy ? "Saving…" : !momentLoaded ? "Loading…" : editing ? "Save" : "Create")
              : (busy ? "SAVING…" : !momentLoaded ? "LOADING…" : editing ? "SAVE" : "CREATE")}
          </button>
        </>
      }
    >
      {/* Live preview — pinned first so edits are visible immediately (docs/09).
          v2: the caption takes the Label role; the preview itself is `.signage-slot` and stays
          the classic board by the token sheet's carve-out — nothing here touches it. */}
      <div>
        <div className={v2 ? "st-label st-t2" : undefined} style={v2 ? { marginBottom: 6 } : caption}>LIVE PREVIEW · {orientation.toUpperCase()}</div>
        <SignagePreview item={draftItem} toast={tmap} orientation={orientation} venueName={venueName} maxWidth={orientation === "portrait" ? 240 : 380} />
      </div>

      {/* Template-specific fields */}
      {template === "drink_special" && (
        <DrinkSpecialFields v2={v2} fields={fields} setField={setField} toastRows={toastRows} tmap={tmap} />
      )}
      {template === "event" && <EventFields v2={v2} fields={fields} setField={setField} />}
      {template === "announcement" && <AnnouncementFields v2={v2} fields={fields} setField={setField} />}
      {template === "image_only" && <ImageOnlyFields v2={v2} fields={fields} setField={setField} />}
      {template === "top_sellers" && <TopSellersFields v2={v2} fields={fields} setField={setField} />}
      {template === "instagram" && <InstagramFields v2={v2} fields={fields} setField={setField} />}
      {template === "smart_toast" && <SmartToastFields v2={v2} fields={fields} setField={setField} toastRows={toastRows} />}
      {template === "now_playing" && <NowPlayingFields v2={v2} fields={fields} setField={setField} slots={slots} />}
      {template === "menu_group" && <MenuGroupFields v2={v2} fields={fields} setField={setField} toastRows={toastRows} />}
      {template === "celebration" && (
        <CelebrationFields
          v2={v2}
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
        <RecurrenceField v2={v2} value={recurrence} onChange={setRecurrence} />
      )}

      <div className="terminal-separator" style={{ margin: "4px 0" }} />

      {/* PREVIEW AS — the asset can run on either screen; check both orientations here. It
          is preview-only (no placement is written from this control). */}
      <Field label="PREVIEW AS" v2={v2}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["portrait", "landscape"] as const).map((o) => (
            <button key={o} type="button" onClick={() => setPreviewOri(o)} {...pressed(previewOri === o)} className={chipCls(v2, previewOri === o)} style={v2 ? chipV2 : { ...chip, ...(previewOri === o ? chipActive : null) }}>
              {v2 ? (o === "portrait" ? "Portrait" : "Landscape") : o.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>

      {/* Where this asset runs (read-only). Add/remove screens from the QUEUE, not here (D7). */}
      {editing && (
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6, lineHeight: 1.5 }}>
          {(placementSlotIds?.length ?? 0) === 0
            ? "IDLE — not on any screen. Queue it from a screen's + ADD."
            : `ON: ${slots.filter((s) => (placementSlotIds ?? []).includes(s.id)).map((s) => s.name).join(" · ")}. Add/remove screens & set per-screen SECS in the QUEUE.`}
        </div>
      )}
      {!editing && queueOnSlotId && (
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
          Will be queued on <B v2={v2}>{slots.find((s) => s.id === queueOnSlotId)?.name ?? "this screen"}</B> on save. Queue it on other screens from their + ADD.
        </div>
      )}

      {!isCeleb && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* v2 splits the Label role (uppercase by definition) from its lowercase hint, so
              `text-transform: uppercase` never shouts "(BLANK = EVERGREEN)". */}
          <Field label={v2 ? "STARTS" : "STARTS (blank = evergreen)"} v2={v2}>
            {v2 && <span className="st-body st-t3">Blank = evergreen</span>}
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
          <Field label={v2 ? "ENDS" : "ENDS (blank = evergreen)"} v2={v2}>
            {v2 && <span className="st-body st-t3">Blank = evergreen</span>}
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* On-screen SECONDS is PER-SCREEN (slot_queue.duration_seconds). On create it seeds the
            first queue placement's dwell; on edit it's set per-screen in the QUEUE, so hide it. */}
        {!editing && (
          <Field label="ON SCREEN (SECONDS)" v2={v2}>
            <input type="number" min={4} value={duration} onChange={(e) => setDuration(Math.max(4, parseInt(e.target.value) || 12))} className={v2 ? "st-body" : undefined} style={v2 ? { ...selV2, width: 120 } : { ...sel, width: 120 }} />
          </Field>
        )}
        {/* v2: the real primitive — a native <input> in a 44px label row (PR 2 NOTE-1). The
            classic arm is the shipped markup, untouched. */}
        {v2 ? (
          <TapTargetCheckbox checked={active} onChange={setActive} label={<>Active{editing ? <span className="st-body st-t2"> (on every screen)</span> : null}</>} />
        ) : (
        <label style={checkLabel}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={checkbox} />
          <span>ACTIVE {editing ? <span style={{ fontSize: 13, opacity: 0.55 }}>(on every screen)</span> : null}</span>
        </label>
        )}
      </div>

      {/* Publish to the public marketing site /events page (0015 flag). Hidden for MENU GROUP:
          DECISION (0065) — the website already publishes the whole menu at /menu, so re-listing
          one section in the What's-On feed is redundant; the feed skips this template explicitly. */}
      {template !== "menu_group" && (v2 ? (
        <TapTargetCheckbox
          checked={showOnWebsite}
          onChange={setShowOnWebsite}
          style={{ alignItems: "flex-start", padding: "6px 12px" }}
          label={<>🌐 Show on website<span className="st-body st-t3" style={{ display: "block" }}>Publishes this item to the public bunkerokc.com events page.</span></>}
        />
      ) : (
      <label style={{ ...checkLabel, alignItems: "flex-start" }}>
        <input type="checkbox" checked={showOnWebsite} onChange={(e) => setShowOnWebsite(e.target.checked)} style={{ ...checkbox, marginTop: 2 }} />
        <span>
          🌐 SHOW ON WEBSITE
          <span style={{ display: "block", fontSize: 14, opacity: 0.55, letterSpacing: 0 }}>
            Publishes this item to the public bunkerokc.com events page.
          </span>
        </span>
      </label>
      ))}

      {err && <div className={v2 ? "st-body st-danger" : "u-red"} style={v2 ? undefined : { fontSize: 18 }}>⚠ {err}</div>}
    </Modal>
    {/* v2 only. A SIBLING of the Modal, not a child: the dialog's own backdrop must not
        bubble a click into the Modal's `onClick={onClose}`, and its z-index (1100) already
        stacks above the Modal (1000). Body = the classic confirm's sentence, verbatim. */}
    {v2 && confirmDelete && (
      <ConfirmDialog
        title="Delete slide?"
        body="Delete this asset? It will be removed from EVERY screen it runs on. This can't be undone."
        confirmLabel="Delete slide"
        cancelLabel="Keep slide"
        danger
        busy={del.isPending}
        onConfirm={() => { setConfirmDelete(false); del.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    )}
    </>
  );
}

/* ── drink_special ──────────────────────────────────────────────────────── */
function DrinkSpecialFields({
  v2, fields, setField, toastRows, tmap,
}: FieldProps & { toastRows: ToastCacheRow[]; tmap: Map<string, ToastCacheRow> }) {
  const guid = str(fields.source_toast_guid);
  const src = guid ? tmap.get(guid) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ToastPicker v2={v2} rows={toastRows} selected={guid} onSelect={(g) => setField("source_toast_guid", g)} />

      {src ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* v2: the name + price are POS-synced values → the CALMED accent (DECISION at
              ToastPicker; matches PR 4's ruling for the same values in EventEditor). */}
          <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 15, opacity: 0.7 }}>
            LIVE from Toast (shown green on screen): <B v2={v2} className="st-accent">{src.name}</B>{src.price != null ? ` · $${src.price}` : ""}.
            Fields below OVERRIDE the live values — leave blank to keep live.
          </div>
          <Field label="NAME OVERRIDE" v2={v2}><input placeholder={src.name ?? ""} value={str(fields.name) ?? ""} onChange={(e) => setField("name", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
          <Field label="PRICE OVERRIDE" v2={v2}><input type="number" step="0.01" placeholder={src.price != null ? String(src.price) : ""} value={numStr(fields.price)} onChange={(e) => setField("price", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
          <Field label={v2 ? "INGREDIENTS / BLURB" : "INGREDIENTS / BLURB (top strip)"} v2={v2}>
            {v2 && <span className="st-body st-t3">The top strip</span>}
            <input placeholder={src.public_blurb ?? "no public blurb — write one"} value={str(fields.ingredients) ?? str(fields.tagline) ?? ""} onChange={(e) => setField("ingredients", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
          <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
            {src.public_blurb
              ? "A public blurb exists in Toast (text before ---); it shows unless you override here."
              : "No public blurb in Toast — Toast descriptions are never shown (recipe safety). Write one above, or add it in Toast (public --- private) so the website menu gets it too."}
          </div>
          <Field label={v2 ? "FLOURISH" : "FLOURISH (script line, optional)"} v2={v2}>
            {v2 && <span className="st-body st-t3">Script line, optional</span>}
            <input placeholder={`e.g. "Out of this World!" — shows in cursive, authored only`} value={str(fields.flourish) ?? ""} onChange={(e) => setField("flourish", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
          <Field label="CATEGORY OVERRIDE" v2={v2}>
            <input placeholder={src.menu_group ?? "e.g. SIGNATURE COCKTAIL"} value={str(fields.category) ?? ""} onChange={(e) => setField("category", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
          <PhotoOverride v2={v2} fields={fields} setField={setField} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>Manual — or pick a Toast source above to auto-fill name/price/photo.</div>
          <Field label="NAME" v2={v2}><input value={str(fields.name) ?? ""} onChange={(e) => setField("name", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
          <Field label="PRICE" v2={v2}><input type="number" step="0.01" value={numStr(fields.price)} onChange={(e) => setField("price", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
          <Field label={v2 ? "INGREDIENTS / BLURB" : "INGREDIENTS / BLURB (top strip)"} v2={v2}>
            {v2 && <span className="st-body st-t3">The top strip</span>}
            <input value={str(fields.ingredients) ?? str(fields.tagline) ?? ""} onChange={(e) => setField("ingredients", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
          <Field label={v2 ? "FLOURISH" : "FLOURISH (script line, optional)"} v2={v2}>
            {v2 && <span className="st-body st-t3">Script line, optional</span>}
            <input value={str(fields.flourish) ?? ""} onChange={(e) => setField("flourish", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
          </Field>
          <Field label="CATEGORY" v2={v2}><input value={str(fields.category) ?? ""} onChange={(e) => setField("category", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
          <ImageField v2={v2} fields={fields} setField={setField} />
        </div>
      )}
      <TreatmentToggle v2={v2} fields={fields} setField={setField} />
    </div>
  );
}

function PhotoOverride({ v2, fields, setField }: FieldProps) {
  return (
    <div>
      {v2 ? (
        <div style={{ marginBottom: 4 }}>
          <div className="st-label st-t2">PHOTO OVERRIDE</div>
          <div className="st-body st-t3">Blank = the live Toast photo</div>
        </div>
      ) : (
      <div style={{ fontSize: 15, opacity: 0.7, marginBottom: 4 }}>PHOTO OVERRIDE (blank = live Toast photo)</div>
      )}
      <ImageField v2={v2} fields={fields} setField={setField} />
    </div>
  );
}

/* ── event ──────────────────────────────────────────────────────────────── */
function EventFields({ v2, fields, setField }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="TITLE" v2={v2}><input value={str(fields.title) ?? ""} onChange={(e) => setField("title", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field label="DATE" v2={v2}><input type="date" value={str(fields.date) ?? ""} onChange={(e) => setField("date", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
        <Field label="TIME" v2={v2}><input placeholder="8:00 PM" value={str(fields.time) ?? ""} onChange={(e) => setField("time", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
      </div>
      <Field label="BLURB" v2={v2}><textarea rows={2} value={str(fields.blurb) ?? ""} onChange={(e) => setField("blurb", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? { ...selV2, resize: "vertical" } : { ...sel, resize: "vertical" }} /></Field>
      {/* Event renderer defaults LEFT (alignOf(item.fields,"left")) — the control must match
          that fallback and persist "center"/"left" EXPLICITLY so CENTER is reachable (never ""
          which setField deletes → falls back to the template default). */}
      <AlignField v2={v2} align={alignOf(fields, "left")} onAlign={(a) => setField("align", a)} />
      <ImageField v2={v2} fields={fields} setField={setField} />
      <TreatmentToggle v2={v2} fields={fields} setField={setField} />
    </div>
  );
}

/* ── announcement ───────────────────────────────────────────────────────── */
function AnnouncementFields({ v2, fields, setField }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="MESSAGE" v2={v2}><textarea rows={3} value={str(fields.text) ?? ""} onChange={(e) => setField("text", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? { ...selV2, resize: "vertical" } : { ...sel, resize: "vertical" }} /></Field>
      <Field label="PRIORITY" v2={v2}>
        <select value={str(fields.priority) ?? "LOW"} onChange={(e) => setField("priority", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel}>
          <option style={v2 ? optV2 : opt} value="LOW">LOW</option>
          <option style={v2 ? optV2 : opt} value="MED">MED</option>
          <option style={v2 ? optV2 : opt} value="HIGH">HIGH</option>
        </select>
      </Field>
      {/* Announcement renderer defaults LEFT — match that fallback and persist explicitly. */}
      <AlignField v2={v2} align={alignOf(fields, "left")} onAlign={(a) => setField("align", a)} />
      <ImageField v2={v2} fields={fields} setField={setField} />
    </div>
  );
}

/* ── image_only ─────────────────────────────────────────────────────────── */
function TopSellersFields({ v2, fields, setField }: FieldProps) {
  const rotateGroups = fields.rotate_groups !== false; // default true
  const cycleSeconds = typeof fields.cycle_seconds === "number" ? fields.cycle_seconds : 10;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InfoCard v2={v2} title="📊 LIVE SLIDE — NOTHING TO FILL IN" v2Title="📊 Live slide — nothing to fill in">
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.75 }}>
          Shows tonight's whole-menu <B v2={v2}>TOP 10</B> sellers straight from the POS, updating live as pours ring up.
          No name, price, or photo to set — just pick the slot, how long it lingers, and switch it ON.
        </div>
        <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { opacity: 0.6, fontSize: 14 }}>
          Respects the POS-visibility rule automatically (a product pulled off the POS view never shows here).
        </div>
      </InfoCard>
      <CheckRow v2={v2} checked={rotateGroups} onChange={(on) => setField("rotate_groups", on ? undefined : false)}
        label="ROTATE THROUGH GROUPS" v2Label="Rotate through groups"
        hint="Walks overall + each menu group while the slide is up. Off = overall top 10 only." />
      {rotateGroups && (
        <Field label={v2 ? "CYCLE SECONDS" : "CYCLE SECONDS (how often it changes list, min 5)"} v2={v2}>
          {v2 && <span className="st-body st-t3">How often it changes list, min 5</span>}
          <input
            type="number" min={5} value={cycleSeconds}
            onChange={(e) => setField("cycle_seconds", clamp(parseInt(e.target.value) || 10, 5, 120))}
            className={v2 ? "st-body" : undefined}
            style={v2 ? { ...selV2, width: 120 } : { ...sel, width: 120 }}
          />
        </Field>
      )}
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
        Tip: set the on-screen seconds to a few cycles (e.g. 40s on screen + 10s cycle = 4 lists) so guests see more than one board.
      </div>
    </div>
  );
}

function InstagramFields({ v2, fields, setField }: FieldProps) {
  const postCount = typeof fields.post_count === "number" ? fields.post_count : 5;
  const includeStories = fields.include_stories !== false; // default true
  const latestOnly = fields.latest_only === true;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InfoCard v2={v2} title="▦ FEEDS ITSELF FROM @bunkerclubokc" v2Title="▦ Feeds itself from @bunkerclubokc">
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.75 }}>
          Shows your <B v2={v2}>newest posts first</B>, one per pass, with the caption and a QR that opens the post.
          No links to paste — it pulls straight from Instagram and refreshes on its own.
        </div>
      </InfoCard>
      <CheckRow v2={v2} checked={latestOnly} onChange={(on) => setField("latest_only", on ? true : "")}
        label="LATEST ONLY" v2Label="Latest only"
        hint="Always show exactly one thing — the newest post (or story, if stories are included below)." />
      {!latestOnly && (
      <Field label={v2 ? "RECENT POSTS IN THE CYCLE" : "HOW MANY RECENT POSTS IN THE CYCLE (1–10)"} v2={v2}>
        {v2 && <span className="st-body st-t3">How many, 1–10</span>}
        <input
          type="number" min={1} max={10} value={postCount}
          onChange={(e) => setField("post_count", clamp(parseInt(e.target.value) || 5, 1, 10))}
          className={v2 ? "st-body" : undefined}
          style={v2 ? { ...selV2, width: 120 } : { ...sel, width: 120 }}
        />
      </Field>
      )}
      <CheckRow v2={v2} checked={includeStories} onChange={(on) => setField("include_stories", on)}
        label="INCLUDE ACTIVE STORIES" v2Label="Include active stories"
        hint={'A live story jumps to the front and shows a "TODAY ONLY" badge until it expires.'} />
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
        Tip: give it a longer duration than a quick promo so guests can read the caption and scan the code.
      </div>
    </div>
  );
}

/* ── now_playing ────────────────────────────────────────────────────────────── */
function NowPlayingFields({ v2, fields, setField, slots }: FieldProps & { slots: AdminSlot[] }) {
  const source = str(fields.source_slug) ?? DEFAULT_NOW_PLAYING_SOURCE;
  const showPlaylist = fields.show_playlist === true;
  // The source is a landscape MEDIA screen. Offer every landscape SCREEN (panels never stamp
  // now_playing — they have no TV of their own, NOTE-1); keep the current value selectable even if
  // it isn't a current landscape slug (so an edited card never loses it).
  const landscape = slots.filter((s) => s.orientation === "landscape" && s.kind !== "panel");
  const options = landscape.some((s) => s.slug === source) ? landscape : [{ slug: source, name: source } as AdminSlot, ...landscape];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InfoCard v2={v2} title="🎬 SHOWS WHAT'S ON THE MOVIE SCREEN" v2Title="🎬 Shows what's on the movie screen">
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.75 }}>
          Advertises the film currently playing on a landscape screen — with its real poster.
          It <B v2={v2}>hides itself</B> automatically when nothing is playing (the movie ends, or trivia takes the screen).
        </div>
      </InfoCard>
      <Field label="READS FROM WHICH SCREEN" v2={v2}>
        <select value={source} onChange={(e) => setField("source_slug", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel}>
          {options.map((s) => (
            <option key={s.slug} value={s.slug} style={v2 ? optV2 : opt}>{s.name} ({s.slug})</option>
          ))}
        </select>
      </Field>
      <CheckRow v2={v2} checked={showPlaylist} onChange={(on) => setField("show_playlist", on ? true : "")}
        label="SHOW THE PLAYLIST NAME" v2Label="Show the playlist name"
        hint={'Adds a small "FROM …" line when that screen is pinned to a named playlist.'} />
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
        Best on a portrait ad screen. Give it a longer duration so guests can read the title and see the poster.
      </div>
    </div>
  );
}

/** Toast's featured-duplicates group — never a customer-facing menu section (see README). */
const SCREENS_GROUP = "★ SCREENS";

/* ── menu_group ─────────────────────────────────────────────────────────────── */
/**
 * MENU GROUP settings (0065). Three fields:
 *   • group        — the exact toast_menu_cache `menu_group` string (required; the slide has
 *                    nothing to list without it, and auto-hides from rotation while it's unset).
 *   • heading      — optional title override; blank = the group's own name.
 *   • show_blurbs  — whether each line carries its public description (default ON).
 *
 * The group list is the DISTINCT menu_group values in the Toast mirror, minus the hidden
 * `★ SCREENS` duplicates group (same exclusion SmartToastFields applies). A group whose every
 * item is off the POS view carries a POS-HIDDEN badge — it is still selectable (the owner may be
 * about to turn it back on in Toast), but the slide will auto-hide until it is.
 */
function MenuGroupFields({ v2, fields, setField, toastRows }: FieldProps & { toastRows: ToastCacheRow[] }) {
  const group = str(fields.group) ?? "";
  const heading = str(fields.heading) ?? "";
  const showBlurbs = fields.show_blurbs !== false; // default true

  // Distinct groups + how many rows in each would actually LIST (in stock AND POS-visible), so
  // the picker tells the truth about what the slide will show. Cold-review NOTE-9: a 0-showable
  // group used to be labelled POS-HIDDEN whatever the cause, which was a lie for a section whose
  // items are simply all 86'd — so the two causes are counted SEPARATELY and named.
  const groups = useMemo(() => {
    const m = new Map<string, { total: number; showable: number; photos: number; eightySixed: number; offPos: number }>();
    for (const r of toastRows) {
      const g = (r.menu_group ?? "").trim();
      if (!g || g === SCREENS_GROUP) continue;
      const e = m.get(g) ?? { total: 0, showable: 0, photos: 0, eightySixed: 0, offPos: 0 };
      e.total += 1;
      if (!r.pos_visible) e.offPos += 1;
      else if (r.out_of_stock) e.eightySixed += 1;
      else {
        e.showable += 1;
        if (r.image) e.photos += 1;
      }
      m.set(g, e);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [toastRows]);

  const picked = groups.find((g) => g.name === group);
  // The ★ SCREENS duplicates group is excluded from the picker; the free-text fallback (shown
  // only when the Toast mirror hasn't loaded) can't enforce that, so it warns instead.
  const typedScreens = group.trim().toUpperCase() === SCREENS_GROUP;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InfoCard v2={v2} title="▤ ONE MENU SECTION, FULL SCREEN" v2Title="▤ One menu section, full screen">
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.75 }}>
          Lists a whole menu group the way bunkerokc.com/menu lists it — name, price (or pour sizes),
          description and photo — sized so the rows <B v2={v2}>fill the screen</B>. It follows Toast live:
          anything 86'd or pulled off the POS view drops out on its own, and the whole slide
          <B v2={v2}> hides itself</B> if the section ends up empty. Long sections page automatically.
        </div>
      </InfoCard>

      <Field label="MENU GROUP" v2={v2}>
        {groups.length > 0 ? (
          <select value={group} onChange={(e) => setField("group", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel}>
            <option value="" style={v2 ? optV2 : opt}>— pick a section —</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name} style={v2 ? optV2 : opt}>
                {g.name} ({g.showable} item{g.showable === 1 ? "" : "s"})
                {g.showable === 0 ? " — NOTHING SHOWABLE (hidden / 86'd)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input placeholder="Exact Toast menu group name" value={group} onChange={(e) => setField("group", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
        )}
      </Field>
      {typedScreens && (
        <div style={v2 ? { padding: "10px 12px", lineHeight: 1.5 } : { fontSize: 14, lineHeight: 1.5 }} className={v2 ? "st-card st-callout-warn st-body st-amber" : "u-amber"}>
          ⚠ {SCREENS_GROUP} is the featured-duplicates group, not a customer menu section — pick a real one.
        </div>
      )}
      {picked && (
        <div className={v2 ? (picked.showable === 0 ? "st-card st-callout-warn st-body" : "st-body st-t2") : undefined} style={v2 ? (picked.showable === 0 ? { padding: "10px 12px", lineHeight: 1.5 } : { lineHeight: 1.5 }) : { fontSize: 14, opacity: 0.7, lineHeight: 1.5 }}>
          {picked.showable === 0 ? (
            <span className={v2 ? "st-amber" : "u-amber"}>
              ⚠ NOTHING SHOWABLE — all {picked.total} item{picked.total === 1 ? "" : "s"} in this section
              {picked.eightySixed > 0 && picked.offPos > 0
                ? ` are out (${picked.eightySixed} 86'd, ${picked.offPos} off the POS view)`
                : picked.eightySixed > 0
                  ? ` ${picked.eightySixed === 1 ? "is" : "are"} 86'd`
                  : ` ${picked.offPos === 1 ? "is" : "are"} off the POS view`}
              , so the slide will stay hidden until that changes in Toast.
            </span>
          ) : (
            <>
              Will list <B v2={v2}>{picked.showable}</B> item{picked.showable === 1 ? "" : "s"} · <B v2={v2}>{picked.photos}</B> with a photo.
              {picked.photos === 0 && " No photos yet — names and prices take the full width until Toast has some."}
              {(picked.eightySixed > 0 || picked.offPos > 0) && (
                <> {picked.eightySixed + picked.offPos} more {picked.eightySixed + picked.offPos === 1 ? "item is" : "items are"} hidden
                  {picked.eightySixed > 0 && ` (${picked.eightySixed} 86'd)`} and will appear on their own when Toast says so.</>
              )}
            </>
          )}
        </div>
      )}

      <Field label={v2 ? "HEADING OVERRIDE" : "HEADING OVERRIDE (blank = the section name)"} v2={v2}>
        {v2 && <span className="st-body st-t3">Blank = the section name</span>}
        <input placeholder={group || "e.g. TIKI TUESDAY"} value={heading} onChange={(e) => setField("heading", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
      </Field>

      <CheckRow v2={v2} checked={showBlurbs} onChange={(on) => setField("show_blurbs", on ? "" : false)}
        label="SHOW DESCRIPTIONS" v2Label="Show descriptions"
        hint={<>The short public description under each name (the part before <code className={v2 ? "st-body" : undefined}>---</code> in Toast).
            Turn off for a tighter list of just names and prices.</>} />

      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
        Tip: give it a longer duration than a quick promo — a guest needs time to read a whole section,
        and a long section turns one page per showing.
      </div>
    </div>
  );
}

/* ── smart_toast ────────────────────────────────────────────────────────────── */
function SmartToastFields({ v2, fields, setField, toastRows }: FieldProps & { toastRows: ToastCacheRow[] }) {
  const mode = (str(fields.smart_mode) ?? "underdogs").toLowerCase() === "champion" ? "champion" : "underdogs";
  const days = typeof fields.days === "number" ? fields.days : mode === "champion" ? 30 : 7;
  const count = typeof fields.count === "number" ? fields.count : 3;
  const menuGroup = str(fields.menu_group);

  // Distinct POS menu groups from the Toast cache (the underdog roster source). Excludes the
  // ★ SCREENS featured duplicates group so it never appears as a pickable category.
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const r of toastRows) {
      const g = (r.menu_group ?? "").trim();
      if (g && g !== "★ SCREENS") set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [toastRows]);

  // When switching mode, snap `days` to the mode's sensible default if it's still on the other
  // default (so CHAMPION opens at 30 and UNDERDOGS at 7 without clobbering a custom value).
  const pickMode = (m: "underdogs" | "champion") => {
    setField("smart_mode", m);
    if (m === "champion" && (fields.days === undefined || fields.days === 7)) setField("days", 30);
    if (m === "underdogs" && (fields.days === undefined || fields.days === 30)) setField("days", 7);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <Caption v2={v2}>MODE</Caption>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([["underdogs", "UNDERDOGS"], ["champion", "CHAMPION"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => pickMode(k)}
              {...(v2 ? { "aria-pressed": mode === k } : null)}
              className={chipCls(v2, mode === k)}
              style={v2 ? chipV2 : { ...chip, ...(mode === k ? chipActive : null) }}
            >
              {v2 ? (k === "underdogs" ? "Underdogs" : "Champion") : label}
            </button>
          ))}
        </div>
      </div>

      <div className={v2 ? "st-card" : "terminal-border"} style={v2 ? { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, lineHeight: 1.5 } : { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 15, lineHeight: 1.5 }}>
        {mode === "underdogs" ? (
          <>
            <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? undefined : { fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{v2 ? "🎯 Give the slow movers some love" : "🎯 GIVE THE SLOW MOVERS SOME LOVE"}</div>
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.75 }}>
              Rotates the <B v2={v2}>bottom {count}</B> selling drinks in a menu group over the last <B v2={v2}>{days} days</B>, straight from the POS.
              Zero-sellers are included; anything 86'd or pulled off the POS view is skipped automatically.
            </div>
          </>
        ) : (
          <>
            <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? undefined : { fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{v2 ? "🎯 Crown the champion" : "🎯 CROWN THE CHAMPION"}</div>
            <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.75 }}>
              Shows the <B v2={v2}>#1 seller of the last {days} days</B> big, with <B v2={v2}>tonight's live top 3</B> beneath it.
              If there isn't {days} days of history yet, it says the true window it used — never a month it doesn't have.
            </div>
          </>
        )}
      </div>

      <Field label="MENU GROUP" v2={v2}>
        {groups.length > 0 ? (
          <select value={menuGroup ?? ""} onChange={(e) => setField("menu_group", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel}>
            {/* CHAMPION allows WHOLE MENU (the overall champion — empty = whole menu, unchanged
                behavior); UNDERDOGS still requires a group to have a roster. */}
            <option value="" style={v2 ? optV2 : opt}>{mode === "champion" ? "WHOLE MENU (overall champion)" : "— pick a group —"}</option>
            {groups.map((g) => <option key={g} value={g} style={v2 ? optV2 : opt}>{g}</option>)}
          </select>
        ) : (
          <input placeholder="e.g. Signature Cocktails (menu not synced yet)" value={menuGroup ?? ""} onChange={(e) => setField("menu_group", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
        )}
      </Field>

      {mode === "champion" && (
        <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 15, opacity: 0.75 }}>
          Leave on <B v2={v2}>WHOLE MENU</B> for the overall champion (the top seller across everything). Set a group for a category champion — e.g. your top <B v2={v2}>Signature Cocktail</B>. Tonight's live top 3 beneath follows the same filter.
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={mode === "underdogs" ? "DAYS TO LOOK BACK" : "DAYS FOR THE CHAMPION"} v2={v2}>
          <input type="number" min={1} max={400} value={days} onChange={(e) => setField("days", clamp(parseInt(e.target.value) || (mode === "champion" ? 30 : 7), 1, 400))} className={v2 ? "st-body" : undefined} style={v2 ? { ...selV2, width: 120 } : { ...sel, width: 120 }} />
        </Field>
        {mode === "underdogs" && (
          <Field label={v2 ? "HOW MANY UNDERDOGS" : "HOW MANY UNDERDOGS (1–6)"} v2={v2}>
            {v2 && <span className="st-body st-t3">1–6</span>}
            <input type="number" min={1} max={6} value={count} onChange={(e) => setField("count", clamp(parseInt(e.target.value) || 3, 1, 6))} className={v2 ? "st-body" : undefined} style={v2 ? { ...selV2, width: 120 } : { ...sel, width: 120 }} />
          </Field>
        )}
      </div>

      {mode === "underdogs" && !menuGroup && (
        <div className={v2 ? "st-card st-callout-warn st-body st-amber" : "u-amber"} style={v2 ? { padding: "10px 12px" } : { fontSize: 15 }}>Pick a menu group so the slide knows which underdogs to feature.</div>
      )}
    </div>
  );
}

function ImageOnlyFields({ v2, fields, setField }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ImageField v2={v2} fields={fields} setField={setField} />
      <Field label="CAPTION" v2={v2}><input value={str(fields.caption) ?? ""} onChange={(e) => setField("caption", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
      <TreatmentToggle v2={v2} fields={fields} setField={setField} />
    </div>
  );
}

/* ── celebration ────────────────────────────────────────────────────────── */
function CelebrationFields({
  v2, fields, setField, celebDate, setCelebDate,
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
        <Caption v2={v2}>OCCASION</Caption>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SKINS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setField("skin", s)}
              {...(v2 ? { "aria-pressed": skin === s } : null)}
              className={chipCls(v2, skin === s)}
              style={v2 ? chipV2 : { ...chip, ...(skin === s ? chipActive : null) }}
            >
              {v2 ? s.charAt(0).toUpperCase() + s.slice(1) : s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <Field label="HONOREE NAME" v2={v2}><input value={str(fields.honoree) ?? ""} onChange={(e) => setField("honoree", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
      <Field label={v2 ? "OCCASION LINE" : "OCCASION LINE (optional)"} v2={v2}>
        {v2 && <span className="st-body st-t3">Optional</span>}
        <input placeholder="auto: skin default" value={str(fields.occasion) ?? ""} onChange={(e) => setField("occasion", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} />
      </Field>
      <Field label={v2 ? "MESSAGE" : "MESSAGE (optional)"} v2={v2}>
        {v2 && <span className="st-body st-t3">Optional</span>}
        <textarea rows={2} value={str(fields.message) ?? ""} onChange={(e) => setField("message", e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? { ...selV2, resize: "vertical" } : { ...sel, resize: "vertical" }} />
      </Field>
      {/* Celebration renderer defaults CENTER — keep that fallback; persist explicitly. */}
      <AlignField v2={v2} align={alignOf(fields)} onAlign={(a) => setField("align", a)} />
      <Field label="DATE" v2={v2}><input type="date" value={celebDate} onChange={(e) => setCelebDate(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
      <div>
        {v2 ? (
          <div style={{ marginBottom: 4 }}>
            <div className="st-label st-t2">PHOTO</div>
            <div className="st-body st-t3">Optional</div>
          </div>
        ) : (
        <div style={{ fontSize: 15, opacity: 0.7, marginBottom: 4 }}>PHOTO (optional)</div>
        )}
        <ImageField v2={v2} fields={fields} setField={setField} />
      </div>

      {/* Shout-out moment — a scheduled, linked takeover (docs/09: sellable party line). */}
      <div className={v2 ? "st-card" : "terminal-border"} style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {v2 ? (
          <TapTargetCheckbox checked={momentOn} onChange={setMomentOn} label="★ Shout-out moment — their name on EVERY screen at their minute" style={{ padding: 0 }} />
        ) : (
        <label style={checkLabel}>
          <input type="checkbox" checked={momentOn} onChange={(e) => setMomentOn(e.target.checked)} style={checkbox} />
          <span>★ SHOUT-OUT MOMENT — their name on EVERY screen at their minute</span>
        </label>
        )}
        {momentOn && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="AT" v2={v2}><input type="time" value={momentTime} onChange={(e) => setMomentTime(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel} /></Field>
            <Field label="FOR" v2={v2}>
              <select value={momentDur} onChange={(e) => setMomentDur(parseInt(e.target.value))} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel}>
                <option style={v2 ? optV2 : opt} value={30}>30 sec</option>
                <option style={v2 ? optV2 : opt} value={60}>60 sec</option>
                <option style={v2 ? optV2 : opt} value={120}>120 sec</option>
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
  /** Beat 8 PR 5 — the presentation, threaded from ItemForm; every leaf below branches on it. */
  v2: boolean;
  fields: Record<string, unknown>;
  setField: (k: string, v: unknown) => void;
}

/**
 * Inline emphasis inside a role-classed paragraph. Classic = a bare `<b>` (no attribute —
 * byte-identical). v2 = the Body role on the element ITSELF, because nothing inherits
 * font-size under `.terminal-theme *` (the PR #89 gotcha): a bare <b> inside a 15px
 * `.st-body` div renders at the theme's 24px. `.st-body` declares weight 400, so the bold
 * is restated inline (an inline declaration beats a plain class rule).
 */
function B({ v2, className, children }: { v2: boolean; className?: string; children: React.ReactNode }) {
  return <b className={v2 ? (className ? `st-body ${className}` : "st-body") : undefined} style={v2 ? { fontWeight: 700 } : undefined}>{children}</b>;
}

/** A section eyebrow. Classic = the shipped `caption` line; v2 = the Label role. */
function Caption({ v2, children }: { v2: boolean; children: React.ReactNode }) {
  return <div className={v2 ? "st-label st-t2" : undefined} style={v2 ? { marginBottom: 6 } : caption}>{children}</div>;
}

/**
 * The "this slide fills itself in" explainer box the live templates open with. Classic = the
 * shipped `terminal-border` block, byte for byte; v2 = an `st-card` with the title in the
 * Heading role. `v2Title` is the sentence-case wording of the same words — the classic title
 * is shouted by hand and would stay shouted under a role class that does not uppercase.
 */
function InfoCard({ v2, title, v2Title, children }: { v2: boolean; title: string; v2Title: string; children: React.ReactNode }) {
  return (
    <div className={v2 ? "st-card" : "terminal-border"} style={v2 ? { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, lineHeight: 1.5 } : { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 15, lineHeight: 1.5 }}>
      <div className={v2 ? "st-heading st-t1" : undefined} style={v2 ? undefined : { fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{v2 ? v2Title : title}</div>
      {children}
    </div>
  );
}

/**
 * A checkbox row with a block hint under its label. Classic = the shipped hand-padded
 * `<label style={checkLabel}>` markup, byte for byte; v2 = `TapTargetCheckbox` (a native
 * input in a 44px label row) with the hint in the Tertiary tier under the label.
 */
function CheckRow({ v2, checked, onChange, label, v2Label, hint }: {
  v2: boolean; checked: boolean; onChange: (on: boolean) => void; label: string; v2Label: string; hint: React.ReactNode;
}) {
  if (v2) {
    return (
      <TapTargetCheckbox
        checked={checked}
        onChange={onChange}
        style={{ alignItems: "flex-start", padding: "6px 12px" }}
        label={<>{v2Label}<span className="st-body st-t3" style={{ display: "block" }}>{hint}</span></>}
      />
    );
  }
  return (
    <label style={{ ...checkLabel, alignItems: "flex-start" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ ...checkbox, marginTop: 2 }} />
      <span>
        {label}
        <span style={{ display: "block", fontSize: 14, opacity: 0.55, letterSpacing: 0 }}>
          {hint}
        </span>
      </span>
    </label>
  );
}

/**
 * ALIGN + the `**bold**` note = the SHARED `FormatControls`, which already carries its own
 * `variant` leg (PR 4). This editor only threads the value; classic passes nothing new.
 */
// DECISION: (Beat 8 PR 5) `signageAdminShared.tsx` is taken VERBATIM from PR 4 (`881dbc0` —
// `variant` on ImageUploadField / FormatControls / ToastSourcePicker + two geometry twins)
// rather than re-implemented here, so the three concurrent Beat 8 branches merge onto main
// without a conflict in that file. `ItemRow` (PR 3's hunk in the same file) is untouched.
function AlignField({ v2, align, onAlign }: { v2: boolean; align: Align; onAlign: (a: Align) => void }) {
  return <FormatControls align={align} onAlign={onAlign} {...(v2 ? { variant: "v2" as const } : null)} />;
}

function TreatmentToggle({ v2, fields, setField }: FieldProps) {
  const t = str(fields.photo_treatment) ?? "viewport";
  if (!str(fields.image_url) && !str(fields.source_toast_guid)) return null;
  return (
    <div>
      <Caption v2={v2}>PHOTO TREATMENT</Caption>
      <div style={{ display: "flex", gap: 8 }}>
        {(["viewport", "phosphor"] as const).map((opt2) => (
          <button
            key={opt2}
            type="button"
            onClick={() => setField("photo_treatment", opt2)}
            {...(v2 ? { "aria-pressed": t === opt2 } : null)}
            className={chipCls(v2, t === opt2)}
            style={v2 ? chipV2 : { ...chip, ...(t === opt2 ? chipActive : null) }}
          >
            {v2 ? (opt2 === "viewport" ? "Viewport" : "Phosphor") : opt2.toUpperCase()}
          </button>
        ))}
      </div>
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? { marginTop: 4 } : { fontSize: 14, opacity: 0.6, marginTop: 4 }}>
        Selling it → VIEWPORT (full colour). Setting a mood → PHOSPHOR (ink-tinted).
      </div>
    </div>
  );
}

function ImageField({ v2, fields, setField }: FieldProps) {
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
      const publicUrl = await uploadCustomImage(file);
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
      {/* v2 thumbs: `border: "1px solid"` with no colour — the sheet blanket paints the hairline. */}
      {url && <img src={url} alt="" style={v2 ? { width: 64, height: 64, objectFit: "cover", border: "1px solid" } : { width: 64, height: 64, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />}
      <input ref={ref} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={v2 ? "st-btn st-body" : undefined} style={v2 ? ghostV2 : btnGhost}>
        {v2 ? (busy ? "Uploading…" : url ? "Replace photo" : "Upload photo") : (busy ? "UPLOADING…" : url ? "REPLACE PHOTO" : "UPLOAD PHOTO")}
      </button>
      {url && <button type="button" onClick={() => setField("image_url", "")} className={v2 ? "st-btn st-body" : undefined} style={v2 ? ghostV2 : btnGhost}>{v2 ? "Remove" : "REMOVE"}</button>}
      {url && (
        // photo_fit: CROP fills the frame (default, Toast-photo parity); FIT letterboxes the
        // whole image — QR codes, posters, anything whose edges must survive.
        <label style={v2 ? { display: "flex", alignItems: "center", gap: 6 } : { display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}>
          {v2 ? <span className="st-label st-t2">FIT</span> : "FIT"}
          <select
            value={str(fields.photo_fit) ?? "cover"}
            onChange={(e) => setField("photo_fit", e.target.value === "cover" ? "" : e.target.value)}
            className={v2 ? "st-body" : undefined}
            style={v2 ? { ...selV2, width: "auto" } : sel}
          >
            <option style={v2 ? optV2 : opt} value="cover">CROP TO FILL</option>
            <option style={v2 ? optV2 : opt} value="contain">WHOLE IMAGE</option>
          </select>
        </label>
      )}
      {err && <span className={v2 ? "st-body st-danger" : "u-red"} style={v2 ? undefined : { fontSize: 15 }}>⚠ {err}</span>}
    </div>
  );
}

// The DAYS rule for a rotation asset. The stored shape is unchanged from 0009/0010
// ({kind:'weekly', daysOfWeek:['TU',…]} | {kind:'annual', month, day}) — what CHANGED is that
// it is now HONORED: itemSchedule.itemAirsNow gates every rotation surface on it at read time,
// in the venue BUSINESS day (a Tuesdays asset runs until the 04:00 closeout, so it is still up
// at 1:30 AM Wednesday). No pg_cron re-arm exists or is needed — nothing rewrites the row, so
// the rule can never go stale (the 0051 "expiry derived at read" pattern).
function RecurrenceField({ v2, value, onChange }: { v2: boolean; value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const kind = value?.kind ?? "none";
  // The real venue rollover hour, never a hardcoded "4 AM" — this copy is the only place the
  // owner is told where a night ends, so it has to match what the resolver actually uses.
  const { closeoutHour } = useVenueClock();
  const closeLabel = `${closeoutHour % 12 === 0 ? 12 : closeoutHour % 12} ${closeoutHour < 12 ? "AM" : "PM"} rollover`;
  const noDays = value?.kind === "weekly" && value.daysOfWeek.length === 0;
  const MODES = [
    { key: "none", label: "EVERY DAY", v2Label: "Every day" },
    { key: "weekly", label: "CERTAIN DAYS", v2Label: "Certain days" },
    { key: "annual", label: "ONE DATE A YEAR", v2Label: "One date a year" },
  ] as const;
  return (
    <div className={v2 ? "st-card" : "terminal-border"} style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <Caption v2={v2}>DAYS IT RUNS</Caption>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(
              m.key === "none" ? null
                : m.key === "annual" ? { kind: "annual", month: 1, day: 1 }
                : { kind: "weekly", daysOfWeek: [] },
            )}
            {...(v2 ? { "aria-pressed": kind === m.key } : null)}
            className={chipCls(v2, kind === m.key)}
            style={v2 ? chipV2 : { ...chip, ...(kind === m.key ? chipActive : null) }}
          >
            {v2 ? m.v2Label : m.label}
          </button>
        ))}
      </div>
      {value?.kind === "annual" && (
        <div style={{ display: "flex", gap: 10 }}>
          {/* DAY is clamped to the MONTH's real length (Feb ≤ 29 — leap years included, so a
              Feb 29 rule is allowed and simply doesn't fire in common years). A flat max of 31
              let a manager save Feb 31, which no business day can ever match: the slide would
              be queued, badged with a date, and silently never run. Changing the month re-clamps
              the day, so Jan 31 → Feb becomes Feb 29, never an impossible date. */}
          <Field label="MONTH" v2={v2}>
            <input
              type="number" min={1} max={12} value={value.month}
              onChange={(e) => {
                const month = clamp(parseInt(e.target.value) || 1, 1, 12);
                onChange({ kind: "annual", month, day: clamp(value.day, 1, daysInMonth(month)) });
              }}
              className={v2 ? "st-body" : undefined}
              style={v2 ? { ...selV2, width: 90 } : { ...sel, width: 90 }}
            />
          </Field>
          <Field label="DAY" v2={v2}>
            <input
              type="number" min={1} max={daysInMonth(value.month)} value={value.day}
              onChange={(e) => onChange({ kind: "annual", month: value.month, day: clamp(parseInt(e.target.value) || 1, 1, daysInMonth(value.month)) })}
              className={v2 ? "st-body" : undefined}
              style={v2 ? { ...selV2, width: 90 } : { ...sel, width: 90 }}
            />
          </Field>
        </div>
      )}
      {value?.kind === "weekly" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {/* Day glyphs (MO…SU) stay as the conventional two-letter day tokens on both legs
              (PR 2 NOTE-3, on the record). v2 keeps the 46px width — above the 44 floor. */}
          {DOW.map((d) => {
            const on = value.daysOfWeek.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => onChange({ kind: "weekly", daysOfWeek: on ? value.daysOfWeek.filter((x) => x !== d) : [...value.daysOfWeek, d] })}
                {...(v2 ? { "aria-pressed": on } : null)}
                className={chipCls(v2, on)}
                title={DOW_LABEL[d]}
                style={v2 ? { ...chipV2, minWidth: 46, padding: "8px 6px", textAlign: "center", justifyContent: "center" } : { ...chip, ...(on ? chipActive : null), minWidth: 46, padding: "8px 6px", textAlign: "center" }}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}
      {/* Plain-phrase echo of the rule, so the manager reads back what he just set. The
          nothing-picked case is a blocker, not a note — it wears the amber and says so. */}
      {noDays ? (
        <div className={v2 ? "st-card st-callout-warn st-body st-amber" : "u-amber"} style={v2 ? { padding: "10px 12px" } : { fontSize: 15 }}>⚠ {recurrenceSentence(value)} SAVE stays disabled until you do, or switch back to EVERY DAY.</div>
      ) : (
        <div className={v2 ? "st-body" : undefined} style={v2 ? undefined : { fontSize: 15 }}>{recurrenceSentence(value)}</div>
      )}
      <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 13, opacity: 0.55 }}>
        A day rule applies on top of any START / END dates above. Nights count as the day they
        started — a TUE slide stays up until close ({closeLabel}), not midnight.
      </div>
    </div>
  );
}

/* ── Toast source picker ────────────────────────────────────────────────── */
// DECISION: (Beat 8 PR 5, matching PR 4's ruling in EventEditor) the SELECTED source's
// name/price are POS-SYNCED values, so they wear the CALMED accent (`st-accent`) — NOT the
// reserved `.st-live` green, which is kept for a true on-air state (the QUEUE's ● NOW). The
// board itself still renders them phosphor-green inside the untouched `.signage-slot` preview.
// The candidate rows in the open picker are a list of choices, not values on a card, so they
// stay in the text tiers. POS-HIDDEN / 86 stay amber (`st-amber` — ambient/pending, the owner
// can flip them back in Toast); REMOVED FROM TOAST is a dead reference the card can never render
// from, so it takes the danger callout.
function ToastPicker({ v2, rows, selected, onSelect }: { v2: boolean; rows: ToastCacheRow[]; selected: string | undefined; onSelect: (g: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = selected ? rows.find((r) => r.guid === selected) : undefined;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => r.menu_group !== "★ SCREENS") // featured duplicates aren't picker sources
      // DECISION (0066): items Toast no longer carries are filtered OUT rather than dimmed
      // like POS-hidden ones — a removed item is a dead reference, so a card built on it could
      // never render. See the matching note in signageAdminShared's ToastSourcePicker. An
      // already-linked removed item still shows in the selected row above, badged.
      .filter((r) => !r.removed_at)
      .filter((r) => !needle || (r.name ?? "").toLowerCase().includes(needle) || (r.menu_group ?? "").toLowerCase().includes(needle))
      .slice(0, 60);
  }, [rows, q]);

  return (
    <div className={v2 ? "st-card" : "terminal-border"} style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className={v2 ? "st-label st-t2" : undefined} style={v2 ? undefined : caption}>SOURCE FROM TOAST</span>
        {sel && <button type="button" onClick={() => onSelect("")} className={v2 ? "st-btn st-body" : undefined} style={v2 ? { ...ghostV2, padding: "4px 10px" } : { ...btnGhost, fontSize: 15, padding: "4px 10px", minHeight: 44 }}>{v2 ? "Clear" : "CLEAR"}</button>}
      </div>
      {sel ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {sel.image && <img src={sel.image} alt="" style={v2 ? { width: 44, height: 44, objectFit: "cover", border: "1px solid" } : { width: 44, height: 44, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={v2 ? "st-heading st-accent" : undefined} style={v2 ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.name}</div>
              <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { fontSize: 14, opacity: 0.6 }}>
                {v2 ? (
                  <>{sel.menu_group}{sel.price != null ? <> · <span className="st-body st-accent">${sel.price}</span></> : ""}{sel.out_of_stock ? <> · <span className="st-body st-amber">86'D</span></> : ""}{sel.pos_visible ? "" : <> · <span className="st-body st-amber">POS-HIDDEN</span></>}</>
                ) : (
                  <>{sel.menu_group}{sel.price != null ? ` · $${sel.price}` : ""}{sel.out_of_stock ? " · 86'D" : ""}{sel.pos_visible ? "" : " · POS-HIDDEN"}</>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setOpen((o) => !o)} className={v2 ? "st-btn st-body" : undefined} style={v2 ? ghostV2 : { ...btnGhost, fontSize: 15, minHeight: 44 }}>{v2 ? "Change" : "CHANGE"}</button>
          </div>
          {/* A card whose Toast item was deleted can never render again (0066) — say so
              here rather than letting it look like an ordinary linked special. */}
          {sel.removed_at && (
            <div className={v2 ? "st-card st-callout-danger st-body st-danger" : "u-amber"} style={v2 ? { padding: "10px 12px" } : { fontSize: 14 }}>⚠ REMOVED FROM TOAST — this card auto-hides on screen; pick another item</div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} className={v2 ? "st-btn st-body" : undefined} style={v2 ? ghostV2 : btnGhost}>{v2 ? (open ? "Close picker" : "Pick a Toast item") : (open ? "CLOSE PICKER" : "PICK A TOAST ITEM")}</button>
      )}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input autoFocus placeholder="search name or group…" value={q} onChange={(e) => setQ(e.target.value)} className={v2 ? "st-body" : undefined} style={v2 ? selV2 : sel2} />
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.length === 0 && <div className={v2 ? "st-body st-t2" : undefined} style={v2 ? undefined : { opacity: 0.6, fontSize: 16 }}>No matches (has the menu synced yet?).</div>}
            {filtered.map((r) => (
              <button
                key={r.guid}
                type="button"
                onClick={() => { onSelect(r.guid); setOpen(false); }}
                // POS-hidden items are shown (staff want to see why an item can't be
                // advertised) but dimmed + badged, and picking one auto-hides on-screen.
                className={v2 ? "st-row st-body" : undefined}
                style={v2 ? { ...pickRowV2, alignItems: "center", opacity: r.pos_visible ? 1 : 0.5 } : { ...pickRow, alignItems: "center", opacity: r.pos_visible ? 1 : 0.5 }}
              >
                {r.image
                  ? <img src={r.image} alt="" style={v2 ? { width: 36, height: 36, objectFit: "cover", border: "1px solid", flexShrink: 0 } : { width: 36, height: 36, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                  : <span style={v2 ? { width: 36, height: 36, border: "1px solid", flexShrink: 0, display: "inline-block" } : { width: 36, height: 36, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
                <span className={v2 ? "st-body" : undefined} style={v2 ? { flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 17 }}>{r.name}</span>
                <span className={v2 ? "st-label st-t3" : undefined} style={v2 ? { whiteSpace: "nowrap" } : { fontSize: 13, opacity: 0.6, whiteSpace: "nowrap" }}>{r.menu_group}</span>
                {!r.pos_visible && <span className={v2 ? "st-label st-amber" : "u-amber"} style={v2 ? { whiteSpace: "nowrap" } : { fontSize: 11, whiteSpace: "nowrap" }}>POS-HIDDEN</span>}
                {r.out_of_stock && <span className={v2 ? "st-label st-amber" : "u-amber"} style={v2 ? undefined : { fontSize: 12 }}>86</span>}
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
  return ITEM_TEMPLATES.find((x) => x.key === t)?.label ?? t.toUpperCase();
}
/** v2 wording of each template name (Heading/Body roles are sentence case; `ITEM_TEMPLATES`'
 *  shouted labels are the classic picker's and the hub's, and stay as they are). */
const V2_LABEL: Partial<Record<Template, string>> = {
  drink_special: "Drink special",
  event: "Event",
  announcement: "Announcement",
  image_only: "Image",
  celebration: "Celebration",
  top_sellers: "Top sellers",
  instagram: "Instagram",
  smart_toast: "Smart Toast",
  now_playing: "Now playing",
  menu_group: "Menu group",
};
/** A segmented chip: primary fill when on, plain when off. Classic = the shipped classes. */
function chipCls(v2: boolean, on: boolean): string {
  return v2 ? (on ? "st-btn st-btn-primary u-ink st-body" : "st-btn st-body") : (on ? "u-fill u-ink" : "");
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

/* v2 twins (Beat 8 PR 5): the same boxes, GEOMETRY only. No `fontFamily` (the role classes own
 * the face), no `background`/`color` (an inline colour cannot beat the theme's !important green
 * — the classes are what actually paint), and `border: "1px solid"` with no colour so the token
 * blanket paints the hairline (the ConfirmDialog idiom). `minWidth: TAP` joins `minHeight`
 * because the 44px floor is measured on BOTH axes (#103 NOTE-6). `optV2` is the one exception:
 * a <select>'s <option> popup is painted by the UA, not the sheet, so its surface is set inline
 * from the same token the sheet gives the <select> itself. */
const selV2: CSSProperties = { fontSize: 15, padding: "9px 11px", minHeight: TAP, border: "1px solid", width: "100%" };
const optV2: CSSProperties = { background: staffSurface.surface2 };
const chipV2: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "8px 12px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer" };
const ghostV2: CSSProperties = { padding: "10px 18px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer", whiteSpace: "nowrap" };
const primaryV2: CSSProperties = { padding: "10px 20px", minWidth: TAP, minHeight: TAP, border: "1px solid", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const tileV2: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center", padding: "18px 10px", border: "1px solid", cursor: "pointer", minHeight: 110 };
const pickRowV2: CSSProperties = { display: "flex", gap: 10, padding: "6px 8px", border: "1px solid", cursor: "pointer", minHeight: 48, minWidth: TAP, width: "100%" };

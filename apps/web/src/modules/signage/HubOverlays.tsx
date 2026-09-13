import type { QueryClient } from "@tanstack/react-query";
import type { AdminItem, AdminSlot, AdminTakeover, AssetWithPlacements } from "./useSignageAdmin";
import type { LiveEvent, ToastCacheRow } from "./useSignage";
import type { LiveGameRow } from "./useSignageAdmin";
import type { ProgramHold } from "./scheduleResolve";
import { ItemEditor } from "./ItemEditor";
import { EventEditor } from "./EventEditor";
import { QueuePanel } from "./QueuePanel";
import { AddAssetPicker } from "./AddAssetPicker";
import { TakeoverPanel } from "./TakeoverPanel";
import { SlideOver } from "./SlideOver";
import { ProgramPanel } from "./ProgramPanel";
import { ScheduleEditor } from "./ScheduleEditor";
import { placementsFor, type Overlay } from "./signageHubShared";

/**
 * The hub's slide-overs — + ADD, QUEUE, TAKEOVER, EVENT, PROGRAM, SCHEDULE and the item
 * editor (UX overhaul Beat 3).
 *
 * LIFTED VERBATIM out of SignageHub.tsx so the classic view and SignageHubV2 open the
 * SAME panels with the SAME props from the SAME page-level state. Nothing about how an
 * overlay opens, saves or closes changed in the move — including the `returnTo`
 * choreography that lands the manager back in QUEUE/ADD after editing an asset. The one
 * edit: `venueName` arrives as a value instead of being read off the venue query here.
 *
 * This file renders panels; it owns no data. Every mutation it triggers belongs to the
 * panel components themselves, exactly as before.
 *
 * THREE OF THEM ARE ALSO EXPORTED ON THEIR OWN, for the pages that opened out of this hub
 * and must keep opening the hub's panel rather than a second copy of it:
 *   · `ProgramOverlay` / `ScheduleOverlay` (Beat 4) — MEDIA ▸ SCREENS & PROGRAMS.
 *   · `AssetOverlay` (Beat 6 PR 4) — BAR OPS ▸ SLIDES. The `asset` branch below is now a
 *     call to it, so there is ONE definition of what editing a slide means: which screens
 *     it reports as its placements, what a save invalidates, where a new slide is queued.
 */
export interface HubOverlayProps {
  overlay: Overlay | null;
  setOverlay: (o: Overlay | null) => void;
  slots: AdminSlot[];
  assets: AssetWithPlacements[];
  toastRows: ToastCacheRow[];
  itemsBySlot: Map<string, AdminItem[]>;
  liveEvents: LiveEvent[];
  liveGame: LiveGameRow | null;
  takeovers: AdminTakeover[];
  canEvents: boolean;
  busyQueueId: string | null;
  /** The page's queue-an-existing-asset mutation (kept as the mutation object so the
   *  call site below is the one the hub always had). */
  queueExisting: { mutate: (v: { slot: AdminSlot; a: AssetWithPlacements }) => void };
  scheduleBySlot: Map<string, unknown[]>;
  overrideHoldFor: (slot: AdminSlot) => ProgramHold | null;
  panelChoices: AdminSlot[];
  timezone: string;
  venueName: string | undefined;
  nextPosition: (slotId: string) => number;
  invalidateItems: () => void;
  invalidateTakeovers: () => void;
  invalidateEvents: () => void;
  qc: QueryClient;
  // DECISION: (Beat 8 PR 2) the variant is THREADED from the page that already knows it,
  // never re-derived inside a panel with `useUiVersion()`.
  /** Which presentation opened these panels (Beat 8 PR 2). `SignageHub` builds ONE
   *  `overlays` node and hands it to whichever view renders, so the version it already
   *  knows is passed down here rather than re-read from the switch. Only PROGRAM and
   *  SCHEDULE consume it in this PR — the other slide-overs are PRs 3–6, and until then
   *  they render classic in BOTH views exactly as they do today. */
  variant?: "classic" | "v2";
}

export function HubOverlays({
  overlay, setOverlay, slots, assets, toastRows, itemsBySlot, liveEvents, liveGame, takeovers,
  canEvents, busyQueueId, queueExisting, scheduleBySlot, overrideHoldFor, panelChoices,
  timezone, venueName, nextPosition, invalidateItems, invalidateTakeovers, invalidateEvents, qc,
  variant = "classic",
}: HubOverlayProps) {
  return (
    <>
      {/* ── slide-overs ─────────────────────────────────────────────────── */}
      {overlay?.kind === "add" && (
        <SlideOver eyebrow={`${overlay.slot.name} ▸ + ADD`} title={`ADD TO ${overlay.slot.name}`} onClose={() => setOverlay(null)}>
          <AddAssetPicker
            slot={overlay.slot}
            assets={assets}
            toastRows={toastRows}
            busyItemId={busyQueueId}
            onPickTemplate={(t) => setOverlay({ kind: "asset", editing: null, preset: t, queueOnSlotId: overlay.slot.id, returnTo: { kind: "add", slot: overlay.slot } })}
            onQueueExisting={(a) => queueExisting.mutate({ slot: overlay.slot, a })}
          />
        </SlideOver>
      )}

      {overlay?.kind === "queue" && (
        <SlideOver eyebrow={`${overlay.slot.name} ▸ QUEUE`} title={`${overlay.slot.name} QUEUE`} onClose={() => setOverlay(null)}>
          <QueuePanel
            slot={overlay.slot}
            slotItems={itemsBySlot.get(overlay.slot.id) ?? []}
            toastRows={toastRows}
            liveEvents={liveEvents}
            gameOn={!!liveGame}
            takeovers={takeovers}
            canEvents={canEvents}
            onAdd={() => setOverlay({ kind: "add", slot: overlay.slot })}
            onEditAsset={(item) => setOverlay({ kind: "asset", editing: item, preset: null, queueOnSlotId: null, returnTo: { kind: "queue", slot: overlay.slot } })}
            onChanged={invalidateItems}
            onEventsChanged={invalidateEvents}
            onTakeover={() => setOverlay({ kind: "takeover", slot: overlay.slot })}
          />
        </SlideOver>
      )}

      {overlay?.kind === "takeover" && (
        <SlideOver eyebrow={`${overlay.slot.name} ▸ TAKEOVER`} title="SEND A TAKEOVER" onClose={() => setOverlay(null)}>
          <TakeoverPanel slot={overlay.slot} takeovers={takeovers} onChanged={invalidateTakeovers} />
        </SlideOver>
      )}

      {overlay?.kind === "event" && (
        <SlideOver eyebrow="RUNNING & UPCOMING" title={overlay.editing ? "EDIT EVENT" : overlay.seed ? "RE-RUN EVENT" : "NEW EVENT"} onClose={() => setOverlay(null)}>
          <EventEditor
            editing={overlay.editing}
            seed={overlay.seed ?? null}
            toastRows={toastRows}
            onSaved={() => { invalidateEvents(); setOverlay(null); }}
            onCancel={() => setOverlay(null)}
            onDeleted={() => { invalidateEvents(); setOverlay(null); }}
          />
        </SlideOver>
      )}

      {/* `key` = the SLOT (addendum WARN). `openKey` lets the SAME panel instance re-enter
          when the manager re-presses the same opener inside the 140ms exit — which is
          exactly what must NOT happen for a DIFFERENT slot: without a key, React reused
          the instance and its `useState` seeds (a DEVICE MATCH draft, a daypart loaded
          into EDIT) carried from the old slot into the new one — measured as a cross-slot
          PATCH. Keyed on the slot id, same-slot keeps the openKey path and a different
          slot remounts fresh. Classic is unaffected: a `key` is React-only, no DOM. */}
      {overlay?.kind === "program" && (
        <ProgramOverlay
          key={overlay.slot.id}
          slot={overlay.slot}
          scheduleBySlot={scheduleBySlot}
          overrideHoldFor={overrideHoldFor}
          panelChoices={panelChoices}
          qc={qc}
          variant={variant}
          openKey={overlay}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay?.kind === "schedule" && (
        <ScheduleOverlay key={overlay.slot.id} slot={overlay.slot} timezone={timezone} variant={variant} openKey={overlay} onClose={() => setOverlay(null)} />
      )}

      {overlay?.kind === "asset" && (
        <AssetOverlay
          slots={slots}
          toastRows={toastRows}
          assets={assets}
          editing={overlay.editing}
          presetTemplate={overlay.preset}
          venueName={venueName}
          queueOnSlotId={overlay.queueOnSlotId}
          nextPosition={nextPosition}
          // Return to the slide-over we came from (QUEUE / ADD) if set, else close to the hub.
          // ItemEditor fires this same onClose on save, delete, AND cancel, so all three exit paths
          // reappear behind the editor. onSaved/onDeleted run first (they invalidate queries) so the
          // reopened queue re-renders with fresh data.
          onClose={() => setOverlay(overlay.returnTo ?? null)}
          onSaved={invalidateItems}
          onDeleted={invalidateItems}
        />
      )}
    </>
  );
}

/**
 * SWITCH PROGRAM ▸ and ⧗ SCHEDULE, as standalone mounts (UX overhaul Beat 4).
 *
 * PURE MOVE out of the two branches above — same components, same props, derived the
 * same way. The MEDIA ▸ SCREENS & PROGRAMS page opens THESE, so there is exactly one
 * place that says what `hasSchedule` / `overrideActive` / `panelChoices` mean and what a
 * program write invalidates. A second copy on the media page is how the hub and that page
 * would start disagreeing about a live screen.
 */
export function ProgramOverlay({
  slot, scheduleBySlot, overrideHoldFor, panelChoices, qc, onClose, variant = "classic", openKey,
}: {
  slot: AdminSlot;
  scheduleBySlot: Map<string, unknown[]>;
  overrideHoldFor: (slot: AdminSlot) => ProgramHold | null;
  panelChoices: AdminSlot[];
  qc: QueryClient;
  onClose: () => void;
  /** Beat 8 PR 2 — a v2 page passes "v2" so the panel renders in the staff tokens.
   *  Threaded, never derived here: this wrapper exists so ONE definition says what
   *  `hasSchedule`/`overrideActive` mean, and reading the switch here would let the hub
   *  and the media page disagree about presentation on the same live screen. */
  variant?: "classic" | "v2";
  /** The caller's overlay-state object — a NEW object per press, which is what lets the
   *  v2 drawer survive a press-✕-then-press-the-same-opener inside its 140ms exit. */
  openKey?: unknown;
}) {
  return (
    <ProgramPanel
      slot={slot}
      hasSchedule={(scheduleBySlot.get(slot.id)?.length ?? 0) > 0}
      overrideActive={overrideHoldFor(slot) !== null}
      panelChoices={panelChoices}
      variant={variant}
      openKey={openKey}
      onClose={onClose}
      onChanged={() => qc.invalidateQueries({ queryKey: ["signage-admin", "slots"] })}
    />
  );
}

export function ScheduleOverlay({ slot, timezone, onClose, variant = "classic", openKey }: { slot: AdminSlot; timezone: string; onClose: () => void; variant?: "classic" | "v2"; openKey?: unknown }) {
  return <ScheduleEditor slot={slot} timezone={timezone} variant={variant} openKey={openKey} onClose={onClose} />;
}

/**
 * THE SLIDE EDITOR, as a standalone mount (UX overhaul Beat 6 PR 4).
 *
 * PURE MOVE out of the `asset` branch above — same ItemEditor, same props, and
 * `placementSlotIds` still derived by the same `placementsFor(assets, id)` call. BAR OPS ▸
 * SLIDES opens THIS, so there is exactly one definition of what editing a slide means:
 * which screens it reports as its placements, what a save invalidates, and where a new
 * slide is queued. A second ItemEditor call site is how the hub and that page would start
 * disagreeing about a slide.
 *
 * The one thing the caller owns is `onClose`: the hub returns to the QUEUE / + ADD
 * slide-over it came from (`returnTo`), the Slides page simply closes back to its list.
 */
export function AssetOverlay({
  slots, toastRows, assets, editing, presetTemplate, venueName, queueOnSlotId, nextPosition,
  onClose, onSaved, onDeleted,
}: {
  slots: AdminSlot[];
  toastRows: ToastCacheRow[];
  assets: AssetWithPlacements[];
  editing: AdminItem | null;
  presetTemplate: AdminItem["template"] | null;
  venueName: string | undefined;
  queueOnSlotId: string | null;
  nextPosition: (slotId: string) => number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  return (
    <ItemEditor
      slots={slots}
      toastRows={toastRows}
      editing={editing}
      presetTemplate={presetTemplate}
      venueName={venueName}
      queueOnSlotId={queueOnSlotId}
      placementSlotIds={editing ? placementsFor(assets, editing.id) : undefined}
      nextPosition={nextPosition}
      onClose={onClose}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
}

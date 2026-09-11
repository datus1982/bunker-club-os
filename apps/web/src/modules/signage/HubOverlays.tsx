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
}

export function HubOverlays({
  overlay, setOverlay, slots, assets, toastRows, itemsBySlot, liveEvents, liveGame, takeovers,
  canEvents, busyQueueId, queueExisting, scheduleBySlot, overrideHoldFor, panelChoices,
  timezone, venueName, nextPosition, invalidateItems, invalidateTakeovers, invalidateEvents, qc,
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

      {overlay?.kind === "program" && (
        <ProgramOverlay
          slot={overlay.slot}
          scheduleBySlot={scheduleBySlot}
          overrideHoldFor={overrideHoldFor}
          panelChoices={panelChoices}
          qc={qc}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay?.kind === "schedule" && (
        <ScheduleOverlay slot={overlay.slot} timezone={timezone} onClose={() => setOverlay(null)} />
      )}

      {overlay?.kind === "asset" && (
        <ItemEditor
          slots={slots}
          toastRows={toastRows}
          editing={overlay.editing}
          presetTemplate={overlay.preset}
          venueName={venueName}
          queueOnSlotId={overlay.queueOnSlotId}
          placementSlotIds={overlay.editing ? placementsFor(assets, overlay.editing.id) : undefined}
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
  slot, scheduleBySlot, overrideHoldFor, panelChoices, qc, onClose,
}: {
  slot: AdminSlot;
  scheduleBySlot: Map<string, unknown[]>;
  overrideHoldFor: (slot: AdminSlot) => ProgramHold | null;
  panelChoices: AdminSlot[];
  qc: QueryClient;
  onClose: () => void;
}) {
  return (
    <ProgramPanel
      slot={slot}
      hasSchedule={(scheduleBySlot.get(slot.id)?.length ?? 0) > 0}
      overrideActive={overrideHoldFor(slot) !== null}
      panelChoices={panelChoices}
      onClose={onClose}
      onChanged={() => qc.invalidateQueries({ queryKey: ["signage-admin", "slots"] })}
    />
  );
}

export function ScheduleOverlay({ slot, timezone, onClose }: { slot: AdminSlot; timezone: string; onClose: () => void }) {
  return <ScheduleEditor slot={slot} timezone={timezone} onClose={onClose} />;
}

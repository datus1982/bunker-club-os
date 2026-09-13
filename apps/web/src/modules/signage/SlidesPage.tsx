import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useUiVersion } from "@/shared/useUiVersion";
import { EmptyState, InlineNotice, ListRow, StaffPageHeader, StatusChip } from "@/shared/ui";
import { useIsMobile } from "@/shared/useIsMobile";
import {
  useAdminSlots, useAllItems, useSignageAssets, useToastCache, toastMap,
  type AdminItem, type AdminSlot, type AssetWithPlacements,
} from "./useSignageAdmin";
import {
  itemAirsToday, recurrenceChipLabel, useVenue, useVenueClock,
  type ToastCacheRow, type VenueClock,
} from "./useSignage";
import { AssetOverlay } from "./HubOverlays";
import {
  AssetCard, assetSubtitle, groupItemsBySlot, makeNextPosition, slotCode,
} from "./signageHubShared";
import { MONO, ghost, summarize, templateBadge } from "./signageAdminShared";
import "./signage.css";

/**
 * BAR OPS ▸ SLIDES (UX overhaul Beat 6, PR 4 — letter B(a)).
 *
 * ORGANISATION ONLY. This is the Signage Hub's ASSET LIBRARY section, moved to a page of
 * its own: the SAME `signage_items` rows, the SAME `ItemEditor`, the SAME `slot_queue`
 * placement model. No table changed, no editor changed, no new feature. The hub keeps
 * SCREEN CONTROL (what is on air, + ADD / QUEUE / TAKEOVER, events, ★ POS) and now carries
 * a one-line "Manage slides →" link where the embedded library used to sit.
 *
 * WHY A PAGE AND NOT A FOLD INTO MEDIA ▸ LIBRARY (code note N1): these are two different
 * libraries. THIS one is `signage_items` — the TV *slides* a manager authors (drink
 * specials, announcements, menu-group cards, Top Sellers, Instagram). MEDIA ▸ LIBRARY is
 * `media_files`, the video catalogue on the bar PC. Different table, different editor,
 * different placement model.
 *
 * v2 ONLY. A device still on the classic shell has no SLIDES nav entry and keeps the
 * library inside the hub, so this route redirects there — the same inverse-MovedRoute
 * wrapper Beat 4 gave the /media/* pages. Classic is therefore untouched (RULE #1).
 *
 * DECISION: the page calls the hub's own HOOKS rather than taking a `SignageHubContext`.
 * react-query serves both surfaces from ONE cache entry per key, so the count in the hub's
 * notice and the count here cannot disagree and a save invalidates exactly what a save in
 * the hub invalidates — while a ctx would force this page to construct the screen-program
 * resolvers (`makeEffFor` and friends) it never renders. Single-sourcing therefore lives at
 * the FUNCTION level: `groupItemsBySlot` / `makeNextPosition` / `AssetOverlay` / `AssetCard`
 * / `summarize` / `assetSubtitle` are shared, not copied.
 *
 * Sizes are inline px: nothing inherits font-size under `.terminal-theme` (PR #89).
 */

/** v2-only route guard — the inverse MovedRoute (Beat 4's `V2Only`, same shape). */
export function Slides() {
  const [version] = useUiVersion();
  // A wrapper, not an early return inside the page: flipping the switch while the page is
  // mounted must mount/unmount a child, never change one component's hook count.
  if (version !== "v2") return <Navigate to="/signage" replace />;
  return <SlidesPage />;
}

export function SlidesPage() {
  const qc = useQueryClient();
  const slotsQ = useAdminSlots();
  const itemsQ = useAllItems();
  const assetsQ = useSignageAssets();
  const toastQ = useToastCache();
  const venueQ = useVenue();

  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  const assets = useMemo(() => assetsQ.data ?? [], [assetsQ.data]);
  const toastRows = useMemo(() => toastQ.data ?? [], [toastQ.data]);
  const tmap = useMemo(() => toastMap(toastRows), [toastRows]);
  // DECISION: `useVenueClock()` rather than re-typing the hub's two fallbacks inline. It is
  // the shared helper over the same two cached queries with the same defaults
  // (America/Chicago, closeout 4), so an OFF TODAY chip means the same thing here as on the
  // hub card and on the TV — a second pair of fallbacks is how they would stop meaning it.
  const venueClock = useVenueClock();

  // The hub's slow render clock, same 60s cadence (a console, not a display). Without it a
  // day-scheduled slide's OFF TODAY chip would keep asserting the business day that was
  // current when the page mounted.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);

  // The hub's definitions, from the hub's file — one answer to "where does a new slide land
  // in that screen's queue".
  //
  // `nextPosition` is DEAD BY CONSTRUCTION on this page: ItemEditor only calls it while
  // saving a NEW item that carries a `queueOnSlotId`, and this page always passes null (see
  // the DECISION at the editor mount). It is threaded through anyway, from the shared
  // definition, because the alternative — omitting it — makes the editor fall back to
  // position 0 the day someone gives this page a queue-on-save path, filing a new slide at
  // the TOP of a screen's rotation. Cheaper to be correct now than to remember then.
  const itemsBySlot = useMemo(() => groupItemsBySlot(itemsQ.data ?? []), [itemsQ.data]);
  const nextPosition = makeNextPosition(itemsBySlot);

  const invalidateItems = () => {
    qc.invalidateQueries({ queryKey: ["signage-admin", "items"] });
    qc.invalidateQueries({ queryKey: ["signage-admin", "assets"] });
  };

  /** null = closed; `item: null` = the + New slide flow. The hub's own overlay shape. */
  const [editing, setEditing] = useState<{ item: AdminItem | null } | null>(null);
  const newSlide = () => setEditing({ item: null });

  const narrow = useIsMobile();
  const count = assets.length;

  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100%", padding: "24px clamp(16px,4vw,40px) 48px", fontFamily: MONO }}>
      {/* `data-st-page` = the token sheet's opt-in hook, on the CONTENT wrapper only — the
          editor below is the hub's shared ItemEditor (its live SignagePreview renders a real
          board whose amber/green must not be repainted). Same rule as the hub and the MEDIA
          pages. */}
      <div data-st-page="" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <StaffPageHeader
          eyebrow="BAR OPS ▸ SLIDES"
          title="Slides"
          tag={assetsQ.isLoading ? "LOADING…" : `${count} SLIDE${count === 1 ? "" : "S"}`}
          right={
            <button type="button" onClick={newSlide} className="st-btn st-btn-primary st-body" style={{ ...ghost, fontWeight: 700 }}>
              + New slide
            </button>
          }
        />

        {/* The "how do I get an IDLE slide onto a screen" affordance lives HERE, not on the
            IDLE chip. A ListRow with `onClick` renders a <button>, and an <a> inside a
            <button> is invalid interactive nesting — it would also split the row's 44px tap
            target in two. The desktop AssetCard is worse: it is SHARED with the classic hub,
            so a link inside it would break classic byte-identity. So the chip explains itself
            with a `title`, and the one clickable route to /signage rides InlineNotice, which
            gives it a 44px target by construction (an inline <a> inside this sentence
            measured 158×31 — a real miss on a phone, which is why it is not one). */}
        <InlineNotice
          style={{ margin: "0 0 16px" }}
          message="Every card the screens can rotate, built once and shared by every screen. Queue one onto a screen from that screen's + ADD, and set its order and seconds in its QUEUE."
          to="/signage"
          label="SIGNAGE HUB →"
        />

        {assetsQ.isLoading ? (
          <div className="st-body st-t2">Loading slides…</div>
        ) : count === 0 ? (
          <EmptyState
            eyebrow="EMPTY LIBRARY"
            message="No slides yet — build one and it becomes available to every screen."
            actionLabel="+ NEW SLIDE"
            onAction={newSlide}
            primary
          />
        ) : narrow ? (
          // Phone: one tappable row per slide. The 200px-minimum thumbnail grid is a
          // desktop shape — on a 390px screen it becomes a single column of cards that
          // scrolls forever, and the thumbnail tells a manager less than the name does.
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {assets.map((a) => (
              <AssetListRow
                key={a.asset.id}
                a={a}
                slots={slots}
                tmap={tmap}
                toastRows={toastRows}
                now={now}
                venueClock={venueClock}
                onOpen={() => setEditing({ item: a.asset as unknown as AdminItem })}
              />
            ))}
          </div>
        ) : (
          // Desktop: the ratified thumbnail grid (D3) is kept — it reads correctly at
          // 1280 and the picture IS the information there.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))", gap: 12 }}>
            {assets.map((a) => (
              <AssetCard
                key={a.asset.id}
                a={a}
                slots={slots}
                toastRows={toastRows}
                tmap={tmap}
                now={now}
                venueClock={venueClock}
                onOpen={() => setEditing({ item: a.asset as unknown as AdminItem })}
              />
            ))}
          </div>
        )}
      </div>

      {/* The hub's editor, mounted from the hub's own definition (AssetOverlay). Rendered
          OUTSIDE the token scope for the reason above. `returnTo` is a hub concept — there
          is no slide-over behind this one, so every exit path closes back to the list.
          DECISION: `queueOnSlotId` is always null here — a slide created on this page is
          IDLE until queued from a screen's + ADD in the hub, byte-matching the hub's own
          `+ NEW ASSET` overlay (the D5/D6 model). */}
      {editing && (
        <AssetOverlay
          key={editing.item?.id ?? "new"}
          variant="v2"
          slots={slots}
          toastRows={toastRows}
          assets={assets}
          editing={editing.item}
          presetTemplate={null}
          venueName={venueQ.data?.name}
          queueOnSlotId={null}
          nextPosition={nextPosition}
          onClose={() => setEditing(null)}
          onSaved={invalidateItems}
          onDeleted={invalidateItems}
        />
      )}
    </div>
  );
}

/* ── slide row (phone) — PURE MOVE from SignageHubV2.tsx ────────────────────── */
/* The hub read these five values off its `ctx`; this page passes them in as props. The
   body below is unchanged, token for token. */
function AssetListRow({ a, slots, tmap, toastRows, now, venueClock, onOpen }: {
  a: AssetWithPlacements;
  slots: AdminSlot[];
  tmap: Map<string, ToastCacheRow>;
  toastRows: ToastCacheRow[];
  now: Date;
  venueClock: VenueClock;
  onOpen: () => void;
}) {
  const item = a.asset as unknown as AdminItem;
  const dayLabel = recurrenceChipLabel(item.recurrence);
  const offToday = !!dayLabel && !itemAirsToday(item, now, venueClock);
  const placed = new Set(a.placements.map((p) => p.slot_id));
  return (
    <ListRow
      // Stacked: this row only renders on a phone, and side-by-side the meta cell gets
      // squeezed to a few characters — the chips need a line of their own.
      stacked
      onClick={onOpen}
      title={summarize(item, toastRows)}
      sub={assetSubtitle(item, tmap)}
      meta={
        <>
          <StatusChip tone="idle" label={templateBadge(item.template)} />
          {dayLabel && <StatusChip tone="warn" label={`↻ ${dayLabel}${offToday ? " · OFF TODAY" : ""}`} />}
          {a.placements.length === 0
            ? <StatusChip tone="off" title="Not on any screen yet — queue it from a screen's + ADD in the Signage Hub" label="IDLE" />
            : slots.filter((s) => placed.has(s.id)).map((s) => (
                <StatusChip key={s.id} tone="live" title={`${s.name} — queued`} label={slotCode(s)} />
              ))}
        </>
      }
    />
  );
}

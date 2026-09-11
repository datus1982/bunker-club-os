import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ConfirmDialog, EmptyState, InlineNotice, ListRow, ScreenCard, StaffPageHeader, StatusChip,
  type StatusTone,
} from "@/shared/ui";
import { useIsMobile } from "@/shared/useIsMobile";
import { screenHealth, type AdminItem, type AdminSlot, type AssetWithPlacements } from "./useSignageAdmin";
import { itemAirsToday, recurrenceChipLabel, type SlotMode } from "./useSignage";
import {
  MONO, CollapsibleSection, CopyKioskButton, EventKindBadge, ghost,
  summarize, templateBadge,
} from "./signageAdminShared";
import { schedulePhrase, statusInfo, type EventRow } from "./useEventsAdmin";
import {
  AssetCard, TransportRow, assetSubtitle, cardBtn, miniBtn, rotationSummary, seedFromEvent, slotCode,
  useEventRowActions, type SignageHubContext,
} from "./signageHubShared";
import { MediaSection } from "./MediaSection";
import "./signage.css";

/**
 * /signage — THE SIGNAGE HUB, v2 presentation (UX overhaul Beat 3).
 *
 * PRESENTATION ONLY. Every query, mutation and derivation lives in `SignageHub.tsx` and
 * arrives in `ctx`; the slide-overs arrive already built as `overlays`. This file must
 * never call Supabase, and must never re-derive what a screen is showing.
 *
 * THE HUB/TV PARITY INVARIANT IS WHY: an ON AIR card reports what the TV's own resolver
 * returns (`ctx.modeFor` / `ctx.programLabelFor` / the shared `rotationSummary`, which
 * still calls `resolveRotation` exactly as it always did). A card that computed its own
 * opinion here would be a second answer to "what is on that screen" — the class of bug
 * the invariant exists to prevent. Every string below is the classic wording, unchanged.
 *
 * What actually changes: the page heading becomes StaffPageHeader; the hand-rolled
 * chips become StatusChip; the screen card becomes the shared ScreenCard frame holding
 * the SAME buttons with the SAME handlers; asset/event/past rows become ListRow on a
 * phone; every empty state becomes EmptyState; the two arm banners become InlineNotice;
 * and FIRE NOW asks through the ratified ConfirmDialog instead of `window.confirm`.
 *
 * MediaSection is rendered UNCHANGED. It is not version-branched, so re-skinning it here
 * would change classic too (RULE #1) — and Beat 4 promotes MEDIA to its own top-level
 * section, which is where that surface gets its pass. DECISION (tagged).
 *
 * Sizes are inline px: nothing inherits font-size under `.terminal-theme` (PR #89).
 */
export function SignageHubV2({ ctx, overlays }: { ctx: SignageHubContext; overlays: ReactNode }) {
  // Two breakpoints, both from the shared hook: 640 = the app-wide phone line for lists;
  // 720 = the screen-card line classic already uses (the wide control row needs the extra
  // 80px before it degrades). Keeping 720 means the v2 card flips exactly where his does.
  const narrow = useIsMobile();
  const cardNarrow = useIsMobile(720);

  const online = ctx.slots.filter((s) => screenHealth(s.last_seen) === "online").length;

  return (
    <div className="terminal-theme staff-ui" style={{ minHeight: "100%", padding: "20px clamp(12px,4vw,40px)", fontFamily: MONO, color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <StaffPageHeader
          eyebrow="BAR OPS ▸ SIGNAGE HUB"
          title="SIGNAGE HUB"
          tag={ctx.slotsLoading ? "LOADING…" : `${ctx.slots.length} SCREEN${ctx.slots.length === 1 ? "" : "S"} · ${online} LIVE`}
          right={<Link to="/dashboard" style={{ ...ghost, textDecoration: "none", fontSize: 16, display: "inline-flex", alignItems: "center" }}>← DASHBOARD</Link>}
        />

        {/* ── A · ON AIR NOW ─────────────────────────────────────────────── */}
        <div id="screens">
          <SectionHeading label="ON AIR NOW" note="what each screen is showing this second" />

          {ctx.gameOffScreens && (
            <InlineNotice
              kind="warn"
              style={{ marginBottom: 12 }}
              message={<>⚠ TRIVIA IS <strong>NOT ON THE SCREENS</strong> — a game exists but hasn't been armed. The bar TVs are on rotation. Arm it with “PUT TRIVIA ON SCREENS” from the Scoring page before game night.</>}
            />
          )}
          {ctx.armedNoGame && (
            <InlineNotice
              style={{ marginBottom: 12 }}
              message={<>◐ TRIVIA IS <strong>ARMED</strong> — no game loaded yet. The bar TVs show the SCAN-TO-JOIN holding board as soon as a game is created, then the live board once it starts. Auto-clears at the nightly rollover.</>}
            />
          )}

          {ctx.slotsLoading ? (
            <div style={{ fontSize: 20 }}>LOADING SCREENS…</div>
          ) : ctx.slots.length === 0 ? (
            <EmptyState eyebrow="NO SCREENS" message="No screens provisioned. Seed one in signage_slots." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ctx.slots.map((s) => <ScreenCardV2 key={s.id} slot={s} ctx={ctx} stacked={cardNarrow} />)}
            </div>
          )}
        </div>

        {/* ── B · ASSET LIBRARY ──────────────────────────────────────────── */}
        <CollapsibleSection
          style={{ marginTop: 32 }}
          sectionKey="assets"
          title="ASSET LIBRARY"
          summary={ctx.assetsLoading ? "…" : `${ctx.assets.length} asset${ctx.assets.length === 1 ? "" : "s"}`}
          defaultOpen={true}
          headerRight={
            <button type="button" onClick={() => ctx.setOverlay({ kind: "asset", editing: null, preset: null, queueOnSlotId: null })} style={{ ...ghost, fontWeight: 700 }}>+ NEW ASSET</button>
          }
        >
          {ctx.assetsLoading ? (
            <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING ASSETS…</div>
          ) : ctx.assets.length === 0 ? (
            <EmptyState
              eyebrow="EMPTY LIBRARY"
              message="No assets yet — build one and it becomes available to every screen."
              actionLabel="+ NEW ASSET"
              onAction={() => ctx.setOverlay({ kind: "asset", editing: null, preset: null, queueOnSlotId: null })}
            />
          ) : narrow ? (
            // Phone: one tappable row per asset. The 200px-minimum thumbnail grid is a
            // desktop shape — on a 390px screen it becomes a single column of cards that
            // scrolls forever, and the thumbnail tells a manager less than the name does.
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ctx.assets.map((a) => <AssetListRow key={a.asset.id} a={a} ctx={ctx} />)}
            </div>
          ) : (
            // Desktop: the ratified thumbnail grid (D3) is kept — it reads correctly at
            // 1280 and the picture IS the information there.
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))", gap: 12 }}>
              {ctx.assets.map((a) => (
                <AssetCard key={a.asset.id} a={a} slots={ctx.slots} toastRows={ctx.toastRows} tmap={ctx.tmap} now={ctx.now} venueClock={ctx.venueClock} onOpen={() => ctx.openAsset(a)} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* ── B2 · MEDIA LIBRARY — untouched (see the file docstring) ────── */}
        <MediaSection />

        {/* ── C · RUNNING & UPCOMING (events) ────────────────────────────── */}
        <div id="events" style={{ marginTop: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <SectionHeading label="RUNNING & UPCOMING" note="promos & events, live and scheduled" style={{ margin: 0 }} />
            {ctx.canEvents && (
              <button type="button" onClick={() => ctx.setOverlay({ kind: "event", editing: null })} className="u-fill u-ink" style={{ ...ghost, fontWeight: 700, background: "var(--terminal-green)", color: "#000" }}>+ NEW EVENT</button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            {ctx.eventsLoading ? (
              <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING…</div>
            ) : ctx.events.length === 0 ? (
              <EmptyState
                eyebrow="NOTHING SCHEDULED"
                message="No promo or event is running or queued up."
                actionLabel={ctx.canEvents ? "+ NEW EVENT" : undefined}
                onAction={ctx.canEvents ? () => ctx.setOverlay({ kind: "event", editing: null }) : undefined}
                primary
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ctx.events.map((ev) => (
                  <EventListRow
                    key={ev.id}
                    row={ev}
                    canEvents={ctx.canEvents}
                    stacked={narrow}
                    onEdit={() => ctx.setOverlay({ kind: "event", editing: ev })}
                    onChanged={ctx.invalidateEvents}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── C2 · PAST (completed events, re-runnable) ──────────────────── */}
        {ctx.pastEvents.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <SectionHeading label="PAST" note="finished events — RE-RUN to schedule again" style={{ margin: 0, opacity: 0.55 }} />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {ctx.pastEvents.map((ev) => (
                <ListRow
                  key={ev.id}
                  stacked={narrow}
                  style={{ opacity: 0.7 }}
                  title={ev.name}
                  sub={`ran ${schedulePhrase(ev)}${ev.show_on_website ? " · 🌐" : ""}`}
                  meta={<><EventKindBadge kind={ev.kind} /><StatusChip tone="off" label="DONE" /></>}
                  actions={ctx.canEvents
                    ? <button type="button" style={rowBtnV2} onClick={() => ctx.setOverlay({ kind: "event", editing: null, seed: seedFromEvent(ev) })}>↻ RE-RUN</button>
                    : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── D · ★ FEATURED ON POS (read-only) ──────────────────────────── */}
        <div style={{ marginTop: 32 }}>
          <SectionHeading label="★ FEATURED ON POS" note="read-only — flipped at the register" />
          <div style={{ fontSize: 15, opacity: 0.65, margin: "0 0 10px", lineHeight: 1.5 }}>
            In-stock items in the Toast ★ SCREENS group auto-rotate onto every screen. Toggle these at the POS
            (Quick Edit → In/Out of Stock) — there is no button here (Toast access is read-only).
          </div>
          {ctx.featured.length === 0 ? (
            <EmptyState eyebrow="NOTHING FEATURED" message="Mark an item In Stock in the POS ★ SCREENS group and it appears on every screen." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))", gap: 8 }}>
              {ctx.featured.map((f) => (
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
      </div>

      {overlays}
    </div>
  );
}

/* ── section heading: the shell's eyebrow treatment ────────────────────────── */
function SectionHeading({ label, note, style }: { label: string; note?: string; style?: CSSProperties }) {
  return (
    <div style={{ margin: "0 0 10px", ...style }}>
      <div style={{ fontSize: 13, letterSpacing: 4, opacity: 0.55, textTransform: "uppercase" }}>{label}</div>
      {note && <div style={{ fontSize: 15, opacity: 0.5, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

/* ── A · screen card, v2 (the shared frame + the page's own controls) ───────── */
function ScreenCardV2({ slot, ctx, stacked }: { slot: AdminSlot; ctx: SignageHubContext; stacked: boolean }) {
  const health = screenHealth(slot.last_seen);
  const mode = ctx.modeFor(slot);
  const programLabel = ctx.programLabelFor(slot);
  const programActive = mode === "rotation" && !!programLabel;
  const overrideHold = ctx.overrideHoldFor(slot);
  const scheduleCount = ctx.scheduleCountFor(slot);
  const isPanel = slot.kind === "panel";
  const isLandscape = slot.orientation === "landscape";
  const overflowOpen = ctx.overflowSlot === slot.id;
  const summary = rotationSummary(ctx.itemsBySlot.get(slot.id) ?? [], ctx.tmap, ctx.now, ctx.venueClock);

  const meta = `${slot.orientation.toUpperCase()} · TERMINAL ${String(slot.terminal_number ?? 0).padStart(2, "0")}${slot.location_label ? ` — ${slot.location_label}` : ""}`;

  // PANEL (D2): a portrait sidebar inside a landscape multiview — no health, no takeover,
  // no program ("follows its host"). Same reduced treatment classic gives it.
  if (isPanel) {
    return (
      <ScreenCard
        stacked={stacked}
        name={slot.name}
        badge={<StatusChip tone="warn" label="PANEL" />}
        meta={<>PORTRAIT PANEL · runs inside a landscape MULTIVIEW · no TV of its own<br />no takeover — follows its host screen</>}
        status={summary}
        actions={
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <button type="button" onClick={() => ctx.setOverlay({ kind: "add", slot })} className="u-fill u-ink" style={{ ...cardBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700, padding: "9px 18px" }}>+ ADD</button>
            <button type="button" onClick={() => ctx.setOverlay({ kind: "queue", slot })} style={{ ...cardBtn, padding: "9px 18px" }}>QUEUE</button>
          </div>
        }
      />
    );
  }

  // Plain-language status — the EXACT classic wording, kept word for word.
  const emph: CSSProperties = { fontSize: "inherit" };
  const status =
    mode === "rotation" && programActive ? (
      <><span className="u-amber" style={emph}>Playing {programLabel}.</span> Rotation resumes when the program is set back to ROTATION (a game/takeover still preempts it).</>
    ) : mode === "rotation" ? (
      <>{summary}</>
    ) : mode === "event" ? (
      <><span className="u-amber" style={emph}>Scheduled event holding the screens{ctx.eventLabel ? `: ${ctx.eventLabel}` : ""}.</span> Returns to rotation when the window ends.</>
    ) : mode === "game" ? (
      <><span className="u-amber" style={emph}>Showing the game display.</span> Returns to rotation automatically when the game ends.{ctx.staleGameDate ? <span className="u-amber" style={emph}> · game dated {ctx.staleGameDate}</span> : null}</>
    ) : (
      <><span className="u-red" style={emph}>Priority takeover on this screen</span>{ctx.takeoverMessageFor(slot) ? `: “${ctx.takeoverMessageFor(slot)}”` : ""}. Dismiss from TAKEOVER.</>
    );

  const hasSubStrip = isLandscape || ctx.transportPlaylistFor(slot);

  return (
    <ScreenCard
      stacked={stacked}
      name={slot.name}
      meta={meta}
      chips={
        <>
          <StatusChip
            tone={health === "online" ? "live" : health === "stale" ? "warn" : "alert"}
            dot={health === "online"}
            label={health === "online" ? "LIVE" : health === "stale" ? "STALE" : "DOWN"}
          />
          <StatusChip tone={modeTone(mode, programActive)} label={modeLabel(mode, programActive ? programLabel : null, ctx.eventLabel)} />
          {scheduleCount > 0 && (
            <StatusChip
              tone={overrideHold ? "warn" : "info"}
              label={overrideHold ? (overrideHold === "event" ? "⧗ SPECIAL EVENT" : "⧗ OVERRIDE") : `⧗ ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}`}
            />
          )}
        </>
      }
      status={status}
      actions={
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 7 }}>
          <button type="button" onClick={() => ctx.setOverlay({ kind: "add", slot })} className="u-fill u-ink" style={{ ...cardBtn, background: "var(--terminal-green)", color: "#000", fontWeight: 700, ...(stacked ? null : { padding: "9px 14px" }) }}>+ ADD</button>
          <button type="button" onClick={() => ctx.setOverlay({ kind: "queue", slot })} style={{ ...cardBtn, ...(stacked ? null : { padding: "9px 14px" }) }}>QUEUE</button>
          <button type="button" onClick={() => ctx.setOverlay({ kind: "takeover", slot })} className="u-amber" style={{ ...cardBtn, borderColor: "var(--terminal-amber, #ffb000)", ...(stacked ? null : { padding: "9px 14px" }) }}>TAKEOVER</button>
          <button type="button" onClick={() => ctx.toggleOverflow(slot.id)} aria-label="More" title="KIOSK URL · PREVIEW · health" style={{ ...cardBtn, padding: "9px 10px", fontSize: 20, opacity: 0.75 }}>⋯</button>
        </div>
      }
      subStrip={hasSubStrip ? (
        <>
          {/* Media programs + schedules are landscape-only (portrait slots stay pure rotation). */}
          {isLandscape && (
            <button type="button" onClick={() => ctx.setOverlay({ kind: "program", slot })} className={programActive ? "u-amber" : ""} style={{ ...cardBtn, flex: "1 1 220px", justifyContent: "space-between", padding: "9px 12px", ...(programActive ? { borderColor: "var(--terminal-amber, #ffb000)" } : null) }}>
              <span style={{ letterSpacing: 1, fontSize: "inherit" }}>▶ PROGRAM: {programActive ? programLabel : "ROTATION"}</span>
              <span style={{ opacity: 0.7, fontSize: "inherit" }}>SWITCH ▸</span>
            </button>
          )}
          {isLandscape && (
            <button type="button" onClick={() => ctx.setOverlay({ kind: "schedule", slot })} style={{ ...cardBtn, flex: "1 1 220px", justifyContent: "space-between", padding: "9px 12px" }}>
              <span style={{ letterSpacing: 1, fontSize: "inherit" }}>⧗ SCHEDULE{scheduleCount > 0 ? `: ${scheduleCount} DAYPART${scheduleCount === 1 ? "" : "S"}` : ""}</span>
              <span style={{ opacity: 0.7, fontSize: "inherit" }}>{scheduleCount > 0 ? "EDIT ▸" : "SET UP ▸"}</span>
            </button>
          )}
          {ctx.transportPlaylistFor(slot) && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}><TransportRow slug={slot.slug} /></div>
          )}
        </>
      ) : undefined}
      overflow={overflowOpen ? (
        <div className="terminal-border" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 15, opacity: 0.6 }}>
            SCREEN HEALTH: {health === "online" ? "● LIVE" : health === "stale" ? "◐ STALE" : "○ DOWN"}
            {slot.last_seen ? ` · last seen ${new Date(slot.last_seen).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "numeric", day: "numeric" })}` : " · never checked in"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href={`/signage/s/${slot.slug}?preview=1`}
              target="_blank"
              rel="noreferrer"
              title="Staff preview only — NEVER point a TV at a ?preview=1 URL (it never shows takeovers or game mode)."
              style={{ ...miniBtn, textDecoration: "none" }}
            >PREVIEW ↗</a>
            <CopyKioskButton slug={slot.slug} style={miniBtn} />
          </div>
        </div>
      ) : undefined}
    />
  );
}

/** The classic ModeChip's label, unchanged — only the chip around it is shared now. */
function modeLabel(mode: SlotMode, programLabel: string | null, eventLabel: string | null): string {
  return mode === "rotation" && programLabel ? `PROGRAM: ${programLabel}`
    : mode === "rotation" ? "MODE: ROTATION"
    : mode === "game" ? "MODE: LIVE GAME"
    : mode === "event" ? `EVENT: ${eventLabel ?? "SCHEDULED"}`
    : "MODE: TAKEOVER";
}
function modeTone(mode: SlotMode, programActive: boolean): StatusTone {
  if (mode === "takeover") return "alert";
  if (mode === "game" || mode === "event" || programActive) return "warn";
  return "idle";
}

/* ── B · asset row (phone) ──────────────────────────────────────────────────── */
function AssetListRow({ a, ctx }: { a: AssetWithPlacements; ctx: SignageHubContext }) {
  const item = a.asset as unknown as AdminItem;
  const dayLabel = recurrenceChipLabel(item.recurrence);
  const offToday = !!dayLabel && !itemAirsToday(item, ctx.now, ctx.venueClock);
  const placed = new Set(a.placements.map((p) => p.slot_id));
  return (
    <ListRow
      stacked={false}
      onClick={() => ctx.openAsset(a)}
      title={summarize(item, ctx.toastRows)}
      sub={assetSubtitle(item, ctx.tmap)}
      meta={
        <>
          <StatusChip tone="idle" label={templateBadge(item.template)} />
          {dayLabel && <StatusChip tone="warn" label={`↻ ${dayLabel}${offToday ? " · OFF TODAY" : ""}`} />}
          {a.placements.length === 0
            ? <StatusChip tone="off" label="IDLE" />
            : ctx.slots.filter((s) => placed.has(s.id)).map((s) => (
                <StatusChip key={s.id} tone="live" title={`${s.name} — queued`} label={slotCode(s)} />
              ))}
        </>
      }
    />
  );
}

/* ── C · event row ──────────────────────────────────────────────────────────── */
function EventListRow({
  row, canEvents, stacked, onEdit, onChanged,
}: { row: EventRow; canEvents: boolean; stacked: boolean; onEdit: () => void; onChanged: () => void }) {
  const { toggle, fire, done, paused, isLive } = useEventRowActions(row, onChanged);
  const [confirmFire, setConfirmFire] = useState(false);
  const st = statusInfo(row);

  return (
    <>
      <ListRow
        stacked={stacked}
        style={{ opacity: done ? 0.65 : 1 }}
        title={row.name}
        sub={`${schedulePhrase(row)}${row.interrupt_game ? " · interrupts game" : ""}${row.show_on_website ? " · 🌐" : ""}`}
        meta={
          <>
            <EventKindBadge kind={row.kind} />
            <StatusChip tone={st.tone === "now" ? "live" : st.tone === "one" ? "warn" : st.tone === "done" ? "off" : "info"} label={st.label} />
          </>
        }
        actions={
          <>
            {canEvents && !done && (
              isLive || paused ? (
                <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending} className={paused ? "" : "u-fill u-ink"} style={paused ? rowBtnV2 : { ...rowBtnV2, fontWeight: 700, background: "var(--terminal-green)", color: "#000" }}>
                  {paused ? "▶ RESUME" : "❚❚ PAUSE"}
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmFire(true)} disabled={fire.isPending} className="u-amber" style={{ ...rowBtnV2, borderColor: "var(--terminal-amber, #ffb000)" }}>▶ FIRE NOW</button>
              )
            )}
            {canEvents && <button type="button" onClick={onEdit} style={rowBtnV2}>EDIT</button>}
          </>
        }
      />
      {confirmFire && (
        <ConfirmDialog
          title={row.kind === "moment" ? "FIRE THIS MOMENT NOW?" : "PUT THIS ON THE SCREENS NOW?"}
          // The classic window.confirm wording, kept — it is the sentence the owner reads.
          body={row.kind === "moment" ? "It skips the tease and lands in ALERT." : `“${row.name}” goes onto the bar screens immediately.`}
          confirmLabel="▶ FIRE NOW"
          danger
          busy={fire.isPending}
          onConfirm={() => { fire.mutate(); setConfirmFire(false); }}
          onCancel={() => setConfirmFire(false)}
        />
      )}
    </>
  );
}

const rowBtnV2: CSSProperties = {
  fontFamily: MONO, fontSize: 15, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "7px 11px",
  minHeight: 44, cursor: "pointer", whiteSpace: "nowrap",
};

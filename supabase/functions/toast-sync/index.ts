// toast-sync — scheduled Toast POS → sales_cache sync (docs/08, Phase 3, AUTH-1 option b).
//
// This is the ONLY thing that talks to Toast. pg_cron invokes it every 60s (via pg_net);
// it aggregates the day's top-selling items per configured menu group + MAIN_MENU_ALL and
// writes public.sales_cache. The /drinks display is a pure realtime READER of that table
// and NEVER invokes this function — so a public screen cannot trigger Toast API spam
// (the legacy AUTH-1 hole). There is no unauthenticated invocation path: callers must
// present the shared CRON_SECRET (verify_jwt is off; the secret is the gate).
//
// SEC-3: Toast credentials live ONLY in function secrets (TOAST_CLIENT_ID/SECRET/
// RESTAURANT_GUID). TZ-1: business date comes from businessDate.ts (venue-TZ Intl), not a
// hardcoded UTC offset. READ-ONLY Toast access (standard tier) — no writes anywhere.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { businessDateFor } from "./businessDate.ts";
import {
  averageUnitsPerDate,
  countUnitsForGuid,
  mergeFields,
  vsAvgPct,
  type FinalStats,
  type RawOrder,
  type SalesRow,
} from "./eventCounter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TOAST_CLIENT_ID = Deno.env.get("TOAST_CLIENT_ID") ?? "";
const TOAST_CLIENT_SECRET = Deno.env.get("TOAST_CLIENT_SECRET") ?? "";
const TOAST_RESTAURANT_GUID = Deno.env.get("TOAST_RESTAURANT_GUID") ?? "";
const TOAST_BASE = "https://ws-api.toasttab.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Toast API ────────────────────────────────────────────────────────────────
async function getToastToken(): Promise<string> {
  const res = await fetch(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: TOAST_CLIENT_ID,
      clientSecret: TOAST_CLIENT_SECRET,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });
  if (!res.ok) throw new Error(`Toast auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.token.accessToken as string;
}

function toastHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Toast-Restaurant-External-ID": TOAST_RESTAURANT_GUID,
    "Content-Type": "application/json",
  };
}

interface AvailableGroup { guid: string; name: string; menuName: string }

async function getMenuGroups(token: string): Promise<AvailableGroup[]> {
  const res = await fetch(`${TOAST_BASE}/menus/v2/menus`, { headers: toastHeaders(token) });
  if (!res.ok) throw new Error(`menus fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const out: AvailableGroup[] = [];
  for (const menu of data.menus ?? []) {
    for (const g of menu.menuGroups ?? []) {
      if (g.guid && g.name && g.visibility !== "NONE") {
        out.push({ guid: g.guid, name: g.name, menuName: menu.name ?? "" });
      }
    }
  }
  return out;
}

// Restaurant business-day closeout hour (config:read). Best-effort — default 0 (calendar
// date) if the endpoint isn't readable at this access tier.
async function getCloseoutHour(token: string): Promise<number> {
  try {
    const res = await fetch(`${TOAST_BASE}/config/v2/restaurants/${TOAST_RESTAURANT_GUID}`, {
      headers: toastHeaders(token),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    // Toast reports closeout as "HH:mm:ss.SSS" under general/schedules depending on config.
    const raw = data?.general?.closeoutHour ?? data?.closeoutHour;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const hh = parseInt(raw.slice(0, 2), 10);
      if (!Number.isNaN(hh)) return hh;
    }
    return 0;
  } catch {
    return 0;
  }
}

interface ToastSelection {
  itemGroup?: { guid: string; name: string };
  item?: { guid: string };
  displayName: string;
  receiptLinePrice: number;
  preDiscountPrice: number;
  quantity: number;
  voided: boolean;
}
interface ToastOrder {
  checks?: { selections?: ToastSelection[]; voided?: boolean }[];
  excessFood?: boolean;
  openedDate?: string | null; // ISO 8601 — used by the event counter's time window
  voided?: boolean;
}

async function getOrders(token: string, businessDate: string): Promise<ToastOrder[]> {
  const res = await fetch(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${businessDate}`, {
    headers: toastHeaders(token),
  });
  if (!res.ok) throw new Error(`orders fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ToastOrder[];
}

interface TopItem { rank: number; item_guid: string; item_name: string; price: number; sales_count: number; sales_percentage: number }

// Aggregate top-5 items for a menu group (or MAIN_MENU_ALL for overall). Ports the legacy
// calculateTopItems: skip waste orders + voided selections; count quantity; price from
// receiptLinePrice; rank by units sold. (Top-customers mode intentionally dropped — PII on
// a public screen, out of docs/08 scope.)
function calculateTopItems(orders: ToastOrder[], menuGuid: string): TopItem[] {
  const overall = menuGuid === "MAIN_MENU_ALL";
  const items = new Map<string, { name: string; price: number; count: number }>();

  for (const order of orders) {
    if (order.excessFood) continue;
    for (const check of order.checks ?? []) {
      for (const sel of check.selections ?? []) {
        if (sel.voided) continue;
        if (!overall && sel.itemGroup?.guid !== menuGuid) continue;
        if (!sel.item) continue;
        const guid = sel.item.guid;
        const existing = items.get(guid);
        if (existing) {
          existing.count += sel.quantity || 1;
        } else {
          items.set(guid, { name: sel.displayName, price: sel.receiptLinePrice || 0, count: sel.quantity || 1 });
        }
      }
    }
  }

  const arr = [...items.entries()].map(([guid, v]) => ({ guid, ...v }));
  arr.sort((a, b) => b.count - a.count);
  const total = arr.reduce((s, i) => s + i.count, 0);
  return arr.slice(0, 5).map((i, idx) => ({
    rank: idx + 1,
    item_guid: i.guid,
    item_name: i.name,
    price: i.price,
    sales_count: i.count,
    sales_percentage: total > 0 ? (i.count / total) * 100 : 0,
  }));
}

// ── last item rung in (NOW POURING ticker source, owner design-beat) ──────────
// Find the most recent non-voided selection by order openedDate for the business date, so the
// signage ticker can say "◆ NOW POURING: {name}" = literally the last thing rung in. Respects
// the POS-visibility principle (never advertise anything not active on the POS view): skip any
// item explicitly pos_visible=false; fail-open otherwise (unknowns show; 86'd is fine — it was
// just sold). Returns { name, at } (at = the order's openedDate ISO) or null when nothing
// qualifies (caller then leaves the prior value untouched — the reader ages it out at 90 min).
interface LastRung { name: string; at: string }
function computeLastRung(orders: ToastOrder[], hiddenGuids: Set<string>, hiddenNames: Set<string>): LastRung | null {
  let best: { openedMs: number; name: string; at: string } | null = null;
  for (const order of orders) {
    if (order.voided || order.excessFood) continue;
    const at = order.openedDate ?? "";
    const openedMs = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(openedMs)) continue;
    for (const check of order.checks ?? []) {
      if (check.voided) continue;
      for (const sel of check.selections ?? []) {
        if (sel.voided || !sel.item) continue;
        const name = (sel.displayName ?? "").trim();
        if (!name) continue;
        if ((sel.item.guid && hiddenGuids.has(sel.item.guid)) || hiddenNames.has(name.toLowerCase())) continue;
        // Latest order wins; within the same order (equal openedMs) the LAST selection wins.
        if (!best || openedMs >= best.openedMs) best = { openedMs, name, at };
      }
    }
  }
  return best ? { name: best.name, at: best.at } : null;
}

// ── operating-hours gate ─────────────────────────────────────────────────────
// venue_settings key 'drinks_sync_window' = { "open": "HH:MM", "close": "HH:MM" } in the
// venue's timezone. Absent → always run. Handles overnight windows (close < open).
function withinWindow(now: Date, timeZone: string, win: { open?: string; close?: string } | null): boolean {
  if (!win?.open || !win?.close) return true;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")!.value);
  const mm = Number(parts.find((p) => p.type === "minute")!.value);
  const cur = hh * 60 + mm;
  const [oh, om] = win.open.split(":").map(Number);
  const [ch, cm] = win.close.split(":").map(Number);
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  return open <= close ? cur >= open && cur < close : cur >= open || cur < close;
}

// ── event SALES COUNTER pass (docs/13) ───────────────────────────────────────
// Runs on EVERY invocation (independent of the drinks_sync_window sales gate). For each
// venue it (1) refreshes fields.live_count for running toast-linked events, and (2) writes
// fields.final_stats once for freshly-completed toast-linked events. Orders are fetched by
// business date and cached within the call so overlapping events share one Toast pull; if a
// venue has no qualifying events, no Toast orders are fetched at all.
//
// deno-lint-ignore no-explicit-any
type Admin = any;
interface EventRow {
  id: string;
  fields: Record<string, unknown> | null;
  toast_guid: string;
  fire_at: string;
  window_minutes: number;
}

async function runEventsPass(
  admin: Admin,
  venueId: string,
  tz: string,
  token: string,
  closeoutHour: number,
): Promise<{ live_updated: number; stats_written: number; running: number; completed: number; skips: string[] }> {
  const now = new Date();
  const nowMs = now.getTime();
  const skips: string[] = [];

  // Running toast-linked events (live counter) …
  const { data: runningRows } = await admin
    .from("scheduled_events")
    .select("id, fields, toast_guid, fire_at, window_minutes")
    .eq("venue_id", venueId)
    .eq("status", "running")
    .not("toast_guid", "is", null)
    .not("fire_at", "is", null);
  const running = (runningRows ?? []) as EventRow[];

  // … and freshly-completed toast-linked events still needing final_stats (bounded to the
  // last 6h of window-end so old history is never reprocessed).
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const { data: completedRows } = await admin
    .from("scheduled_events")
    .select("id, fields, toast_guid, fire_at, window_minutes")
    .eq("venue_id", venueId)
    .eq("status", "completed")
    .not("toast_guid", "is", null)
    .not("fire_at", "is", null);
  const completed = ((completedRows ?? []) as EventRow[]).filter((e) => {
    if (e.fields && (e.fields as Record<string, unknown>).final_stats !== undefined) return false;
    const endMs = Date.parse(e.fire_at) + (e.window_minutes ?? 0) * 60_000;
    return endMs <= nowMs && endMs >= nowMs - sixHoursMs;
  });

  // Per-business-date order cache (fetch each date at most once across all events).
  const orderCache = new Map<string, RawOrder[]>();
  async function ordersFor(businessDate: string): Promise<RawOrder[]> {
    const hit = orderCache.get(businessDate);
    if (hit) return hit;
    const fetched = (await getOrders(token, businessDate)) as unknown as RawOrder[];
    orderCache.set(businessDate, fetched);
    return fetched;
  }
  // Union the orders covering [fromMs, toMs] — usually one business date, two only if the
  // window straddles the venue's closeout rollover.
  async function ordersCovering(fromDate: Date, toDate: Date): Promise<RawOrder[]> {
    const bdSet = new Set<string>([
      businessDateFor(fromDate, tz, closeoutHour),
      businessDateFor(toDate, tz, closeoutHour),
    ]);
    const out: RawOrder[] = [];
    for (const bd of bdSet) out.push(...(await ordersFor(bd)));
    return out;
  }

  let liveUpdated = 0;
  for (const ev of running) {
    const fromMs = Date.parse(ev.fire_at);
    if (Number.isNaN(fromMs)) continue;
    const orders = await ordersCovering(new Date(fromMs), now);
    const count = countUnitsForGuid(orders, ev.toast_guid, fromMs, nowMs);
    const prev = (ev.fields as Record<string, unknown> | null)?.live_count;
    if (prev !== count) {
      const merged = mergeFields(ev.fields, { live_count: count });
      const { error } = await admin.from("scheduled_events").update({ fields: merged }).eq("id", ev.id);
      if (error) throw error;
      liveUpdated++;
    }
  }

  let statsWritten = 0;
  for (const ev of completed) {
    const fromMs = Date.parse(ev.fire_at);
    if (Number.isNaN(fromMs)) continue;
    const endMs = fromMs + (ev.window_minutes ?? 0) * 60_000;
    const orders = await ordersCovering(new Date(fromMs), new Date(endMs));
    const units = countUnitsForGuid(orders, ev.toast_guid, fromMs, endMs);

    // Baseline = this item's average units per prior business date from sales_cache history.
    const eventBusinessDate = businessDateFor(new Date(fromMs), tz, closeoutHour);
    const { data: hist } = await admin
      .from("sales_cache")
      .select("business_date, sales_count")
      .eq("venue_id", venueId)
      .eq("item_guid", ev.toast_guid);
    const { avg, dates } = averageUnitsPerDate((hist ?? []) as SalesRow[], eventBusinessDate);
    const pct = vsAvgPct(units, avg);
    if (avg === null) {
      skips.push(`event ${ev.id}: vs_avg skipped (${dates} prior date(s) < 3)`);
    }

    const finalStats: FinalStats = {
      units,
      window_minutes: ev.window_minutes ?? 0,
      vs_avg_pct: pct,
      computed_at: now.toISOString(),
    };
    const merged = mergeFields(ev.fields, { final_stats: finalStats });
    const { error } = await admin.from("scheduled_events").update({ fields: merged }).eq("id", ev.id);
    if (error) throw error;
    statsWritten++;
  }

  return { live_updated: liveUpdated, stats_written: statsWritten, running: running.length, completed: completed.length, skips };
}

// ── main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Auth gate: shared cron secret. No secret configured OR mismatch → reject.
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;
  // Optional businessDate override (YYYYMMDD) for manual backfill / testing. Only
  // reachable behind the cron secret, so it's not an public surface.
  const dateOverride: string | null = typeof body?.businessDate === "string" && /^\d{8}$/.test(body.businessDate) ? body.businessDate : null;

  if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !TOAST_RESTAURANT_GUID) {
    return json({ error: "Toast credentials not configured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: venues, error: vErr } = await admin.from("venues").select("id, timezone");
    if (vErr) throw vErr;

    const token = await getToastToken();
    const closeoutHour = await getCloseoutHour(token);
    const menuGroups = await getMenuGroups(token);
    const groupName = new Map(menuGroups.map((g) => [g.guid, g.name]));

    const results: Record<string, unknown>[] = [];

    for (const venue of venues ?? []) {
      const tz = (venue.timezone as string) || "America/Chicago";

      // DECISION: closeout-hour override. Toast /config 404s at our (standard) access tier, so
      // getCloseoutHour() returns 0 and the setting the owner applied (venue_settings
      // toast_closeout_hour=4) was inert — every order past midnight flipped the board to an
      // empty NEW day mid-service. Honor that setting here (a 4 AM bar rollover keeps late-night
      // orders on the correct business date); fall back to the Toast value, else 0. Additive,
      // and it makes the closeout=4 premise real for the Top Sellers idle state + last-rung.
      const { data: coRow } = await admin
        .from("venue_settings")
        .select("value")
        .eq("venue_id", venue.id)
        .eq("key", "toast_closeout_hour")
        .maybeSingle();
      const coVal = typeof coRow?.value === "number" ? coRow.value : Number(coRow?.value);
      const effectiveCloseout = Number.isFinite(coVal) && coVal >= 0 && coVal <= 23 ? coVal : closeoutHour;

      // Operating-hours gate (unless force).
      const { data: winRow } = await admin
        .from("venue_settings")
        .select("value")
        .eq("venue_id", venue.id)
        .eq("key", "drinks_sync_window")
        .maybeSingle();
      const win = (winRow?.value as { open?: string; close?: string } | null) ?? null;
      const inWindow = force || withinWindow(new Date(), tz, win);

      // EVENT COUNTER pass — runs on EVERY invocation, independent of the sales window gate.
      // (docs/13: the live counter must keep ticking during an event even outside bar hours.)
      const events = await runEventsPass(admin, venue.id, tz, token, effectiveCloseout);

      if (!inWindow) {
        // Sales half is skipped outside operating hours — shape preserved for existing readers,
        // now additively carrying the events summary.
        results.push({ venue: venue.id, skipped: "outside operating hours", events });
        continue;
      }

      // Refresh the admin's pick-list of available groups.
      if (menuGroups.length > 0) {
        await admin.from("drinks_available_groups").upsert(
          menuGroups.map((g) => ({ venue_id: venue.id, toast_menu_guid: g.guid, name: g.name, menu_name: g.menuName, updated_at: new Date().toISOString() })),
          { onConflict: "venue_id,toast_menu_guid" },
        );
      }

      const businessDate = dateOverride ?? businessDateFor(new Date(), tz, effectiveCloseout);
      const orders = await getOrders(token, businessDate);

      // Configured groups to display (fall back to overall if none configured yet).
      const { data: groups } = await admin
        .from("drinks_menu_groups")
        .select("toast_menu_guid")
        .eq("venue_id", venue.id)
        .eq("enabled", true);
      const guids = (groups ?? []).map((g) => g.toast_menu_guid as string);
      const targetGuids = guids.length > 0 ? guids : ["MAIN_MENU_ALL"];

      let rowsWritten = 0;
      for (const guid of targetGuids) {
        const top = calculateTopItems(orders, guid);
        // Replace this group's cached rows atomically-ish: clear then insert fresh.
        await admin.from("sales_cache").delete().eq("venue_id", venue.id).eq("menu_group_guid", guid);
        if (top.length > 0) {
          const { error: insErr } = await admin.from("sales_cache").insert(
            top.map((t) => ({
              venue_id: venue.id,
              menu_group_guid: guid,
              business_date: businessDate,
              rank: t.rank,
              item_guid: t.item_guid,
              item_name: t.item_name,
              price: t.price,
              sales_count: t.sales_count,
              sales_percentage: t.sales_percentage,
            })),
          );
          if (insErr) throw insErr;
          rowsWritten += top.length;
        }
      }

      // Drop cache rows for groups no longer targeted (e.g. disabled since last run).
      await admin
        .from("sales_cache")
        .delete()
        .eq("venue_id", venue.id)
        .not("menu_group_guid", "in", `(${targetGuids.map((g) => `"${g}"`).join(",")})`);

      // LAST ITEM RUNG IN → venue_settings.signage_last_rung (NOW POURING ticker source).
      // Only when orders exist AND a qualifying selection is found — otherwise leave the prior
      // value in place (the display ages it out after 90 min).
      let lastRung: LastRung | null = null;
      if (orders.length > 0) {
        const { data: hiddenRows } = await admin
          .from("toast_menu_cache")
          .select("guid, name")
          .eq("venue_id", venue.id)
          .eq("pos_visible", false);
        const hiddenGuids = new Set((hiddenRows ?? []).map((h: { guid: string }) => h.guid));
        const hiddenNames = new Set((hiddenRows ?? []).map((h: { name: string | null }) => String(h.name ?? "").trim().toLowerCase()));
        lastRung = computeLastRung(orders, hiddenGuids, hiddenNames);
        if (lastRung) {
          const { error: rungErr } = await admin
            .from("venue_settings")
            .upsert({ venue_id: venue.id, key: "signage_last_rung", value: lastRung }, { onConflict: "venue_id,key" });
          if (rungErr) throw rungErr;
        }
      }

      results.push({ venue: venue.id, businessDate, closeoutHour: effectiveCloseout, orders: orders.length, groups: targetGuids.length, rowsWritten, groupNames: targetGuids.map((g) => groupName.get(g) ?? g), last_rung: lastRung?.name ?? null, events });
    }

    return json({ ok: true, results }, 200);
  } catch (error) {
    console.error("toast-sync error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

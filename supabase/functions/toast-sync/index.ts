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
interface ToastOrder { checks?: { selections?: ToastSelection[] }[]; excessFood?: boolean }

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

// ── main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Auth gate: shared cron secret. No secret configured OR mismatch → reject.
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const force = await req.json().then((b) => b?.force === true).catch(() => false);

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

      // Operating-hours gate (unless force).
      const { data: winRow } = await admin
        .from("venue_settings")
        .select("value")
        .eq("venue_id", venue.id)
        .eq("key", "drinks_sync_window")
        .maybeSingle();
      const win = (winRow?.value as { open?: string; close?: string } | null) ?? null;
      if (!force && !withinWindow(new Date(), tz, win)) {
        results.push({ venue: venue.id, skipped: "outside operating hours" });
        continue;
      }

      // Refresh the admin's pick-list of available groups.
      if (menuGroups.length > 0) {
        await admin.from("drinks_available_groups").upsert(
          menuGroups.map((g) => ({ venue_id: venue.id, toast_menu_guid: g.guid, name: g.name, menu_name: g.menuName, updated_at: new Date().toISOString() })),
          { onConflict: "venue_id,toast_menu_guid" },
        );
      }

      const businessDate = businessDateFor(new Date(), tz, closeoutHour);
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

      results.push({ venue: venue.id, businessDate, closeoutHour, orders: orders.length, groups: targetGuids.length, rowsWritten, groupNames: targetGuids.map((g) => groupName.get(g) ?? g) });
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

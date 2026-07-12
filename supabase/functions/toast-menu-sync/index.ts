// toast-menu-sync — Toast Menus V2 → toast_menu_cache mirror (docs/09, "POS as CMS").
//
// Sibling of toast-sync (same secrets, same CRON_SECRET gate, same scheduled/no-public
// invocation model). READ-ONLY per the Phase 3 docs/09 amendment — standard Toast access
// has no write scopes, so this only READS menus + stock; featured control is POS-side-only.
//
// Each run:
//   1. GET /menus/v2/metadata — cheap staleness check; pull full menus only when changed.
//   2. On change: GET /menus/v2/menus → upsert toast_menu_cache (name, PUBLIC blurb only,
//      price, image, group, tags). Mirror images into the `signage` bucket so screens never
//      depend on Toast's CDN.
//   3. Poll stock (86) status → out_of_stock (best-effort; defaults to in-stock).
// Description safety (docs/09): only text before `---` is shown; see menuText.publicBlurb.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicBlurb } from "./menuText.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TOAST_CLIENT_ID = Deno.env.get("TOAST_CLIENT_ID") ?? "";
const TOAST_CLIENT_SECRET = Deno.env.get("TOAST_CLIENT_SECRET") ?? "";
const TOAST_RESTAURANT_GUID = Deno.env.get("TOAST_RESTAURANT_GUID") ?? "";
const TOAST_BASE = "https://ws-api.toasttab.com";
const VENUE_ID = Deno.env.get("VENUE_ID") ?? "11111111-1111-1111-1111-111111111111";
const BUCKET = "signage";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getToastToken(): Promise<string> {
  const res = await fetch(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: TOAST_CLIENT_ID, clientSecret: TOAST_CLIENT_SECRET, userAccessType: "TOAST_MACHINE_CLIENT" }),
  });
  if (!res.ok) throw new Error(`Toast auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token.accessToken as string;
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": TOAST_RESTAURANT_GUID, "Content-Type": "application/json" };
}

// Mirror a Toast CDN image into our storage bucket; return the public URL (or null).
async function mirrorImage(admin: ReturnType<typeof createClient>, guid: string, imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `toast/${guid}.${ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

// Best-effort stock map: guid -> out_of_stock. Toast's stock endpoint shape varies by tier;
// default to in-stock if unreadable so a menu item never wrongly disappears.
async function getStockMap(token: string): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  try {
    const res = await fetch(`${TOAST_BASE}/stock/v1/inventory`, { headers: headers(token) });
    if (!res.ok) return map;
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.inventory ?? []);
    for (const r of rows) {
      const guid = r.guid ?? r.itemGuid;
      if (!guid) continue;
      // Toast /stock/v1/inventory: status is IN_STOCK | OUT_OF_STOCK | QUANTITY.
      // QUANTITY carries a finite `quantity`; <= 0 means effectively 86'd.
      const status = (r.status ?? r.stockStatus ?? "").toString().toUpperCase();
      const oos = status === "OUT_OF_STOCK" || status === "OUT" || r.inStock === false ||
        (status === "QUANTITY" && typeof r.quantity === "number" && r.quantity <= 0);
      map.set(guid, oos);
    }
  } catch { /* default in-stock */ }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (!CRON_SECRET || (req.headers.get("x-cron-secret") ?? "") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const force = await req.json().then((b) => b?.force === true).catch(() => false);

  if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !TOAST_RESTAURANT_GUID) {
    return json({ error: "Toast credentials not configured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const token = await getToastToken();

    // 1. Staleness check via metadata.
    const metaRes = await fetch(`${TOAST_BASE}/menus/v2/metadata`, { headers: headers(token) });
    const meta = metaRes.ok ? await metaRes.json() : {};
    const lastUpdated = String(meta.lastUpdated ?? "");

    const { data: stateRow } = await admin.from("venue_settings").select("value").eq("venue_id", VENUE_ID).eq("key", "toast_menu_last_synced").maybeSingle();
    const prev = (stateRow?.value as { lastUpdated?: string } | null)?.lastUpdated ?? "";
    const menuChanged = force || !lastUpdated || lastUpdated !== prev;

    // Stock always refreshes (cheap, changes often); menu body only when metadata changed.
    const stock = await getStockMap(token);

    let itemsUpserted = 0;
    if (menuChanged) {
      const menusRes = await fetch(`${TOAST_BASE}/menus/v2/menus`, { headers: headers(token) });
      if (!menusRes.ok) throw new Error(`menus fetch failed: ${menusRes.status} ${await menusRes.text()}`);
      const menusData = await menusRes.json();

      const rows: Record<string, unknown>[] = [];
      // Groups can nest sub-groups; walk the tree and collect items from every level.
      const walk = async (group: Record<string, any>) => {
        if (group.visibility === "NONE") return;
        for (const item of group.menuItems ?? []) {
          if (!item.guid) continue;
          const imageUrl = item.image ?? item.imageUrl ?? null;
          const mirrored = imageUrl ? await mirrorImage(admin, item.guid, imageUrl) : null;
          rows.push({
            guid: item.guid,
            venue_id: VENUE_ID,
            name: item.name ?? "",
            description: publicBlurb(item.description), // PUBLIC blurb only (docs/09 safety)
            price: typeof item.price === "number" ? item.price : 0,
            image_url: imageUrl,
            image_storage_path: mirrored,
            menu_group: group.name ?? null,
            item_tags: (item.itemTags ?? []).map((t: { name?: string }) => t.name ?? "").filter(Boolean),
            out_of_stock: stock.get(item.guid) ?? false,
            updated_at: new Date().toISOString(),
          });
        }
        for (const sub of group.menuGroups ?? []) await walk(sub);
      };
      for (const menu of menusData.menus ?? []) {
        for (const group of menu.menuGroups ?? []) await walk(group);
      }
      // De-dupe by guid (an item can appear in multiple menus) — upsert needs unique keys.
      const byGuid = new Map(rows.map((r) => [r.guid as string, r]));
      const deduped = [...byGuid.values()];
      if (deduped.length > 0) {
        const { error } = await admin.from("toast_menu_cache").upsert(deduped, { onConflict: "guid" });
        if (error) throw new Error(`toast_menu_cache upsert: ${error.message ?? JSON.stringify(error)}`);
        itemsUpserted = deduped.length;
      }
      await admin.from("venue_settings").upsert(
        { venue_id: VENUE_ID, key: "toast_menu_last_synced", value: { lastUpdated, at: new Date().toISOString() } },
        { onConflict: "venue_id,key" },
      );
    } else if (stock.size > 0) {
      // Menu unchanged: just refresh out_of_stock on the cached rows.
      for (const [guid, oos] of stock) {
        await admin.from("toast_menu_cache").update({ out_of_stock: oos, updated_at: new Date().toISOString() }).eq("guid", guid).eq("venue_id", VENUE_ID);
      }
    }

    return json({ ok: true, menuChanged, itemsUpserted, stockRows: stock.size, lastUpdated }, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("toast-menu-sync error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

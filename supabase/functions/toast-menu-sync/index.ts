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
//   4. Compute pos_visible from Menus V2 `visibility` channel arrays (0034): "POS"
//      present = active on the register (advertisable, per the owner's principle).
//      The GROUP test cascades into its items — the owner hides a whole group
//      (e.g. "Winter Cocktails", group visibility []) even while its items still
//      list POS on their own, so item-level visibility alone would miss it.
// Description safety (docs/09): only text before `---` is shown; see menuText.publicBlurb.
//
// v8 (2026-07-17): also extract pour-size price options (priceOptions.ts) into
// toast_menu_cache.price_options (0050) so $0-base liquor/draft items show SHOT/COCKTAIL/
// DOUBLE (or PINT/PITCHER) prices on the public menu.
//
// v10 (2026-09-01): also record WHERE each item sits in the owner's Toast layout
// (menuOrder.ts → toast_menu_cache.group_position / item_position, 0064). Toast is now the
// single source of the public menu's ORDER too — the website carries no order of its own,
// so a brand-new Toast group lands exactly where the owner put it with no deploy.
//
// v11 (2026-09-01): the sync stopped being additive-only. Owner ruling — "Toast should be
// the sole source of truth. If it is in Toast, visible, in stock, sellable, it should show
// up. If it's hidden, 86'd, deleted, etc it should be gone." Items ABSENT from the walk
// (deleted in Toast, or pulled off every menu) are now flagged removed_at + forced
// pos_visible=false (0066), which drops them from every public surface; every present row
// carries removed_at:null so a returning item is restored on the same pass. Guarded: an
// empty/failed payload never prunes (menuPrune.ts).
// v11 also fixes the OTHER half of the same ruling — an item that IS in Toast and visible
// must show up. A guid listed in both a visible group and a hidden one used to cache from its
// LAST occurrence, so the owner's Tiki Tuesday drinks (also listed in the POS-hidden Classics
// group) vanished from the website. The row de-dupe now keeps the occurrence menuOrder.ts
// chose — the FIRST POS-visible one, else the first — so menu_group, pos_visible and the
// positions always come from one and the same listing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicBlurb, publicLongform } from "./menuText.ts";
import { buildGroupUsage, extractPriceOptions } from "./priceOptions.ts";
import { assignMenuPositions } from "./menuOrder.ts";
import { chunk, gatePrune, planPrune, type PruneCacheRow } from "./menuPrune.ts";
import { isPosVisible } from "./posVisible.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TOAST_CLIENT_ID = Deno.env.get("TOAST_CLIENT_ID") ?? "";
const TOAST_CLIENT_SECRET = Deno.env.get("TOAST_CLIENT_SECRET") ?? "";
const TOAST_RESTAURANT_GUID = Deno.env.get("TOAST_RESTAURANT_GUID") ?? "";
const TOAST_BASE = "https://ws-api.toasttab.com";
const VENUE_ID = Deno.env.get("VENUE_ID") ?? "11111111-1111-1111-1111-111111111111";
const BUCKET = "signage";
// venue_settings state key raised when a prune is held by the cap (WARN-1). Absent = healthy;
// the staff dashboard reads it to show an amber "MENU PRUNE HELD" line on the Toast panel.
const PRUNE_ALARM_KEY = "toast_menu_prune_alarm";
const SYNC_VERSION = "v12-prune-cap"; // deployed==source marker

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

// isPosVisible (0034) now lives in posVisible.ts — menuOrder.ts needs the identical rule to
// choose which occurrence of a shared item wins, and two copies would drift.

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
    let priceOptionRows = 0;
    // Rows carrying a Toast layout position (0064). Since v11 every walked row carries its own
    // occupancy coordinates, so this now equals itemsUpserted — kept as an explicit signal that
    // the ordering walk ran (a 0 beside a non-zero itemsUpserted would mean it silently didn't).
    let positionedRows = 0;
    let removedRows = 0; // rows Toast no longer carries, flagged this pass (0066)
    let restoredRows = 0; // previously-removed rows Toast carries again (0066)
    // True when a prune was planned but HELD by the cap (WARN-1). A held pass deliberately
    // does NOT record lastUpdated, so the next 2-minute tick re-walks and retries.
    let pruneSkipped = false;
    if (menuChanged) {
      const menusRes = await fetch(`${TOAST_BASE}/menus/v2/menus`, { headers: headers(token) });
      if (!menusRes.ok) throw new Error(`menus fetch failed: ${menusRes.status} ${await menusRes.text()}`);
      const menusData = await menusRes.json();
      // NOTE-6: fail LOUD on a malformed body rather than walking `undefined` into an empty
      // row set. An empty walk is already guarded downstream, but a 200 carrying HTML or a
      // bare string should be an error in the logs, not a silent no-op pass.
      if (!menusData || typeof menusData !== "object") throw new Error("menus payload malformed");

      // Menu ORDER (0064): where the owner put each item in his Toast layout. Derived up-front
      // by a pure walk of the raw payload (menuOrder.ts — menus in order, groups in order,
      // sub-groups depth-first) so the ordering rule stays unit-testable (pnpm test:menuorder).
      // The map's value is the occurrence menuOrder CHOSE for each guid: the first POS-visible
      // one, else the first. The row walk below numbers its own occurrences identically (same
      // tree, same child order, same skip guards), so the de-dupe can keep exactly that row —
      // menu_group, pos_visible and the positions then always describe one single listing.
      const positions = assignMenuPositions(menusData);

      const rows: Record<string, unknown>[] = [];
      let groupCounter = 0; // must stay in lockstep with menuOrder's counter
      // Groups can nest sub-groups; walk the tree and collect items from every level.
      // `groupVisible` carries the POS-visibility cascade: once a hidden group is
      // entered, every descendant item inherits pos_visible=false regardless of its
      // own visibility (that's exactly how the owner hides a whole section). We no
      // longer early-return on a hidden group — hidden items stay in the cache
      // (staff picker shows them badged; the public_menu view filters them) rather
      // than vanishing, which would strand references to them.
      const walk = async (group: Record<string, any>, groupVisible: boolean) => {
        // Skipped WITHOUT consuming a group number — menuOrder's walkGroup guards identically.
        if (typeof group !== "object" || group === null) return;
        const here = groupVisible && isPosVisible(group.visibility);
        const groupPosition = groupCounter++;
        const items = Array.isArray(group.menuItems) ? group.menuItems : [];
        for (let itemPosition = 0; itemPosition < items.length; itemPosition++) {
          const item = items[itemPosition];
          if (typeof item !== "object" || item === null) continue;
          if (!item.guid) continue;
          const imageUrl = item.image ?? item.imageUrl ?? null;
          const mirrored = imageUrl ? await mirrorImage(admin, item.guid, imageUrl) : null;
          rows.push({
            guid: item.guid,
            venue_id: VENUE_ID,
            name: item.name ?? "",
            description: publicBlurb(item.description), // PUBLIC short blurb only (docs/09 safety)
            long_blurb: publicLongform(item.description), // authored long-form after `--- recipe |` (recipe discarded, 0048)
            price: typeof item.price === "number" ? item.price : 0,
            image_url: imageUrl,
            image_storage_path: mirrored,
            menu_group: group.name ?? null,
            item_tags: (item.itemTags ?? []).map((t: { name?: string }) => t.name ?? "").filter(Boolean),
            out_of_stock: stock.get(item.guid) ?? false,
            // pos_visible (0034) = group cascade AND item's own POS visibility.
            pos_visible: here && isPosVisible(item.visibility),
            // raw item channel array, for future per-channel granularity.
            visibility: Array.isArray(item.visibility) ? item.visibility : null,
            // Toast layout order (0064) — THIS occurrence's own coordinates, not a lookup.
            // The de-dupe below keeps the occurrence menuOrder chose, so the surviving row's
            // numbers are that choice by construction (and can never disagree with the
            // menu_group / pos_visible sitting beside them).
            group_position: groupPosition,
            item_position: itemPosition,
            // Present in Toast right now (0066). Written UNCONDITIONALLY on every present row
            // so an item the owner puts BACK is restored on the same pass that sees it —
            // restoration needs no separate step and no human.
            removed_at: null,
            // Pour-size price options (0050) are computed AFTER the walk, once every item's
            // group references are known (the venue-wide usage count drives the shared-tier
            // vs per-item-group choice). Stash the item's group refs here; stripped before upsert.
            _groupRefs: Array.isArray(item.modifierGroupReferences) ? item.modifierGroupReferences : [],
            updated_at: new Date().toISOString(),
          });
        }
        for (const sub of (Array.isArray(group.menuGroups) ? group.menuGroups : [])) await walk(sub, here);
      };
      for (const menu of (Array.isArray(menusData.menus) ? menusData.menus : [])) {
        if (typeof menu !== "object" || menu === null) continue;
        // A menu can itself be POS-hidden; seed the cascade from the menu's visibility.
        const menuVisible = isPosVisible(menu.visibility);
        for (const group of (Array.isArray(menu.menuGroups) ? menu.menuGroups : [])) await walk(group, menuVisible);
      }
      // De-dupe by guid (an item can appear in multiple menus) — the upsert needs unique keys,
      // and WHICH occurrence survives is load-bearing: it decides the item's menu_group, its
      // pos_visible and its position all at once. Keep the occurrence menuOrder chose (first
      // POS-visible, else first). Falling back to the first row when the map has no entry
      // (a non-string guid menuOrder skips) keeps this total and self-consistent.
      const byGuid = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const guid = r.guid as string;
        const prev = byGuid.get(guid);
        if (!prev) { byGuid.set(guid, r); continue; }
        const want = positions.get(guid);
        if (want && r.group_position === want.group_position && r.item_position === want.item_position) {
          byGuid.set(guid, r);
        }
      }
      const deduped = [...byGuid.values()];

      // Pour-size price options (0050): the root payload carries two ref maps; each item's
      // modifierGroupReferences point into modifierGroupReferences, whose options point into
      // modifierOptionReferences. buildGroupUsage counts distinct items per group (over the
      // DEDUPED set, so an item in two menus isn't double-counted) so the extractor can prefer
      // the shared tier group over a legacy per-item "Size" during the owner's restructure.
      const groupRefs = (menusData.modifierGroupReferences ?? {}) as Record<string, any>;
      const optionRefs = (menusData.modifierOptionReferences ?? {}) as Record<string, any>;
      const usage = buildGroupUsage(
        deduped.map((r) => (r._groupRefs as Array<number | string>) ?? []),
      );
      for (const r of deduped) {
        // Reviewer WARN-1: a malformed modifier shape must degrade THIS item's
        // options to null, never abort the whole sync pass (stale-cache risk).
        let opts: ReturnType<typeof extractPriceOptions> = null;
        try {
          opts = extractPriceOptions({
            groupRefIds: r._groupRefs as Array<number | string>,
            groupRefs,
            optionRefs,
            usage,
          });
        } catch (e) {
          console.error(`price-options extract failed for ${r.guid}: ${e instanceof Error ? e.message : e}`);
          opts = null;
        }
        r.price_options = opts;
        if (opts) priceOptionRows++;
        if (r.group_position !== null) positionedRows++;
        delete r._groupRefs; // never persisted — an internal carry only
      }

      // ── Prune (0066): what Toast NO LONGER carries ─────────────────────────────────
      // Read the cache's guid set BEFORE the upsert so `restored` is honest (the upsert is
      // about to clear removed_at on every present row). Two hard guards stand between a bad
      // Toast response and a blanked menu: this `deduped.length > 0` check, and planPrune's
      // own empty-present-set no-op. A walk that yields zero rows is a Toast failure, never a
      // restaurant that deleted its whole menu (the media-catalog "empty flap" lesson).
      let toRemove: string[] = [];
      if (deduped.length > 0) {
        const { data: cacheGuids, error: cacheErr } = await admin
          .from("toast_menu_cache")
          .select("guid, removed_at")
          .eq("venue_id", VENUE_ID)
          .limit(5000); // NOTE-2: never let PostgREST's default page cap silently shorten the
                        // cache side of the diff — a truncated read would look like deletions.
        if (cacheErr) throw new Error(`toast_menu_cache guid read: ${cacheErr.message ?? JSON.stringify(cacheErr)}`);
        const cacheRows = (cacheGuids ?? []) as PruneCacheRow[];
        const plan = planPrune(cacheRows, new Set(deduped.map((r) => r.guid as string)));
        restoredRows = plan.restored.length;

        // WARN-1: a prune bigger than the cap is HELD — an incomplete-but-valid Toast payload
        // must not be able to empty the menu unattended. force:true is the human override.
        const gate = gatePrune({ removedCount: plan.removed.length, cacheCount: cacheRows.length, force });
        if (gate.held) {
          pruneSkipped = true;
          // A removed guid is by definition NOT in `deduped` (that's the present set), so read
          // the names back from the cache — the alarm has to be readable by a human.
          const first5 = plan.removed.slice(0, 5);
          const names = await admin
            .from("toast_menu_cache")
            .select("guid, name")
            .eq("venue_id", VENUE_ID)
            .in("guid", first5);
          const byGuidName = new Map(((names.data ?? []) as { guid: string; name: string | null }[]).map((r) => [r.guid, r.name]));
          const sample = first5.map((g) => byGuidName.get(g) ?? g);
          console.error(
            `PRUNE HELD: ${plan.removed.length} items absent from Toast exceeds the cap of ${gate.cap} ` +
            `(cache ${cacheRows.length}). Skipping the prune AND the lastUpdated stamp so the next tick retries. ` +
            `Sample: ${sample.join(", ")}`,
          );
          await admin.from("venue_settings").upsert(
            {
              venue_id: VENUE_ID,
              key: PRUNE_ALARM_KEY,
              value: { count: plan.removed.length, cap: gate.cap, at: new Date().toISOString(), sample },
            },
            { onConflict: "venue_id,key" },
          );
        } else {
          toRemove = plan.removed;
        }
      }

      if (deduped.length > 0) {
        const { error } = await admin.from("toast_menu_cache").upsert(deduped, { onConflict: "guid" });
        if (error) throw new Error(`toast_menu_cache upsert: ${error.message ?? JSON.stringify(error)}`);
        itemsUpserted = deduped.length;
      }

      if (toRemove.length > 0) {
        // pos_visible=false is what actually removes the item everywhere (public_menu's
        // WHERE-gate, rankFilter/rankGates, lastRung, the drink_special auto-hide) — the
        // 0034 owner principle doing the work. removed_at only records WHY, for staff.
        // Positions are nulled so a stale rank can never drag a phantom section around.
        // Rows already flagged are deliberately left alone (plan.alreadyRemoved): their
        // original removal timestamp is the honest record.
        const stamp = new Date().toISOString();
        for (const part of chunk(toRemove, 100)) {
          const { error } = await admin
            .from("toast_menu_cache")
            .update({ pos_visible: false, removed_at: stamp, group_position: null, item_position: null, updated_at: stamp })
            .eq("venue_id", VENUE_ID)
            .in("guid", part);
          if (error) throw new Error(`toast_menu_cache prune: ${error.message ?? JSON.stringify(error)}`);
          removedRows += part.length;
        }
      }
      if (pruneSkipped) {
        // DELIBERATELY NOT recording lastUpdated. Stamping it would make the next tick
        // menuChanged=false and latch the bad state in until a Toast publish or a forced run;
        // leaving it makes every 2-minute tick re-walk until Toast answers completely.
        console.error("PRUNE HELD: lastUpdated NOT recorded — the next tick will re-walk.");
      } else {
        await admin.from("venue_settings").upsert(
          { venue_id: VENUE_ID, key: "toast_menu_last_synced", value: { lastUpdated, at: new Date().toISOString() } },
          { onConflict: "venue_id,key" },
        );
        // A clean pass clears any standing alarm (delete rather than null so the dashboard's
        // "row absent = healthy" read stays trivially true).
        await admin.from("venue_settings").delete().eq("venue_id", VENUE_ID).eq("key", PRUNE_ALARM_KEY);
      }
    } else if (stock.size > 0) {
      // Menu unchanged: just refresh out_of_stock on the cached rows.
      for (const [guid, oos] of stock) {
        await admin.from("toast_menu_cache").update({ out_of_stock: oos, updated_at: new Date().toISOString() }).eq("guid", guid).eq("venue_id", VENUE_ID);
      }
    }

    return json({ ok: true, version: SYNC_VERSION, menuChanged, itemsUpserted, priceOptionRows, positionedRows, removedRows, restoredRows, pruneSkipped, stockRows: stock.size, lastUpdated }, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("toast-menu-sync error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

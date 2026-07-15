// instagram-sync — @bunkerclubokc posts + stories → instagram_cache mirror.
//
// Sibling of toast-menu-sync (same CRON_SECRET gate, same scheduled/no-public invocation
// model, same "mirror the CDN image into our `signage` bucket so screens never depend on a
// third-party CDN" idiom). pg_cron invokes it every 15 min (0042). The public signage board
// reads instagram_cache with the anon key and renders one post per rotation pass with the
// caption + a QR to the permalink (the `instagram` template).
//
// Each run:
//   1. Read the long-lived access token from Vault via instagram_token_get() (service-role
//      RPC). The token is NEVER an edge-fn secret and NEVER logged (0042 DECISION: the
//      refresh cron must WRITE the rotated token back, which edge fns can't do to their own
//      secrets — so it lives in Vault and this fn get/sets it there).
//   2. Fetch me/media (limit 12) + me/stories. Upsert rows; mirror each item's image to the
//      bucket at instagram/{venue}/{media_id}.jpg (only if not already stored). VIDEO uses
//      thumbnail_url; CAROUSEL_ALBUM uses the parent media_url only (DECISION: children
//      skipped in v1). One bad image doesn't kill the run.
//   3. Delete expired story rows (+ their storage objects) and prune posts beyond the newest 24.
//   4. Token refresh: if the stored token is ≥30 days old (refreshed_at in venue_settings),
//      call refresh_access_token and instagram_token_set the new 60-day token. Tolerate the
//      "token too new to refresh" (<24h) error gracefully.
//   5. Write venue_settings.instagram_sync_status = {ok, at, posts, stories} (status ONLY,
//      NEVER the token) so staff can surface health later.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VENUE_ID = Deno.env.get("VENUE_ID") ?? "11111111-1111-1111-1111-111111111111";
const GRAPH = "https://graph.instagram.com/v21.0";
const BUCKET = "signage";
const POSTS_KEEP = 24; // prune post rows beyond the newest N
const REFRESH_AFTER_DAYS = 30; // refresh the 60-day token once it is comfortably old enough

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Admin = ReturnType<typeof createClient>;

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
}

// Scrub the access token out of any string before it can reach logs, the response body, or
// the anon-readable status row (WARN-1). The token rides in the request URL, so a Deno fetch
// NETWORK error ("error sending request for url (…access_token=<TOKEN>)") carries the full
// token in its message — this removes it defensively at every exit. Strips both the raw token
// value AND anything after "access_token=" (belt and braces for URLs we didn't build).
function scrub(s: string, token: string): string {
  let out = s;
  if (token) out = out.split(token).join("[token]");
  return out.replace(/access_token=[^&\s"')]+/gi, "access_token=[token]");
}

// Fetch a Graph edge; returns { status, body }. NEVER lets the token escape in an error:
// a fetch failure message contains the request URL (incl. access_token) — rethrow scrubbed.
async function graph(path: string, token: string, params: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const u = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  try {
    const r = await fetch(u);
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  } catch (e) {
    throw new Error(scrub(e instanceof Error ? e.message : String(e), token));
  }
}

// Mirror an Instagram CDN image into our bucket at instagram/{venue}/{media_id}.jpg.
// Idempotent: skips the download if the object already exists. Returns the storage path
// (stable, independent of the expiring CDN URL) or null on any failure.
async function mirrorImage(admin: Admin, mediaId: string, imageUrl: string): Promise<string | null> {
  const path = `instagram/${VENUE_ID}/${mediaId}.jpg`;
  try {
    // Already stored? (list the exact object) — avoids re-downloading unchanged posts.
    const { data: existing } = await admin.storage.from(BUCKET).list(`instagram/${VENUE_ID}`, {
      search: `${mediaId}.jpg`,
      limit: 1,
    });
    if (existing && existing.some((o) => o.name === `${mediaId}.jpg`)) return path;

    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

// Upsert one media row (post or story) into instagram_cache; mirror its image first.
async function upsertMedia(admin: Admin, m: IgMedia, isStory: boolean): Promise<boolean> {
  if (!m.id || !m.permalink) return false;
  const postedAt = m.timestamp ? new Date(m.timestamp) : new Date();
  // DECISION: VIDEO → thumbnail_url (a still we can display); CAROUSEL_ALBUM → the parent
  // media_url only (children are not fetched in v1). IMAGE → media_url.
  const imageUrl = (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) ?? m.thumbnail_url ?? null;
  const storagePath = imageUrl ? await mirrorImage(admin, m.id, imageUrl) : null;
  const expiresAt = isStory ? new Date(postedAt.getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
  const { error } = await admin.from("instagram_cache").upsert(
    {
      venue_id: VENUE_ID,
      media_id: m.id,
      media_type: m.media_type ?? null,
      is_story: isStory,
      caption: isStory ? null : (m.caption ?? null),
      permalink: m.permalink,
      username: m.username ?? null,
      posted_at: postedAt.toISOString(),
      storage_path: storagePath,
      expires_at: expiresAt,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "media_id" },
  );
  return !error;
}

// Delete a storage object best-effort (ignore failures — the DB row is the source of truth).
async function removeStorage(admin: Admin, path: string | null) {
  if (!path) return;
  try { await admin.storage.from(BUCKET).remove([path]); } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!CRON_SECRET || (req.headers.get("x-cron-secret") ?? "") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Write a status row (never the token) for later staff surfacing.
  const writeStatus = async (value: Record<string, unknown>) => {
    await admin.from("venue_settings").upsert(
      { venue_id: VENUE_ID, key: "instagram_sync_status", value: { ...value, at: new Date().toISOString() } },
      { onConflict: "venue_id,key" },
    );
  };

  // Held outside the try so the top-level catch can defensively scrub the token from any
  // message before it hits console.error / the status row / the response body (WARN-1).
  let tokenForScrub = "";
  try {
    // 1. Token from Vault (service-role RPC). Never logged.
    const { data: token, error: tokErr } = await admin.rpc("instagram_token_get");
    if (tokErr) throw new Error(`token_get failed: ${tokErr.message}`);
    if (typeof token === "string") tokenForScrub = token;
    if (!token || typeof token !== "string") {
      await writeStatus({ ok: false, error: "no_token_in_vault" });
      return json({ error: "no instagram token in vault (seed vault secret 'instagram_token')" }, 500);
    }

    // 2. Fetch posts + stories.
    const media = await graph("me/media", token, {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username",
      limit: "12",
    });
    // Any auth failure (OAuthException / 401) → record status, don't crash the schedule.
    if (media.status === 401 || media.body?.error?.type === "OAuthException") {
      await writeStatus({ ok: false, error: `auth: ${media.body?.error?.message ?? media.status}` });
      return json({ error: "instagram auth failed" }, 200);
    }
    if (media.status !== 200) {
      await writeStatus({ ok: false, error: `media ${media.status}: ${JSON.stringify(media.body?.error ?? media.body).slice(0, 200)}` });
      return json({ error: `me/media ${media.status}` }, 200);
    }
    const posts: IgMedia[] = media.body.data ?? [];

    const stories = await graph("me/stories", token, {
      fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp,username",
    });
    const storyItems: IgMedia[] = stories.status === 200 ? (stories.body.data ?? []) : [];

    // 3. Upsert (per-item failures don't abort the run).
    let postsUpserted = 0;
    for (const p of posts) if (await upsertMedia(admin, p, false)) postsUpserted++;
    let storiesUpserted = 0;
    for (const st of storyItems) if (await upsertMedia(admin, st, true)) storiesUpserted++;

    // 4. Prune: expired stories (+ storage), then posts beyond the newest POSTS_KEEP (+ storage).
    const nowIso = new Date().toISOString();
    const { data: deadStories } = await admin
      .from("instagram_cache")
      .select("id, storage_path")
      .eq("venue_id", VENUE_ID)
      .eq("is_story", true)
      .lt("expires_at", nowIso);
    for (const s of (deadStories ?? []) as Array<{ id: string; storage_path: string | null }>) {
      await removeStorage(admin, s.storage_path);
      await admin.from("instagram_cache").delete().eq("id", s.id);
    }
    // Also drop stories that vanished from the live feed (expired but expires_at already past
    // handled above; a story pulled early won't reappear in me/stories — the expires_at prune
    // catches it within 24h, acceptable for v1).

    const { data: keptPosts } = await admin
      .from("instagram_cache")
      .select("id, storage_path")
      .eq("venue_id", VENUE_ID)
      .eq("is_story", false)
      .order("posted_at", { ascending: false });
    const stale = (keptPosts ?? []).slice(POSTS_KEEP) as Array<{ id: string; storage_path: string | null }>;
    for (const p of stale) {
      await removeStorage(admin, p.storage_path);
      await admin.from("instagram_cache").delete().eq("id", p.id);
    }

    // 5. Token refresh (once the 60-day token is old enough). refreshed_at lives in
    //    venue_settings.instagram_token_refreshed_at (never the token itself).
    let refreshed = false;
    try {
      const { data: refRow } = await admin
        .from("venue_settings")
        .select("value")
        .eq("venue_id", VENUE_ID)
        .eq("key", "instagram_token_refreshed_at")
        .maybeSingle();
      const lastRefreshed = (refRow?.value as { at?: string } | null)?.at;
      const ageDays = lastRefreshed ? (Date.now() - new Date(lastRefreshed).getTime()) / 86_400_000 : Infinity;
      if (ageDays >= REFRESH_AFTER_DAYS) {
        const rr = await graph("refresh_access_token", token, { grant_type: "ig_refresh_token" });
        if (rr.status === 200 && rr.body?.access_token) {
          const { error: setErr } = await admin.rpc("instagram_token_set", { p_token: rr.body.access_token });
          if (!setErr) {
            await admin.from("venue_settings").upsert(
              { venue_id: VENUE_ID, key: "instagram_token_refreshed_at", value: { at: new Date().toISOString() } },
              { onConflict: "venue_id,key" },
            );
            refreshed = true;
          }
        }
        // A "token too new to refresh" (<24h) or transient error is tolerated — just don't
        // stamp refreshed_at, so we retry on the next eligible run. Never log the token.
      }
    } catch { /* refresh is best-effort; a sync run never fails on it */ }

    await writeStatus({ ok: true, posts: postsUpserted, stories: storiesUpserted, refreshed });
    return json({ ok: true, postsUpserted, storiesUpserted, activeStories: storyItems.length, refreshed }, 200);
  } catch (error) {
    // Defensively scrub the token from EVERY exit (belt and braces — graph() already scrubs
    // its own fetch failures, but a future code path shouldn't be able to reintroduce a leak).
    const msg = scrub(error instanceof Error ? error.message : String(error), tokenForScrub);
    console.error("instagram-sync error:", msg);
    await writeStatus({ ok: false, error: msg.slice(0, 200) });
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

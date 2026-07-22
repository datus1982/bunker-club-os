import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import type { StripCard } from "./useThisWeek";

/**
 * Resolvers for the What's-On feed's THREE dynamic signage templates — the ones the TVs
 * build LIVE at render time and that carry no text in their own `signage_items.fields`:
 *   • now_playing → THE HERO: the film currently on the bar's landscape MEDIA screen.
 *   • top_sellers → the live sales leaderboard (whole menu, or one group if fields.menu_group).
 *   • instagram   → the newest @venue post/story.
 * Before this module, useThisWeek's promo loop found no title on these items and silently
 * skipped them as "contentless" — so the 🌐 checkbox saved but nothing showed. Each resolver
 * mirrors the SAME anon-safe read path the public /signage/s/:slug board already uses, so it's
 * proven anon-readable, and degrades to `null` (skip the card) on any error/empty — NEVER throws
 * the page (matches the `const { data } = await ...` no-throw idiom used across this feed).
 *
 * DECISION (bundle isolation): this file imports ONLY the supabase client. The canonical pieces
 * it mirrors live in heavy hook modules (modules/signage/useSignage.ts, modules/signage/
 * mediaProgram.ts, modules/leaderboard/useDrinks.ts) that pull react-query + the signage display
 * graph. apps/web declares no `sideEffects:false`, so importing even a pure fn from one of those
 * would drag its whole module into the EAGER homepage chunk (the site is code-split; everything
 * else is lazy) and hurt the Home LCP the CLAUDE.md notes we protect. So the small pure bits are
 * replicated here with a citation to the single source of truth for each value/algorithm — kept
 * byte-faithful, never a "new number".
 */

const SIGNAGE_BUCKET = "signage";

/** A minimal item shape — only what a dynamic card needs off a flagged signage_items row. */
export interface DynamicItem {
  id: string;
  template: string;
  fields: Record<string, unknown>;
}

/** The three dynamic templates this module resolves (everything else stays on the promo path). */
export const DYNAMIC_TEMPLATES = new Set(["now_playing", "top_sellers", "instagram"]);

/* ── shared tiny helpers (mirrors of canonical logic, cited) ─────────────────── */

/** Public URL for a `signage` bucket object (mirrors mediaProgram.thumbUrl / useInstagramFeed). */
function bucketUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from(SIGNAGE_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

function fieldStr(fields: Record<string, unknown>, key: string): string | undefined {
  const v = fields[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/* ── 1) NOW PLAYING (the hero) ────────────────────────────────────────────────
 * Mirrors useSignage.useNowPlayingSources: read the source screen's now_playing_file_id +
 * now_playing_at (signage_slots) and the media_files row (title/poster). Freshness gate is the
 * SAME 15-min window the TV rotation auto-hide uses. Source slug = fields.source_slug, default
 * "landscape-bar" (the movie TV). Nothing fresh → null (correct — matches today's absent card).
 */

// Cited: useSignage.DEFAULT_NOW_PLAYING_SOURCE (0054/0055 — the bar's landscape MEDIA screen).
const DEFAULT_NOW_PLAYING_SOURCE = "landscape-bar";
// Cited: useSignage.NOW_PLAYING_FRESH_MS, which mirrors media-control's NOW_PLAYING_FRESH_MS (0054).
// Older ⇒ the film is treated as gone (movie ended / trivia took the screen) and the card is skipped.
const NOW_PLAYING_FRESH_MS = 15 * 60_000;

/** Is a source's now_playing stamp fresh right now? (mirrors useSignage.isNowPlayingFresh). */
function nowPlayingFresh(at: string | null | undefined): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && Date.now() - t <= NOW_PLAYING_FRESH_MS;
}

/** Split a Kodi-style "Title (YYYY)" into name + year (mirrors mediaProgram.parseTitleYear). */
function parseTitleYear(raw: string): { title: string; year: string | null } {
  const m = raw.match(/^(.*\S)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: m[2] };
  return { title: raw.trim(), year: null };
}

export async function resolveNowPlayingCard(item: DynamicItem): Promise<StripCard | null> {
  const sourceSlug = fieldStr(item.fields, "source_slug") ?? DEFAULT_NOW_PLAYING_SOURCE;

  const { data: slotRow } = await supabase
    .from("signage_slots")
    .select("now_playing_file_id, now_playing_at")
    .eq("slug", sourceSlug)
    .maybeSingle();

  const fileId = (slotRow as { now_playing_file_id: string | null } | null)?.now_playing_file_id ?? null;
  const at = (slotRow as { now_playing_at: string | null } | null)?.now_playing_at ?? null;
  // AUTO-HIDE (0054): only advertise while the bar screen is ACTUALLY playing a fresh film.
  if (!fileId || !nowPlayingFresh(at)) return null;

  const { data: fileRow } = await supabase
    .from("media_files")
    .select("title, filename, poster_path, thumb_path")
    .eq("id", fileId)
    .maybeSingle();
  const file = fileRow as { title: string | null; filename: string; poster_path: string | null; thumb_path: string | null } | null;
  if (!file) return null;

  // media_files.title is the sync-prettified name (hub-editable); fall back to the filename minus
  // extension (mirrors mediaProgram.nowShowingParts). Blank ⇒ no card.
  const raw = (file.title && file.title.trim()) || file.filename.replace(/\.[^.]+$/, "");
  if (!raw.trim()) return null;
  const { title, year } = parseTitleYear(raw);

  // poster_path preferred (real one-sheet), thumb_path fallback (frame grab) — never a broken image.
  const posterUrl = bucketUrl(file.poster_path);
  const image = posterUrl ?? bucketUrl(file.thumb_path) ?? undefined;

  return {
    key: `now-playing-${item.id}`,
    kind: "media",
    kicker: "On the bar screen now",
    title: `NOW SHOWING — ${title.toUpperCase()}${year ? ` · ${year}` : ""}`,
    image,
    // TMDB API terms: credit ONLY when a real sourced poster is the image on screen (poster_path
    // resolved AND chosen) — NOT on a thumb-grab or text fallback. Mirrors the TV template's
    // hasPoster gate (SignageTemplates.tsx). Full disclaimer lives in the qsys-media-control runbook.
    credit: image && image === posterUrl ? "POSTERS: TMDB" : undefined,
    // Render at true poster aspect (2:3) ONLY when the image IS the real one-sheet — a thumb
    // frame-grab fallback is ~16:9 and stays square-cropped like the other cards.
    poster: !!(image && image === posterUrl),
    live: true,
  };
}

/* ── 2) TOP SELLERS ───────────────────────────────────────────────────────────
 * Mirrors useDrinks.useSalesCache (POS-visibility gate) + overallTopSellers (MAIN_MENU_ALL, else
 * a merge across groups). Optional group filter: fields.menu_group resolves to a per-group
 * sales_cache bucket via drinks_menu_groups (same as the CHAMPION slide). Public-safe: item_name
 * is the drink name (no PII), and any Toast item flagged pos_visible=false is dropped (0034 owner
 * principle — never advertise what isn't active on the POS view).
 */

// Cited: useDrinks.OVERALL_GROUP — the synthetic whole-menu bucket toast-sync writes.
const OVERALL_GROUP = "MAIN_MENU_ALL";

interface SalesRow {
  menu_group_guid: string;
  rank: number;
  item_guid: string | null;
  item_name: string;
  sales_count: number;
}

/** Overall top-N from grouped sales (mirrors useDrinks.overallTopSellers). */
function overallTop(byGroup: Record<string, SalesRow[]>, limit: number): SalesRow[] {
  const main = byGroup[OVERALL_GROUP];
  if (main && main.length) return [...main].sort((a, b) => a.rank - b.rank).slice(0, limit);
  const merged = new Map<string, SalesRow>();
  for (const [g, rows] of Object.entries(byGroup)) {
    if (g === OVERALL_GROUP) continue;
    for (const it of rows) {
      const k = (it.item_guid ?? it.item_name).toString().trim().toLowerCase();
      const prev = merged.get(k);
      if (!prev || it.sales_count > prev.sales_count) merged.set(k, it);
    }
  }
  return [...merged.values()].sort((a, b) => b.sales_count - a.sales_count).slice(0, limit);
}

export async function resolveTopSellersCard(item: DynamicItem): Promise<StripCard | null> {
  // Sales rows + the POS-hidden set, in parallel (mirrors useSalesCache's two-query gate).
  const groupName = fieldStr(item.fields, "menu_group");
  const [salesRes, hiddenRes, groupsRes] = await Promise.all([
    supabase
      .from("sales_cache")
      .select("menu_group_guid, rank, item_guid, item_name, sales_count")
      .eq("venue_id", VENUE_ID)
      .order("rank"),
    supabase.from("toast_menu_cache").select("guid, name").eq("venue_id", VENUE_ID).eq("pos_visible", false),
    // Only needed for a group-filtered card; cheap + anon-readable (the /drinks board reads it).
    groupName
      ? supabase.from("drinks_menu_groups").select("toast_menu_guid, name").eq("venue_id", VENUE_ID).eq("enabled", true)
      : Promise.resolve({ data: [] as { toast_menu_guid: string; name: string }[] }),
  ]);

  const hidden = (hiddenRes.data ?? []) as { guid: string; name: string | null }[];
  const hiddenGuids = new Set(hidden.map((h) => h.guid));
  const hiddenNames = new Set(hidden.map((h) => String(h.name ?? "").trim().toLowerCase()));
  const rows = ((salesRes.data ?? []) as SalesRow[]).filter((r) =>
    r.item_guid ? !hiddenGuids.has(r.item_guid) : !hiddenNames.has(String(r.item_name).trim().toLowerCase()),
  );
  if (rows.length === 0) return null; // pre-first-pour / no data → skip (never a blank card)

  const byGroup: Record<string, SalesRow[]> = {};
  for (const r of rows) (byGroup[r.menu_group_guid] ??= []).push(r);

  // DECISION: optional group filter — if the item carries fields.menu_group, source that group's
  // sales_cache bucket (mirrors useDrinks.groupGuidByName + groupTopSellers, case-insensitive);
  // whole-menu otherwise. Unconfigured/empty group falls back to overall so the card never blanks.
  let title = "TOP SELLERS TONIGHT";
  let top: SalesRow[] = [];
  if (groupName) {
    const groups = (groupsRes.data ?? []) as { toast_menu_guid: string; name: string }[];
    const needle = groupName.trim().toLowerCase();
    const guid = groups.find((g) => g.name.trim().toLowerCase() === needle && g.toast_menu_guid !== OVERALL_GROUP)?.toast_menu_guid;
    const groupRows = guid ? byGroup[guid] : undefined;
    if (groupRows && groupRows.length) {
      title = groupName.toUpperCase();
      top = [...groupRows].sort((a, b) => a.rank - b.rank).slice(0, 3);
    }
  }
  if (top.length === 0) top = overallTop(byGroup, 3);
  if (top.length === 0) return null;

  // A short "1. NAME 50 · 2. NAME 42 · 3. NAME 30" body — a few ranked names + counts.
  const body = top.map((r, i) => `${i + 1}. ${r.item_name} ${r.sales_count}`).join("  ·  ");

  return {
    key: `top-sellers-${item.id}`,
    kind: "promo",
    kicker: "Pouring most",
    title,
    body,
    live: true, // live from the POS (green dot), same voice as the TV "◉ LIVE FROM THE POS".
  };
}

/* ── 3) INSTAGRAM ─────────────────────────────────────────────────────────────
 * Mirrors useInstagram.useInstagramFeed: read instagram_cache (stories first, then newest posts),
 * drop expired stories, mirror-bucket image URL. For the FEED CARD we take the single NEWEST item
 * (task: "Newest post only"). No QR on web (that's a TV affordance). Honors fields.include_stories
 * (whether stories are eligible) and, implicitly, "newest" = the latest thing on the account.
 */

/** Trim a caption to a headline (mirrors SignageTemplates.cleanCaption: collapse ws, drop trailing
 *  #/@ tokens, cap length with an ellipsis). */
function cleanCaption(raw: string, cap: number): string {
  let s = raw.replace(/\s+/g, " ").trim();
  const tokens = s.split(" ");
  while (tokens.length && /^[#@][\w.À-￿]+$/.test(tokens[tokens.length - 1])) tokens.pop();
  s = tokens.join(" ").trim();
  if (s.length > cap) s = s.slice(0, cap - 1).replace(/\s+\S*$/, "").trimEnd() + "…";
  return s;
}

/** "2 hours ago" (mirrors SignageTemplates.relativeTime). */
function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? "" : "s"} ago`;
}

export async function resolveInstagramCard(item: DynamicItem): Promise<StripCard | null> {
  // fields.include_stories (IG template setting) — default true, matching ItemEditor's default.
  const includeStories = item.fields.include_stories !== false;

  let query = supabase
    .from("instagram_cache")
    .select("media_id, is_story, caption, username, posted_at, storage_path, expires_at")
    .eq("venue_id", VENUE_ID)
    .order("is_story", { ascending: false })
    .order("posted_at", { ascending: false })
    .limit(6);
  if (!includeStories) query = query.eq("is_story", false);

  const { data } = await query;
  const rows = ((data ?? []) as Array<{
    media_id: string; is_story: boolean; caption: string | null; username: string | null;
    posted_at: string; storage_path: string | null; expires_at: string | null;
  }>)
    // Drop stories whose expiry passed before the next sync prunes them, and any story with no
    // mirrored image (nothing to show) — mirrors useInstagramFeed's defensive filters.
    .filter((r) => !(r.is_story && r.expires_at && new Date(r.expires_at).getTime() <= Date.now()))
    .filter((r) => !(r.is_story && !r.storage_path));
  if (rows.length === 0) return null;

  // Newest thing on the account (story or post), by posted_at — the feed card is a single "here's
  // the latest" frame (task: "Newest post only for the feed card").
  const newest = [...rows].sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime())[0];
  const handle = newest.username ? `@${newest.username}` : "Instagram";
  const caption = cleanCaption(newest.caption ?? "", 120);
  const rel = relativeTime(newest.posted_at);

  return {
    key: `instagram-${item.id}`,
    kind: "promo",
    kicker: "Latest on Instagram",
    badge: newest.is_story ? "STORY" : undefined,
    // Caption leads when present; otherwise the handle carries the card (stories often have none).
    title: caption || handle,
    body: caption ? `${handle} · ${rel}` : rel,
    image: bucketUrl(newest.storage_path) ?? undefined,
  };
}

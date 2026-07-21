import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { todayKey } from "./useSiteCopy";
import { fetchPromoMenu, fieldStr, priceLine } from "./promoResolve";
import {
  DYNAMIC_TEMPLATES,
  resolveNowPlayingCard,
  resolveTopSellersCard,
  resolveInstagramCard,
  type DynamicItem,
} from "./dynamicCards";

/**
 * The home page's "What's On" feed (docs/14): auto-assembled from data the OS
 * already maintains, fully empty-state tolerant, and rendered as a rotating
 * terminal feed (TerminalFeed.tsx). Sources, in rotation order:
 *   0) ON THE SCREENS NOW — active WINDOW/MESSAGE scheduled_events, straight off
 *      the TVs via the anon horizon view `signage_events_live` (0035). These are
 *      public by definition (they're on the room's screens right now).
 *   1) TRIVIA — a fixed card on the venue's trivia night (Wednesday).
 *   2) PROMOS — website-flagged `signage_items` (show_on_website + active),
 *      Toast-sourced ones resolved LIVE through the POS-gated public_menu.
 *   3) EVENTS — upcoming `public_events` (anon-safe view; tease copy only),
 *      de-duped against anything already showing ON THE SCREENS NOW.
 * All reads are anon-safe. Failures degrade to an empty list, never throw the page.
 */

export type StripCard = {
  key: string;
  // "media" = the NOW PLAYING hero (a dynamic signage card). TerminalFeed styles off live/image/
  // badge, not kind, so kind stays a semantic tag (no exhaustive switch keys off it).
  kind: "trivia" | "karaoke" | "event" | "promo" | "screen" | "media";
  kicker: string;
  title: string;
  body?: string;
  /** Optional thumbnail (custom upload or Toast photo). Below-the-fold, lazy-loaded. */
  image?: string;
  /** Small kind tag rendered beside the kicker (live screen events: WINDOW / MESSAGE). */
  badge?: string;
  /** Attribution credit shown as a dim caption on this card only (e.g. "POSTERS: TMDB" on the
   *  NOW PLAYING hero when a real sourced poster is on screen — a TMDB API terms obligation). */
  credit?: string;
  live?: boolean;
};

const TRIVIA_DAY = "wed"; // Bunker Club runs trivia Wednesday nights (docs/00).
const KARAOKE_DAY = "sat"; // Karaoke runs MOST Saturdays — not guaranteed (owner, 2026-07-13).

/** A row of the anon horizon view `signage_events_live` (0035) — display columns only. */
type LiveEventRow = {
  id: string;
  name: string;
  kind: "window" | "message" | "moment";
  fields: Record<string, unknown>;
  toast_guid: string | null;
  fire_at: string | null;
  window_minutes: number;
};

export function useThisWeek() {
  return useQuery({
    queryKey: ["site-thisweek", VENUE_ID],
    staleTime: 60_000,
    queryFn: async (): Promise<StripCard[]> => {
      const cards: StripCard[] = [];
      const today = todayKey();
      const nowMs = Date.now();

      // ── 0) ON THE SCREENS NOW ─────────────────────────────────────────────
      // What's actually on the room's TVs this minute. `signage_events_live` is the
      // anon, horizon-gated view: a WINDOW/MESSAGE row appears ONLY while now ∈
      // [fire_at, fire_at + window). MOMENTs are in-room theatre (tease/alert/payoff)
      // and DON'T belong on the website, so we take window/message only.
      //
      // DECISION (review WARN-1, orchestrator-adjudicated 2026-07-14, owner may flip):
      // WINDOW promos (happy hour) auto-publish while live — that's the owner's ask
      // ("show what's running on the screens"). MESSAGE events (often personal —
      // "HAPPY BIRTHDAY <name>") reach the public homepage ONLY when the owner ticked
      // 🌐 SHOW ON WEBSITE: the in-room TVs reach the bar, the homepage reaches the
      // internet, and a name on the internet is an opt-in. The flag check rides
      // public_events (flagged rows only; no horizon filter), so no new surface.
      const { data: liveRows } = await supabase
        .from("signage_events_live")
        .select("id, name, kind, fields, toast_guid, fire_at, window_minutes")
        .eq("venue_id", VENUE_ID);

      const liveAll = ((liveRows ?? []) as LiveEventRow[]).filter(
        (e) => e.kind === "window" || e.kind === "message",
      );
      const liveMsgIds = liveAll.filter((e) => e.kind === "message").map((e) => e.id);
      let flaggedMsgIds = new Set<string>();
      if (liveMsgIds.length > 0) {
        const { data: flagged } = await supabase
          .from("public_events")
          .select("id")
          .in("id", liveMsgIds);
        flaggedMsgIds = new Set(((flagged ?? []) as { id: string }[]).map((f) => f.id));
      }
      const liveEvents = liveAll.filter((e) => e.kind === "window" || flaggedMsgIds.has(e.id));
      const liveIds = new Set(liveEvents.map((e) => e.id));

      // ── TRIVIA / KARAOKE (day-of-week fixed cards) ───────────────────────
      if (today === TRIVIA_DAY) {
        cards.push({
          key: "trivia-tonight",
          kind: "trivia",
          kicker: "Tonight",
          title: "ATOMIC PUB TRIVIA",
          body: "Round up a team and take your shot at the season leaderboard. Doors are open — grab a table.",
          live: true,
        });
      }
      // Karaoke runs MOST Saturdays, not every one — so the card stays honest: it
      // flags the night but tells people to check socials rather than promising it.
      if (today === KARAOKE_DAY) {
        cards.push({
          key: "karaoke-tonight",
          kind: "karaoke",
          kicker: "Tonight",
          title: "KARAOKE",
          body: "Karaoke runs most Saturdays — not every week, so check our socials to be sure. If the mic's on, it's your night.",
          live: true,
        });
      }

      // ── 2) PROMOS (website-flagged signage_items) ────────────────────────
      // Apply the same time-window filter as useEvents (W2): drop items whose ends_at
      // has passed, and items whose starts_at is still in the future; evergreen
      // (null/null) always shows. Fetch generously since the filter runs client-side.
      // Order by created_at (stable, oldest-first): signage_items.sort_order is no longer
      // written when an asset is created (placement/order moved to slot_queue in the hub
      // consolidation, 0045), so it's unreliable for ordering the website feed.
      // Limit raised 8→24 (2026-07-15): the owner programs more than a handful of 🌐 promos
      // and every one should rotate through the feed.
      const { data: promos } = await supabase
        .from("signage_items")
        .select("id, template, fields, starts_at, ends_at, created_at")
        .eq("venue_id", VENUE_ID)
        .eq("show_on_website", true)
        .eq("active", true)
        .order("created_at", { ascending: true, nullsFirst: true })
        .limit(24);

      const inWindow = (promos ?? []).filter((p) => {
        if (p.ends_at && new Date(p.ends_at).getTime() < nowMs) return false; // ended
        if (p.starts_at && new Date(p.starts_at).getTime() > nowMs) return false; // not yet live
        return true;
      }) as Array<{
        id: string;
        template: string;
        fields: Record<string, unknown>;
        starts_at: string | null;
        ends_at: string | null;
      }>;

      // Toast-sourced promos (drink_specials) AND toast-linked live events both carry
      // their name/price/photo LIVE in Toast — resolve every guid through public_menu
      // (POS-visibility-gated) in ONE query so cards get real title/body/image and the
      // off-POS / 86'd auto-hide applies.
      const menu = await fetchPromoMenu([
        ...inWindow.map((p) => fieldStr(p.fields, ["source_toast_guid"])),
        ...liveEvents.map((e) => e.toast_guid),
      ]);

      // Build the ON THE SCREENS NOW cards (prepended — they're the most timely).
      const screenCards: StripCard[] = [];
      for (const e of liveEvents) {
        const src = e.toast_guid ? menu.get(e.toast_guid) : undefined;
        const title = fieldStr(e.fields, ["title", "name"]) ?? e.name ?? src?.name ?? undefined;
        if (!title) continue; // never render a contentless card
        const body =
          fieldStr(e.fields, ["body", "directive", "message", "blurb", "cta"]) ??
          src?.public_blurb ??
          (src ? priceLine(src.price, src.group) : undefined);
        const image = fieldStr(e.fields, ["image_url"]) ?? src?.image ?? undefined;
        screenCards.push({
          key: `screen-${e.id}`,
          kind: "screen",
          kicker: "On the screens now",
          badge: e.kind === "message" ? "MESSAGE" : "WINDOW",
          title: title.toUpperCase(),
          body,
          image,
          live: true,
        });
      }

      // Cap raised 3→12 (2026-07-15) so every programmed 🌐 promo rotates, not just the
      // first few. The contentless-skip and off-POS gates below are unchanged — a promo
      // still only counts toward the cap once it resolves to a real, POS-visible card.
      let shown = 0;
      for (const p of inWindow) {
        if (shown >= 12) break;
        // Dynamic templates (now_playing / top_sellers / instagram) carry no title in their own
        // fields — they're resolved live below, not on the manual-promo path. Skip them here so
        // they never count toward the promo cap or fall through as contentless. (They'd skip for
        // lack of a title anyway; this is explicit.)
        if (DYNAMIC_TEMPLATES.has(p.template)) continue;
        const guid = fieldStr(p.fields, ["source_toast_guid"]);
        // Toast-sourced but off-POS / 86'd (absent from public_menu) → skip entirely.
        const src = guid ? menu.get(guid) : undefined;
        if (guid && !src) continue;

        const manualTitle = fieldStr(p.fields, ["headline", "title", "name", "drink_name"]);
        const title = manualTitle ?? src?.name ?? undefined;
        // Never render a contentless card: no real title → skip (kills the "Now On" fallback).
        if (!title) continue;

        const body =
          fieldStr(p.fields, ["blurb", "subtitle", "detail", "ingredients", "tagline"]) ??
          src?.public_blurb ??
          (src ? priceLine(src.price, src.group) : undefined);
        const image = fieldStr(p.fields, ["image_url"]) ?? src?.image ?? undefined;

        shown++;
        cards.push({
          key: `promo-${p.id}`,
          kind: "promo",
          kicker: p.template === "drink_special" ? "Featured" : "On Now",
          title: title.toUpperCase(),
          body,
          image,
        });
      }

      // ── 2b) DYNAMIC SIGNAGE CARDS (now_playing / top_sellers / instagram) ──
      // These templates carry no authored copy — the TVs build them live at render time — so the
      // feed resolves each the SAME anon-safe way the /signage board does (dynamicCards.ts). Each
      // 🌐-flagged item flows through to the website only when its live source has content:
      //   • now_playing → THE HERO: the film currently on the bar's landscape screen (skips when
      //     nothing fresh is playing — correct, matches the card's absence today).
      //   • top_sellers / instagram → grouped with the promos (current "what's on" content).
      // DECISION: render at most ONE card per dynamic template (they're singleton concepts — a
      // second now_playing/top_sellers/instagram item would be redundant), so multiple flagged
      // items of the same template never crowd the feed. Cap: the three dynamic cards are bounded
      // by construction (≤1 each), so they don't need to draw down the 12-promo cap.
      const firstOf = (tpl: string): DynamicItem | undefined => {
        const p = inWindow.find((x) => x.template === tpl);
        return p ? { id: p.id, template: p.template, fields: p.fields } : undefined;
      };
      const npItem = firstOf("now_playing");
      const tsItem = firstOf("top_sellers");
      const igItem = firstOf("instagram");
      const [nowPlayingCard, topSellersCard, instagramCard] = await Promise.all([
        npItem ? resolveNowPlayingCard(npItem) : Promise.resolve(null),
        tsItem ? resolveTopSellersCard(tsItem) : Promise.resolve(null),
        igItem ? resolveInstagramCard(igItem) : Promise.resolve(null),
      ]);
      // top_sellers + instagram sit with the promos (before upcoming events); now_playing leads
      // the whole feed as the hero (prepended at the return, ahead of even ON THE SCREENS NOW).
      if (topSellersCard) cards.push(topSellersCard);
      if (instagramCard) cards.push(instagramCard);

      // ── 3) UPCOMING EVENTS (public_events, future only, de-duped) ─────────
      const nowIso = new Date().toISOString();
      const { data: events } = await supabase
        .from("public_events")
        .select("id, name, title, blurb, fire_at")
        .eq("venue_id", VENUE_ID)
        .gte("fire_at", nowIso)
        .order("fire_at", { ascending: true })
        .limit(3);

      for (const e of events ?? []) {
        if (liveIds.has(e.id)) continue; // already showing ON THE SCREENS NOW — don't double up
        cards.push({
          key: `event-${e.id}`,
          kind: "event",
          kicker: "This Week",
          title: (e.title || e.name || "Event").toString().toUpperCase(),
          body: e.blurb ?? undefined,
        });
      }

      // NOW PLAYING is the hero (leads), then ON THE SCREENS NOW, then the rest.
      return [...(nowPlayingCard ? [nowPlayingCard] : []), ...screenCards, ...cards];
    },
  });
}

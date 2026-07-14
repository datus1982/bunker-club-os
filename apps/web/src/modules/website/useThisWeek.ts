import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { todayKey } from "./useSiteCopy";
import { fetchPromoMenu, fieldStr, priceLine } from "./promoResolve";

/**
 * The home page's "tonight / this week" strip (docs/14): auto-assembled from data
 * the OS already maintains, and fully empty-state tolerant.
 *   1) TRIVIA — a fixed card on the venue's trivia night (Wednesday).
 *   2) EVENTS — upcoming `public_events` (anon-safe view; tease copy only).
 *   3) PROMOS — website-flagged `signage_items` (show_on_website + active).
 * All reads are anon-safe. Failures degrade to an empty list, never throw the page.
 */

export type StripCard = {
  key: string;
  kind: "trivia" | "karaoke" | "event" | "promo";
  kicker: string;
  title: string;
  body?: string;
  /** Optional thumbnail (custom upload or Toast photo). Below-the-fold, lazy-loaded. */
  image?: string;
  live?: boolean;
};

const TRIVIA_DAY = "wed"; // Bunker Club runs trivia Wednesday nights (docs/00).
const KARAOKE_DAY = "sat"; // Karaoke runs MOST Saturdays — not guaranteed (owner, 2026-07-13).

export function useThisWeek() {
  return useQuery({
    queryKey: ["site-thisweek", VENUE_ID],
    staleTime: 60_000,
    queryFn: async (): Promise<StripCard[]> => {
      const cards: StripCard[] = [];
      const today = todayKey();

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

      // Upcoming published events (view is anon-safe; hide past ones).
      const nowIso = new Date().toISOString();
      const { data: events } = await supabase
        .from("public_events")
        .select("id, name, title, blurb, fire_at")
        .eq("venue_id", VENUE_ID)
        .gte("fire_at", nowIso)
        .order("fire_at", { ascending: true })
        .limit(3);

      for (const e of events ?? []) {
        cards.push({
          key: `event-${e.id}`,
          kind: "event",
          kicker: "This Week",
          title: (e.title || e.name || "Event").toString().toUpperCase(),
          body: e.blurb ?? undefined,
        });
      }

      // Website-flagged screen promos. Apply the same time-window filter as
      // useEvents (W2): drop items whose ends_at has passed, and items whose
      // starts_at is still in the future; evergreen (null starts_at/ends_at) always
      // shows. Fetch a few extra since the window filter runs client-side.
      const nowMs = Date.now();
      const { data: promos } = await supabase
        .from("signage_items")
        .select("id, template, fields, starts_at, ends_at, sort_order")
        .eq("venue_id", VENUE_ID)
        .eq("show_on_website", true)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .limit(8);

      // Toast-sourced promos (drink_specials) carry their name/price/photo LIVE in
      // Toast — resolve those guids through public_menu (POS-visibility-gated) in one
      // query so the card gets a real title/body/image instead of a bare "Now On".
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
      const menu = await fetchPromoMenu(inWindow.map((p) => fieldStr(p.fields, ["source_toast_guid"])));

      let shown = 0;
      for (const p of inWindow) {
        if (shown >= 3) break;
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

      return cards;
    },
  });
}

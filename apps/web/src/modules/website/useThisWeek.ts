import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { todayKey } from "./useSiteCopy";

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
  kind: "trivia" | "event" | "promo";
  kicker: string;
  title: string;
  body?: string;
  live?: boolean;
};

const TRIVIA_DAY = "wed"; // Bunker Club runs trivia Wednesday nights (docs/00).

function pickText(fields: unknown, keys: string[]): string | undefined {
  if (!fields || typeof fields !== "object") return undefined;
  const f = fields as Record<string, unknown>;
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function useThisWeek() {
  return useQuery({
    queryKey: ["site-thisweek", VENUE_ID],
    staleTime: 60_000,
    queryFn: async (): Promise<StripCard[]> => {
      const cards: StripCard[] = [];
      const isTriviaDay = todayKey() === TRIVIA_DAY;

      if (isTriviaDay) {
        cards.push({
          key: "trivia-tonight",
          kind: "trivia",
          kicker: "Tonight",
          title: "ATOMIC PUB TRIVIA",
          body: "Round up a team and take your shot at the season leaderboard. Doors are open — grab a table.",
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

      // Website-flagged screen promos.
      const { data: promos } = await supabase
        .from("signage_items")
        .select("id, template, fields, sort_order")
        .eq("venue_id", VENUE_ID)
        .eq("show_on_website", true)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .limit(3);

      for (const p of promos ?? []) {
        const title =
          pickText(p.fields, ["headline", "title", "name", "drink_name"]) ?? "Now On";
        cards.push({
          key: `promo-${p.id}`,
          kind: "promo",
          kicker: p.template === "drink_special" ? "Featured" : "On Now",
          title: title.toUpperCase(),
          body: pickText(p.fields, ["blurb", "subtitle", "detail", "price"]),
        });
      }

      return cards;
    },
  });
}

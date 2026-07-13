import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Public events data (docs/14). Two anon-safe sources, unioned into one card list:
 *   1) `public_events` view (0015) — scheduled_events flagged show_on_website, tease
 *      copy only (no stage internals). Future fire_at only.
 *   2) `signage_items` flagged show_on_website + active — the templater's event /
 *      celebration / announcement promos (anon-readable display data via 0011
 *      public_read). Expired items (ends_at in the past) are dropped; evergreen
 *      (null ends_at) always show.
 *
 * The weekly trivia standing block is a static card the page renders itself. All reads
 * degrade to an empty list rather than throwing the page.
 */

export interface EventCard {
  key: string;
  kicker: string;
  title: string;
  /** Human date/time line, e.g. "Wed, Aug 6 · 8:00 PM". Absent for undated notices. */
  when: string | null;
  body: string | null;
  /** ms epoch used only for ordering; undated cards sort to the end. */
  sortAt: number;
}

function str(fields: unknown, key: string): string | undefined {
  if (!fields || typeof fields !== "object") return undefined;
  const v = (fields as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** "2026-08-06" → "Wed, Aug 6" (local, no TZ shift — parsed as a plain calendar date). */
function fmtDate(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** ISO timestamp → "Wed, Aug 6 · 8:00 PM". */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function useEvents() {
  return useQuery({
    queryKey: ["site-events", VENUE_ID],
    staleTime: 60_000,
    queryFn: async (): Promise<EventCard[]> => {
      const nowIso = new Date().toISOString();
      const cards: EventCard[] = [];

      // 1) Scheduled events (view is anon-safe; future only).
      const { data: events } = await supabase
        .from("public_events")
        .select("id, name, title, blurb, fire_at")
        .eq("venue_id", VENUE_ID)
        .gte("fire_at", nowIso)
        .order("fire_at", { ascending: true })
        .limit(12);

      for (const e of (events ?? []) as Array<{
        id: string; name: string | null; title: string | null; blurb: string | null; fire_at: string;
      }>) {
        cards.push({
          key: `evt-${e.id}`,
          kicker: "Event",
          title: (e.title || e.name || "Event").toString(),
          when: fmtDateTime(e.fire_at),
          body: e.blurb ?? null,
          sortAt: new Date(e.fire_at).getTime(),
        });
      }

      // 2) Website-flagged signage promos (event / celebration / announcement).
      const { data: promos } = await supabase
        .from("signage_items")
        .select("id, template, fields, ends_at, sort_order")
        .eq("venue_id", VENUE_ID)
        .eq("show_on_website", true)
        .eq("active", true)
        .in("template", ["event", "celebration", "announcement"])
        .order("sort_order", { ascending: true })
        .limit(24);

      const nowMs = Date.now();
      for (const p of (promos ?? []) as Array<{
        id: string; template: string; fields: Record<string, unknown>; ends_at: string | null;
      }>) {
        // Drop items that have already ended; evergreen (null ends_at) stays.
        if (p.ends_at && new Date(p.ends_at).getTime() < nowMs) continue;

        let title = "On Now";
        let when: string | null = null;
        let body: string | null = null;
        let kicker = "On Now";
        let sortAt = Number.MAX_SAFE_INTEGER; // undated → end of list.

        const dateStr = str(p.fields, "date");
        const timeStr = str(p.fields, "time");
        if (dateStr) {
          const dl = fmtDate(dateStr);
          when = dl ? (timeStr ? `${dl} · ${timeStr}` : dl) : (timeStr ?? null);
          const parsed = new Date(`${dateStr}T00:00`).getTime();
          if (!Number.isNaN(parsed)) sortAt = parsed;
        }

        if (p.template === "event") {
          kicker = "Event";
          title = str(p.fields, "title") ?? "Event";
          body = str(p.fields, "blurb") ?? null;
        } else if (p.template === "celebration") {
          kicker = "Celebration";
          const honoree = str(p.fields, "honoree");
          const occasion = str(p.fields, "occasion");
          title = honoree ? `${honoree}${occasion ? ` — ${occasion}` : ""}` : "A Celebration";
          body = str(p.fields, "message") ?? null;
        } else {
          kicker = "Notice";
          title = str(p.fields, "text") ?? "Announcement";
          body = null;
        }

        cards.push({ key: `sig-${p.id}`, kicker, title, when, body, sortAt });
      }

      // Dated cards ascending; undated (sortAt = MAX) fall to the end, insertion-stable.
      cards.sort((a, b) => a.sortAt - b.sortAt);
      return cards;
    },
  });
}

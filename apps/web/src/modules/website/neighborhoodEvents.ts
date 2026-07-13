/**
 * "Around the Neighborhood" — PURE logic + data (no imports), so it's unit-
 * testable via tsx without pulling in the supabase client. The React Query hook
 * lives in useNeighborhoodEvents.ts and re-exports everything here.
 *
 * Curated EXTERNAL Route 66 / Uptown highlights for /events (docs/14). Past-dated
 * entries auto-hide so the section never shows a stale date.
 */

export interface NeighborhoodEvent {
  title: string;
  /** Plain calendar date, "YYYY-MM-DD". */
  date: string;
  url: string;
  blurb: string;
}

// THREE-WAY INVARIANT: byte-identical to the 0032 seed + the live DB row. Also
// React Query placeholderData — drift reflows /events and spikes CLS. See 0032.
export const FALLBACK: NeighborhoodEvent[] = [
  {
    title: "Oklahoma Route 66 Muralfest",
    date: "2026-07-18",
    url: "https://oklahomaroute66.com/centennial",
    blurb:
      "Statewide mural celebration for the Mother Road's 100th year — new roadside art commissioned up and down the route.",
  },
  {
    title: "Route 66 Hall of Fame Induction",
    date: "2026-07-25",
    url: "https://oklahomaroute66.com/centennial",
    blurb:
      "The annual induction ceremony in Clinton, honoring the people and places that made Oklahoma's stretch of 66.",
  },
  {
    title: "Route 66 Centennial Day",
    date: "2026-11-11",
    url: "https://oklahomaroute66.com/centennial",
    blurb:
      "One hundred years to the day since Route 66 was commissioned on November 11, 1926. Statewide celebrations mark the milestone.",
  },
];

/** "2026-07-18" → local Date at midnight (no TZ shift). Returns null on bad input. */
export function parseDay(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-07-18" → "Sat, Jul 18, 2026" (local, no TZ shift). */
export function fmtNeighborhoodDate(dateStr: string): string | null {
  const d = parseDay(dateStr);
  if (!d) return null;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Pure filter+sort: keep only entries dated today-or-later, soonest first.
 * `now` is injectable for testing. A malformed/missing date is dropped (we never
 * show an undated neighborhood highlight). Comparison is by calendar day, so an
 * event dated today stays visible through the whole of today.
 */
export function upcomingNeighborhoodEvents(
  items: NeighborhoodEvent[],
  now: Date = new Date(),
): NeighborhoodEvent[] {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return items
    .map((e) => ({ e, d: parseDay(e.date) }))
    .filter((x): x is { e: NeighborhoodEvent; d: Date } => x.d != null && x.d.getTime() >= todayStart)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map((x) => x.e);
}

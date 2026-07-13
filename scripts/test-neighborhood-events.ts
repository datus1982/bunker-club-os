/**
 * Unit test for the /events "Around the Neighborhood" past-date auto-hide + sort
 * (docs/14, site-refinement-1). `npx tsx scripts/test-neighborhood-events.ts`.
 *
 * Imports the PURE module (no supabase client) so it runs standalone. Guards the
 * rule that a neighborhood highlight vanishes the day AFTER its date, that
 * today's entry stays visible, that output is soonest-first, and that malformed
 * dates are dropped.
 */
import {
  upcomingNeighborhoodEvents,
  fmtNeighborhoodDate,
  FALLBACK,
  type NeighborhoodEvent,
} from "../apps/web/src/modules/website/neighborhoodEvents.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}`);
}

const ev = (title: string, date: string): NeighborhoodEvent => ({
  title,
  date,
  url: "https://example.com",
  blurb: "",
});

const items = [
  ev("past", "2026-01-01"),
  ev("today", "2026-07-13"),
  ev("soon", "2026-07-18"),
  ev("later", "2026-11-11"),
  ev("bad-date", "not-a-date"),
];
const now = new Date(2026, 6, 13, 15, 30); // 2026-07-13 15:30 local

const out = upcomingNeighborhoodEvents(items, now);

check("drops past-dated entries", out.every((e) => e.title !== "past"));
check("keeps an entry dated today", out.some((e) => e.title === "today"));
check("drops malformed dates", out.every((e) => e.title !== "bad-date"));
check("returns exactly the 3 upcoming", out.length === 3);
check(
  "sorted soonest-first",
  out.map((e) => e.title).join(",") === "today,soon,later",
);

// Day-boundary: the day AFTER an event's date, it hides; ON the date it shows.
const single = [ev("gig", "2026-07-18")];
check("visible on the event day", upcomingNeighborhoodEvents(single, new Date(2026, 6, 18, 23, 0)).length === 1);
check("hidden the day after", upcomingNeighborhoodEvents(single, new Date(2026, 6, 19, 0, 1)).length === 0);

// The seeded FALLBACK is all-future relative to the branch date (2026-07-13).
check(
  "seeded fallback is all upcoming at branch date",
  upcomingNeighborhoodEvents(FALLBACK, new Date(2026, 6, 13)).length === FALLBACK.length,
);

// Formatter
check("formats a valid date", fmtNeighborhoodDate("2026-07-18") === "Sat, Jul 18, 2026");
check("bad date → null", fmtNeighborhoodDate("nope") === null);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll neighborhood-events tests passed.");

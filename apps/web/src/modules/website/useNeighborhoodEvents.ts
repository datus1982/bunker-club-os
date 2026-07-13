import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";

import { FALLBACK, type NeighborhoodEvent } from "./neighborhoodEvents";

// Re-export the pure helpers so pages import them from one place; the pure logic
// + FALLBACK live in neighborhoodEvents.ts (no supabase import) so they're
// unit-testable via tsx. See scripts/test-neighborhood-events.ts.
export {
  FALLBACK,
  upcomingNeighborhoodEvents,
  fmtNeighborhoodDate,
  type NeighborhoodEvent,
} from "./neighborhoodEvents";

/**
 * React Query hook over the `site_neighborhood_events` venue_settings key
 * (anon-readable via 0011 public_read, seeded by 0032). Degrades to the FALLBACK
 * (which is also placeholderData) so /events always renders.
 */
export function useNeighborhoodEvents() {
  return useQuery({
    queryKey: ["site-neighborhood-events", VENUE_ID],
    staleTime: 5 * 60_000,
    placeholderData: FALLBACK,
    queryFn: async (): Promise<NeighborhoodEvent[]> => {
      const { data, error } = await supabase
        .from("venue_settings")
        .select("value")
        .eq("venue_id", VENUE_ID)
        .eq("key", "site_neighborhood_events")
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value;
      return Array.isArray(raw) ? (raw as NeighborhoodEvent[]) : FALLBACK;
    },
  });
}

import { QueryClient } from "@tanstack/react-query";

// docs/01 realtime strategy: realtime-first. Queries are invalidated by
// postgres_changes subscriptions; a slow refetch (30–60s) is the ONLY polling —
// a safety net for dropped websockets on bar wifi. NEVER sub-30s polling.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchInterval: 45_000, // safety-net poll only; realtime does the real work
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

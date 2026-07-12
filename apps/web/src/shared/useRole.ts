import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "./supabaseClient";
import { useSession } from "./useSession";

export type StaffRole = "admin" | "host" | "staff";

/** admin ⊇ host ⊇ staff for authorization comparisons (docs/01). */
const RANK: Record<StaffRole, number> = { staff: 1, host: 2, admin: 3 };

export function roleAtLeast(role: StaffRole | null, min: StaffRole): boolean {
  return role != null && RANK[role] >= RANK[min];
}

/**
 * The caller's staff role for the active venue, read from venue_staff
 * (NOT auth app_metadata — keeps roles venue-scoped for SaaS, docs/01).
 * Returns null for players / signed-out users.
 */
export function useRole() {
  const { session, loading: sessionLoading } = useSession();
  const uid = session?.user?.id;

  const query = useQuery({
    queryKey: ["venue-role", VENUE_ID, uid],
    enabled: !!uid,
    queryFn: async (): Promise<StaffRole | null> => {
      const { data, error } = await supabase
        .from("venue_staff")
        .select("role")
        .eq("venue_id", VENUE_ID)
        .eq("profile_id", uid!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as StaffRole | undefined) ?? null;
    },
  });

  return {
    role: query.data ?? null,
    loading: sessionLoading || query.isLoading,
    isSignedIn: !!uid,
  };
}

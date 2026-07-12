import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "./supabaseClient";
import { useSession } from "./useSession";

export type StaffRole = "admin" | "host" | "staff";

/** Module keys (mirror venue_staff.modules + has_module() in migration 0024). */
export type ModuleKey = "trivia" | "seasons" | "drinks" | "signage" | "website" | "events";

/** admin ⊇ host ⊇ staff for authorization comparisons (docs/01). */
const RANK: Record<StaffRole, number> = { staff: 1, host: 2, admin: 3 };

export function roleAtLeast(role: StaffRole | null, min: StaffRole): boolean {
  return role != null && RANK[role] >= RANK[min];
}

/** Module access (mirrors has_module SQL): admin implies every module; otherwise the
 *  module must be explicitly granted. Rank no longer implies module access (0024). */
export function hasModule(role: StaffRole | null, modules: ModuleKey[], key: ModuleKey): boolean {
  if (role === "admin") return true;
  return modules.includes(key);
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
    queryFn: async (): Promise<{ role: StaffRole | null; modules: ModuleKey[] }> => {
      const { data, error } = await supabase
        .from("venue_staff")
        .select("role, modules")
        .eq("venue_id", VENUE_ID)
        .eq("profile_id", uid!)
        .maybeSingle();
      if (error) throw error;
      return {
        role: (data?.role as StaffRole | undefined) ?? null,
        modules: (data?.modules as ModuleKey[] | undefined) ?? [],
      };
    },
  });

  const role = query.data?.role ?? null;
  const modules = query.data?.modules ?? [];

  return {
    role,
    modules,
    /** Convenience: does the caller have this module (admin implies all)? */
    can: (key: ModuleKey) => hasModule(role, modules, key),
    loading: sessionLoading || query.isLoading,
    isSignedIn: !!uid,
  };
}

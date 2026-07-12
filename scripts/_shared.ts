/**
 * Shared helpers for the ops scripts. Node/tsx runtime (NOT the browser).
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`\n✗ Missing required env var: ${name}\n  See .env.example.\n`);
    process.exit(1);
  }
  return v;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

/** Client for the NEW owned project, service role (bypasses RLS). Writes allowed. */
export function newServiceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client for the LEGACY OptiDev project, anon key. READ-ONLY by discipline —
 * this project serves live Wednesday trivia; never call insert/update/delete/
 * upsert on it (docs/03). Only .select() and storage downloads.
 */
export function legacyReadClient(): SupabaseClient {
  return createClient(requireEnv("LEGACY_SUPABASE_URL"), requireEnv("LEGACY_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Paginate an entire table via .range() in pages of `pageSize`. */
export async function selectAll(
  client: SupabaseClient,
  table: string,
  pageSize = 1000,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`select ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

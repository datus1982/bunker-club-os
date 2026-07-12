import { createClient } from "@supabase/supabase-js";

// docs/01: the standard Supabase client. The legacy OptiDev gateway/HMAC client
// (~200 lines) and the window.__ENV__ runtime-injection helper are GONE.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
);

/** Active venue id. Single-venue today; schema is multi-venue (docs/00 principle 2). */
export const VENUE_ID = import.meta.env.VITE_VENUE_ID;

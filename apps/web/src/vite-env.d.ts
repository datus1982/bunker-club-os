/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** The active venue id (seeded Bunker Club row). Single-venue for now. */
  readonly VITE_VENUE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

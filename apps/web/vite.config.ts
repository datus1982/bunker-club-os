import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

// Simplified per docs/03: NO OptiDev plugins (injectSource / visualEditor /
// errorOverlay), NO WORKSPACE_HOST logic, NO window.__ENV__ injection.
// Standard Vite env only (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});

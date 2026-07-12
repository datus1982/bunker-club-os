/**
 * DEV-gated logger (docs/04 QUAL-1). The legacy Leaderboard console.log'd on every
 * render — every 5s, forever, on unattended signage. Route all debug logging through
 * this so it vanishes in production builds. Errors always surface.
 */
export const log = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args);
};

export const logError = (...args: unknown[]) => {
  console.error(...args);
};

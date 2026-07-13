import type { ModuleKey } from "./useRole";

/**
 * Staff-facing display labels for module keys. The KEYS (used in venue_staff.modules,
 * has_module(), routes) never change — only what a manager sees. Task-named per
 * [[manager-grade-ux-goal]]: "DRINKS" reads like "edit the advertised drinks" but the
 * module is the sales-rank TV board, so staff surfaces call it TOP SELLERS. One map so
 * no surface (Users grant matrix, ACCESS DENIED copy, nav) ever says "DRINKS" again.
 */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  trivia: "TRIVIA",
  seasons: "SEASONS",
  drinks: "TOP SELLERS",
  signage: "SIGNAGE",
  website: "WEBSITE",
  events: "EVENTS",
};

export function moduleLabel(key: ModuleKey): string {
  return MODULE_LABELS[key] ?? key.toUpperCase();
}

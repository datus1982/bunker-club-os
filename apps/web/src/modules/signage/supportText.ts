import type { Orientation } from "./useSignage";

/**
 * SUPPORTING-TEXT FLOOR — the single-sourced minimum size for the in-world supporting-label
 * class across EVERY signage card (owner beat 2026-07-15 late: "all that supporting text is too
 * small … you can't read it in this setting"; follow-up 2026-07-15 night: "pass over all cards
 * and make this size the minimum").
 *
 * The label class = the small flavor labels that sit SUBORDINATE to the big names/prices/headers:
 * feed caps (OPTICAL FEED — LIVE, ARCHIVE FEED, CHART LEADER, DWELLER ID …), eyebrows/kickers
 * (UPCOMING PROTOCOL, ▸ ON NOW — PROMO, ◈ SHELTER BULLETIN, PRIORITY BROADCAST …), badges
 * (STORY — TODAY ONLY, MANDATORY FUN), timestamps/relative-time, date-tile day-of-week captions,
 * window/counter chips (LAUNCH WINDOW OPEN — 04:12 REMAINING, FUEL CONSUMED), empty-state
 * sub-lines (◊ AWAITING NEXT POST, ◊ SALES TELEMETRY ARMED, ◊ TALLYING THE POURS), and
 * CTA-adjacent micro-copy (SCAN TO OPEN THE POST, the counter unit line).
 *
 * These read as mush at bar distance below this floor, so anything of the class BELOW it rises TO
 * it; anything already at/above it stays. NOT for: big headlines/names/prices, event-card
 * body/CTA text (sized up in PRs #27/#32), the ticker (its own sizing system), the chrome
 * header/footer, or list count-labels (SOLD — already proportional to their big green figures).
 *
 * Shared here (rather than in either template file) so SignageTemplates, EventStages, and
 * signagePhoto all read ONE constant — no split-brain seam where the same label renders at two
 * sizes on adjacent rotation cards. Type-only import of Orientation, so no runtime cycle.
 */
export const SUPPORT_TEXT: Record<Orientation, number> = { portrait: 40, landscape: 32 };

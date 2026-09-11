import { hasModule, roleAtLeast, type ModuleKey, type StaffRole } from "@/shared/useRole";
import { SECTIONS_V2, childVisibleV2 } from "./navV2";
import { screenHealth } from "@/modules/signage/useSignageAdmin";
import { formatAge, type ScreenSlot, type SyncStatus } from "./useDashboard";
import type { TriviaArmState } from "@/modules/signage/triviaArm";

/**
 * HOME's shared data — the module-tile table, the label helpers, and the alert-strip
 * derivation — so the classic `Dashboard` and `DashboardV2` render from ONE definition
 * (the `usersShared.ts` precedent, Beat 2).
 *
 * `TILES` moved here VERBATIM from Dashboard.tsx; the two fields added to the type
 * (`section`, `title`) are read by the v2 view only, so classic's filter + render are
 * unchanged. Nothing here calls Supabase — it is pure functions over data the page's
 * hooks already fetched.
 */

// ── module tiles ─────────────────────────────────────────────────────────

/** The v2 nav sections (navV2.ts `SECTIONS_V2`), used to group the launcher. */
export type TileSection = "GAMES" | "BAR OPS" | "MEDIA" | "SYSTEM";

export interface Tile {
  label: string; to: string; desc: string;
  module?: ModuleKey;    // shown when the caller holds this grant (admin implied)
  minRole?: StaffRole;   // used for non-module-scoped tiles (admin-only surfaces)
  disabled?: string;     // phase note if not yet built
  hint?: "tonight" | "season";
  /** v2 only: which nav section this launcher belongs under. */
  section: TileSection;
  /** v2 only: the sentence-case name (§B: UPPERCASE is the Label role, not a title). */
  title: string;
}

export const TILES: Tile[] = [
  { label: "TRIVIA CONTROL", to: "/scoring", desc: "Live scoring console — run the game", module: "trivia", hint: "tonight", section: "GAMES", title: "Trivia control" },
  { label: "GAME SETUP", to: "/game/setup", desc: "Create a game, rounds & questions", module: "trivia", section: "GAMES", title: "Game setup" },
  { label: "TEAMS", to: "/teams", desc: "Regular-team roster & PINs", module: "trivia", section: "GAMES", title: "Teams" },
  { label: "HISTORY", to: "/game/history", desc: "Past games & final boards", module: "trivia", section: "GAMES", title: "History" },
  { label: "SEASONS", to: "/admin/seasons", desc: "Standings, playoffs & finals", minRole: "admin", hint: "season", section: "GAMES", title: "Seasons" },
  { label: "TOP SELLERS", to: "/admin/drinks", desc: "Configure the sales-rank TV board", module: "drinks", section: "BAR OPS", title: "Top sellers" },
  { label: "USERS", to: "/admin/users", desc: "Staff accounts & module grants", minRole: "admin", section: "SYSTEM", title: "Users" },
  { label: "SIGNAGE", to: "/signage", desc: "Specials & event screens", module: "signage", section: "BAR OPS", title: "Signage hub" },
  { label: "WEBSITE", to: "/", desc: "Public site content", module: "website", disabled: "Phase 3.5", section: "BAR OPS", title: "Website" },
];

/**
 * The v2 launcher's MEDIA group.
 *
 * DECISION: HOME launches every section the nav has. `TILES` above has no MEDIA entry —
 * classic HOME predates the MEDIA promotion (Beat 4) and that table is frozen — so the v2
 * launcher takes its MEDIA tiles straight from the NAV's own MEDIA section: same routes,
 * same labels, and the SAME GATE (`childVisibleV2`, i.e. `has_module('signage')`, since
 * MEDIA has no module of its own). Declaring a second list here would be a second answer
 * to "may this person see MEDIA", which is the drift the nav's gate exists to prevent.
 * Classic renders none of it: `TILES` is untouched and this is called only by DashboardV2.
 */
const MEDIA_TILE_COPY: Record<string, { title: string; desc: string }> = {
  "/media/library": { title: "Library", desc: "Every film on the bar PC" },
  "/media/playlists": { title: "Playlists", desc: "Folder playlists and what they carry" },
  "/media/screens": { title: "Screens & programs", desc: "What each screen plays and when" },
};

export function mediaTiles(role: StaffRole | null, modules: ModuleKey[]): Tile[] {
  const section = SECTIONS_V2.find((s) => s.label === "MEDIA");
  if (!section) return [];
  return section.children
    .filter((c) => c.to && !c.comingSoon && childVisibleV2(role, modules, c))
    .map((c) => {
      const copy = MEDIA_TILE_COPY[c.to];
      return {
        label: c.label,
        to: c.to,
        section: "MEDIA" as const,
        title: copy?.title ?? c.label,
        // `c.task` is the drawer's one-liner; the copy above is the shorter tile voice.
        desc: copy?.desc ?? c.task ?? "",
        module: c.module,
        minRole: c.minRole,
      };
    });
}

/** The gate BOTH views filter by — identical to the expression classic has always used
 *  (module grant, else rank), so a host{trivia} sees exactly the same tiles in either. */
export function tileVisible(role: StaffRole | null, modules: ModuleKey[], t: Tile): boolean {
  return t.module ? hasModule(role, modules, t.module) : roleAtLeast(role, t.minRole ?? "staff");
}

// ── labels ───────────────────────────────────────────────────────────────

/** Classic's UPPERCASE game-status label. Untouched — classic renders it. */
export function tonightLabel(status: string): string {
  switch (status) {
    case "active": return "LIVE";
    case "paused": return "PAUSED";
    case "setup": return "IN SETUP";
    case "stopped": return "STOPPED";
    case "completed": return "COMPLETE";
    default: return status.toUpperCase();
  }
}

/** The same fact in sentence case, for v2 (§B: caps is the Label role only). */
export function tonightPhrase(status: string): string {
  switch (status) {
    case "active": return "Game in progress";
    case "paused": return "Game paused";
    case "setup": return "Game in setup";
    case "stopped": return "Game stopped";
    case "completed": return "Game complete";
    default: return status;
  }
}

/**
 * The season's time line for v2. A season whose last day has passed must never read
 * "0 days left" — `days_remaining` floors at 0 (useDashboard), so zero IS "over", and the
 * honest sentence names the day it ended. `ends_on` is a plain date; it is split into its
 * parts and rebuilt locally so the label can never slip a day through a UTC parse.
 */
export function seasonTimePhrase(endsOn: string, daysRemaining: number): string {
  if (daysRemaining > 0) return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`;
  const [y, m, d] = endsOn.split("-").map(Number);
  if (!y || !m || !d) return "Ended";
  return `Ended ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Screen label for the STATUS BOARD: name, else TERMINAL n — location. */
export function screenName(s: ScreenSlot): string {
  if (s.name) return s.name;
  const n = String(s.terminal_number ?? 0).padStart(2, "0");
  return `TERMINAL ${n}${s.location_label ? ` — ${s.location_label}` : ""}`;
}

// ── the HOME alert strip (audit §C2, letter E1) ──────────────────────────

/** One row of the strip. `to` is set only when the viewer can actually reach the fix. */
export interface HomeAlert {
  id: string;
  /** `warn` = going wrong (amber); `danger` = a true failure state (red). §B budget. */
  tone: "warn" | "danger";
  message: string;
  to?: string;
  label?: string;
}

/**
 * Everything that should interrupt a manager, derived from state HOME (and the Signage
 * Hub) ALREADY read — no new table, column, RPC or query shape, per the beat's RULE #1.
 *
 * Sources, in the order they appear:
 *   1/2. the trivia arm — `triviaArm.ts`, the SAME function the hub's notice uses, so HOME
 *        and the hub can never disagree about whether trivia is on the screens. The gate is
 *        `alertNotArmed`, which is silent on a FUTURE `setup` deck, and the COPY splits on
 *        the game's business-day relation: a still-open game from an earlier night is a
 *        "nobody ended it" problem, not an "arm it" problem (PR 2 review, WARN-1).
 *   3.   screen heartbeats — `screenHealth(last_seen)` for OFFLINE (a true failure, red);
 *        STALE only past FIVE minutes (amber), because the card's chip flips at two and a
 *        screen 2–5 minutes behind is almost always mid-reload, not in trouble.
 *   4.   Toast sync — only the RED state (>60min, and for sales only INSIDE the venue's
 *        sync window: `classify()` already resolves an out-of-hours gap to `idle`).
 *        Amber (15–60min) is ordinary churn and deliberately does NOT raise a row. The
 *        sentence names what is actually stale: the sellers boards (sales), the website
 *        menu and drink slides (menu), or both.
 *
 * An empty result renders NOTHING — no "all clear" chrome (audit §A1: the page must
 * distinguish "needs you" from "FYI", and a permanent green bar distinguishes nothing).
 *
 * `canTrivia` / `canSignage` gate only the ACTION LINK: every viewer of HOME already
 * sees this state in the cards below, so the sentence is never hidden, but a link to a
 * console the viewer's grants would refuse is worse than no link.
 */
export function homeAlerts(input: {
  arm: TriviaArmState & { liveGame?: { game_date: string | null } | null };
  sync: SyncStatus | undefined;
  screens: ScreenSlot[] | undefined;
  canTrivia: boolean;
  canSignage: boolean;
}): HomeAlert[] {
  const { arm, sync, screens, canTrivia, canSignage } = input;
  const out: HomeAlert[] = [];

  if (arm.alertNotArmed && arm.gameIsPast) {
    // The live case this replaced: an `active` game from an earlier night that nobody ended
    // still reads as "a game exists", and HOME used to tell the manager to ARM it. The fix
    // is to end it — the arm model is not the problem.
    out.push({
      id: "trivia-game-never-ended",
      tone: "warn",
      message: `A game dated ${prettyDate(arm.liveGame?.game_date)} is still open — it was never ended. End it from Scoring so tonight starts clean.`,
      to: canTrivia ? "/scoring" : undefined,
      label: "Open scoring →",
    });
  } else if (arm.alertNotArmed) {
    out.push({
      id: "trivia-not-armed",
      tone: "warn",
      message: "Trivia isn't on the screens — a game exists but the bar TVs are still on rotation. Arm it from Scoring before the game starts.",
      to: canTrivia ? "/scoring" : undefined,
      label: "Open scoring →",
    });
  } else if (arm.armedNoGame) {
    // Never both: the two are mutually exclusive by construction (deriveTriviaArmState).
    out.push({
      id: "trivia-armed-no-game",
      tone: "warn",
      message: "Trivia is armed with no game loaded — the bar TVs show the scan-to-join board. The arm clears by itself at the nightly rollover.",
      to: canTrivia ? "/scoring" : undefined,
      label: "Open scoring →",
    });
  }

  const offline = (screens ?? []).filter((s) => screenHealth(s.last_seen) === "offline");
  // NOTE-2: the CARD's chip still flips at two minutes; the STRIP waits five. Between the
  // two a screen is nearly always mid-reload, and a row that cries wolf every evening is a
  // row nobody reads.
  const stale = (screens ?? []).filter(
    (s) => screenHealth(s.last_seen) === "stale" && ageMinutes(s.last_seen) > 5,
  );
  if (offline.length) {
    out.push({
      id: "screens-offline",
      tone: "danger",
      message: `${nameList(offline)} ${offline.length === 1 ? "hasn't" : "haven't"} checked in — the screen may be off, asleep or disconnected.`,
      to: canSignage ? "/signage" : undefined,
      label: "Check screens →",
    });
  }
  if (stale.length) {
    out.push({
      id: "screens-stale",
      tone: "warn",
      message: `${nameList(stale)} ${stale.length === 1 ? "is" : "are"} late checking in — may still be showing, but the heartbeat is behind.`,
      to: canSignage ? "/signage" : undefined,
      label: "Check screens →",
    });
  }

  if (sync) {
    const salesRed = sync.toastSync.state === "red";
    const menuRed = sync.menuSync.state === "red";
    const stalled: string[] = [];
    if (salesRed) stalled.push(`sales ${formatAge(sync.toastSync.ageMs)}`);
    if (menuRed) stalled.push(`menu ${formatAge(sync.menuSync.ageMs)}`);
    // NOTE-3: name what is actually stale. The two syncs feed different surfaces, and
    // "older data" without a subject sends a manager looking in the wrong place.
    const SELLERS = "the sellers boards";
    const MENU = "the website menu and the drink slides";
    const affected = salesRed && menuRed ? `${SELLERS}, ${MENU}` : salesRed ? SELLERS : MENU;
    if (stalled.length) {
      // DECISION: no link. Nothing in the app restarts the sync — it is a scheduled job,
      // and pointing at a page that cannot fix it would be a lie. The TOAST SYNC card
      // below carries the detail; this row exists so the failure is not only visible to
      // someone who reads all four cards.
      out.push({
        id: "toast-stalled",
        tone: "danger",
        message: `Toast sync has stopped (${stalled.join(", ")}) — ${affected} are showing older data.`,
      });
    }
  }

  return out;
}

/** Minutes since a heartbeat; +Infinity when there has never been one. */
function ageMinutes(lastSeen: string | null): number {
  if (!lastSeen) return Number.POSITIVE_INFINITY;
  const t = new Date(lastSeen).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60_000;
}

/** "Sep 9" from a plain `YYYY-MM-DD`, rebuilt locally so it cannot slip a day through a
 *  UTC parse. An absent/odd date degrades to "an earlier night". */
export function prettyDate(date: string | null | undefined): string {
  if (!date) return "an earlier night";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "an earlier night";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Wed, Sep 16" — the TONIGHT card's next-game line. */
export function prettyDayAndDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Portrait Main" / "Portrait Main and Bar TV" / "Portrait Main, Bar TV and 1 more". */
function nameList(slots: ScreenSlot[]): string {
  const names = slots.map(screenName);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

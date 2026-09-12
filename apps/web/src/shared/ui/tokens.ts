/**
 * Staff token system v2 — the TS mirror of `theme/staff-tokens-v2.css`
 * (docs/ux-overhaul/02-polish-pass-audit-2026-09-11.md §B).
 *
 * WHY A TS COPY EXISTS AT ALL: nothing inherits font-size in this app
 * (`.terminal-theme *` sets it on EVERY element at class specificity, so inheritance —
 * which has zero specificity — never reaches anything; PR #89). Component text sizes
 * are therefore inline px, and inline px needs the numbers in TypeScript. Geometry
 * (padding, gap, radius, min-height) is inline for the same house reason: the
 * primitives are style-object components so they work in either shell.
 *
 * WHAT MUST *NOT* COME FROM HERE: colour. `.terminal-theme *` forces
 * `color: green !important` and an inline style cannot beat an !important — an inline
 * `color: tokens.text1` renders GREEN and silently lies. Colour is applied by the
 * `st-*` classes in staff-tokens-v2.css (`st-t1/st-t2/st-t3/st-accent/st-live/
 * st-amber/st-danger`, plus the `u-*` utilities re-declared there). The hex values
 * below are exported for documentation + the few places a NON-`color` property takes
 * them (a background, a border on an element inside the v2 scope, an SVG fill).
 *
 * Names mirror the SwiftUI semantic names in §B so the iPad app (Bunker Control) can
 * define the same roles against the same values.
 * NOTE (§B iOS groundwork): the audit states no iOS codebase exists; one does —
 * `apps/bunker-control-ios` on the unpushed `phase-bunker-control-v1` branch. Its own
 * palette has NOT been reconciled with these names (code note N9, out of scope here).
 */

/** Ground + elevation. Higher tier = lighter (elevation by lightness, not shadow).
 *  `ground` is NEVER a card fill — a card indistinguishable from the page is the
 *  single largest cause of "flat" (§B). */
export const staffSurface = {
  /** `Color.staffBackground` — page background. */
  ground: "#0B0D10",
  /** `Color.staffSurface1` — cards, list rows, module tiles. */
  surface1: "#131618",
  /** `Color.staffSurface2` — grouped sections/panels, form controls. */
  surface2: "#171B1F",
  /** `Color.staffSurface3` — menus, dropdowns, the mobile nav drawer. */
  surface3: "#1A1C25",
  /** `Color.staffSurface4` — modals, confirm dialogs, sheets. */
  surface4: "#22273D",
} as const;

/** Text tiers — alpha on white, never a bare #FFFFFF. Applied via the `st-t*`
 *  CLASSES, not inline (see the colour note above). */
export const staffText = {
  /** `Color.staffTextPrimary` — titles, primary data values, active nav. */
  primary: "rgba(255,255,255,0.87)",
  /** `Color.staffTextSecondary` — labels, captions, helper copy, metadata. */
  secondary: "rgba(255,255,255,0.60)",
  /** `Color.staffTextDisabled` — disabled controls, placeholders, least-important. */
  disabled: "rgba(255,255,255,0.38)",
} as const;

/** Accent roles — calmed; spent as accent, not as ground truth. */
export const staffAccentColors = {
  /** `Color.staffAccent` — active nav pill, links, focus rings, calm status. */
  accent: "#7FE6A8",
  /** `Color.staffAccentLive` — RESERVED for a true real-time LIVE dot/label ONLY. */
  accentLive: "#00FF41",
  /** `Color.staffAmber` — pending/idle/ambient labels, non-urgent callouts. */
  amber: "#E8B04B",
  /** `Color.staffDanger` — destructive actions and true error states ONLY. */
  danger: "#FF5A5A",
  /** The 8% wash behind a danger callout (`--st-danger-soft`). */
  dangerSoft: "rgba(255,90,90,0.08)",
} as const;

/** `Color.staffHairline` — replaces the 2px solid green frame round every card. */
export const staffHairline = "rgba(255,255,255,0.08)";
export const staffHairlineStrong = "rgba(255,255,255,0.16)";

/** Staff-surface radius ruling (TV/public canon keeps sharp corners). */
export const radius = {
  /** `Radius.staffControl` / `Radius.staffCard` — cards, inputs, buttons. */
  control: 6,
  /** `Radius.staffSheet` — modals, sheets, the mobile nav drawer. */
  sheet: 10,
  /** Status chips, nav pills, badges. */
  pill: 9999,
} as const;

/** 8pt grid. `Spacing` enum in SwiftUI, same case names, values in points. */
export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s6: 24,
  s8: 32,
  s12: 48,
} as const;

/** Motion budget — one named scale; nothing infinite off display routes. */
export const motion = {
  /** Hover/press: opacity + background only. */
  hover: 140,
  /** Drawer/sheet enter: single-axis (slide OR fade, never both). */
  sheet: 180,
  /** Expand/collapse: height + opacity. */
  expand: 160,
  ease: "ease-out",
} as const;

/**
 * Type roles (`.staffFont(.display)` … in SwiftUI). `px` is the 390px size, `md` the
 * ≥768px size. The matching `st-display/st-heading/st-body/st-label/st-mono` classes
 * carry these in CSS with the responsive step; these constants are for the inline
 * sizes a one-off span still needs.
 *
 * CASE is copy, not cascade: Display/Heading/Body/Mono-data strings are authored in
 * sentence or mixed case, Label-role strings are authored (or rendered) UPPERCASE.
 */
export const type = {
  display: { px: 28, md: 34, line: 1.15, weight: 700, face: "display" },
  heading: { px: 17, md: 19, line: 1.3, weight: 600, face: "display" },
  // 15 at 390, NOT §B's 14 — the owner's PR #14 "body size bump" 15px staff floor wins.
  body: { px: 15, md: 15, line: 1.5, weight: 400, face: "body" },
  label: { px: 12, md: 12, line: 1.3, weight: 500, face: "body", tracking: "0.06em" },
  monoData: { px: 15, md: 15, line: 1.4, weight: 500, face: "body" },
} as const;

/** The app-wide tap floor. Asserted on WIDTH and height by the beat harnesses. */
export const TAP = 44;

/** Class names the token stylesheet answers to, as constants so a typo is a type
 *  error rather than a silently-green label. */
export const st = {
  /** Mark a v2-ONLY page root with this attribute (`data-st-page`) — it is the opt-in
   *  hook the whole token sheet hangs off. A classic page rendered inside the v2 shell
   *  deliberately carries none, and keeps its green look exactly. */
  pageAttr: { "data-st-page": "" } as const,
  t1: "st-t1",
  t2: "st-t2",
  t3: "st-t3",
  accent: "st-accent",
  live: "st-live",
  amber: "st-amber",
  danger: "st-danger",
  display: "st-display",
  heading: "st-heading",
  body: "st-body",
  label: "st-label",
  mono: "st-mono",
  /** Mono-data-large (24px, tabular) — the NAMED host-desk exemption (polish arc 2):
   *  the trivia scoring grid's score cells, ×2 / ★ bonus marks and TOTAL column. Team
   *  names and rank stay on `body`/`mono`. Do not spend it on ordinary body data. */
  monoLg: "st-mono-lg",
  card: "st-card",
  panel: "st-panel",
  row: "st-row",
  menu: "st-menu",
  sheet: "st-sheet",
  chip: "st-chip",
  btn: "st-btn",
  btnPrimary: "st-btn-primary",
  btnDanger: "st-btn-danger",
  calloutWarn: "st-callout-warn",
  /** The danger twin of `calloutWarn` (PR 2) — a true failure state, not a warning. */
  calloutDanger: "st-callout-danger",
} as const;

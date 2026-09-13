/**
 * Shared staff UI primitives (UX overhaul Beat 1, audit §5).
 * Import from "@/shared/ui" so a page never re-invents a row, an empty state or a
 * heading — the classes these close are real regressions the app has already shipped
 * once (green-on-green empty action, 720px table on a 390px phone).
 */
export { StaffPageHeader } from "./StaffPageHeader";
export { SectionNav, type SectionNavChild, type SectionNavSection } from "./SectionNav";
export { ListRow } from "./ListRow";
export { StatusChip, type StatusTone } from "./StatusChip";
export { ScreenCard } from "./ScreenCard";
export { ConfirmDialog } from "./ConfirmDialog";
export { useSheetPhase, type SheetPhase } from "./useSheetPhase";
export { EmptyState } from "./EmptyState";
export { InlineNotice } from "./InlineNotice";
export { FormField } from "./FormField";
export { ToggleSwitch } from "./ToggleSwitch";
export { TapTargetCheckbox } from "./TapTargetCheckbox";
export { prefersReducedMotion, EXIT_MS, EXIT_SLACK_MS } from "./motion";
/** The v2 token system (Beat 6 PR 1) — the TS mirror of theme/staff-tokens-v2.css.
 *  Colour is applied by the `st-*` CLASSES, never by an inline `color` (the base theme
 *  forces green with !important); these values exist for inline sizes/geometry and for
 *  the non-`color` properties that legitimately take a literal. */
export {
  staffSurface, staffText, staffAccentColors, staffHairline, staffHairlineStrong,
  radius, space, motion, type as typeRoles, TAP, st,
} from "./tokens";

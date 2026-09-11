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
export { EmptyState } from "./EmptyState";
export { InlineNotice } from "./InlineNotice";
export { FormField } from "./FormField";
export { ToggleSwitch } from "./ToggleSwitch";
export { TapTargetCheckbox } from "./TapTargetCheckbox";

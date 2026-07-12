import { Placeholder, DisplayPlaceholder } from "@/shared/Placeholder";

// Host tools (host+). Real pages ported in Phase 1 (docs/04).
export const Dashboard = () => <Placeholder title="DASHBOARD" phase="Phase 0/1" />;
export const Scoring = () => <Placeholder title="SCORING" phase="Phase 1 (docs/04)" />;
export const Teams = () => <Placeholder title="TEAMS" phase="Phase 1 (docs/04)" />;
export const History = () => <Placeholder title="HISTORY" phase="Phase 1 (docs/04)" />;
export const Settings = () => <Placeholder title="SETTINGS" phase="Phase 1 (docs/04)" />;
export const GameTools = () => <Placeholder title="GAME TOOLS" phase="Phase 1 (docs/04)" />;

// Public display routes (docs/01 — rendered through DisplayCanvas, no auth).
// Leaderboard is ported (docs/04); GameDisplay remains a stub until its port.
export { Leaderboard } from "./Leaderboard";
export const GameDisplay = () => (
  <DisplayPlaceholder title="GAME DISPLAY" orientation="landscape" />
);

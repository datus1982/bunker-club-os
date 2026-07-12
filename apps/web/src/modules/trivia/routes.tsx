import { Placeholder } from "@/shared/Placeholder";

// Host tools (host+). Real pages ported in Phase 1 (docs/04).
export const Dashboard = () => <Placeholder title="DASHBOARD" phase="Phase 0/1" />;
export const Scoring = () => <Placeholder title="SCORING" phase="Phase 1 (docs/04)" />;
export const Teams = () => <Placeholder title="TEAMS" phase="Phase 1 (docs/04)" />;
export const Settings = () => <Placeholder title="SETTINGS" phase="Phase 1 (docs/04)" />;
export const GameTools = () => <Placeholder title="GAME TOOLS" phase="Phase 1 (docs/04)" />;

// Public display routes (docs/01 — rendered through DisplayCanvas, no auth).
// Leaderboard + GameDisplay ported (docs/04).
export { Leaderboard } from "./Leaderboard";
export { GameDisplay } from "./GameDisplay";

// Host tool (host+): read-only game history + view a game's final board.
export { History } from "./History";

// Host tool (host+): create a game + its rounds.
export { GameSetup } from "./GameSetup";

// Host tool (host+): enter questions/answers per round.
export { QuestionEntry } from "./QuestionEntry";

// Host tool (host+): set per-round inter-round video URLs.
export { VideoEntry } from "./VideoEntry";

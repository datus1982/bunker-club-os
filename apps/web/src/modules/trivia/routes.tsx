import { Placeholder } from "@/shared/Placeholder";

// Host tools (host+). Real pages ported in Phase 1 (docs/04).
export const Dashboard = () => <Placeholder title="DASHBOARD" phase="Phase 0/1" />;
export const Settings = () => <Placeholder title="SETTINGS" phase="Phase 1 (docs/04)" />;
export const GameTools = () => <Placeholder title="GAME TOOLS" phase="Phase 1 (docs/04)" />;

// Host tool (host+): live scoring console (docs/04 ARCH-2 decomposition).
export { Scoring } from "./Scoring";

// Host tool (host+): regular-team roster (shares TeamEditorDialog with Scoring).
export { Teams } from "./Teams";

// Public dual-display screen preview (trivia-sandbox) — both boards side by side, no auth.
// The reusable boards it embeds (LeaderboardBoard / GameDisplayBoard) also drive signage
// game mode; the old standalone /leaderboard + /game-display TV routes are retired.
export { GamePreview } from "./GamePreview";

// Host tool (host+): read-only game history + view a game's final board.
export { History } from "./History";

// Host tool (host+): create a game + its rounds.
export { GameSetup } from "./GameSetup";

// Host tool (host+): enter questions/answers per round.
export { QuestionEntry } from "./QuestionEntry";

// Host tool (host+): set per-round inter-round video URLs.
export { VideoEntry } from "./VideoEntry";

// Host tool (host+): bulk import questions from a PowerPoint deck.
export { BulkImport } from "./BulkImport";

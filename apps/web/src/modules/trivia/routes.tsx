import { Placeholder } from "@/shared/Placeholder";
import { EmptyState, StaffPageHeader } from "@/shared/ui";
import { useUiVersion } from "@/shared/useUiVersion";

// Host tools (host+). Real pages ported in Phase 1 (docs/04).
export const Dashboard = () => <Placeholder title="DASHBOARD" phase="Phase 0/1" />;

/**
 * /settings — still the Phase 1 scaffold. CLASSIC renders the untouched Placeholder
 * (byte-identical, RULE #1). v2 says the honest thing instead: the nav already marks
 * SETTINGS as COMING SOON and never links here, so a manager who arrives by URL should
 * read "not built yet", not "Scaffolding — implemented in Phase 1 (docs/04)" (audit A5).
 */
export const Settings = () => {
  const [version] = useUiVersion();
  if (version !== "v2") return <Placeholder title="SETTINGS" phase="Phase 1 (docs/04)" />;
  return (
    <div data-st-page="" style={{ padding: "24px clamp(16px, 4vw, 48px) 48px", maxWidth: 900, margin: "0 auto" }}>
      <StaffPageHeader eyebrow="SYSTEM ▸ SETTINGS" title="Settings" tag="NOT BUILT YET" />
      <EmptyState
        eyebrow="NOTHING HERE YET"
        message="Venue settings don't have a screen yet. Hours, timezone, ticker lines and the sync windows still live in the database — ask in-session when you need one changed."
      />
    </div>
  );
};
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

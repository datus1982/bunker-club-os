import { Placeholder } from "@/shared/Placeholder";
import { EmptyState, StaffPageHeader } from "@/shared/ui";
import { useUiVersion } from "@/shared/useUiVersion";
import { withTriviaVersion } from "./triviaVersion";
import { Scoring as ScoringPage } from "./Scoring";
import { Teams as TeamsPage } from "./Teams";
import { History as HistoryPage } from "./History";
import { GameSetup as GameSetupPage } from "./GameSetup";
import { QuestionEntry as QuestionEntryPage } from "./QuestionEntry";
import { VideoEntry as VideoEntryPage } from "./VideoEntry";
import { BulkImport as BulkImportPage } from "./BulkImport";

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

/* ── the trivia staff pages (polish arc 2, PR 3) ───────────────────────────────
 * Each is wrapped in `withTriviaVersion`, which supplies the "render in the v2 token
 * look?" context. It reads `false` — i.e. classic, byte for byte — unless BOTH device
 * switches are on v2. The wrapper lives here so `App.tsx`'s route table, and with it
 * the TV/staff chunk split, is untouched. SEASONS gets the same wrapper in
 * `modules/seasons/routes.tsx`.
 *
 * QUESTIONS / VIDEOS / IMPORT joined the same switch (Marvin ruling 2026-09-12): a host
 * leaving Scoring for the deck tools should not cross a look boundary. They needed no
 * new plumbing — the same `data-st-page` hook, `cx()` and role classes the five pages
 * use, plus `StaffPageHeader`. They render NO sub-nav row (they match no nav child), so
 * the trivia switch is not offered while you are on one; the way back is any of the five.
 *
 * NOT wrapped, and frozen unconditionally (§A2): GamePreview — an audience-board
 * preview, not a staff page. */

// Host tool (host+): live scoring console (docs/04 ARCH-2 decomposition).
export const Scoring = withTriviaVersion(ScoringPage);

// Host tool (host+): regular-team roster (shares TeamEditorDialog with Scoring).
export const Teams = withTriviaVersion(TeamsPage);

// Public dual-display screen preview (trivia-sandbox) — both boards side by side, no auth.
// The reusable boards it embeds (LeaderboardBoard / GameDisplayBoard) also drive signage
// game mode; the old standalone /leaderboard + /game-display TV routes are retired.
export { GamePreview } from "./GamePreview";

// Host tool (host+): read-only game history + view a game's final board.
export const History = withTriviaVersion(HistoryPage);

// Host tool (host+): create a game + its rounds.
export const GameSetup = withTriviaVersion(GameSetupPage);

// Host tool (host+): enter questions/answers per round.
export const QuestionEntry = withTriviaVersion(QuestionEntryPage);

// Host tool (host+): set per-round inter-round video URLs.
export const VideoEntry = withTriviaVersion(VideoEntryPage);

// Host tool (host+): bulk import questions from a PowerPoint deck.
export const BulkImport = withTriviaVersion(BulkImportPage);

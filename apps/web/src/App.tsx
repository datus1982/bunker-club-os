import { Navigate, Routes, Route } from "react-router-dom";

import { RequireAuth, RequireRole } from "./shared/guards";
import * as Trivia from "./modules/trivia/routes";
import * as Website from "./modules/website/routes";
import { Checkin, CheckinQRPage } from "./modules/registration/routes";
import { Login } from "./modules/auth/Login";
import { Portal } from "./modules/portal/routes";
import { DrinksDisplay, DrinksAdmin } from "./modules/leaderboard/routes";
import { SeasonsAdmin } from "./modules/seasons/routes";
import { SignageAdmin, SlotDisplay } from "./modules/signage/routes";

/**
 * Top-level route map (docs/01, updated by docs/14). The public website owns the
 * site root and renders with zero auth; the internal dashboard lives at /dashboard.
 * Public DISPLAY routes render with zero auth and are safe on an unattended screen
 * (read-only). Staff routes are role-gated.
 */
export function App() {
  return (
    <Routes>
      {/* Public marketing website (docs/14, Phase 3.5) — no auth */}
      <Route path="/" element={<Website.Home />} />
      <Route path="/menu" element={<Website.Menu />} />
      <Route path="/events" element={<Website.Events />} />
      <Route path="/trivia" element={<Website.Trivia />} />
      <Route path="/visit" element={<Website.Visit />} />
      <Route path="/about" element={<Website.About />} />

      {/* Internal dashboard — staff+ */}
      <Route path="/dashboard" element={<RequireRole role="staff"><Trivia.Dashboard /></RequireRole>} />

      {/* Trivia host tools — host+ */}
      <Route path="/scoring" element={<RequireRole role="host"><Trivia.Scoring /></RequireRole>} />
      <Route path="/game/setup" element={<RequireRole role="host"><Trivia.GameSetup /></RequireRole>} />
      <Route path="/game/:gameId/questions" element={<RequireRole role="host"><Trivia.QuestionEntry /></RequireRole>} />
      <Route path="/game/:gameId/videos" element={<RequireRole role="host"><Trivia.VideoEntry /></RequireRole>} />
      <Route path="/game/:gameId/bulk-import" element={<RequireRole role="host"><Trivia.BulkImport /></RequireRole>} />
      <Route path="/game/*" element={<RequireRole role="host"><Trivia.GameTools /></RequireRole>} />
      <Route path="/teams" element={<RequireRole role="host"><Trivia.Teams /></RequireRole>} />
      <Route path="/history" element={<RequireRole role="host"><Trivia.History /></RequireRole>} />
      <Route path="/settings" element={<RequireRole role="host"><Trivia.Settings /></RequireRole>} />

      {/* Public display routes — no auth */}
      <Route path="/leaderboard" element={<Trivia.Leaderboard />} />
      <Route path="/game-display" element={<Trivia.GameDisplay />} />
      <Route path="/drinks" element={<DrinksDisplay />} />
      <Route path="/signage/s/:slug" element={<SlotDisplay />} />

      {/* Staff sign-in (minimal; full auth is Phase 2) */}
      <Route path="/login" element={<Login />} />

      {/* Player-facing */}
      <Route path="/checkin" element={<Checkin />} />
      <Route path="/checkin/qr" element={<CheckinQRPage />} />
      {/* Old registration route — /checkin fully replaces it (docs/05); keep a redirect. */}
      <Route path="/add-team" element={<Navigate to="/checkin" replace />} />
      <Route path="/portal/*" element={<RequireAuth><Portal /></RequireAuth>} />

      {/* Staff / admin */}
      <Route path="/signage" element={<RequireRole role="staff"><SignageAdmin /></RequireRole>} />
      <Route path="/admin/drinks" element={<RequireRole role="staff"><DrinksAdmin /></RequireRole>} />
      <Route path="/admin/seasons" element={<RequireRole role="admin"><SeasonsAdmin /></RequireRole>} />

      {/* Fallback — unknown paths land on the public home */}
      <Route path="*" element={<Website.Home />} />
    </Routes>
  );
}

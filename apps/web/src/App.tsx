import { Routes, Route } from "react-router-dom";

import { RequireAuth, RequireRole } from "./shared/guards";
import * as Trivia from "./modules/trivia/routes";
import { Checkin } from "./modules/registration/routes";
import { Portal } from "./modules/portal/routes";
import { DrinksDisplay } from "./modules/leaderboard/routes";
import { SeasonsAdmin } from "./modules/seasons/routes";
import { SignageAdmin, SlotDisplay } from "./modules/signage/routes";

/**
 * Top-level route map (docs/01). Public DISPLAY routes render with zero auth and
 * are safe on an unattended screen (read-only). Staff routes are role-gated.
 */
export function App() {
  return (
    <Routes>
      {/* Dashboard — staff+ */}
      <Route path="/" element={<RequireRole role="staff"><Trivia.Dashboard /></RequireRole>} />

      {/* Trivia host tools — host+ */}
      <Route path="/scoring" element={<RequireRole role="host"><Trivia.Scoring /></RequireRole>} />
      <Route path="/game/*" element={<RequireRole role="host"><Trivia.GameTools /></RequireRole>} />
      <Route path="/teams" element={<RequireRole role="host"><Trivia.Teams /></RequireRole>} />
      <Route path="/history" element={<RequireRole role="host"><Trivia.History /></RequireRole>} />
      <Route path="/settings" element={<RequireRole role="host"><Trivia.Settings /></RequireRole>} />

      {/* Public display routes — no auth */}
      <Route path="/leaderboard" element={<Trivia.Leaderboard />} />
      <Route path="/game-display" element={<Trivia.GameDisplay />} />
      <Route path="/drinks" element={<DrinksDisplay />} />
      <Route path="/signage/s/:slug" element={<SlotDisplay />} />

      {/* Player-facing */}
      <Route path="/checkin" element={<Checkin />} />
      <Route path="/portal/*" element={<RequireAuth><Portal /></RequireAuth>} />

      {/* Staff / admin */}
      <Route path="/signage" element={<RequireRole role="staff"><SignageAdmin /></RequireRole>} />
      <Route path="/admin/seasons" element={<RequireRole role="admin"><SeasonsAdmin /></RequireRole>} />

      {/* Fallback */}
      <Route path="*" element={<Checkin />} />
    </Routes>
  );
}

import { Navigate, Routes, Route } from "react-router-dom";

import { RequireAuth, RequireRole, RequireModule } from "./shared/guards";
import * as Trivia from "./modules/trivia/routes";
import * as Website from "./modules/website/routes";
import { Checkin, CheckinQRPage } from "./modules/registration/routes";
import { Login } from "./modules/auth/Login";
import { ResetPassword } from "./modules/auth/ResetPassword";
import { Portal } from "./modules/portal/routes";
import { DrinksDisplay, DrinksAdmin } from "./modules/leaderboard/routes";
import { SeasonsAdmin } from "./modules/seasons/routes";
import { SignageAdmin, SlotDisplay } from "./modules/signage/routes";
import { Dashboard, StaffLayout, Users } from "./modules/dashboard/routes";

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

      {/* Staff routes — wrapped in StaffLayout so the persistent staff nav (Phase 4b)
          renders above every tool. RequireRole inside each route still gates access. */}
      <Route element={<StaffLayout />}>
        {/* Internal dashboard / admin-shell home — any staff (tiles filter by module) */}
        <Route path="/dashboard" element={<RequireRole role="staff"><Dashboard /></RequireRole>} />

        {/* Trivia host tools — gated on the TRIVIA module grant (0024) */}
        <Route path="/scoring" element={<RequireModule module="trivia"><Trivia.Scoring /></RequireModule>} />
        <Route path="/game/setup" element={<RequireModule module="trivia"><Trivia.GameSetup /></RequireModule>} />
        <Route path="/game/:gameId/questions" element={<RequireModule module="trivia"><Trivia.QuestionEntry /></RequireModule>} />
        <Route path="/game/:gameId/videos" element={<RequireModule module="trivia"><Trivia.VideoEntry /></RequireModule>} />
        <Route path="/game/:gameId/bulk-import" element={<RequireModule module="trivia"><Trivia.BulkImport /></RequireModule>} />
        <Route path="/game/*" element={<RequireModule module="trivia"><Trivia.GameTools /></RequireModule>} />
        <Route path="/teams" element={<RequireModule module="trivia"><Trivia.Teams /></RequireModule>} />
        <Route path="/history" element={<RequireModule module="trivia"><Trivia.History /></RequireModule>} />
        <Route path="/settings" element={<RequireRole role="admin"><Trivia.Settings /></RequireRole>} />

        {/* Module surfaces — each gated on its own grant; seasons stays admin-only */}
        <Route path="/signage" element={<RequireModule module="signage"><SignageAdmin /></RequireModule>} />
        <Route path="/admin/drinks" element={<RequireModule module="drinks"><DrinksAdmin /></RequireModule>} />
        <Route path="/admin/seasons" element={<RequireRole role="admin"><SeasonsAdmin /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole role="admin"><Users /></RequireRole>} />
      </Route>

      {/* Public display routes — no auth */}
      <Route path="/leaderboard" element={<Trivia.Leaderboard />} />
      <Route path="/game-display" element={<Trivia.GameDisplay />} />
      <Route path="/drinks" element={<DrinksDisplay />} />
      <Route path="/signage/s/:slug" element={<SlotDisplay />} />

      {/* Staff sign-in (password + email-OTP) and password recovery landing */}
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Player-facing */}
      <Route path="/checkin" element={<Checkin />} />
      <Route path="/checkin/qr" element={<CheckinQRPage />} />
      {/* Old registration route — /checkin fully replaces it (docs/05); keep a redirect. */}
      <Route path="/add-team" element={<Navigate to="/checkin" replace />} />
      <Route path="/portal/*" element={<RequireAuth><Portal /></RequireAuth>} />

      {/* Fallback — unknown paths land on the public home */}
      <Route path="*" element={<Website.Home />} />
    </Routes>
  );
}

import { useEffect } from "react";
import { Navigate, Routes, Route, useNavigate } from "react-router-dom";

import { supabase } from "./shared/supabaseClient";
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

// Did we land with a password-recovery hash on THIS page load? Supabase's implicit
// recovery link lands as `#…&type=recovery`. When `redirect_to` isn't allow-listed,
// Supabase falls back to the Site URL — so the recovery token can arrive at ANY route
// (the owner hit this on `/`), where the client silently establishes the session and
// strips the hash, leaving the user signed in with no set-password form in sight.
// Captured at module scope (import time), before the client's detectSessionInUrl has a
// chance to consume + strip the hash — a mount-time read could lose that race.
const landedWithRecoveryHash =
  new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery";

/**
 * App-level PASSWORD_RECOVERY safety net. Ensures a recovery session — however it
 * arrived — ends up at `/reset-password` looking at the set-new-password form, not
 * silently signed in on whatever page the token landed on.
 *
 * Two triggers, because the recovery signal can surface either before or after React
 * subscribes:
 *   1) Synchronous capture: if the page loaded with a `type=recovery` hash anywhere but
 *      `/reset-password`, redirect there — preserving the hash so the auth client can
 *      still consume the token if it hasn't yet (never strip the token out from under it).
 *   2) The PASSWORD_RECOVERY auth event, for when the client processes the token after
 *      we've subscribed.
 * Error hashes (`#error=…&error_code=otp_expired`) carry no `type` param and establish no
 * session, so neither trigger fires for them — they fall through to the normal error path.
 */
function useRecoveryRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    if (landedWithRecoveryHash && window.location.pathname !== "/reset-password") {
      navigate("/reset-password" + window.location.hash, { replace: true });
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
        navigate("/reset-password", { replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
    // Run once on mount; navigate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Top-level route map (docs/01, updated by docs/14). The public website owns the
 * site root and renders with zero auth; the internal dashboard lives at /dashboard.
 * Public DISPLAY routes render with zero auth and are safe on an unattended screen
 * (read-only). Staff routes are role-gated.
 */
export function App() {
  useRecoveryRedirect();
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

import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Navigate, Routes, Route, useNavigate } from "react-router-dom";

import { supabase } from "./shared/supabaseClient";
import { RequireAuth, RequireRole, RequireModule } from "./shared/guards";
// The PUBLIC marketing website stays in the main chunk — it's the site root and
// must paint instantly with no chunk round-trip. Everything else (staff tools,
// display screens, auth, portal, check-in) is route-split with React.lazy so the
// public site's initial bundle stays small (docs/12 perf; Phase 3.5 task 3).
import * as Website from "./modules/website/routes";

/**
 * Route-level code splitting. Each non-public surface loads as its own chunk on
 * first navigation. Components that share a `import()` specifier (all the trivia
 * routes, both drinks routes, …) are bundled together and fetched once — Vite
 * dedupes the shared dynamic import, so e.g. every `Trivia.*` route is one chunk.
 *
 * `namedLazy` adapts a named export to React.lazy's default-export contract while
 * preserving the single-specifier grouping (the string literal lives in the
 * per-module loader, which Vite still statically analyses).
 */
function namedLazy<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
) {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType }));
}

const triviaRoutes = () => import("./modules/trivia/routes");
const leaderboardRoutes = () => import("./modules/leaderboard/routes");
const signageRoutes = () => import("./modules/signage/routes");
const dashboardRoutes = () => import("./modules/dashboard/routes");
const registrationRoutes = () => import("./modules/registration/routes");

// Trivia host tools + public display routes (one shared chunk).
const Scoring = namedLazy(triviaRoutes, "Scoring");
const GameSetup = namedLazy(triviaRoutes, "GameSetup");
const QuestionEntry = namedLazy(triviaRoutes, "QuestionEntry");
const VideoEntry = namedLazy(triviaRoutes, "VideoEntry");
const BulkImport = namedLazy(triviaRoutes, "BulkImport");
const GameTools = namedLazy(triviaRoutes, "GameTools");
const Teams = namedLazy(triviaRoutes, "Teams");
const History = namedLazy(triviaRoutes, "History");
const Settings = namedLazy(triviaRoutes, "Settings");
const Leaderboard = namedLazy(triviaRoutes, "Leaderboard");
const GameDisplay = namedLazy(triviaRoutes, "GameDisplay");

// Drinks display + admin.
const DrinksDisplay = namedLazy(leaderboardRoutes, "DrinksDisplay");
const DrinksAdmin = namedLazy(leaderboardRoutes, "DrinksAdmin");

// Signage hub + child pages (edit-rotation, broadcast) + public slot display.
const SignageHub = namedLazy(signageRoutes, "SignageHub");
const EditRotation = namedLazy(signageRoutes, "EditRotation");
const Broadcast = namedLazy(signageRoutes, "Broadcast");
const SlotDisplay = namedLazy(signageRoutes, "SlotDisplay");

// Admin shell (dashboard, persistent staff layout, users).
const Dashboard = namedLazy(dashboardRoutes, "Dashboard");
const StaffLayout = namedLazy(dashboardRoutes, "StaffLayout");
const Users = namedLazy(dashboardRoutes, "Users");

// Seasons admin, player portal, auth, check-in.
const SeasonsAdmin = namedLazy(() => import("./modules/seasons/routes"), "SeasonsAdmin");
const Portal = namedLazy(() => import("./modules/portal/routes"), "Portal");
const Login = namedLazy(() => import("./modules/auth/Login"), "Login");
const ResetPassword = namedLazy(() => import("./modules/auth/ResetPassword"), "ResetPassword");
const Checkin = namedLazy(registrationRoutes, "Checkin");
const CheckinQRPage = namedLazy(registrationRoutes, "CheckinQRPage");

/**
 * Minimal themed fallback while a route chunk loads. Only ever shown for the
 * lazy (non-public) surfaces — the public website is eager — so the terminal
 * register is always appropriate here (staff tools, display screens, auth).
 */
function RouteFallback() {
  return (
    <div
      className="terminal-theme"
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--terminal-green, #33ff66)",
        fontFamily: "'Share Tech Mono', monospace",
        fontSize: "1.1rem",
        letterSpacing: "0.12em",
      }}
    >
      LOADING…
    </div>
  );
}

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
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Public marketing website (docs/14, Phase 3.5) — no auth */}
      <Route path="/" element={<Website.Home />} />
      <Route path="/menu" element={<Website.Menu />} />
      <Route path="/events" element={<Website.Events />} />
      <Route path="/trivia" element={<Website.Trivia />} />
      <Route path="/visit" element={<Website.Visit />} />
      <Route path="/about" element={<Website.About />} />
      <Route path="/history" element={<Website.History />} />

      {/* Staff routes — wrapped in StaffLayout so the persistent staff nav (Phase 4b)
          renders above every tool. RequireRole inside each route still gates access. */}
      <Route element={<StaffLayout />}>
        {/* Internal dashboard / admin-shell home — any staff (tiles filter by module) */}
        <Route path="/dashboard" element={<RequireRole role="staff"><Dashboard /></RequireRole>} />

        {/* Trivia host tools — gated on the TRIVIA module grant (0024) */}
        <Route path="/scoring" element={<RequireModule module="trivia"><Scoring /></RequireModule>} />
        <Route path="/game/setup" element={<RequireModule module="trivia"><GameSetup /></RequireModule>} />
        <Route path="/game/:gameId/questions" element={<RequireModule module="trivia"><QuestionEntry /></RequireModule>} />
        <Route path="/game/:gameId/videos" element={<RequireModule module="trivia"><VideoEntry /></RequireModule>} />
        <Route path="/game/:gameId/bulk-import" element={<RequireModule module="trivia"><BulkImport /></RequireModule>} />
        <Route path="/game/*" element={<RequireModule module="trivia"><GameTools /></RequireModule>} />
        <Route path="/teams" element={<RequireModule module="trivia"><Teams /></RequireModule>} />
        {/* DECISION: the public Route 66 history page claims the bare `/history`
            (docs/14 — the public site owns the root; the task specifies `/history`).
            The staff trivia game-archive tool moves into the existing `/game/*`
            namespace at `/game/history` — consistent with the other host tools and
            already kept out of the index by `Disallow: /game` in robots.txt. Static
            segment ranks above the `/game/*` splat below, so no ordering hazard. */}
        <Route path="/game/history" element={<RequireModule module="trivia"><History /></RequireModule>} />
        <Route path="/settings" element={<RequireRole role="admin"><Settings /></RequireRole>} />

        {/* Module surfaces — each gated on its own grant; seasons stays admin-only */}
        <Route path="/signage" element={<RequireModule module="signage"><SignageHub /></RequireModule>} />
        <Route path="/signage/screens/:slug" element={<RequireModule module="signage"><EditRotation /></RequireModule>} />
        <Route path="/signage/broadcast" element={<RequireModule module="signage"><Broadcast /></RequireModule>} />
        <Route path="/admin/drinks" element={<RequireModule module="drinks"><DrinksAdmin /></RequireModule>} />
        <Route path="/admin/seasons" element={<RequireRole role="admin"><SeasonsAdmin /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole role="admin"><Users /></RequireRole>} />
      </Route>

      {/* Public display routes — no auth */}
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/game-display" element={<GameDisplay />} />
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
    </Suspense>
  );
}

import { Suspense, useEffect, type ComponentType } from "react";
import { Navigate, Routes, Route, useNavigate } from "react-router-dom";

import { supabase } from "./shared/supabaseClient";
import { RequireAuth, RequireRole, RequireModule } from "./shared/guards";
import { lazyWithReload } from "./shared/lazyWithReload";
import { NoIndex } from "./shared/NoIndex";
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
 *
 * It builds on `lazyWithReload` (not React.lazy directly) so a stale-chunk import()
 * failure during a deploy window self-heals with one reload instead of black-framing a
 * TV (PR #42 residue). Every route below is defined via namedLazy, so all inherit it.
 */
function namedLazy<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
) {
  return lazyWithReload(async () => ({ default: (await loader())[name] as ComponentType }));
}

const triviaRoutes = () => import("./modules/trivia/routes");
const leaderboardRoutes = () => import("./modules/leaderboard/routes");
const signageRoutes = () => import("./modules/signage/routes");
const dashboardRoutes = () => import("./modules/dashboard/routes");
const registrationRoutes = () => import("./modules/registration/routes");

/**
 * DISPLAY-ONLY loaders — separate `import()` specifiers so the unattended screen routes get
 * their own chunks and can never be grown by a staff beat (PR #104 reviewer NOTE-6).
 *
 * `/signage/s/:slug` is the bar TVs. It used to share `signageRoutes` with SignageHub,
 * EditRotation and the three /media/* pages, so every TV downloaded the whole staff console
 * as dead code. Shared LEAF modules (DisplayCanvas, supabaseClient, the trivia boards, the
 * signage templates) still land in chunks both sides import — that is correct; what must
 * never recur is a staff PAGE riding the TV's download. See modules/signage/displayRoutes.tsx.
 */
const signageDisplayRoutes = () => import("./modules/signage/displayRoutes");
const leaderboardDisplayRoutes = () => import("./modules/leaderboard/displayRoutes");

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
// DECISION: GamePreview deliberately STAYS on the trivia chunk. It is the host's
// off-screen dual-board preview (a laptop, opened for a few minutes during setup), never a
// mounted screen, and it renders the very boards — LeaderboardBoard / GameDisplayBoard —
// that the host tools around it already pull in. Splitting it would buy a host no bytes and
// would cost a second round-trip on a page that is always reached from those same tools.
const GamePreview = namedLazy(triviaRoutes, "GamePreview");

// Drinks: the public board loads from its own display-only module (see the loader comment
// above); the admin page stays on the staff chunk.
const DrinksDisplay = namedLazy(leaderboardDisplayRoutes, "DrinksDisplay");
const DrinksAdmin = namedLazy(leaderboardRoutes, "DrinksAdmin");

// Signage hub (consolidated — Events & Broadcast tabs folded in) + legacy queue redirect.
const SignageHub = namedLazy(signageRoutes, "SignageHub");
const EditRotation = namedLazy(signageRoutes, "EditRotation");
// BAR OPS ▸ SLIDES (Beat 6 PR 4) — same staff chunk as the hub: it mounts the hub's own
// ItemEditor and reads the hub's own queries. NEVER the display chunk.
const Slides = namedLazy(signageRoutes, "Slides");

// The bar TVs. Own chunk, own module — nothing staff-facing may join it.
const SlotDisplay = namedLazy(signageDisplayRoutes, "SlotDisplay");

// MEDIA, promoted out of the hub (UX overhaul Beat 4) — same chunk as the hub: these pages
// mount the hub's own media panels + slide-overs.
const MediaLibrary = namedLazy(signageRoutes, "MediaLibrary");
const MediaPlaylists = namedLazy(signageRoutes, "MediaPlaylists");
const MediaScreens = namedLazy(signageRoutes, "MediaScreens");

// Admin shell (dashboard, persistent staff layout, users).
const Dashboard = namedLazy(dashboardRoutes, "Dashboard");
const StaffLayout = namedLazy(dashboardRoutes, "StaffLayout");
const BroadcastMoved = namedLazy(dashboardRoutes, "BroadcastMoved");
const EventsMoved = namedLazy(dashboardRoutes, "EventsMoved");
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
        {/* The slide library as its own page (Beat 6 PR 4). Gated on the hub's own grant —
            it reads and writes signage_items exactly as the hub's embedded library did. A
            classic device is redirected back to /signage by the page itself. */}
        <Route path="/signage/slides" element={<RequireModule module="signage"><Slides /></RequireModule>} />
        {/* Legacy per-screen editor bookmark — opens the hub's QUEUE slide-over then normalizes the URL. */}
        <Route path="/signage/screens/:slug" element={<RequireModule module="signage"><EditRotation /></RequireModule>} />
        {/* Retired tabs (folded into the hub). CLASSIC redirects silently, exactly as it
            always has; the v2 shell says where the tool went instead (audit finding #6). */}
        <Route path="/signage/broadcast" element={<RequireModule module="signage"><BroadcastMoved /></RequireModule>} />
        <Route path="/signage/events" element={<RequireModule module="signage"><EventsMoved /></RequireModule>} />
        {/* MEDIA (Beat 4) — v2-only pages for the surfaces that used to sit inside the hub.
            Gated on the SAME grant the hub is gated on: MEDIA has no module of its own, and
            every one of these pages reads/writes signage tables. A classic device that lands
            here is redirected back into the hub by the page itself. */}
        <Route path="/media" element={<Navigate to="/media/library" replace />} />
        <Route path="/media/library" element={<RequireModule module="signage"><MediaLibrary /></RequireModule>} />
        <Route path="/media/playlists" element={<RequireModule module="signage"><MediaPlaylists /></RequireModule>} />
        <Route path="/media/screens" element={<RequireModule module="signage"><MediaScreens /></RequireModule>} />
        <Route path="/admin/drinks" element={<RequireModule module="drinks"><DrinksAdmin /></RequireModule>} />
        <Route path="/admin/seasons" element={<RequireRole role="admin"><SeasonsAdmin /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole role="admin"><Users /></RequireRole>} />
      </Route>

      {/* Public display routes — no auth. The bar TVs run on signage kiosk slugs
          (/signage/s/:slug); trivia reaches a screen when the host ARMS it in Scoring
          (signage game-mode takeover). The old auto-resolving /leaderboard + /game-display
          TV routes are retired — /game/preview is the host's off-screen dual-board preview. */}
      {/* Dual-display screen preview (trivia-sandbox) — both boards side by side, no auth. */}
      <Route path="/game/preview" element={<GamePreview />} />
      {/* Legacy public drinks board — frozen (decision E). The only change is a noindex
          meta tag injected by the wrapper; DrinksDisplay itself is untouched. */}
      <Route path="/drinks" element={<NoIndex><DrinksDisplay /></NoIndex>} />
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

# 04 — Module: Atomic Pub Trivia (port + fixes)

Source: `trivia-scoreboard-32575` export. Feature set is good; port it, do not redesign gameplay. Wednesday-night workflows (Ronnie's muscle memory) must survive intact: GameSetup → QuestionEntry/BulkImport/VideoEntry → Scoring ↔ GameDisplay/Leaderboard → History.

## Audit findings → required fixes (file:line refs against export)

**SEC-1 (critical): client-side PIN auth.** AddTeam.tsx fetches `select("*")` on teams (incl. pin_code, contact_email) and compares PIN in browser (AddTeam.tsx:113). Teams.tsx:441 displays PINs in the UI. → Superseded entirely by Registration v2 (05). During port, remove PIN display from Teams admin; PINs verified only via edge function.

**SEC-2 (critical): open RLS + anon writes.** Any client can UPDATE/DELETE any row (e.g., AddTeam authenticated path updates teams directly). → Apply 02's RLS. Host mutations require host role.

**ARCH-1: sync chaos.** GameDisplay runs Realtime + 5s poll + 5s refetchInterval simultaneously (GameDisplay.tsx:87,115,120). Leaderboard uses NO realtime — four queries × 5s polling (~48 req/min/screen) (Leaderboard.tsx:110,156,174,191). → One pattern (01): realtime subscription invalidates queries; 30–60s poll fallback only.

**ARCH-2: Scoring.tsx god component.** 3,285 lines, 30 useState, 29 queries/mutations; duplicates team-edit UI also present in Teams.tsx. → Decompose during port: `RoundGrid`, `QuestionPanel` (wraps existing QuestionDisplay), `VideoControls`, `LeaderboardToggle`, `TeamEditorDialog` (single shared component used by Scoring AND Teams), hooks `useActiveGame`, `useGameScores`, `useDisplayState`. Behavior-identical; structure only. This is the highest-regression-risk work — do it with the parity checklist below.

**PERF-1:** flicker animation runs on /leaderboard 24/7 (App.tsx excludes only /game-display). → Flicker opt-in per route; off on displays (01).

**QUAL-1:** console.log on every Leaderboard render (every 5s on signage). Strip all debug logging; add a tiny `log()` util gated on `import.meta.env.DEV`.

**QUAL-2:** QR component is a placeholder that tells you to use an external generator (TeamRegistrationQR.tsx). → Render a real QR (lib: `qrcode.react`), pointing at `/checkin?source=qr`.

**QUAL-3:** QR-arrival detection via `document.referrer === ''` (AddTeam.tsx:36). → `?source=qr` param.

**QUAL-4:** score totals assembled client-side from 4 polled queries. → Use a `game_scoreboard(game_id)` SQL function/view; one query, atomic.

**QUAL-5:** dual lockfiles (pnpm-lock.yaml + yarn.lock). → pnpm only.

**QUAL-6:** `public/` contains a 14MB .pptx and a fully extracted pptx tree — build artifacts committed by accident. Exclude from port.

## Edge functions to port

- `parse-powerpoint` — unzips .pptx, extracts rounds/questions/picture-round images. Port as-is; re-test against one of Ronnie's real decks.
- `analyze-image` — Gemini 2.5 Flash vision for picture-round answers. Needs owner's own `GEMINI_API_KEY`. Port as-is.
- `save-theme-settings` — trivially small; likely fold into direct table writes under new RLS.

## Parity checklist (must all pass before cutover — test with a fake game)

- [ ] Create game, rounds auto-generated incl. bonus types (standard + three-chance)
- [ ] Bulk import a real PowerPoint: round names, questions, answers, picture images land correctly
- [ ] Question entry manual path; video URL entry with YouTube preview
- [ ] Scoring grid entry, wildcard, tiebreaker, round complete → answer key shows previous round
- [ ] GameDisplay syncs question nav + answer reveal + picture rounds + video show/hide with <1s latency
- [ ] Leaderboard: scores show/hide toggle, tie indicator (incl. custom icon), countdown before start, Game Over on final-round completion
- [ ] History page reflects completed game
- [ ] Settings/theme customizations apply
- [ ] Two displays + host on bar wifi simultaneously, one hour, zero desyncs

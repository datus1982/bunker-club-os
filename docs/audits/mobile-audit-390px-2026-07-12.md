# Mobile Usability Audit — Staff UI @ 390×844 (2026-07-12)

Independent audit for Phase 4c (admin UI mobile fixes). Viewport 390×844, Chromium (Claude Browser),
session user `mobile-audit@bunker.test` (admin, all modules — deleted post-audit). Display routes
(/leaderboard, /game-display, /drinks board) and /checkin + /portal excluded per Phase 4c scope.
To be MERGED with the owner's own reported issues before the fix plan is finalized.

---

## GLOBAL — StaffNav (`modules/dashboard/StaffNav.tsx`)

**BROKEN — Nav consumes 404px (48%) of the viewport as a sticky header**

The `<nav>` uses `display: "flex", flexWrap: "wrap"` with no row limit or collapse mechanism. At 390px
with 9 items (HOME, TRIVIA, GAME SETUP, TEAMS, HISTORY, DRINKS, SEASONS, USERS + brand link +
VIEWING AS ADMIN label + SIGN OUT), everything wraps into ~8 rows. Measured height: **404px**. Every
staff route loses half its screen to the nav before content starts.

Secondary issues:
- All nav link `<a>` elements: **37px tall** (< 44px minimum). `padding: "4px 10px"`, `fontSize: 18`.
- "GAME SETUP" NavLink wraps to two lines (no `whiteSpace: "nowrap"`), making it 64px tall while others are 37px — uneven row heights.
- "▚ BUNKER OS" brand link: **33px tall** (< 44px). `fontSize: 22`, `padding: 0`.
- "VIEWING AS ADMIN" label and SIGN OUT button appear below the link rows, not alongside them, producing a confusing visual order.

Source: `StaffNav.tsx:50-77`. The outer nav `flexWrap: "wrap"` is the root cause; the inner
`<div style={{ flex: 1, flexWrap: "wrap" }}>` compounds it.

**Desktop note**: At 800px+ the nav renders as a single horizontal bar — correct. Any mobile fix must
use a media query or a hamburger/collapse approach; changing the flex model unconditionally would
break the desktop layout.

---

## /login (`modules/login/Login.tsx`)

No horizontal overflow (scrollWidth 390 = clientWidth 390).

- **POLISH**: The "EMAIL CODE" tab label wraps to two lines inside the button ("EMAIL" / "CODE") — awkward vs. a single-word label.
- Tap targets: PASSWORD (117×90px), EMAIL CODE (117×90px), SIGN IN (242×62px), Forgot-password link (242×80px) — all adequate.
- **POLISH**: "Forgot password? Send a reset link →" is styled as a button but reads like secondary text; weak hierarchy vs. the sign-in button.

---

## /dashboard (`modules/dashboard/Dashboard.tsx`)

No horizontal overflow. Body scrollHeight: 2725px (long page due to nav + tiles stacked one column).

**AWKWARD — Small inline action links**
- "CREATE GAME →" jump link: **130×35px** — height < 44px. Source: `Dashboard.tsx:100`, `jumpLink` style (`padding: "4px 10px"`).
- Display tile screen links ("LEADERBOARD ↗", "GAME DISPLAY ↗", "DRINKS ↗"): **~80–125×34px** — height < 44px. Source: `Dashboard.tsx:275`, `screenLink` style (`padding: "4px 8px"`).

**AWKWARD — Header stacking**: header `flexWrap: "wrap"` stacks the title block (94px) and the
clock/date div (69px, right-aligned) — the clock looks orphaned. Header total: 175px.

**POLISH — Status grid collapses to 1 column** (`repeat(auto-fit, minmax(200px, 1fr))` at 310px available)
— all 4 status panels stack; lots of scrolling to reach the module grid.

---

## /scoring (`modules/trivia/Scoring.tsx`, `QuestionPanel.tsx`, `RoundGrid.tsx`)

**BROKEN — QuestionPanel causes page-level horizontal overflow (scrollWidth: 792px)**

`QuestionPanel.tsx:86`:
```js
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
```
Without `minmax(0, 1fr)`, grid items keep `min-width: auto`. The Question Projector column contains a
`<select>` (346px — sized to its widest option) and a row of 4 buttons ("◀ PREV", "NEXT ▶",
"▣ HIDE QUESTION", "◎ SHOW ANSWER"). The column expands to 446px, extending to x=792. The entire
Question Projector panel is off-screen with no scroll affordance — simply clipped.
The inner Answer Key nests another `gridTemplateColumns: "1fr 1fr"` (line 95) — same vulnerability.
Measured: scrollWidth 792, clientWidth 390, 402px overflow.

**AWKWARD — RoundGrid horizontal scroll**: the `<table>` wrapper `overflowX: "auto"` (line 53) correctly
contains it, but table scrollWidth is 971px in a 326px container — 645px of in-table scrolling to reach
later rounds and the edit/remove buttons. No visual scroll indicator on mobile.

**AWKWARD — Small tap targets in RoundGrid**
- Round header "✓ DONE" / "OPEN" buttons: **80×40px** / **56×40px** (height < 44px). `RoundGrid.tsx:67`, `padding: "1px 8px"`.
- Team edit (✎) button: **32×42px** (width < 44px). `RoundGrid.tsx:148`.
- Team delete (🗑) button: **42×42px**. `RoundGrid.tsx:149`.

**AWKWARD — Game status buttons**: START / PAUSE / STOP (`btnGhost`, `padding: "8px 14px"`, `fontSize: 22`) ≈ **38px tall**. `Scoring.tsx:85-91`.

**AWKWARD — Native checkbox in ScoreDialog**: wildcard checkbox renders at browser-default **13×13px**. `RoundGrid.tsx:313`, `checkRow` from `ui.tsx:56`.

---

## /teams (`modules/trivia/Teams.tsx`, `TeamEditorDialog.tsx`)

No horizontal overflow.

- **AWKWARD — h1 `fontSize: 48` + `alignItems: "baseline"`** (`Teams.tsx:65-71`): "TEAM ROSTER" wraps to two lines; "+ ADD TEAM" aligns to its baseline and reads as a 130px-tall row. Tappable, but jarring.
- **AWKWARD — TeamEditorDialog needs 135px internal scroll** to reach CANCEL/SAVE (content 874px in an 88vh/739px container; `overflowY: "auto"` in `ui.tsx:83`) — no scroll indicator.
- **AWKWARD — Native checkboxes 13×13px** ("REGULAR TEAM"; label text expands the tap area only if the user knows to tap it).

---

## /history (`modules/trivia/History.tsx`)

No horizontal overflow. "VIEW BOARD →" buttons 276×56px — fine.
- **AWKWARD** — same baseline-alignment heading pattern as Teams; heading wraps ("GAME" / "HISTORY") and "← DASHBOARD" renders 72px tall.

---

## /game/setup (`modules/trivia/GameSetup.tsx`)

**BROKEN (minor) — Date input forces grid overflow (scrollWidth: 393px)**

`Row` at `GameSetup.tsx:318`: `gridTemplateColumns: "1fr 1fr"`. The date input's browser-enforced
minimum width exceeds its `1fr` column (cols 171.5px + 144px + 16px gap = 331.5px in a 266px container;
Section `padding: 20` inside outer `padding: 40`). "START TIME" extends to x=394.
Same pattern at line 235 (`"1fr 1fr 1fr"` for three-chance bonus rounds) — latent, triggers when a bonus is added.

- **AWKWARD — outer `padding: 40`** (80px horizontal) leaves only 310px of content — tightest staff route. `GameSetup.tsx:169`.
- **AWKWARD — native checkboxes 13×13px** ("PLAYOFF GAME" line 196; regular-team grid line 270).

---

## /admin/seasons

**BROKEN (minor) — STARTS/ENDS date inputs overflow (scrollWidth: 405px)** — same root cause as
GameSetup (`"1fr 1fr"` + date inputs); ENDS extends to x=405.

---

## /admin/drinks (`modules/leaderboard/DrinksAdmin.tsx`)

**BROKEN (minor) — Rotation group row overflows on long names (scrollWidth: 393px)**

`DrinksAdmin.tsx:129-135`: flex row `<span style={{ flex: 1 }}>{g.name}</span>` + ▲ ▼ ● ON / REMOVE
buttons. The span lacks `min-width: 0`; long names (e.g. "Signature Cocktails") push REMOVE 3px off-screen.

- **AWKWARD — ▲/▼ reorder buttons 40px wide** (`btn`, `padding: "6px 12px"`). Height 50px OK.
- **POLISH — heading wraps to 3 lines** ("DRINKS / BOARD — / CONFIG" at `fontSize: 40`).

---

## /admin/users (`modules/dashboard/Users.tsx`)

No page-level overflow (table correctly wrapped in `overflowX: "auto"`).

- **AWKWARD — table `minWidth: 720`** (line 114) in a 359px container → 476px of horizontal scrolling; only EMAIL + part of ROLE visible; no scroll indicator on iOS.
- **AWKWARD — module checkboxes 20×20px** (`Users.tsx:144`, explicit) — no surrounding label to expand tap area.
- **AWKWARD — role select 82×36px** (height < 44px).

---

## Summary table

| Route | BROKEN | AWKWARD | POLISH |
|---|---|---|---|
| **StaffNav (all routes)** | nav=404px, all links 37px | — | — |
| /login | — | — | EMAIL CODE tab label wraps |
| /dashboard | — | jump links 34-35px; screen links 34px | header stacks; clock orphaned |
| /scoring | QuestionPanel 2-col overflows 402px | RoundGrid horiz scroll; DONE/OPEN 40px; ✎ 32px; 🗑 42px; status btns 38px; checkbox 13px | — |
| /teams | — | header baseline-align (130px row); dialog scroll 135px; checkbox 13px | — |
| /history | — | header baseline-align | — |
| /game/setup | date Row overflows 4px | padding 80px; checkbox 13px | — |
| /admin/seasons | date grid overflows 15px | — | — |
| /admin/drinks | group row overflows 3px | ▲▼ 40px wide | heading wraps 3 lines |
| /admin/users | — | table 720px min in 359px; checkboxes 20px; role select 36px | — |

---

## Common root causes (for fix planning)

1. **`gridTemplateColumns: "1fr 1fr"` without `minmax(0, 1fr)`** — QuestionPanel (BROKEN), GameSetup Row (BROKEN), Seasons create form (BROKEN), answer-key inner grid. Fix: `minmax(0, 1fr)` everywhere, or `min-width: 0` on grid children.
2. **StaffNav `flexWrap: "wrap"` with no mobile collapse** — the single largest usability issue. Fix: hamburger/drawer behind `@media (max-width: 600px)`, or compact collapsed row. Must not change desktop (single bar at 800px+).
3. **Flex rows with fixed-size buttons + `flex: 1` span lacking `min-width: 0`** — DrinksAdmin group rows.
4. **Native checkboxes unstyled (13×13px)** — TeamEditorDialog, GameSetup, ScoreDialog. Fix: sized checkbox styling and/or full-row `<label>` tap targets.
5. **Heading `fontSize` 40–48 + `alignItems: "baseline"` + no wrap strategy** — Teams, History, DrinksAdmin header rows.
6. **Route container `padding: 32–40px`** — 64–80px horizontal at 390px leaves 310–326px of content; a mobile-reduced padding buys ~50px everywhere.

# Bunker OS — Polish arc 2: trivia tokens + toggle, motion/material layer, Media posters (OKUDA, 2026-09-12)

*Design specialist's spec, dispatched by Marvin off Stephen's 2026-09-12 brief
(`~/Marvin/decisions/2026-09-12-bunker-os-polish-arc-2.md`), continuing the 2026-09-11 pass
(`02-polish-pass-audit-2026-09-11.md`, shipped as Beat 6 / PRs #109–#112, LIVE in prod). House:
Bunker (`~/.claude/skills/bunker-design-doctrine`), amended 2026-09-11 (strict terminal law
lifted on staff surfaces) and again 2026-09-12 (trivia STAFF surfaces enter scope behind a
toggle; TVs/game displays/kiosk slugs stay frozen). RULE #1 stands throughout: additive,
behind a switch, no schema change, TVs untouched, screenshot-verified at 390 + 1280 with real
data.

Read against the live token sheet (`apps/web/src/theme/staff-tokens-v2.css`, `shared/ui/
tokens.ts`, `shared/ui/ConfirmDialog.tsx`) and the live trivia/media code
(`modules/trivia/{routes,Scoring}.tsx`, `modules/signage/{MediaPanels,useMediaAdmin}.tsx`),
not just the audit prose — every file/line cited below was read this pass. Real-data
screenshots: `~/Marvin/projects/bunker/beat6-shots/pr1-scoring-freeze-v2-{390,1280}.png`,
`pr1-medialibrary-v2-{390,1280}.png` (today's shipped state); round-1 mockup + shots at
`04-polish-arc2-round1-mockup.html` / `~/Marvin/projects/bunker/polish-arc2-round1-shots/`.

---

## A. Trivia staff surfaces — token adoption + toggle

### A0. What's true today (confirmed by reading the code, not just the audit)
- `modules/trivia/routes.tsx` exports `Scoring`, `Teams`, `History`, `GameSetup`,
  `QuestionEntry`, `VideoEntry`, `BulkImport` with **zero `useUiVersion` branching** —
  unlike `Users`/`DrinksAdmin`/`SignageHub`, trivia has no `*V2.tsx` sibling at all. It is not
  "frozen behind a check," it simply has no v2 rendering path to freeze.
  `modules/seasons/SeasonsAdmin.tsx` is the same shape (plain, no v2 variant).
- Because `StaffLayout` (the shell picker) wraps whichever page router hands it, a device
  already on `bunker.ui_version=v2` sees trivia pages rendered **inside the v2 shell chrome**
  (top nav, BACK TO CLASSIC) with the **page body still classic green terminal** —
  confirmed visually in `pr1-scoring-freeze-v2-1280.png`: BUNKER OS / HOME / GAMES / BAR OPS
  / MEDIA / SYSTEM nav bar, then a byte-for-byte classic green `SCORING` console below it.
  This is `staff-tokens-v2.css`'s own documented reason for scoping every rule to
  `[data-st-page]` / `.sv2-nav` / `.st-sheet` instead of `.staff-v2` broadly (file header,
  "WHY THE SCOPE IS NOT THE WHOLE SHELL") — trivia pages carry none of those three hooks, so
  not one existing v2 rule touches them. **This means the token sheet is already written to
  extend to trivia for free — the only missing piece is trivia pages emitting `data-st-page`
  when their own toggle says v2.** No second stylesheet is needed.
- `Scoring.tsx` sets `fontFamily: "'VT323','Share Tech Mono',monospace"` inline on its root —
  VT323 leads. Per the ratified 2026-07-13 type ruling ("VT323 is hard to read on staff
  UI — he said so"), this was already off-doctrine before this arc; a v2 Scoring should drop
  VT323 entirely in favor of Share Tech Mono (display/heading) + JetBrains Mono (body/data),
  same as every other v2 staff surface — not a new call, just finishing an old one.
- The CRT scanline/vignette suppression rule already handles trivia correctly with zero
  changes: `staff-tokens-v2.css:520-532`'s `:has([data-st-page])` selector only fires on a
  `.terminal-theme` root that is *currently hosting* a tokened page. A v2-toggled Scoring
  page emitting `data-st-page` gets the scanline OFF automatically, the same rule already
  shipped for Users/Media/SignageHub — nothing to add here either.

### A1. The toggle — proposal (storage not yet decided; two options, recommendation first)

**Recommended: a second, independent localStorage key, same mechanism as `useUiVersion`.**

```
KEY:     bunker.trivia_ui_version
VALUES:  "classic" | "v2"   (default "classic" — RULE #1, nobody's Scoring changes look
                              until they opt in, exactly like the main switch)
```
Implemented as a second hook, `useTriviaUiVersion()`, copy-pasted from `shared/
useUiVersion.ts` verbatim (same private-mode try/catch, same in-tab subscriber set, same
cross-tab `storage` listener) — this is "a second key, not a third mechanism": the read/
write/subscribe shape is identical, so a future maintainer already knows how it works.

**Composition with `bunker.ui_version`:** the trivia toggle is only OFFERED, and only takes
effect, when the device is already on the main `v2` shell. Reasoning: a classic-shell device
has never seen `.staff-v2`/token CSS anywhere, so "try new trivia layout" on a classic device
would be introducing the token system through a side door with no way to see the rest of it
first — confusing, and it doubles the classic-parity surface QA has to prove (today's Beat 3
proof method — PNG sha256 + innerHTML diff — assumes classic is one unconditional shape).
Concretely: `TriviaLayout` (a new thin wrapper, mirroring `StaffLayout`'s own pattern) reads
BOTH hooks; renders classic Scoring/GameSetup/Teams/History/Seasons when
`ui_version !== "v2"` **or** `trivia_ui_version !== "v2"`; renders the v2-token page (with
`data-st-page`) only when both are `"v2"`. A classic device therefore never even sees the
trivia toggle control — same "no dead switches" principle the main toggle already follows
(it renders in both shells "so there is always a way back").

**Alternative (not recommended): a third value on the existing key** (e.g.
`"v2"` → `"v2-full"` meaning "v2 shell + v2 trivia"). Rejected because `UiVersion` is typed
`"classic" | "v2"` and consumed in ~10 files (`grep` count above) — widening that union
touches every one of them for a feature that only trivia cares about, versus a new hook that
touches nothing existing. Named per the dispatch's instruction to propose, not decide —
Stephen letters this at §E, decision A.

**Where the switch lives:** a small control in the GAMES ▸ TRIVIA sub-nav row (the same row
that already carries SCORING · GAME SETUP · TEAMS · HISTORY · SEASONS, visible in
`pr1-scoring-freeze-v2-1280.png`'s second nav strip), styled identically to
`UiVersionToggle.tsx` (dashed 1px border, transparent fill, 44px tap floor, quiet-by-design)
but reading **"TRY THE NEW TRIVIA LOOK →" / "← BACK TO CLASSIC TRIVIA"**. It renders on every
trivia page (Scoring/GameSetup/Teams/History/Seasons) in the same nav strip so a host can flip
back mid-task without hunting for the control — same reasoning as the main toggle rendering
in both shells.

**What a classic device sees:** nothing new anywhere. No trivia toggle control (the shell
around it is classic and never offers it), no token CSS, byte-identical trivia pages — the
existing Beat 3 classic-parity proof method (PNG sha256 + innerHTML, from a `main` worktree)
applies unchanged.

### A2. Per-surface adoption — what changes, what must not

**Scoring (host desk) — desktop-primary, laptop at the bar, live game in progress.**
This is the highest-stakes surface in the whole arc: it is read live, in front of a room, by
a host (Ronnie) running a rehearsed choreography (`trivia-host-workflow` memory — hide
scoreboard while entering scores, reveal per round, final reveal; fixed-size question boxes
that must not reflow as content changes). **Zero-surprise is the design constraint, not a
suggestion.**

Adopts (look only, same DOM structure, same button positions):
- Ground/elevation tiers (`--st-ground` page, `--st-surface-1` for the RoundGrid cells and
  the answer-key/video panels, `--st-surface-2` for the control-line container).
- White-alpha text tiers — green stops being the text color for labels/body; reserved for
  the ONE place it already means something specific: the existing `.st-live` class
  (`--st-accent-live: #00FF41`, "RESERVED: a true LIVE dot/label only" per the token sheet's
  own comment) is the exact, already-built hook for `TriviaScreensBar`'s **"● LIVE ON
  SCREENS"** state — this is not a new design decision, it's the existing reserved-green rule
  finding its first trivia use.
- Calmed accent `#7FE6A8` for the non-live interactive chrome (START, QUESTIONS/VIDEOS/
  IMPORT/TEAMS/HISTORY links, the DISPLAY/BOARD stage-control pills when selected).
- Amber-calm `#E8B04B` for the "○ OFF — NOT ON SCREENS" and "◐ ARMED · …" states (replacing
  the current raw `--terminal-amber, #ffb000` in `TriviaScreensBar`) — same u-amber utility
  class, now re-pointed by the token sheet's own re-declaration (`staff-tokens-v2.css:258`),
  no code change needed beyond adding `data-st-page`.
- Danger red `#FF5A5A` for REMOVE TEAM / CLEAR EVERYTHING / END GAME (`btnDanger` already
  used for all three — same free ride via `.st-btn-danger`).
- Hairline (`1px rgba(255,255,255,.08)`) replacing the 2px green `.terminal-border`/
  `.terminal-separator` rectangles — already a drop-in via the token sheet's own
  `.terminal-border`/`.terminal-separator` re-declarations (`staff-tokens-v2.css:354-364`).
- 6px radius on cards/inputs/buttons, pill radius on chips (free via the same mechanism).
- Type: drop VT323, adopt Share Tech Mono (display/heading: "SCORING" H1, round labels) +
  JetBrains Mono (body/data: team names, the tabular score grid — `.st-mono`'s
  `font-variant-numeric: tabular-nums` is a genuine upgrade for a numbers-heavy grid VT323
  never had).
- Motion: hover/press feedback only (§B below) — no page-transition or mount animation on
  Scoring itself; it is a single persistent page during a live game, and per the
  host-workflow memory the room should never see anything "settle."

Does **NOT** change (named explicitly, per the dispatch):
- **Stage controls**: DISPLAY (JOIN QR / Q&A / VIDEO / UP NEXT / THANKS) and BOARD (JOIN QR /
  TABULATE / STANDINGS / FINAL) keep their exact button set, order, and independent-control
  behavior. These are the manual choreography controls named in the card — nothing about
  which buttons exist or what they do moves.
- **The arm bar** (BAR SCREENS: armed/off + PUT/TAKE TRIVIA ON/OFF SCREENS + END GAME) keeps
  its position (directly under the header, above the control line), its wording, and its
  "unmissable" sizing intent.
- **RoundGrid** fixed-size score cells and the desktop-density `.scoring-page` rule — no
  layout/reflow change, only fill/border/text-color swaps inside the same cells.
- **Button copy stays UPPERCASE, verb-first, exactly as shipped** (START, PUT TRIVIA ON
  SCREENS, END GAME, SCORE ROUND, HIDE ANSWER…) — this is a **deliberate, named deviation**
  from §B's general case rule (Body-role strings drop to sentence case). Rationale: this is
  muscle-memory copy read at a glance mid-show by a host who has run this exact console for
  months; changing case or wording here is a legibility experiment on a live product with an
  audience, which is exactly what "zero-surprise" rules out. Recommend Label-role tokens
  render UPPERCASE (unchanged from §B) and Body-role button copy on Scoring/GameSetup/Teams/
  History specifically is **exempted** from the sentence-case migration — every OTHER v2
  surface (Users, Media, SignageHub) keeps the shipped case rule as-is.
- **44px tap floor** — already met, no change.

**Game Setup, Teams, History, Seasons — between-game admin tasks, not live-in-front-of-a-
room.** These carry none of Scoring's "an audience is watching right now" constraint — a
host building rounds or checking a roster before doors open is doing exactly the kind of task
Users/Media/DrinksAdmin already do in full v2. Recommend these FOUR adopt the **complete**
§B system with no carve-outs: full elevation/text/accent/hairline/radius set, motion budget
(§B below), sentence-case body copy per the standard case rule, task-named sub-nav labels
where a bare noun exists today. The one shared rule: Teams/History/GameSetup reuse
`TeamEditorDialog`/`Modal` idioms already present — no new dialog primitive invented here;
where they overlap with `ConfirmDialog`-worthy destructive actions (e.g. GameSetup deleting a
round), apply the same D1 danger pattern already shipped for Users/Top Sellers (verb-named
buttons, red budget, `ConfirmDialog`, no hold-to-confirm this arc — matching Beat 6's own
N7/N10 ruling to keep one confirm tier system-wide for now).

**Frozen, unconditionally, regardless of the toggle:** everything under §D of the 2026-09-11
audit — `/game-display`, `/leaderboard`, `/signage/s/:slug`, `/drinks`, `/game/preview`'s
audience-facing boards, every TV render path, every kiosk slug. None of those files are
touched by anything in this document. If a future ask tried to route trivia-toggle state
into any of them, that is out of RULE #1 and stops here, unbuilt.

---

## B. Motion + material layer — v2 staff surfaces (trivia included, once toggled)

Ties entirely to tokens already in `staff-tokens-v2.css` (`--st-motion-hover: 140ms`,
`--st-motion-sheet: 180ms`, `--st-motion-expand: 160ms`, `--st-ease: ease-out`) — **no new
color, no new duration constant invented.** Where a rule below needs a duration the shipped
scale doesn't name, it reuses the nearest existing one rather than adding a fourth.

### Press / hover feedback
- **Hover** (`@media (hover:hover)` — skip on touch, since a touch device has no hover
  state to fake): background steps up one elevation tier or to `rgba(255,255,255,0.06)` on a
  bordered control — this is the exact rule already shipped
  (`staff-tokens-v2.css:146-154`). Nothing to add.
- **Press, bound to `:active` (fires on pointer-down, not on click/release)** — this is the
  one concrete, load-bearing idea to import from the apple-design slice ("respond on
  pointer-down, not release"): add `:active` rules beside the existing `:hover` ones, same
  file, same selectors —
  ```css
  .terminal-theme.staff-v2 [data-st-page] button:active,
  .terminal-theme.staff-v2 [data-st-page] a:active,
  .terminal-theme.staff-v2 .sv2-nav button:active,
  .terminal-theme.staff-v2 .st-sheet button:active {
    background: rgba(255, 255, 255, 0.1) !important;
    transition-duration: 80ms; /* faster than the 140ms hover — press must feel instant */
  }
  .terminal-theme.staff-v2 [data-st-page] .st-btn-primary:active,
  .terminal-theme.staff-v2 .st-sheet .st-btn-primary:active { opacity: 0.82; }
  .terminal-theme.staff-v2 [data-st-page] .st-btn-danger:active,
  .terminal-theme.staff-v2 .st-sheet .st-btn-danger:active { background: rgba(255,90,90,0.18) !important; }
  ```
  **No `transform: scale()`** — the shipped budget is explicitly "opacity/background only"
  (`02-polish-pass-audit-2026-09-11.md` §B motion budget); a scale-on-press would be a new
  motion primitive this arc doesn't have standing to add. This is the one place this spec
  narrows the apple-slice's own suggestion (`:active { transform: scale(.97) }`) to fit the
  house's already-ratified budget.
- Disabled: unchanged (`opacity: 0.4`, no hover/press transition — already shipped).

### Page / drawer / sheet enter + exit (same path, both directions)
- **Sheets/drawers** (`ConfirmDialog`, `SlideOver`, the mobile `.sv2-drawer`): enter is
  already `--st-motion-sheet` (180ms) single-axis, per §B. This arc adds the **exit**, which
  the shipped sheet only implements via instant unmount today — same axis, mirrored, faster
  (120ms ease-in, "leaving should feel quicker than arriving," a standard easing convention,
  not a new number: `--st-motion-hover` already exists at a close-enough value if a
  dedicated exit token is judged not worth adding — recommend reusing 140ms rather than a
  5th constant).
  ```css
  @keyframes st-sheet-enter { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform: translateY(0);} }
  @keyframes st-sheet-exit  { from { opacity:1; transform: translateY(0);} to { opacity:0; transform: translateY(8px);} }
  .st-sheet .st-panel[data-state="entering"] { animation: st-sheet-enter var(--st-motion-sheet) var(--st-ease); }
  .st-sheet .st-panel[data-state="exiting"]  { animation: st-sheet-exit 140ms ease-in; }
  ```
  A center-anchored dialog (`ConfirmDialog`) has no edge to slide from, so its "single axis"
  is a small Y-rise (8px) + opacity, not a horizontal slide — a directional drawer
  (`.sv2-drawer`, the mobile nav) uses the SAME keyframes with `translateX` instead of
  `translateY`, sliding from whichever edge it's anchored to.
- **Menus/popovers** (a future `OverflowMenu` per §C6 of the 09-11 audit, or any `<select>`-
  replacement dropdown): `transform-origin` pinned to the trigger's corner — a ⋯ button in a
  row's top-right opens its menu from the top-right, not the geometric center of the menu
  box. Positioning rule, not a new duration.

### List / card mount
- New/changed cards entering a grid (Media Library re-filtering, a trivia round appearing in
  GameSetup): **opacity 0→1 only, 140ms** (reuse `--st-motion-hover`, since this is a
  "settle" event, not a sheet event) — no position animation, no stagger. Explicitly
  declining a hand-rolled stagger across a 504-card grid: the complexity and paint cost is
  not worth it for a library filter re-render, and per the trivia-host-workflow memory,
  content should never visibly "reflow" on a host-facing page — instant layout, faded-in
  content only.

### Chip state change
- Filter/status chip selection (Media Library's ALL/PRESENT/MISSING/…, a future Scoring
  round-tab): background + color crossfade, 140ms (`--st-motion-hover`), **no size change**
  — a chip that resizes on selection shifts every chip after it and reads as jumpy in a row
  a manager is tapping quickly.

### Alert strip enter
- HOME's shipped "trivia not armed" strip (`.st-callout-warn`/`.st-callout-danger`, already
  live) mounts via height 0→auto + opacity 0→1, **160ms** (`--st-motion-expand` — this is
  the exact token already named for "expand/collapse" in the 09-11 audit; the strip's mount
  is an expand event, so it should use this token rather than the sheet or hover ones).

### Focus ring
- `:focus-visible` only (never bare `:focus` — a mouse click must not ring a button; a Tab
  press must). The shipped rule (`staff-tokens-v2.css:342-347`) is `outline: 2px solid
  var(--st-accent); outline-offset: 1px` — **keep it exactly**; this section validates it
  against the apple-slice's feedback rules rather than replacing it. No transition (a focus
  ring should snap in with focus, not animate).

### Hairline / glow rules
- Hairline: `1px rgba(255,255,255,0.08)` (`--st-hairline`), already shipped, unchanged —
  this arc introduces no second hairline value.
- Glow: **none** by default anywhere in scope (matches the shipped removal of the 2px glow
  rectangles). The one standing exception, already ratified house-wide and NOT reinvented
  here: `.staff-ui` LIVE glow = `0 0 2px rgba(0,255,65,.3)` — reuse this exact value verbatim
  for Scoring's `.st-live` "● LIVE ON SCREENS" label if/when it gets a glow treatment; do not
  create a second small-glow spec for trivia.

### Glass / translucency — verdict: NOT this arc, anywhere in Bunker staff
The design-notes' real-glass technique (SVG `feTurbulence` + `feDisplacementMap` inside
`backdrop-filter`) is explicitly flagged by its own source note as **Safari/WebKit-partial**
and scoped by that same note to "Ondograph/PADD… not Bunker OS." Staff phones are iPhones —
the exact device class the brief asks to gate on — so this technique fails its own
verification gate before a single line is written for this house. Plain `backdrop-filter:
blur()` (no displacement) is also declined: the source note's own opener calls unbent blur "a
flat grey rectangle," and spending render cost on that for a 500-card grid buys the version
of the effect the note says not to ship. **Verdict: zero translucency on any Bunker staff
surface, trivia included, this arc.** Sheets/modals keep their solid `--st-surface-4` fill.
This is decision C in §E below — flagged as a decision because it's a "no," not because
there's a real design case being weighed against it.

### The three `prefers-*` fallbacks (required CSS)
`prefers-reduced-motion` is **already shipped** (`staff-tokens-v2.css:534-541`). The other
two are not — add them as siblings in the same file, same file-scoping discipline:
```css
@media (prefers-reduced-transparency: reduce) {
  /* Moot in practice (no translucency ships this arc — see verdict above) but required so
     a future material layer inherits the fallback for free instead of it being forgotten. */
  .terminal-theme.staff-v2 [data-st-page],
  .terminal-theme.staff-v2 .st-sheet .st-panel {
    backdrop-filter: none !important;
  }
}
@media (prefers-contrast: more) {
  .staff-v2 {
    --st-hairline: rgba(255, 255, 255, 0.35);
    --st-hairline-strong: rgba(255, 255, 255, 0.5);
  }
  .terminal-theme.staff-v2 [data-st-page] .st-t2,
  .terminal-theme.staff-v2 [data-st-page] .st-t3,
  .terminal-theme.staff-v2 .st-sheet .st-t2,
  .terminal-theme.staff-v2 .st-sheet .st-t3 {
    color: var(--st-text-1) !important; /* secondary/disabled promote to primary contrast */
  }
}
```
Same `!important`/scope discipline as every other rule in the file (documented at the file
header) — these are additive lines in the existing stylesheet, not a new file.

---

## C. Media Library — posters replace thumbnails

### C0. What's true today (confirmed by reading the code + the shipped v2 screenshots)
- `useMediaAdmin.ts:21` selects `"id, filename, title, hash, duration_seconds, width,
  height, size_bytes, thumb_path, status, has_subtitles"` — **`poster_path` is not in the
  select list.** The column exists on `media_files` (confirmed: `useSignage.ts:331` selects
  it for the TV renderer, `useSignage.ts:351` resolves `posterUrl = thumbUrl(poster_path) ??
  thumbUrl(thumb_path)`, and `SignageTemplates.tsx:1054-1060` already renders a 2:3
  contain-fit poster hero on the NOW PLAYING TV card using that exact resolver). Adding
  `poster_path` to the admin select is **not a schema change** — the column already exists —
  it's a query-shape addition, squarely inside RULE #1.
- `MediaPanels.tsx:96-247` (`MediaFileCard`) renders `file.thumb` (i.e. `thumb_path` only) in
  a fixed `height: 110` box, `objectFit: "cover"`, in a grid of
  `minmax(min(100%,200px),1fr)` cards. Confirmed visually in `pr1-medialibrary-v2-1280.png`:
  a landscape frame-grab per card, cropped, at a size where a still from *Diamonds Are
  Forever* and a still from *Dr. No* are close to indistinguishable at a glance — exactly
  Stephen's complaint ("more easily recognizable").
- Title truncation confirmed in the same screenshot: **"Dr. Strange…", "Oppenheimer…",
  "Diamonds Ar…", "Dr. No (196…"** — every title in the shown data clips well before its
  distinguishing information (a year, a subtitle) survives. The v2 card already correctly
  demoted the runtime badge and promoted PRESENT/MISSING (A4, shipped Beat 6) — the
  remaining legibility problem is entirely image recognizability + title truncation, not
  badge weight.
- `MediaPanels.tsx:411` — `DELETE PLAYLIST` still calls raw `window.confirm(...)`. This is
  confirmed the **last unconverted destructive control** in the v2 surfaces grepped this
  pass (`EventEditor.tsx`, `SignageHub.tsx` classic, `ItemEditor.tsx`, `TakeoverPanel.tsx`,
  `signageAdminShared.tsx` all still use `confirm()` too, but those are classic-render or
  outside this arc's file-touch map — DELETE PLAYLIST is the one inside Media, which is in
  scope this arc).

### C1. Card image — poster with a fallback waterfall (reuse the TV resolver, don't invent one)
- **Source order, identical to `useSignage.ts:351`:** `poster_path` → `thumb_path` → the
  existing "▶" glyph placeholder (`MediaPanels.tsx:144`, unchanged for the true "neither
  exists" case). Wire this into `useMediaAdmin.ts`'s select (add `poster_path`) and into
  `MediaFileCard`'s image resolution — same fallback function, imported, not re-derived.
- **Aspect: `2 / 3`** (the movie one-sheet ratio already used by `SignageTemplates.tsx:1054`
  and `useThisWeek.ts`'s `poster?: boolean` flag) — reuse the ratio the app already commits
  to elsewhere rather than invent a Library-specific one. Replace the fixed `height: 110`
  with `aspect-ratio: 2 / 3; width: 100%`.
- **Fit rule, extended from the house's own TV imagery law** ("Toast photos cover-fit,
  everything else contain-fit — never crop imagery we didn't crop"): a real `poster_path` is
  pre-cropped to the ratio by the source (TMDB), so `object-fit: cover` is safe and correct;
  a `thumb_path` fallback is a raw 16:9 frame grab that was never cropped to 2:3, so it gets
  `object-fit: contain` (letterboxed into the poster frame) rather than cropped — the same
  distinction the TV renderer already makes between sourced and unsourced imagery, applied
  here for the first time to the staff Library card.
- **Dim-on-not-present:** keep the exact existing rule (`opacity: file.status === "present"
  ? 1 : 0.45` on the `<img>`) applied to whichever URL won the fallback — no new dimming
  value.
- **Badge placement — PRESENT/MISSING/UNSUPPORTED stays loudest, unchanged in kind:** the
  shipped v2 treatment (`MediaPanels.tsx:146-165` — opaque `rgba(2,6,10,.92)` pill, top-left,
  `inset 0 0 0 1px currentColor`, calmed-accent/danger/amber ink) is already correctly
  reasoned and stays exactly as-is; only its offset nudges from `top:8,left:8` (unchanged) /
  `bottom:6,right:6` → `bottom:8,right:8` for the runtime chip, matching the taller 2:3 frame's
  margins. The runtime badge stays the demoted Disabled-tier peer it already is — do not
  promote it back to parity with the status badge.
- **Grid:** narrow the minimum card width from 200px to **160px**
  (`grid-template-columns: repeat(auto-fill, minmax(min(100%,160px), 1fr))`). A 2:3 portrait
  reads recognizably narrower than a 16:9 landscape crop did — the extra height a poster adds
  is deliberate (Stephen's own reasoning: recognizability over density), so this spec does
  not fight it by shrinking the image; it recovers a little of the added scroll length via
  grid width instead. Tighten `gap: 12px` → `10px` at 390 to the same end.

### C2. Title rules
- **2-line clamp, not 1-line ellipsis:**
  ```css
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  ```
  replacing the current `whiteSpace: nowrap; overflow: hidden; textOverflow: ellipsis`. Two
  lines at Body role (15px/1.5, JetBrains Mono, ~26-30 characters/line at a 160-180px card)
  comfortably carries every real title seen in this pass except the single worst case in the
  library ("Dr. Strangelove or How I Learned to Stop Worrying and Love the Bomb," confirmed
  via `arc2-medialibrary-current-390.png`), which still ellipsizes gracefully on line 2
  instead of clipping after four words on line 1 — a strict improvement, not a full fix for
  the single longest outlier, and that's an acceptable trade.
  - Case: sentence case (this is a title string, not a Label-role string — the case rule from
    §B applies normally here, unlike the Scoring exemption in §A2).
- **Full title reachable:** the DOM element carries `title={display}` (native browser
  tooltip on hover, desktop) and the existing rename button already has an accessible label
  via its visible text — recommend adding `aria-label={display}` explicitly since the
  visible text is now clamped and a screen reader should get the whole string regardless of
  what's visually clipped. This is the "full title reachable" requirement satisfied without
  adding a new expand/detail affordance this arc.
- The filename/path caption line underneath (`01_Atomic_Age/Dr. Strangelove…`) is unchanged
  — 1-line ellipsis stays; that line is provenance for staff, not the recognizability problem
  Stephen named.

### C3. Playlists cards
- `PlaylistRow` (`MediaPanels.tsx:250-283`) is a **text-only row today — it renders no
  thumbnail at all**, so there is no thumbnail→poster swap needed there; this section is
  smaller than the dispatch's "same for Playlists if they show films" implies, because they
  currently don't show film art.
- Recommend (nice-to-have, not required this arc): a small 32×48px (2:3) leading poster from
  the playlist's first present clip, same resolver, so a manager can recognize a playlist by
  its cover film without opening it. Flagged as optional and lower priority than the Library
  grid fix — the dispatch's core complaint (thumbnails, title truncation) lives entirely in
  the Library grid, not here.

### C4. DELETE PLAYLIST — close the last v2 `window.confirm()`
Replace `MediaPanels.tsx:411`'s raw `confirm(...)` with the shipped `ConfirmDialog`
primitive (`shared/ui/ConfirmDialog.tsx`) — the same one Users/Top Sellers REMOVE already
uses (D1, Beat 6 PR 3):
- `danger={true}` (paints CONFIRM in `--st-danger`, per the shipped component).
- `confirmLabel="Delete playlist"` / `cancelLabel="Keep playlist"` — verb-named, matching
  the D1 danger-language rule (never Yes/No, never a bare repeat of the button's own label).
- `body`: the exact existing sentence, verbatim — "Clips stay in the library; any screen
  pointed at it falls back to an empty program until re-pointed." No copy change needed;
  only the dialog surface changes from a browser-native `confirm()` to the in-app sheet.
- Geography: the DELETE PLAYLIST button already renders alone at `marginLeft: "auto"` in the
  `SlideOver` footer (no primary action shares its row) — no geography change required, only
  the confirm-surface swap.
- Tier: **ConfirmDialog only, no hold-to-confirm, no text-swap** — matching the Beat 6
  N7/N10 ruling to keep one confirm tier system-wide until Stephen asks for tiering.

---

## D. Round-1 mockup

Filed at `04-polish-arc2-round1-mockup.html` (hash-deep-linkable: `#scoring`, `#media`,
`#motion`). Three sections:
1. **Host desk at 1280**, today (`assets/arc2-scoring-current-1280.png`, the real
   `pr1-scoring-freeze-v2-1280.png`) beside the §A2 token treatment applied to the same real
   game/team/score data, stage controls and layout held pixel-for-pixel identical.
2. **Media Library at 390**, today (`assets/arc2-medialibrary-current-390.png`, the real
   `pr1-medialibrary-v2-390.png`) beside the §C poster/title treatment on the same real
   titles (Dr. Strangelove, Oppenheimer, Repo Man, Spaced Invaders, Stay Tuned, The Book of
   Eli, The Truman Show, WarGames — all read from the real shots this pass, plus a MISSING
   example read from `beat5-shots/media-library-v2-filtered-390.png`).
3. **Motion sampler** — press, sheet enter/exit, alert-strip expand — CSS-only (no JS
   animation library), honoring `prefers-reduced-motion`.
Screenshots of the mockup itself: `~/Marvin/projects/bunker/polish-arc2-round1-shots/`.

---

## E. Decisions for Stephen

Recommended letter listed first in each line.

- **A1 (recommended).** Trivia toggle = a **second localStorage key**
  (`bunker.trivia_ui_version`), nested under the main `v2` switch (only offered once the
  shell itself is v2), living in the TRIVIA sub-nav row. **A2.** A third value on the
  existing `bunker.ui_version` key instead — touches the shared `UiVersion` type and ~10
  consuming files for a trivia-only feature; not recommended.
- **B1 (recommended).** Toggle scope = **all five trivia staff pages at once**
  (Scoring/GameSetup/Teams/History/Seasons flip together) — one mental model ("trivia is on
  the new look or it isn't"), and GameSetup/Teams/History/Seasons carry none of Scoring's
  live-audience risk, so there's no safety reason to stagger them. **B2.** Host desk
  (Scoring) last — ship GameSetup/Teams/History/Seasons in v2 first, hold Scoring in classic
  an extra beat until it's been watched running a real Wednesday night on the other four.
- **C1 (recommended).** No glass/translucency anywhere on Bunker staff surfaces this arc
  (Safari-partial technique, scoped elsewhere by its own source note; staff phones are
  iPhones). **C2.** Allow a Safari-safe plain `backdrop-filter: blur()` (no displacement,
  flatter look) on ONE surface — the mobile nav drawer only — as a limited experiment; not
  recommended by this pass (the source note itself calls flat blur the wrong version of the
  effect, and it costs render weight on every drawer open for a look nobody asked for).
- **D1 (recommended).** Media Library poster aspect = **2:3**, matching the ratio already
  shipped on the TV NOW PLAYING card and the website hero — one poster ratio system-wide.
  **D2.** A shorter 3:4 ratio for the Library grid specifically (slightly less scroll length
  per row) — breaks the "one ratio, one system" argument for a modest space saving.
  Grid minimum card width **160px** either way.
- **E1 (recommended).** Scoring's button copy (START, END GAME, PUT TRIVIA ON SCREENS, etc.)
  stays UPPERCASE/verb-first even after v2 tokens land — an explicit, named exemption from
  the general sentence-case rule, because it's muscle-memory copy read live by a host mid-
  show. **E2.** Apply the sentence-case rule to Scoring too, for total consistency with every
  other v2 surface — not recommended: this is a legibility experiment on a live product with
  a room watching, which is exactly what "zero-surprise" is meant to prevent.

---

## What could not be independently verified this pass
- The dev server was not started against the real database for this pass — every screenshot
  cited above is a real-data capture already on disk from Beat 6 (`beat6-shots/`,
  `beat5-shots/`), which the dispatch names as an acceptable substitute for "read-only,
  no writes to the DB." No live trivia page was rendered fresh; the mockup's "new" side is a
  hand-built static reproduction of the token system against the same real strings, not a
  screenshot of running code (there is no running code yet — this is the design round).
- Whether a real Safari/WebKit test of the SVG-displacement glass technique would in fact
  fail on an iPhone was not re-verified this pass (no iPhone/Safari test rig available in
  this session) — the verdict in §B rests on the design-notes' own stated caveat, not a fresh
  test.

---

## §A2 addendum — the host grid's type roles (2026-09-12, Marvin ruling, as built)

Added after the PR-3 build, when a measurement of the live branch showed the score grid's
spans carried **no role class at all**: they were rendering at the theme's own
`.terminal-theme * { font-size: 1.5rem }` = 24px, exactly as they always had. The only
things that had actually moved were the TOTAL value (24 → 15px, via `st-mono`'s
`!important`) and the column headers (24 → 12px, via `st-label`) — i.e. the grid had got
*smaller*, not larger, which is the opposite of what §A2 intends for a surface read across
a host's desk mid-show.

**The rule, and it governs every future touch of this grid:**

> **Nothing on the host grid gets smaller than it is today.**

As built:

| Element | Role | Size |
|---|---|---|
| Score cells — the points, the wildcard `×2`, the `★` bonus mark, the empty-cell `–` | `st-mono-lg` (**mono-data-large**) | **24px** JetBrains Mono, `tabular-nums` |
| TOTAL value | `st-mono-lg st-accent` | **24px**, calm-accent ink |
| Team name, rank, the ★ / ⚡ team badges | *no class, deliberately* | 24px (the theme's own) |
| Column headers `RANK` / `TEAM` / `R1…R5` / `FINAL` / `TOTAL` | `st-body st-t2` | **15px** |

`st-mono-lg` is a **named exemption**, in the same class as Scoring's UPPERCASE button copy
(§E1): it does not shrink the data to the 15px Body/Mono floor the rest of v2 uses. The
decision is x-height arithmetic — 24px JetBrains Mono ≈ 13.2px x-height against 20px ≈ 11px
— and legibility at the host desk outranks token tidiness. The role earns its keep by
*naming* the size (so it can never be lost to a future blanket rule) and by adding
`font-variant-numeric: tabular-nums`, which the grid never had: columns of scores now line
up digit for digit.

Headers take **Body 15px, not Label 12px**. Label would have bought uppercase the copy
already has, at the cost of a 6.6px x-height on a label a host scans while entering scores.

Cell geometry is unchanged in structure: the same fixed cells, the same two-line `10×2` over
`★2` content, measured un-clipped at 390 and 1280.

**Also settled in the same pass:**
- **Scoring opts out of the motion layer.** Its v2 root emits `data-st-motion="off"` beside
  `data-st-page`; `staff-tokens-v2.css` §7 cancels `st-mount-fade` inside it. §A2 forbids the
  room seeing anything settle, and Scoring's control line, round selector, both fixed boxes,
  the v2 Modal panel and the ScoreDialog card all match the motion layer's selector.
- **`.st-sheet` roots drop the CRT overlay.** `ConfirmDialog`'s backdrop is its own
  `.terminal-theme` element, so the `:has([data-st-page])` suppression could never reach it
  and every v2 dialog since Beat 6 has been painting scanlines over a tokened sheet.
- **The trivia switch names itself** — `TRIVIA: TRY THE NEW LOOK →` / `← TRIVIA: BACK TO
  CLASSIC` — because on the phone drawer it stacks directly above the shell's own switch.
  On desktop it sits at the sub-nav row's 38px, not 44, so the row does not grow and every
  page in the v2 shell keeps its exact y-position.
- **QUESTIONS / VIDEOS / IMPORT joined the trivia switch.** They needed no new plumbing — the
  same `data-st-page` hook, `cx()` and role classes as the five pages — so a host leaving
  Scoring for the deck tools no longer crosses a look boundary. They render no sub-nav row,
  so the switch itself is not offered while you are on one.

---

## §B addendum (2026-09-12, Marvin ruling — Beat 8)

**Contents of a surface-4 sheet do not stack elevation; they separate by hairline.**

Beat 8 PR 1 moves the signage slide-overs onto the `.st-sheet` scope, which meant giving
that scope the surface rules a FORM needs and a two-button dialog never did. The first
build copied its `[data-st-page]` twins verbatim — including the fills — and the harness
showed the consequence immediately: a `.st-card` (`--st-surface-1`, #131618) or a
`.st-menu` (`--st-surface-3`, #1A1C25) inside a #22273D drawer renders **darker** than its
container. On a page those tiers sit on ground (#0B0D10) and read as raised; on a sheet
they read as holes.

The ruling closes it without a new value: **"higher = lighter", and `--st-surface-4` is the
top of the ladder on purpose.** A fifth, lighter tier for sheet contents is exactly the
drift the token sheet exists to prevent — one exception becomes a parallel scale, and the
two dialects §B was written to stop are back. So inside a sheet, `.st-card`, `.st-row`,
`.st-box`, `.st-menu` and `.terminal-border` carry **no fill at all**: `background:
transparent`, a 1px `--st-hairline` edge, the 6px control radius. Hover and selected states
on an interactive row spend the existing white-alpha wash (`rgba(255,255,255,0.06)` — the
same one section 1 already spends on a control hover), never a fill tier.

The `[data-st-page]` leg is untouched: a card on a PAGE keeps `--st-surface-1`, and its
elevation still reads correctly against the ground. `.st-panel` is untouched too — the
sheet's own panel is the surface-4 object, and a nested `.st-panel` inherits that rather
than acquiring a second meaning by nesting depth. `.terminal-separator` is left exactly as
its page twin: it is already a bare 1px hairline bar rather than a fill tier, and giving it
a transparent background plus a border would render a 3px double rule with nothing between
the lines.

**Slide-overs animate ENTER only for now.** `SlideOver`'s v2 leg carries
`data-state="entering"`, so the ratified backdrop fade applies and a `.st-drawer` rule
swaps the centred dialog's 8px Y-rise for the 10px X-slide §B asks of an edge-anchored
surface. There is no exit: an exit means a deferred unmount, which today means a second
copy of `ConfirmDialog`'s phase machine (entering → exiting → closed, the
`animationend`-versus-fallback-timer race, the re-open-inside-the-exit retarget). **The
exit/deferred-unmount phase machine is backlog for a SHARED hook across `ConfirmDialog` and
`SlideOver`** — one implementation, two consumers, the way `shared/ui/motion.ts` already
holds the one definition of `prefersReducedMotion` / `EXIT_MS`.

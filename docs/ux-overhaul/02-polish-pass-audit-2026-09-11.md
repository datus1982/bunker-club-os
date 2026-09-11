# Bunker OS — Polish pass: staff-surface audit, token system, IA simplification (OKUDA, 2026-09-11)

*Design specialist's audit + spec, dispatched by Marvin off Stephen's 2026-09-11 brief
(`~/Marvin/decisions/2026-09-11-bunker-os-polish-pass.md`). House: Bunker
(`~/.claude/skills/bunker-design-doctrine`), **amended for this card**: the strict terminal
feel is no longer law on staff/backend surfaces (rulings 2–3 of the brief). TVs, signage
renderers, game displays, and the trivia/host system are FROZEN — see §D. Judged against
real-data V2 screenshots in `~/Marvin/projects/bunker/beat{1..5}-shots/`. RULE #1 stands:
every recommendation below is additive, behind `ui_version`, schema-free, TV-untouched, and
verifiable at 390px + desktop with real data. Round-1 mockup: `02-polish-round1-mockup.html`
(same directory).*

## A. Polish audit by surface

Every screenshot below is V2 (the shipped shell, `ui_version=v2`), real data, as of Beats 1–5
(PRs #100–#108). Classic is not audited — it is not the surface Stephen is polishing.

### A1. HOME / hub
**Screenshot:** `beat1-shots/dashboard-v2-390.png`, `beat1-shots/dashboard-v2-1280.png`

- **Noise to remove/collapse:** Four "SYSTEM STATUS" cards (Toast Sync, Tonight, Season,
  Screens) and four+ "MODULES" tiles below them say overlapping things at equal visual
  weight — "Tonight → No game today → Create Game" and the "Trivia Control" module tile
  directly below it ("Live scoring console — run the game / ▸ no game today") are the same
  fact told twice in two different card styles. Every card uses the identical 1px-glow green
  rectangle regardless of whether it's a live status readout, a leaderboard, or a static nav
  tile — nothing in the frame tells the eye which of the ten boxes on this page matters right
  now.
- **Hierarchy failure:** Nothing distinguishes "needs your attention" from "just FYI." The
  Signage Hub's "⚠ TRIVIA IS NOT ON THE SCREENS" warning (see A3) is a genuine actionable
  alert, but it only surfaces two navigation levels deep, inside Signage Hub — never on HOME,
  where a manager actually starts her session. A page called "system status" should read
  top-to-bottom as: (1) anything wrong right now, (2) tonight's task, (3) a compact launcher.
  Today it reads as one undifferentiated stack of green boxes.
- **Navigation friction:** ~0 taps to see the page, but ~10+ visual "boxes" to scan before
  finding the one thing that matters (e.g., "is there a game tonight") — the complaint is
  scan cost, not click cost. On desktop (`dashboard-v2-1280.png`) the MODULES grid continues
  well past the fold with no distinction between a module that has state to report (Trivia
  Control) and one that's a pure static link (History).

### A2. GAMES / host (Scoring console)
**Screenshot:** `beat1-shots/scoring-v2-390.png`

- **Noise to remove/collapse:** Minimal — this surface is already close to right-sized
  (density was previously tuned per the owner's own trivia-host note, `.scoring-page`
  desktop-density rule in `terminal-theme.css`). Not a target for the heavy overhaul; see §D.
- **Hierarchy failure:** None flagged. The "BAR SCREENS: OFF — NOT ON SCREENS" state
  correctly gets the one non-green (amber) treatment on the page, which is the right
  instinct the calmed-accent rule (§B) will generalize.
- **Navigation friction:** None flagged; this is the host's own desktop-primary tool and
  Stephen explicitly said not to touch it.

### A3. BAR OPS — Top Sellers editor (drinks) and Signage Hub
**Screenshots:** `beat3-shots/drinks-v2-390.png`, `beat3-shots/signage-v2-390.png`

- **Noise to remove/collapse (drinks/Top Sellers):** Every rotation-group row
  (Draft Beers, Shots, Signature Cocktails, Mocktails, Overall Top 5) repeats an **"● ON"**
  chip twice — once under the group name, once again inline in the ▲▼/REMOVE action row.
  Same fact, same row, twice. Collapse to one status chip per row, top-right of the row
  header, with ▲▼/REMOVE reading as pure actions underneath.
- **Hierarchy failure (drinks):** **REMOVE** renders in the same orange/amber used
  elsewhere in the system for "ambient/pending" state (`.u-amber`) — an owner-call item
  already on record. Per the danger-language rules in §B, orange is the wrong register for
  a destructive action; REMOVE needs to move into red's budget, and ON/▲/▼ (all reversible,
  non-destructive) need to stop competing with it for the same warm color.
- **Noise to remove/collapse (Signage Hub):** `signage-v2-390.png` runs the full **ASSET
  LIBRARY (15 assets)** — poster art, price, source, DRINK/TOP-5/IDLE badges — directly
  inside the Signage Hub page, below the two screen cards. This is the same Library that
  Beat 4 promoted to its own MEDIA top-level section. Right now a manager sees the entire
  media catalog twice: once to manage what's playing (legitimately Signage Hub's job) and
  once more as a duplicate, orphaned list that belongs to MEDIA ▸ LIBRARY. This is the
  single biggest concrete "noise" item found in this pass.
- **Hierarchy failure (Signage Hub):** The one thing on this page that is a true alert —
  "⚠ TRIVIA IS NOT ON THE SCREENS — a game exists but hasn't been armed" — is styled
  correctly (amber-bordered callout) but is buried below a page header and only visible
  after a full scroll pass on mobile; it should anchor the top of the page (or promote to
  HOME per A1) rather than compete with two full-height screen cards for the first viewport.
- **Navigation friction:** Reaching an individual asset's rotation state today means:
  BAR OPS → SIGNAGE HUB → scroll past two screen cards → scroll the 15-item asset list
  → find the row. Once MEDIA ▸ LIBRARY is the sole owner of the asset list (per the IA fix
  in §C), Signage Hub becomes screen-control only and the same task becomes: BAR OPS →
  SIGNAGE HUB → one of two screen cards, no scrolling past unrelated content.

### A4. MEDIA — Library
**Screenshot:** `beat4-shots/media-library-v2-390.png`

- **Noise to remove/collapse:** The page is a single unbroken column of full-height
  thumbnail cards (title, runtime badge, path, one PLAY ON… button) with no grouping,
  filter chips, or section breaks — `504 FILES · 152 MISSING` is a good, real, front-of-page
  stat (keep it), but there is nothing between that header and an effectively infinite
  scroll of cards. The polish-candidate note about "SHOW ALL page height" is this: an
  unbounded list with no way to jump or filter is the literal shape of "tough to sift
  through."
- **Hierarchy failure:** The `PRESENT` badge (top-left of each thumbnail) is the only signal
  distinguishing a file that's actually on disk from one that isn't, and it's the same size
  and weight as the runtime badge in the opposite corner — for a catalog whose header just
  told you 152 files are missing, the presence badge should be the most visually prominent
  element on a card, not a same-weight peer of the runtime counter.
- **Navigation friction:** No search/filter is visible in this capture; per the brief's own
  polish-candidate list, the Library search input needs a real-iPhone check (safe-area /
  keyboard occlusion) before this pass ships — flagged as **not independently verified**
  here (no screenshot of the search state was available in the shots directory).

### A5. SYSTEM — Users, Settings
**Screenshots:** `beat2-shots/users-v2-390.png`, `beat2-shots/settings-v2-390.png`

- **Noise to remove/collapse (Users):** Each staff card repeats six module toggles
  (TRIVIA / SEASONS / TOP SELLERS / SIGNAGE / WEBSITE / EVENTS & PROMOS) at full size even
  for an **admin** row, where all six are implicitly ON and locked — the caption "Admins
  implicitly hold every module" is true but appears once at the very bottom of the page,
  after three admin cards have already each spent six rows showing locked-on toggles the
  admin can't change. Collapse the admin case to a single "Full access (admin)" line and
  reserve the six-toggle grid for host/staff rows where it's actually a decision surface.
- **Hierarchy failure (Users):** REMOVE (destructive: revokes an account) and the ROLE
  dropdown (routine) sit side-by-side at equal visual weight in every card — exactly the
  "danger has no geography" failure mode named in §B. REMOVE should not share a row with a
  routine control.
- **Hierarchy failure (Settings):** Not a hierarchy problem so much as an honesty one — the
  page is a placeholder ("Scaffolding — implemented in Phase 1") styled identically to a
  real, working page. Per the Beat-1 addendum ruling, Settings already gets COMING-SOON
  treatment in the nav; this pass should make sure the page itself reads as
  not-yet-built (see EmptyState pattern in §C), not as a working page with nothing on it.
- **Navigation friction:** SYSTEM ▸ USERS ▸ scroll past N admin cards (each ~6 rows of inert
  toggles) to reach the one staff/host row you actually came to edit. On a 3-person staff
  list this is mild; it will not scale.

## B. Token sheet v2 — staff surfaces

Applies to everything under `StaffLayout` (`.staff-ui`). **TVs, signage renderers, game
displays keep the existing terminal theme byte-for-byte** — nothing in this section touches
`.terminal-theme` outside `.staff-ui` scope. Every token below also gets a SwiftUI-portable
semantic name so the iOS companion can consume the same system (see note on iOS groundwork
at the end of this section).

### Ground + elevation (near-black, lightness-stepped — his own dark-mode reference)
| Tier | Hex | Usage | SwiftUI semantic name |
|---|---|---|---|
| Ground | `#0B0D10` | Page background | `Color.staffBackground` |
| Elevation 1 | `#131618` | Cards, list rows, module tiles | `Color.staffSurface1` |
| Elevation 2 | `#171B1F` | Grouped sections/panels (e.g. a rotation-group container, a form section) | `Color.staffSurface2` |
| Elevation 3 | `#1A1C25` | Menus, dropdowns, the mobile nav drawer | `Color.staffSurface3` |
| Elevation 4 | `#22273D` | Modals, confirm dialogs, sheets — the highest thing on screen | `Color.staffSurface4` |

Higher tier = lighter, per the "elevation by lightness, not shadow" rule — shadows don't
read on OLED-dark grounds. Never use ground (`#0B0D10`) as a card fill; a card indistinguishable
from the page is the single largest cause of "flat."

### Text tiers (alpha-on-white, never a bare `#FFFFFF`)
| Tier | Value | Usage | SwiftUI semantic name |
|---|---|---|---|
| Primary | `rgba(255,255,255,0.87)` | Card titles, primary data values, active nav | `Color.staffTextPrimary` |
| Secondary | `rgba(255,255,255,0.60)` | Labels, captions, helper copy, metadata | `Color.staffTextSecondary` |
| Disabled | `rgba(255,255,255,0.38)` | Disabled controls, placeholders, least-important timestamps | `Color.staffTextDisabled` |

**This is the central deviation the brief authorizes:** default staff body/UI text moves off
full-saturation phosphor green onto this neutral white-alpha scale. Green/amber stop being
"the color of all text" and become status/identity accents again — spent deliberately, the
way the design notes describe calming an over-saturated brand hue. Interpretation stated per
doctrine: this is the one move that answers "clunky and flat" more than any other single
change, because it's what lets a card's *content* out-rank its *chrome* for the first time.

### Accent roles (calmed — same hue family, spent as accent, not as ground truth)
| Role | Hex | Usage | SwiftUI semantic name |
|---|---|---|---|
| Accent (default/calm) | `#7FE6A8` | Active nav pill, links, focus rings, primary icons, non-alerting status dots | `Color.staffAccent` |
| Accent (full-saturation, reserved) | `#00FF41` | Small "LIVE now" dot/label only — true real-time state, ties back visually to the TV green | `Color.staffAccentLive` |
| Amber (ambient/pending, calmed) | `#E8B04B` | Pending/idle/ambient state labels, non-urgent callouts | `Color.staffAmber` |
| Red (danger — a budget, see below) | `#FF5A5A` | Destructive actions and true error states ONLY | `Color.staffDanger` |

Calmed accent derivation shown for the record: `#00FF41` (H135 S100 L50) → `#7FE6A8`
(H135 S45 L70), the same saturation/lightness move the reference video applied to a
saturated blue. Amber gets the identical treatment from `#FFB000`.

### Hairline
`1px rgba(255,255,255,0.08)` — replaces the 2px solid green rectangle drawn around every
card/section today. This single swap removes most of the "wireframe" look in the current
screenshots without touching layout. SwiftUI: `Color.staffHairline`, `.strokeBorder`.

### Radius — ruling
**Staff surfaces get a small radius now.** The terminal doctrine's "no rounding" is TV/public
canon; Stephen's ruling 2 explicitly frees staff surfaces from that law. A small, consistent
radius costs nothing functionally and is one of the cheapest, highest-signal ways to read as
"a considered app" instead of "a terminal emulator" — which is exactly the adjective set he
asked for (clean, simple, easy to find). Scale:
- Cards, inputs, buttons: **6px** (`Radius.staffControl` / `Radius.staffCard`)
- Modals, sheets, the mobile nav drawer: **10px** (`Radius.staffSheet`)
- Status chips, nav pills, badges: **full pill** (`9999px`, unchanged from current chip
  shape — this was already the right call and stays)
Do not round further than this — a heavily rounded "soft app" look reads as the "Apple-esque"
target Stephen explicitly ruled out. 6px/10px is a legibility signal, not a style statement.

### Type roles (Share Tech Mono + JetBrains Mono retained — see case for keeping below)
| Role | Face | 390px | md: | Weight | Case | SwiftUI semantic name |
|---|---|---|---|---|---|---|
| Display | Share Tech Mono | 28px / 1.15 | 34px / 1.15 | 700 | Sentence case | `.staffFont(.display)` |
| Heading | Share Tech Mono | 17px / 1.3 | 19px / 1.3 | 600 | Mixed case (eyebrow labels stay caps) | `.staffFont(.heading)` |
| Body | JetBrains Mono | 14px / 1.5 | 15px / 1.5 | 400 | Mixed case | `.staffFont(.body)` |
| Label | JetBrains Mono | 12px / 1.3, tracking 0.06em | 12px / 1.3 | 500 | UPPERCASE (labels/table-headers only) | `.staffFont(.label)` |
| Mono-data | JetBrains Mono | 14px / 1.4, tabular-nums | 15px / 1.4 | 500 | As-is | `.staffFont(.monoData)` |

**Case rule (new):** today every tier — hero title, section header, card body, button — is
forced uppercase by the base `.terminal-theme` cascade, which is why a page like
`dashboard-v2-1280.png` reads as one undifferentiated wall of caps. Reserve UPPERCASE for
Label role only (eyebrows, table headers, status chips, nav items — short strings where caps
are a legibility win). Display/Heading/Body drop to sentence or mixed case. This is a case
change, not a face change — Share Tech Mono and JetBrains Mono stay exactly as ratified
2026-07-13; the readability gap in the current screenshots is overwhelmingly a
weight/case/hierarchy problem, not a typeface problem, so there's no case here for spending
a font swap.

### Spacing scale (8pt grid — ports 1:1 to SwiftUI)
`4 · 8 · 12 · 16 · 24 · 32 · 48` px = `space-1` through `space-12` (`space-1=4, space-2=8,
space-3=12, space-4=16, space-6=24, space-8=32, space-12=48`). Card internal padding:
`space-4` (16px) at 390, `space-6` (24px) at md:. Gap between stacked cards: `space-3` (12px)
at 390, `space-4` (16px) at md: — tighter than today's rendered gap, which is inflated by the
2px glowing borders being counted as part of the whitespace. SwiftUI: a `Spacing` enum with
the same case names, values in points.

### Motion budget
Hover/press: 120–150ms ease-out, opacity/background only. Drawer/sheet enter: 180ms ease-out,
single-axis (slide or fade, never both). Expand/collapse (an accordion or "show more"
section): height+opacity, 160ms. Nothing infinite off display routes (existing rule,
unchanged). No 3-D, no bounce, no spring overshoot — matches the existing
`staffnav-drop` 120ms precedent in `terminal-theme.css` almost exactly; this pass tightens
the budget into one named scale rather than leaving it as one-off keyframes per component.

### Danger language (destructive-action design)
- **Verb-named buttons, not YES/NO or bare icons:** "Remove access", "Delete asset
  permanently", "End game" — never a bare "REMOVE" or an X icon alone.
- **Red is a budget, spent only on:** delete/permanently-remove actions and true failure
  states (sync failed, screen offline). It is NOT spent on: "Sign out" (reversible, routine
  — currently rendered in amber/orange on the dashboard header, should be neutral/secondary
  style), or "Remove [rotation group]" (reversible via re-add — see geography rule below,
  this is about placement, not necessarily red).
- **Geography:** a destructive control never sits in the row/column where the primary
  confirm action lives. Concretely: Users' REMOVE moves out of the same row as the ROLE
  dropdown into a separated "danger zone" strip (top hairline, own label) at the bottom of
  the staff card — matches the GitHub pattern cited in the source notes.
- **Confirm pattern, tiered by cost:**
  - **Hold-to-confirm (~300ms ring)** for irreversible/costly actions: delete a media asset
    permanently, remove a staff account.
  - **Text-swap confirm** ("Remove group?" → tap again to confirm, 3s window) for
    reversible-but-not-trivial actions: removing a rotation group from Top Sellers (re-addable
    via "+ ADD," but not a one-tap undo).
  - **No confirm needed** for instantly-reversible toggles: ON/OFF state on an existing
    rotation group, a checkbox.

### iOS groundwork — status
Marvin could not locate an iOS/companion-app codebase under `~/bunker-club-os` or in the
Bunker session memory (`~/.claude/projects/-Users-admin-bunker-club-os/memory/`) — confirmed
again in this pass; no Swift/Xcode project exists yet. **This token sheet is written to port
1:1 without it**: every color is a semantic role name (not a raw hex reference in component
code), spacing is an 8-pt scale (Apple's own native grid), and type is named by role
(display/heading/body/label/monoData) rather than by pixel value — a SwiftUI `Font`/`Color`
extension can define these exact names against the exact values above with no redesign when
the iOS app groundwork exists. The "Apple design guidelines as a Claude skill" video Stephen
flagged is relevant only as *thinking* (semantic roles, motion budget, wayfinding) — nothing
in this sheet borrows Apple's *look* (no SF Symbols-style depth, no translucency-by-default,
no Apple system typefaces); Share Tech Mono / JetBrains Mono and the calmed-phosphor accent
are what keep this Bunker OS rather than "Apple-esque."

## C. IA + nav simplification

**Stays inside the ratified two-tier shape** (HOME / GAMES / BAR OPS / MEDIA / SYSTEM, each
with a sub-nav row) — no third tier, per doctrine and per the brief's own rule #4.

1. **Signage Hub loses the embedded asset library.** It becomes screen-control only: the
   screen cards (Portrait Main, Bar TV) plus a single "Manage Library →" link out to
   MEDIA ▸ LIBRARY. This is the one structural (not just visual) change in this pass —
   directly answers A3's biggest finding. MEDIA ▸ LIBRARY remains the sole owner of the
   asset list; nothing about its data model changes, only which page renders it.
2. **HOME gets an alert strip, sourced from existing state, not new data.** Anything that is
   currently a warning-styled callout buried in a sub-page (e.g. "Trivia not on screens")
   surfaces as a compact one-line alert row at the top of HOME, above SYSTEM STATUS. Tapping
   it deep-links to where the fix happens (Signage Hub, Scoring). This is presentation only
   — the underlying "is trivia armed" check already exists on the Signage Hub page today.
3. **HOME's SYSTEM STATUS and MODULES sections merge where they duplicate.** "Tonight / No
   game today / Create Game" and the "Trivia Control" module tile are the same fact; keep
   the richer one (Tonight, since it has the action button) and drop the redundant module
   tile's status line, leaving the tile as a pure launcher ("Trivia Control — Live scoring
   console, run the game" with no separate "no game today" restated inside it).
4. **Users collapses the admin case.** Admin rows show one line ("Full access — admin") in
   place of six locked-on toggles; the six-toggle grid renders only for host/staff rows where
   it's a real decision.
5. **Task-named labels, extended (not invented) from the existing good pattern.** The module
   tiles already do this right (`"Live scoring console — run the game"`, not `"Trivia"`) —
   this pass extends the same one-line task description to sub-nav chips that currently read
   as bare nouns (e.g. Signage Hub's sub-items), and to nav labels that name a system instead
   of a task where a task-name is clearer to a new manager.
6. **A single overflow (⋯) convention, everywhere.** Primary per-row action (Play, Edit,
   Open) stays inline; everything else (duplicate, remove-from-rotation, view details) moves
   behind one ⋯ menu component, replacing today's inconsistent mix of "always show 2–3
   buttons" vs. "hide behind ⋯" that differs page to page.
7. **What a new manager sees first, end to end:** HOME → alert strip (if anything needs her)
   → Tonight's game action → a compact module launcher with task-named one-liners. No page
   in the two-tier shape should require more than the existing ≤2-tap reach the 2026-09-08
   audit already established; this pass does not change tap depth, only what she sees once
   she arrives.

## D. Trivia/TV adoption note

**Trivia/host system is not reformatted.** It adopts exactly two things from this token
sheet, both invisible to its current look:
- **Spacing scale** (§B) — the 8pt grid, since the scoring console's own density rule
  already approximates it; this just gives it a shared name instead of a one-off `.scoring-page`
  media-query constant.
- **Type roles by name** (§B) — `label` and `monoData` roles specifically, since the scoring
  console already sets small caption/label text and tabular score numbers; naming them the
  same as the rest of staff UI means a future shared component (e.g. a score readout) behaves
  identically wherever it's used, without changing how Scoring looks today.

**It does NOT adopt:** the near-black/elevation surface system, the calmed accent, the 6px
radius, the white-alpha text tiers, the danger-language button copy changes, or the case
rule. Scoring stays green-on-black, sharp-cornered, all-caps, exactly as shipped.

**TV rendering is untouched.** `/signage/s/:slug`, `/game/preview`, `/drinks`,
`/game-display`, `/leaderboard` — no file under those render paths is touched by this pass,
and none of the tokens in §B apply to them.

## E. Round-1 mockup

Filed at `~/bunker-club-os/docs/ux-overhaul/02-polish-round1-mockup.html` (hash-deep-linkable:
`#home`, `#barops`, `#tokens`). Shows HOME/hub and the Top Sellers (BAR OPS) editor at 390px,
current-V2 screenshot side by side with the new token system applied to the same real data,
plus the token sheet rendered as swatches/type samples. Screenshots of the mockup itself
saved to `~/Marvin/projects/bunker/polish-round1-shots/`.

## F. Decisions for Stephen

Recommended letter listed first in each line.

- **A1 (recommended). Ship the neutral white-text / calmed-accent base now, as scoped in
  §B** — the single highest-leverage fix for "clunky and flat," but it is the one token
  decision that changes the system's default read (green identity becomes an accent, not the
  ground). **A2.** Keep body text green (only add elevation tiers, hairlines, radius, and
  case fixes) and defer the text-color change to a later round.
- **B1 (recommended). Fold Signage Hub's asset library into MEDIA ▸ LIBRARY now, in this
  pass** — it's a real duplicate surface, not just a look change, and closes cleanly under
  RULE #1 (link change, no schema change). **B2.** Leave Signage Hub's embedded library in
  place for now and revisit after MEDIA ships further.
- **C1 (recommended). Adopt the 6px/10px staff radius.** **C2.** Keep sharp corners on staff
  surfaces too (closer to current terminal fidelity, less of the "considered app" signal).
- **D1 (recommended). Move REMOVE (Top Sellers, Users) into red's budget with the
  geography/confirm rules in §B now.** **D2.** Leave REMOVE's current amber styling in place
  and treat danger-language as a later round.
- **E1 (recommended). Promote the "trivia not armed" alert to a HOME-level strip now** (pure
  presentation, no new state). **E2.** Leave it on Signage Hub only, where it lives today.

# Beat 6 — Polish pass build brief (LETTERED 2026-09-11 — GO)

*Drafted 2026-09-11 by the build lane off Okuda's audit
(`02-polish-pass-audit-2026-09-11.md` §B–§D) and Marvin's card. **Lettered the same
evening: Stephen answered "all as recommended" = A1 B1 C1 D1 E1** (relayed by Marvin, LCARS
card `mtxgq1aqhjns29`). Build sequence per the card, smallest first, one PR each: (1) tokens
layer, (2) HOME merge + alert strip, (3) danger pattern + Users admin collapse, (4) hub
library fold — **(4) is HELD on code note N1 until the two-libraries question is answered.***

Spec of record: `02-polish-pass-audit-2026-09-11.md` (§B token sheet, §C IA, §D trivia/TV
adoption). Mockup: `02-polish-round1-mockup.html` (`#home`, `#barops`, `#tokens`).
Owner brief: `~/Marvin/decisions/2026-09-11-bunker-os-polish-pass.md`.

---

## 0. Letters — IN (2026-09-11, Stephen via Marvin)

| # | Question | Recommended | Alternative | **Stephen** |
|---|---|---|---|---|
| A | Staff text base | **A1** white-alpha text tiers + calmed accent (`#7FE6A8`), green reserved for LIVE | A2 keep green text; only elevation, hairline, radius, case | **A1** |
| B | Signage Hub asset library | **B1** fold into MEDIA ▸ LIBRARY now | B2 leave in the hub | **B → (a) SLIDES PAGE** (Stephen 18:05 CT "slides page is fine, go ahead", after N1): new page **BAR OPS ▸ SLIDES** owning the `signage_items` list + `ItemEditor` as they are (same table, same editor, same `slot_queue` placement — a page move, no data-model change); the hub keeps a one-line "Manage slides (N) →" link where the embedded library was; screen control stays in the hub. No third nav tier. |
| C | Staff radius | **C1** 6px controls/cards, 10px sheets, pill chips | C2 stay sharp | **C1** |
| D | REMOVE (Top Sellers, Users) | **D1** red danger budget + geography + tiered confirm now | D2 leave amber, later round | **D1, amended (Marvin ruling on N7):** KEEP PR #103's `ConfirmDialog`; REMOVE moves into red (`#FF5A5A`), verb-named ("Remove group" / "Keep group" — never Yes/No), own footer strip never beside the primary. **NO hold-to-confirm in Beat 6** (N10 moot). |
| E | Trivia-not-armed alert | **E1** HOME-level strip now | E2 stays in Signage Hub | **E1** |

Card additions: real-data shots at 390 + 1280 for HOME, Top Sellers editor, Media Library,
Users, Signage Hub → `~/Marvin/projects/bunker/beat6-shots/` (beat5 naming + `report.json`).
NOT in scope: Read the Room; flipping the `ui_version` default; any trivia/host visual change;
any TV route; the iPhone search-input check; NO SUBTITLES semantics. "If any token cannot be
implemented inside RULE #1, name it and build the rest."

### PR plan
| PR | Branch | Scope | Status |
|---|---|---|---|
| 1 | `phase-polish-tokens` | §2.1 tokens layer + §2.2 type/case + §2.3 surfaces/hairline/radius on the v2 shell + every `shared/ui` primitive + the v2 pages that only need restyle (Media, Signage Hub chrome, Users, Top Sellers) | dispatched |
| 2 | `phase-polish-home` | `DashboardV2` — Tonight/Trivia-Control merge (C3) + alert strip (E1, N8 hoist) | after 1 |
| 3 | `phase-polish-danger` | D1 on Top Sellers + Users (ConfirmDialog kept, verb-named, red, footer strip), Users admin-row collapse (C4) | after 1 |
| 4 | `phase-polish-slides-page` | BAR OPS ▸ SLIDES page (`signage_items` + `ItemEditor`, v2-only route; classic device → `<Navigate to="/signage">` per the Beat 4 `V2Only` pattern) + hub "Manage slides →" link | after 1 (unblocked 18:05 CT) |
| — | riding 1 or 3 | C5 task-named sub-nav copy, C6 ⋯ convention, A5 Settings EmptyState, A4 badge weight | fold where cheapest |

---

## 1. RULE #1 mechanics (unchanged from Beats 1–5)

- **Additive, behind the per-DEVICE switch.** Every visual change lives under
  `.staff-v2` (only `StaffShellV2` puts it on the page) or inside a component that only
  renders when `useUiVersion()` is `v2`. Classic (`ui_version` absent/`classic`/malformed)
  renders byte-identical — proven the Beat 3 way: PNG sha256 + `innerHTML` of every
  classic staff page from a `main` worktree, before vs after.
- **No schema change. No migration. No edge-fn change.** Zero writes added; any "new"
  state on HOME (E1) is derived from data the hub already reads.
- **TVs frozen.** `SlotDisplay`, `DrinksDisplay`, `GameDisplay`, `Leaderboard`,
  `GamePreview`, `signage.css` render paths, `terminal-theme.css` — **untouched**.
  `pnpm test:tvchunk` runs in CI between Build and Deploy and must print `TV CHUNK: CLEAN`
  on the branch push.
- **Trivia/host tools frozen** (`Scoring`, `GameSetup`, `Teams`, `History`, `QuestionPanel`,
  `RoundGrid`, `TeamEditorDialog`) — see code note N6 on §D's "adopt the names" clause.
- **Proof set per page** (real data, `document.fonts.load` gated on Share Tech Mono /
  JetBrains Mono / VT323): 390px + 1280px, classic AND v2, into
  `~/Marvin/projects/bunker/beat6-shots/`. Harnesses assert WIDTH + height on the 44px
  tap floor. One throwaway `*.test` admin, deleted after (`auth.users like '%.test'` = 0).
- **Builder READ-ONLY on real signage/media/staff data.** Writes proven by code identity.
- **Gate:** builder → reviewer (verdict VERBATIM in the PR) → fold WARNs → addendum →
  Stephen's word → merge → close-out: deploy green, prod entry hash == a CLEAN-WORKTREE
  build of merged main (compare the `index-*.js` named in `index.html`; there are two),
  both TVs' `last_seen` advancing across +10 min.
- Before any commit: `git status` + grep for `__harness` / `qa-harness` (PR #89 near-miss).

---

## 2. Scope by token-sheet section → what changes

### 2.1 Tokens (§B) — one new stylesheet, one new TS module
- `theme/staff-tokens-v2.css` (NEW) — CSS custom properties on `.staff-v2`
  (`--st-ground/--st-surface-1..4/--st-text-1/2/3/--st-accent/--st-accent-live/
  --st-amber/--st-danger/--st-hairline/--st-radius-control/--st-radius-sheet/
  --st-space-1..12`), plus the scoped overrides that beat the base cascade (N2, N3).
  Imported ONLY by `StaffShellV2.tsx` (same pattern as `staff-shell-v2.css`).
- `shared/ui/tokens.ts` (NEW) — the same values as TS constants for inline `style`
  (required: text sizes are inline in this app, N4). Named by semantic role to mirror the
  SwiftUI names in §B.

### 2.2 Type roles + case rule (§B)
Display/Heading/Body/Label/Mono-data as `.st-display/.st-heading/.st-body/.st-label/
.st-mono` under `.staff-v2` + matching constants. The case change is **copy, not cascade**
(N5): every v2 component that renders a title/body string in literal caps gets a
sentence-case string; Label-role strings stay caps.

### 2.3 Surfaces, hairline, radius (§B) — [gated C]
Card/row/tile/dialog/drawer fills on the elevation tiers; 2px green frames → the hairline;
radius per C1 via a `.staff-v2`-scoped `border-radius` override (N3).

### 2.4 Danger language (§B) — D1 as amended
Verb-named destructive buttons; red budget; geography (Users REMOVE → own danger strip
under a hairline). Confirm = the shipped `ConfirmDialog` (PR #103) with verb-named
buttons ("Remove group" / "Keep group"); no hold-to-confirm, no text-swap in Beat 6.

### 2.5 IA (§C)
- C1 Signage Hub → screen-control only via the SLIDES page — **[B = (a), unblocked]**
- C2 HOME alert strip — **[gated E]**
- C3 HOME status/module de-dup
- C4 Users admin rows collapse to one "Full access — admin" line
- C5 task-named sub-nav labels (copy only, `navV2.ts`)
- C6 one ⋯ overflow convention (new `shared/ui/OverflowMenu.tsx`, replaces per-page mixes)
- A4 Media Library: PRESENT/MISSING badge weight; real-iPhone search check (owner eyeball)
- A5 Settings placeholder → `EmptyState` "not built yet" read (v2 only)

### 2.6 Trivia/TV adoption (§D) — OUT of Beat 6 (Marvin ruling on N6)
Nothing rendered changes. **Follow-up, not a task:** on the next trivia/host touch, name
the scoring console's spacing constants and label/monoData sizes after the shared tokens
(zero-render-diff refactor, PNG sha256 proof).

---

## 3. File-touch map (v2 shell + components the token sheet reaches)

| File | Why | Letter |
|---|---|---|
| `theme/staff-tokens-v2.css` **NEW** | token custom properties + scoped cascade overrides | A, C |
| `shared/ui/tokens.ts` **NEW** | TS mirror of the tokens for inline sizes | all |
| `theme/staff-shell-v2.css` | nav chrome onto tokens (ground, hairline, accent pill, drawer surface-3, radius) | A, C |
| `theme/staff-form.css` | `.bui-*` geometry onto spacing scale + radius (still zero `!important`) | C |
| `modules/dashboard/StaffShellV2.tsx` | imports the token sheet; SIGN OUT off amber → secondary | A |
| `modules/dashboard/navV2.ts` | task-named sub-item labels (copy) | — |
| `shared/ui/SectionNav.tsx` | active pill = accent, drawer = surface-3 / 10px, motion budget | A, C |
| `shared/ui/StaffPageHeader.tsx` | Display role; drop `textTransform: uppercase` (the ONE cascade caps rule) | — |
| `shared/ui/ListRow.tsx` `ScreenCard.tsx` `EmptyState.tsx` `InlineNotice.tsx` | surface-1/2 fills, hairline, radius, text tiers | A, C |
| `shared/ui/StatusChip.tsx` | tones onto calmed accent/amber/danger; `live` keeps `#00FF41` | A |
| `shared/ui/ConfirmDialog.tsx` | surface-4 / 10px; new `variant="hold"` (300ms ring) | C, D |
| `shared/ui/ToggleSwitch.tsx` `TapTargetCheckbox.tsx` `FormField.tsx` | accent, radius, text tiers | A, C |
| `shared/ui/OverflowMenu.tsx` **NEW** | the single ⋯ convention (C6) | — |
| `modules/dashboard/Dashboard.tsx` | add the `useUiVersion` branch (today HOME has NO v2 variant — it renders classic inside the v2 shell) | E |
| `modules/dashboard/DashboardV2.tsx` **NEW** | alert strip (E1), status/module de-dup (C3), tokens | E |
| `modules/dashboard/UsersV2.tsx` | admin-row collapse (C4); REMOVE → danger strip + hold-confirm (D1) | D |
| `modules/leaderboard/DrinksAdminV2.tsx` | ON chip + `● ON` button de-dup (audit A3); REMOVE → red + text-swap confirm (D1) | D |
| `modules/signage/SignageHubV2.tsx` | alert to top of page; ASSET LIBRARY section — **N1 decides** | B, E |
| `modules/signage/signageHubShared.tsx` | hoist the "trivia not armed" derivation into a hook HOME can call (parity invariant: one function) | E |
| `modules/signage/MediaPanels.tsx` (`variant="v2"` paths only) | PRESENT/MISSING badge weight; tokens | A |
| `modules/signage/MediaPages.tsx` | page chrome onto tokens | A |
| `modules/signage/HubOverlays.tsx` (v2 render paths only) | slide-over surface-3 / radius — **verify each panel is v2-only before touching; classic hub opens the same panels** | C |
| `Settings.tsx` (placeholder) | v2-only `EmptyState` (A5) | — |

**NOT touched:** `terminal-theme.css`, `signage.css`, `StaffNav.tsx`, `Dashboard.tsx`
classic branch, `Users.tsx` classic render, `DrinksAdmin.tsx` classic render,
`SignageHub.tsx` classic render, `MediaSection.tsx`, every display route, every trivia/host
page, every edge function, `supabase/`.

---

## 4. Code notes — things the token sheet asks for that are NOT cleanly implementable inside RULE #1 as written (named, not resolved)

- **N1 — Letter B conflates two different libraries.** The hub's "ASSET LIBRARY (15
  assets)" section in `SignageHubV2.tsx:97` is `signage_items` — TV *slides* (drink
  specials, announcements, Top Sellers cards, menu-group slides) edited by `ItemEditor`,
  queued per screen through `slot_queue`. MEDIA ▸ LIBRARY (`/media/library`) is
  `media_files` — the 504-file *video* catalog on the bar PC. The media library was ALREADY
  removed from the v2 hub in Beat 4 (the `GO TO MEDIA →` notice at `SignageHubV2.tsx:138`
  is where it went). "Fold the hub's asset library into MEDIA ▸ LIBRARY" would put TV slides
  inside the video-file catalog: different table, different editor, different placement
  model, and the audit's own "nothing about its data model changes" would not hold. The
  audit's *observation* (the hub is long; screen control and slide authoring compete)
  stands. Options for Stephen/Marvin, not chosen here: (a) a `/media/slides` (or
  BAR OPS ▸ SLIDES) page that owns the slide library, hub keeps a link; (b) collapse the
  hub section by default; (c) B2. **Needs a re-ask before B is lettered.**
- **N2 — A1's text-color change fights an `!important` at class specificity.**
  `terminal-theme.css:168-181` sets `color: var(--terminal-green) !important` on
  `.terminal-theme *`. The only way to move v2 text to white-alpha without touching that
  file is a higher-specificity `!important` override scoped `.terminal-theme.staff-v2 *`
  (0,2,0). That ties with the `u-amber`/`u-red`/`u-idle`/`u-ink` utilities
  (`.terminal-theme .u-amber`, also 0,2,0, also `!important`) so the override must load
  BEFORE them or carry one more class, or every amber/red status label in v2 turns white.
  Implementable, but it is a scope-wide `!important` on `*` — the class of rule the shell
  CSS header promised not to add. Reviewer will want it flagged inline.
- **N3 — C1's radius fights `.terminal-theme * { border-radius: 0 !important }`**
  (`terminal-theme.css:139-146`). Same mechanism as N2: a `.terminal-theme.staff-v2 *`
  override. Chips must then re-assert their pill radius above it.
- **N4 — Nothing inherits font-size in this app** (`.terminal-theme *` sets 1.5rem on every
  element). The type roles cannot be "set on the container"; each text element carries its
  px inline or its own class. Every `fontSize` in the new markup will be load-bearing (the
  PR #89 lesson) — budget for it and comment it.
- **N5 — The case rule is copy, not cascade.** No `text-transform: uppercase` exists in
  `terminal-theme.css`, `staff-shell-v2.css`, `staff-form.css`, or `index.css`; the single
  cascade caps rule is `StaffPageHeader.tsx:49`. Every other caps string is authored caps.
  Sentence-case = editing strings in every v2 component (and choosing which are Label-role
  and stay caps). Larger diff than the audit implies; every string change is a screenshot
  diff the reviewer must accept.
- **N6 — §D "trivia adopts the spacing scale + type role NAMES" touches frozen files.**
  Scoring/host tools are not behind `ui_version`; they render the same in both shells.
  Even a rename-only refactor of `.scoring-page` constants is a diff to a frozen surface
  that must be proven byte-identical by PNG sha256. Recommend: **out of Beat 6**; adopt on
  the next trivia touch.
- **N7 — D1's "text-swap confirm" for Top Sellers REMOVE replaces a shipped ratified
  DECISION.** PR #103 put `ConfirmDialog` in front of v2 REMOVE (classic has no confirm).
  D1 swaps the dialog for tap-again-in-3s. Both are write-preventing, so RULE #1 holds
  either way, but it reverses a tagged DECISION and needs saying in the PR.
- **N8 — E1's alert strip needs the hub's arm derivation on HOME.** The "trivia not armed"
  context is computed in the hub (`signageHubShared` ctx: active game + venue arm flag).
  HOME must call the SAME function (hub/HOME parity, like hub/TV parity) — a hoist into
  `signageHubShared.tsx`, no new query shape. `Dashboard.tsx` already reads tonight's game;
  the arm flag read is the addition (read-only, existing `venue_settings` row).
- **N9 — The audit's "no iOS codebase exists" is wrong.** Bunker Control (SwiftUI, iPad)
  lives in worktree `.claude/worktrees/agent-a82ad84cd93100297/apps/bunker-control-ios/`
  (branch `phase-bunker-control-v1`, unpushed, 17 app commits, iOS 17+, XcodeGen project,
  `com.bunkerokc.bunkercontrol`). Its theme is ONE file, `BunkerControl/Theme/Theme.swift`
  (`enum Theme` static lets + `TerminalPanel`/`Chip`/`Eyebrow`/`TerminalButtonStyle`/
  `EmptyState` views). **Token-name check (Marvin ask, 2026-09-11) — iOS branch NOT changed
  in this beat; this is the reconciliation list for whoever ports the tokens:**

  | Okuda §B (SwiftUI name) | Bunker Control today | Mismatch |
  |---|---|---|
  | `Color.staffBackground` #0B0D10 | `Theme.bg` #050505 | name + value |
  | `Color.staffSurface1..4` (4 lightness tiers) | `Theme.panel` #0E0E0E, one tier | no elevation ladder on iOS |
  | `Color.staffTextPrimary/Secondary/Disabled` (white-alpha 0.87/0.60/0.38) | none — primary UI text is `Theme.amber` #FFB000, secondary `dimAmber` (0.55α) | **iOS runs the AMBER color-state as its text base; Okuda's white-alpha base has no counterpart** — the central A1 deviation must be ported deliberately, not renamed |
  | `Color.staffAccent` #7FE6A8 (calmed) | none — `Theme.green` #00FF41 is used for live/fresh signals | closest role is `staffAccentLive`; there is no calmed accent on iOS |
  | `Color.staffAccentLive` #00FF41 | `Theme.green` #00FF41 (+ `dimGreen` 0.45α for chrome/rules) | value matches, name differs |
  | `Color.staffAmber` #E8B04B (ambient/pending) | `Theme.amber` #FFB000 (PRIMARY UI + `HealthChip.stale`) | same hue family, opposite job + uncalmed value |
  | `Color.staffDanger` #FF5A5A | `Theme.red` ≈ #FF4036 (fault/offline) | value differs; iOS also spends red on offline health, Okuda's budget says failure states are in-budget so OK |
  | `Color.staffHairline` 1px white 0.08α | `dimGreen`/`dimAmber` 1px strokes on every panel/chip/button | iOS is still the "wireframe" look Okuda removes |
  | `Radius.staffControl` 6 / `staffCard` 6 / `staffSheet` 10 / chips pill | `cardRadius` 4, buttons 3, chips 2, sheets = iOS default | all differ |
  | `.staffFont(.display/.heading/.body/.label/.monoData)` 28·17·14·12·14 px (390) | `Theme.title` 30 / `cardTitle` 26 / `body` 17 / `label` 13 / `big` 21, SF Mono `.monospaced` | sizes are iPad-arm's-length by ruling ("dead simple, big buttons"), face is SF Mono not JetBrains/Share Tech — role NAMES can map (title→display, cardTitle→heading, body→body, label→label; `big` and `monoData` have no partner) |
  | `Spacing` 4·8·12·16·24·32·48 | no scale — literal paddings (18, 9/5, 40, 14) | none exists |
  | 44px tap floor | `controlHeight` 62 | iOS deliberately larger (owner ruling) |
  | case rule (Label-only caps) | `Chip`/`Eyebrow`/`EmptyState` force `.uppercased()` in code | same authored-caps pattern as web (N5) |
  | motion budget | none declared (`isPressed` opacity 0.6 only) | none exists |

  Net: nothing in Bunker Control is named `Color.staff*` / `.staffFont` — a port is a new
  `Theme` surface, not a rename, and the amber-as-text-base decision on iOS needs Stephen's
  word before A1 crosses over.
- **N10 — Hold-to-confirm** — MOOT for Beat 6 (D1 amended: ConfirmDialog kept).
- **N11 — HOME has no v2 variant today.** `/dashboard` renders the classic `Dashboard`
  inside `StaffShellV2`. Any HOME change (E1, C3, tokens) needs a `DashboardV2` behind the
  same `useUiVersion` branch pattern as Users/DrinksAdmin/SignageHub — additive, but it is
  a new page, not a restyle.

---

## 5. Proof + close-out checklist (fill at PR time)

- [ ] classic PNG sha256 + innerHTML identical, every staff route, from a `main` worktree
- [ ] v2 shots 390 + 1280 per touched page → `beat6-shots/`
- [ ] 44px floor asserted (width + height)
- [ ] `pnpm typecheck` · `pnpm build` · `pnpm test:tvchunk` → `TV CHUNK: CLEAN`
- [ ] reviewer verdict verbatim in PR · WARNs folded · addendum
- [ ] Stephen's word · merge · deploy green · prod hash == clean-worktree build · TVs +10 min
- [ ] `*.test` users = 0 · no `__harness` residue · `docs/15 §Hub` addendum if v2 default flips

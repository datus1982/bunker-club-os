# Beat 1 — new staff shell + navigation, behind a switch (2026-09-08)

*Handoff from Marvin (orchestrator) to the repo session. Design source: `00-audit-and-ia-2026-09-08.md` (Okuda).
Charter + RULE #1: `~/Marvin/projects/bunker/bunker-os-ux-overhaul.md`. Build with the CODE specialist; gate with the
reviewer; owner reviews screenshots.*

## Owner decisions (2026-09-08, final)
- **A → promote MEDIA to a top-level nav section now** (Library · Playlists · Screens & Programs).
- **B → rename TRIVIA → GAMES now**, with a reserved `READ THE ROOM — COMING SOON` slot beside TRIVIA and SEASONS.
- **C → Users on phone becomes stacked cards** (name / role / actions), no sideways table (lands in Beat 2, but the ListRow primitive is built here).
- **D → Top Sellers ▲/▼ reorder buttons to 44 px: fix NOW** as a tiny standalone PR ahead of Beat 1. Zero risk.
- **E → legacy public `/drinks` display route: leave exactly as is + `noindex`.** No redirect during the overhaul.

## RULE #1 (owner): nothing breaks, nothing goes offline
Additive only · behind a switch · TVs frozen (`/signage/s/*`, `/game/preview`, `/drinks` rendering and URLs untouched)
· no schema change (the switch is a per-user preference stored where `venue_staff` prefs already live, or
localStorage if no column exists — do NOT add a migration for it) · reviewer pass + real-data screenshots at 390 px
and desktop + `signage_slots.last_seen` heartbeat check after deploy.

## Scope of Beat 1
1. **`ui_version` switch.** Per-user toggle (`classic` | `v2`), default `classic`. A "Try the new layout" control
   in the staff header and a way back. Owner + one staff account flip first.
2. **Shell primitives** (specs in the audit §5): `StaffPageHeader` (eyebrow + h2 + tag), `SectionNav` (two-tier
   bar + phone drawer; absorbs `StaffNav`'s duplicate `useIsMobile` into the shared hook), `ListRow` (built now,
   used by Users in Beat 2), `EmptyState`, `InlineNotice`.
3. **Navigation per the ratified shape, extended:** HOME · **GAMES** (TRIVIA: Scoring · Game Setup · Teams · History |
   READ THE ROOM: coming-soon placeholder | SEASONS) · **BAR OPS** (Signage Hub · Events & Promos · Top Sellers) ·
   **MEDIA** (Library · Playlists · Screens & Programs — the existing Media surfaces re-linked, no new features) ·
   **SYSTEM** (Users · Settings). Phone: section names as sticky headers, one thumb-scroll, HOME pinned top,
   VIEWING-AS/SIGN-OUT pinned bottom (mockup view 3). No third tier.
4. **Every existing route keeps its path.** v2 wraps the current page components in the new shell; classic renders
   exactly as today. Retired paths (`/signage/broadcast`, `/signage/events`) show an InlineNotice "this moved to …"
   instead of a silent redirect.
5. **Bake the staff styling into the shell** so a page can no longer miss `.staff-ui` (audit finding #12):
   Share Tech Mono headers, JetBrains Mono body, 2 px glow, 44 px tap targets — from the shell, not per page.
6. **Tiny-fix first (D):** Top Sellers reorder buttons → 44 px, separate PR, merged before Beat 1 opens.
7. **`noindex` on `/drinks` (E):** meta tag only. Nothing else about that route changes.

## Out of scope (later beats)
Component swaps inside pages (Beat 2 SYSTEM, Beat 3 BAR OPS), Media features, Read the Room itself, any TV template.

## Acceptance checklist (reviewer + owner)
- [ ] Classic mode byte-for-byte unchanged in behavior; v2 off by default.
- [ ] Screenshots, real data: Dashboard, Users, Signage Hub, Scoring — each at 390 px and desktop, v2 and classic.
- [ ] Phone nav operable one-handed; every section reachable in ≤ 2 taps.
- [ ] Reviewer PASS; no `!important` additions to `terminal-theme.css`.
- [ ] Deploy green; `signage_slots.last_seen` advancing on every screen 10 min after deploy.
- [ ] Owner flips `v2` on his own account and answers one question: "keep, tweak, or back."

## Owner review loop
One artifact page (or the proven screenshot page), versions round-1/round-2, one decision per round, letters.

---
## Addendum 2026-09-08 — rulings after the repo session's live-code read (bunker-club-os-47)
Verified by the repo session against the working tree; Marvin's rulings:
1. **Strike** "absorbs StaffNav's duplicate `useIsMobile`" — already fixed (all call sites import `@/shared/useIsMobile`). Audit finding #4 is closed.
2. **D is a one-liner:** `minWidth: 44` on the shared `btn` style in `DrinksAdmin.tsx` (height already 44). Still its own tiny PR.
3. **MEDIA links in Beat 1 = hash anchors on `/signage`** (`#library`, `#playlists`, `#screens`) that expand + scroll the section. No new routes. Real `/media/*` paths are Beat 4's decision.
4. **SETTINGS under SYSTEM gets the same COMING SOON treatment as READ THE ROOM** (it is still the Phase 1 placeholder). Never link a placeholder page as if it were real.
5. **`ui_version` lives in localStorage → per DEVICE, not per account.** Owner told plainly. The toggle must be discoverable in BOTH shells so there is always a way back. No migration for a prefs column in this phase.
6. **E via an App.tsx route wrapper that injects `<meta name="robots" content="noindex">`** around `/drinks`. Not robots.txt (Disallow only stops crawling), and not inside `DrinksDisplay.tsx` (frozen file).
7–9. Phone drawer already matches mockup view 3 → v2 mobile is a restyle + two new sections. TRIVIA→GAMES + placeholder = data edit to `SECTIONS` with a `comingSoon` flag on `NavChild`. Retired redirects → `InlineNotice` each. Agreed.
10. **Item 5 ("bake `.staff-ui` into the shell") is already satisfied** by `StaffLayout` wrapping `terminal-theme staff-ui`. Okuda's finding #12 only bites pages outside StaffLayout (Login, ResetPassword, checkin). **Ruling: out of Beat 1** — those are public / walk-up surfaces with their own distance rules; do not move them. Item 5 → struck.
**Build lane:** bunker-club-os-47 is the build lane for D then `phase-ux-beat-1`. Marvin did not start session `bunker-club-os-c2`; treat it as Stephen's until he says otherwise, and avoid the tree until confirmed. The two `docs/ux-overhaul/*.md` files are handoff artifacts — commit them on the Beat 1 branch.

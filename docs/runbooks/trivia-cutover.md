# Runbook — Trivia Cutover (OptiDev → Bunker OS)

The deliberate act of moving Wednesday trivia off the legacy OptiDev system onto the
Bunker OS platform. The platform's host tools are built and proven; this is the
operational plan to flip it on for a real Wednesday with minimal risk. Companion to
`docs/03-MIGRATION-OPTIDEV-EXIT.md` (the original migration plan) — this runbook
supersedes its steps 4–6 with the two ratified decisions below.

## Ratified decisions (owner, 2026-07-21)

1. **Clear the board — everyone starts fresh.** History didn't matter much, and the
   244 orphan legacy teams (imported records with zero members and no PIN) made
   self-service check-in dead-end for returning regulars. So at cutover we **archive
   all legacy teams** and every crew starts on the clean create-team path. Historical
   games/scores/questions stay in the DB (hidden, reversible) — teams are only hidden,
   never deleted.

2. **Host-primary check-in on night one.** The night does NOT depend on a full room
   getting email OTP codes to arrive (compounded by known iCloud-junk deliverability).
   The host creates + checks in each crew from the Scoring console. Self-service
   check-in is the opt-in path patrons adopt over following weeks.

## Operational facts (for whoever runs this)

- Venue id: `11111111-1111-1111-1111-111111111111`. Supabase project ref: `ysrqvdutayirpoibdlbf`.
- Apply SQL via the Management API: `POST https://api.supabase.com/v1/projects/ysrqvdutayirpoibdlbf/database/query`
  with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` (root `.env`), body `{"query":"…"}`.
- TV kiosk slugs (already live on the bar TVs): `/signage/s/portrait-main`, `/signage/s/landscape-bar`.
  During a live game the signage auto-takes-over to game mode both orientations (Phase 5).
- Host tools: `/game/setup` (create game), `/scoring` (run the night), `/leaderboard` (standings board).
- Legacy OptiDev is untouched by all of this and keeps running until we deliberately repoint. **Rollback = repoint OptiSigns URLs back.**

---

## Phase 1 — Prep (the week before)

- [ ] **Ronnie gets a host login.** Admin → `/admin/users` → INVITE STAFF → his email, title
      **host**, module **trivia**. He accepts the emailed link (check junk — see the SMTP runbook).
- [ ] **Ronnie runs a full practice game** end-to-end on `/game/setup` → `/scoring`, on a
      throwaway game (id like `fa11face-…`, deleted after): create game, enter/import a deck,
      add a couple of teams via **+ CREATE NEW TEAM**, score a round, walk the board stages
      (JOIN QR → hide scores → per-round reveal → final), a video round, a picture round.
      Goal: no surprises for his hands on the night.
- [ ] **Confirm the TVs enter game mode from NEW game data.** Start a throwaway game while a
      TV is on its kiosk slug; verify portrait → LeaderboardBoard and landscape → GameDisplayBoard
      take over, and that they return to rotation when the game is set `completed`. (Heartbeat-first
      if verifying remotely: `signage_slots.last_seen` fresh.)
- [ ] **Email deliverability sanity** (only matters for the self-serve opt-in path, not the
      host path): confirm Resend rate limit has headroom for a pre-game rush (currently 100/hr;
      ~one OTP per self-serving team) and that a test OTP lands (check junk). SPF/DKIM/DMARC
      are all in place.
- [ ] **Print the new JOIN QR.** `/checkin/qr` (or point a table sign at `os.bunkerokc.com/checkin?source=qr`).
      Keep the OLD OptiDev QR sign in a drawer until 30 days post-cutover (rollback).
- [ ] **Pick the cutover Wednesday** and confirm the OptiSigns schedule / spare screen plan for the parallel run.

## Phase 2 — Parallel run (one Wednesday, before committing)

Score one real night in BOTH systems (or score legacy for real, shadow-score the new one):
- [ ] OptiSigns keeps pointing at OptiDev URLs (production unchanged).
- [ ] Ronnie also opens the new `/scoring` on a second tab and shadow-scores the night.
- [ ] Watch a new `/game-display` / `/leaderboard` on a spare screen.
- [ ] Confirm scoring math, wildcards/bonuses, board stages, and standings match his expectation.
- If clean → schedule the real cutover. If not → fix, re-rehearse.

## Phase 3 — Cutover night

Run in this order:

1. [ ] **Archive the board** (makes it pristine — see the SQL block below). Do this shortly
      before doors, once, from the Management API. Verify the count.
2. [ ] **Host creates the game** on `/game/setup` FIRST (nothing can check in until a game
      exists). Enter/import the deck.
3. [ ] **Point the TVs' game mode at the new game** — they auto-take-over once the game is
      active (no manual repoint of the kiosk slugs needed; they're already on the new platform).
4. [ ] **Check crews in — host-primary:** as each crew calls out its name, host does
      `/scoring` → ADD TEAM → **+ CREATE NEW TEAM** (name it, ADD) → they're in. Phoneless
      crews never touch a phone. (Zero-fill handles late arrivals automatically.)
5. [ ] **Self-serve is available but optional:** the JOIN QR lets a crew create their own
      team (portal + PIN + season history going forward). Encourage it, don't require it.
6. [ ] **Run the night** on `/scoring` with Ronnie's board-stage choreography.
7. [ ] **Repoint OptiSigns** off the legacy URLs to the new kiosk slugs / leaderboard —
      OR, if the TVs are already on the new slugs, there's nothing to repoint; just retire
      the legacy display schedule. Swap the table QR signs to the new JOIN QR.

## Phase 4 — After

- [ ] Leave OptiDev **alive but unused for 30 days** (rollback window). Keep the old QR sign.
- [ ] After 30 clean days, close OptiDev.

---

## The archive step (SQL — reversible)

**Run once, at cutover (Phase 3 step 1).** Hides every legacy team from all patron-facing
surfaces (check-in search + "my teams" both filter `archived = false`) without deleting any
history. Historical games/scores/questions are untouched and stay queryable.

```sql
-- Clear the board: archive all currently-active teams for the venue.
update public.teams
set archived = true
where venue_id = '11111111-1111-1111-1111-111111111111'
  and archived = false;

-- Verify (expect the archived count to jump; active count → 0):
select count(*) filter (where archived) as archived,
       count(*) filter (where not archived) as active
from public.teams
where venue_id = '11111111-1111-1111-1111-111111111111';
```

**Rollback (un-clear the board)** — if you ever want the legacy teams back:

```sql
-- CAUTION: this un-archives EVERY team, including any created after cutover.
-- To restore ONLY the pre-cutover legacy teams, snapshot their ids BEFORE archiving
-- (select id from teams where venue_id = '…' and archived = false) and un-archive by id list.
update public.teams
set archived = false
where venue_id = '11111111-1111-1111-1111-111111111111'
  and archived = true;
```

> **Tip:** before running the archive, capture the id list so rollback is surgical:
> `select id from public.teams where venue_id = '11111111-1111-1111-1111-111111111111' and archived = false;`
> Save it; the rollback can then target exactly those ids instead of everything.

## Rollback (the whole cutover)

The only integration point is the OptiSigns URL schedule. To roll back: repoint OptiSigns
URLs to OptiDev, put the old JOIN QR sign back, and (optionally) un-archive the board.
Ronnie resumes on the legacy system. Keep the old QR sign until 30 days post-cutover.

## Notes / known trade-offs

- Host-created walk-up teams have no captain member (a plain team insert). That's correct —
  the host isn't the captain. A crew that later wants a persistent self-serve identity
  (portal/PIN/season history) should create their own team via `/checkin` rather than
  reuse the host-created record. At host-primary volume, duplicates are unlikely (the host
  sees existing teams in the picker before creating).
- The orphan-team claim path and duplicate-guard were considered and **dropped** — the
  clear-the-board decision makes them moot (no bulk legacy orphans to reclaim).
- Season: cutover is a clean-slate first season on the new platform. Decide season timing
  when scheduling the cutover Wednesday.

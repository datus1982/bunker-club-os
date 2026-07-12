# 05 — Module: Team Registration v2 ("the device remembers you")

## Requirements (from owner)

- Persistent team registry; teams recur week to week.
- Multiple people per team, multiple emails/phones; attendance rotates — ANY member can check the team in.
- Recall must be near-instant for regulars; first-time flow simple enough for someone two beers deep on a Wednesday.
- OTP ("2FA style") acceptable; owner suggested it.
- Feeds seasons + portal (06/07): check-in identity is the same auth identity.

## Flow spec

### Entry
QR on tables/host stand → `/checkin?source=qr`. Also linked from portal.

### State machine
```
[scan] → has valid session? ──yes──> RETURNING
                    └──no──> IDENTIFY
IDENTIFY: enter email (v1) or phone (v2/Twilio) → OTP 6-digit → verified → profile ensured
  → member of ≥1 team? ──yes──> RETURNING
                       └─no──> NEW_PLAYER
RETURNING: "Welcome back, {name}" + list of my teams (most-recently-played first)
  → tap team → CHECK-IN CONFIRM (shows tonight's game date, team display name editable)
  → check_in_team RPC → DONE ("You're in. Good luck, {team}.")
  Edge: no active game tonight → friendly "no game running" screen with next game date if scheduled.
  Edge: team already checked in → "Already checked in by {member} at {time}" + option to view.
NEW_PLAYER: two buttons:
  [Start a new team] → team name (+ optional logo later) → creates team + membership(captain) → CHECK-IN CONFIRM
  [Join an existing team] → search team by name → two join paths:
      (a) a current member approves from their phone (portal notification/simple pending list), or
      (b) enter team PIN → verify-team-pin edge fn → membership created
DONE screen: shows season rank teaser if active season ("The Regulators — #3 in Summer Circuit") → link to portal.
```

Target: returning player = scan → 1 tap. First-timer = scan → email → code → team → tap. No passwords ever.

### Members management
In portal (07): list members, add member by email/phone (creates pending profile invite — they claim it at first OTP login), remove member (captain only), set team PIN (hashed via edge fn; used only for join-by-PIN fallback).

## Implementation notes

- Supabase Auth `signInWithOtp({ email })` — free, built-in. Phone OTP behind a config flag; enable when Twilio creds exist (~$0.01/msg; volume is trivial).
- Session persistence default (localStorage) gives the "remembers you" behavior.
- `check_in_team(game_id, team_id, display_name)` — security-definer RPC (02): validates membership, inserts game_teams with `checked_in_by = auth.uid()`, runs zero-score backfill for completed rounds atomically (logic ported from AddTeam.tsx:180-205).
- `verify-team-pin` edge function: rate-limited (5 attempts / 15 min per IP+team), compares against `pin_hash`, on success inserts team_members for caller. PIN never travels to any client SELECT.
- Walk-up fallback (no phone): host can check any team in from /scoring (host role bypasses membership check) — Ronnie's escape hatch, and how paper-and-pencil teams still play.
- Kill the old /add-team route; /checkin replaces it. Keep a redirect.

## Anti-goals
No passwords. No email verification beyond OTP. No team approval workflows beyond the two join paths. No profile photos/avatars v1.

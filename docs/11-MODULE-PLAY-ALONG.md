# 11 — Module: Solo Play-Along (backlog — Phase 6)

## Origin & constraint
Teams answer on PAPER by design; phones are discouraged for team play and that stays true. But solo bar patrons — people at the bar who notice trivia happening and want in — are a separate audience. Play-along gives them a parallel, phone-native game with zero effect on the team competition. It's also a conversion funnel: tonight's solo player is next month's new team.

## Flow
- Same QR / URL as check-in: the `/checkin` landing offers two paths — **CHECK IN MY TEAM** and **PLAY ALONG SOLO**.
- Solo path v1: Supabase anonymous sign-in + display name (no OTP required — friction must be near zero). Optional "save my streak" upsell converts anon → OTP account after the game (Supabase supports anonymous→permanent identity linking).
- Player screen mirrors `game_display_state` in realtime: shows current round/question number and a single answer text field. NO question text on the phone v1 — the room's display/host reading is the source; the phone is an answer slip. (Keeps eyes up, keeps it social, and sidesteps question-leak concerns.)
- Submission window: open while `show_answer = false` for the current question; the moment the host reveals, submissions lock and the player sees correct/incorrect + running score.
- Between rounds / game over: personal scorecard + solo leaderboard (phone-only v1; optional "TOP OPERATIVES" slide on GameDisplay between rounds as a v2 flourish).

## Data
```sql
create table play_along_entries (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games on delete cascade not null,
  profile_id uuid references profiles not null,   -- anon auth users get profiles too
  display_name text not null,
  created_at timestamptz default now(),
  unique (game_id, profile_id)
);
create table play_along_answers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references play_along_entries on delete cascade not null,
  question_id uuid references questions not null,
  answer_text text not null,
  submitted_at timestamptz default now(),
  is_correct boolean,
  unique (entry_id, question_id)
);
```
Submission via RPC `submit_play_along_answer(entry_id, question_id, answer_text)` — security definer; validates the question is the currently displayed one AND `show_answer = false` (server-side gate, not client). Grading runs on answer reveal (trigger on game_display_state.show_answer, or in the host's reveal RPC path), server-side only — clients never grade. Pipeline per submission, in order:
1. Normalize both sides: lowercase, trim, collapse whitespace, strip punctuation, drop leading articles (the/a/an).
2. Exact match after normalization → correct.
3. Typo tolerance via Levenshtein, budget SCALED BY LENGTH of the correct answer: ≤4 chars → 0 edits; 5–8 → 1; 9+ → 2. (Flat tolerance wrongly equates cat/car.)
4. Numeric equivalence: digits ↔ number words ("8" == "eight").
5. Surname convention: if correct answer is a multi-token proper name, accept a normalized match on its FINAL token only ("Kennedy" scores vs "John F. Kennedy"; "John" does not).
6. Check `accepted_answers text[]` (NEW column on questions) — known aliases, same pipeline per alias.

Human backstop (build this — it's what makes fuzzy matching sufficient): on the host's Scoring page after a reveal, show near-miss submissions clustered by normalized text with an "Also accept" button — one tap appends the alias to accepted_answers and regrades that question for all entries. Mirrors a live host ruling on paper answers.

Per-question `solo_gradable boolean default true` flag: multi-part or quote/description questions can be excluded; the answer slip shows "team question — sit this one out."

Ties on score broken by cumulative submission speed.

## Guardrails
- Display names: length cap + basic profanity list; host can remove an entry from /scoring.
- Rate limit: 1 submission per question per entry (DB unique), RPC rejects after lock.
- Absolutely no linkage to team scores; solo results never affect season standings.
- IMPORTANT product rule: this must never become a backdoor for teams to look up answers — hence no question text on phones v1 and server-side submission lock.

## Why this is cheap
Rides entirely on existing rails: game_display_state realtime (already built for GameDisplay), questions table, auth. New surface is one phone page + two tables + one RPC + a grading function.

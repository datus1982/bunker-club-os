# 15 — Module: Media (landscape reimagined for regular bar use)

> Drafted 2026-07-16 from the owner's direction (memory [[media-module-direction]] + this
> session's brief): "Reimagine the landscape display for our regular bar use. Media library
> system. Live input from HDMI UVC capture. Also thinking a multiview mode to show the 16:9
> media/capture content with a portrait frame next to it running some slides."
> Ratification mockup: `docs/media-module-mockup.html`. Nothing here builds until the owner
> ratifies the mockup's decisions.

## Goal

The landscape bar TVs never leave Bunker OS. Beyond today's rotation/trivia-takeover they gain:
ambient video (a local library with playlists and schedules), live HDMI sources (cable box,
console, camera — anything through a UVC capture stick), and a **multiview** that pairs the 16:9
media/capture feed with a portrait panel running slides — so ads keep working while video plays.

## Hardware reality (load-bearing constraints — read first)

1. **UVC capture requires a computer.** A TV's built-in browser has no USB input. The capture
   feed reaches the page via `getUserMedia` (a UVC stick enumerates as a webcam), which means a
   real machine with the stick plugged in must render the slot.
2. **Local video over LAN is blocked by mixed content.** The app is served over https; a page
   can't fetch `http://192.168.x.x/video.mp4`. But `http://127.0.0.1` **is** a secure context —
   a page may fetch media from a server on its own machine.
3. Both constraints resolve the same way: **a media PC drives the media-capable landscape TV
   over HDMI**, running a thin Electron kiosk shell (`apps/media-shell/`) that (a) loads the
   normal slot URL, (b) serves the local video files at `http://127.0.0.1:{port}`, (c) has the
   capture stick attached, camera permission pre-granted, and unmuted autoplay allowed.
   Every other screen keeps its dumb built-in browser — nothing changes for them.

The shell is deliberately thin: all UI and logic live in the web app and ride normal deploys.
The shell only provides what a browser can't: local file serving, granted permissions, kiosk
boot, a crash watchdog.

## Concept: PROGRAMS

The slot mode ladder (docs/09 §Screens, as amended by docs/13) keeps its top tiers and gains a
programmable bottom tier:

```
takeover > MOMENT stages > live game > PROGRAM
```

where today's rotation is simply the default program. Program kinds:

| Program | Renders |
|---|---|
| `rotation` | today's behavior (slot_queue rotation) — the default, and the only kind portrait slots use |
| `playlist` | a media-library playlist looping (native `<video>`, files from the local shell) |
| `capture` | the live UVC input (`getUserMedia`) |
| `multiview` | 16:9 main region (playlist **or** capture) + a portrait panel running a slide rotation |

Program state lives on the slot row (`signage_slots.program jsonb`, null = rotation) and is
switched from the hub screen card (SWITCH PROGRAM control) — realtime, no reload, same as every
other admin action. Takeovers, MOMENT stages, and live trivia still override any program, so
Wednesday night behaves exactly as today.

**Schedules** (phase M3): a per-slot daypart table so programs flip themselves — plain-phrase UI
like the events recurrence builder ("daily 4 PM–close → PLAYLIST 'Atomic Ambience'"), never cron.
Resolver order: active schedule row > manual program > rotation.

## Media library

- **Files live on the media PC** in a watched folder (e.g. `~/BunkerMedia`). Adding content =
  dropping files in the folder (or any sync tool the owner likes pointing at it). No cloud
  video storage: streaming ambient video 12h/day through Supabase would burn bandwidth for
  nothing and die with the internet connection; the LAN copy is free and outage-proof.
- **Metadata syncs up** so the phone admin works from anywhere: the shell watches the folder,
  probes duration/dimensions, generates a thumbnail, and reports to a new edge function
  `media-catalog-sync` (device-token gated, service-role upsert — same shape as the CRON_SECRET
  pattern) which maintains `media_files` rows + thumbnails in the `signage` bucket. Files
  removed from disk mark `status='missing'` (never auto-delete rows).
- **Playback** is a native `<video>` element sourcing `http://127.0.0.1:{port}/media/{hash}`.
  On a machine that isn't the media PC (staff preview, hub), the player shows the thumbnail +
  a `MEDIA HOST OFFLINE` chip instead — previews stay honest without needing the files.
- **Codecs:** H.264 MP4 is the safe target (plays everywhere); the shell flags files it can't
  probe/serve rather than silently skipping.
- Audio: the media PC's audio out feeds the bar system (owner's routing call). The Electron
  shell allows unmuted autoplay, so `shared/videoAudio.ts` gates simply pass; in ordinary
  browsers the existing muted-boot + probe pattern applies.

```sql
create table media_files (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  filename text not null,            -- relative to the watched folder
  title text,                        -- editable in the hub; defaults from filename
  hash text not null,                -- content hash; the playback URL key
  duration_seconds numeric,
  width int, height int, size_bytes bigint,
  thumb_path text,                   -- signage bucket
  status text not null default 'present' check (status in ('present','missing','unsupported')),
  added_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (venue_id, hash)
);

create table media_playlists (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  name text not null,
  source text not null default 'custom' check (source in ('custom','folder')),
  folder_path text,                  -- for source='folder': the subfolder this mirrors
  presentation text not null default 'framed' check (presentation in ('framed','fullbleed')),
  shuffle boolean not null default false,
  created_at timestamptz default now(),
  unique (venue_id, folder_path)     -- one auto-playlist per folder
);

create table media_playlist_items (
  playlist_id uuid references media_playlists on delete cascade not null,
  file_id uuid references media_files on delete cascade not null,
  position int not null default 0,
  primary key (playlist_id, file_id)
);
```

Plus `alter table signage_slots add column program jsonb` and (M3) a `slot_program_schedule`
table. RLS on all new tables copies the `slot_queue` block verbatim: anon SELECT (TVs are anon),
`has_module('signage')` manage. Realtime on `media_files`/`media_playlists`/playlist items +
`signage_slots` program changes.

`program` jsonb shapes:
```
{ "kind": "playlist",  "playlist_id": "…" }
{ "kind": "capture",   "device_match": "USB3 Video", "audio": true }
{ "kind": "multiview", "main": { …playlist-or-capture shape… }, "panel_slot_id": "…" }
```

## Live input (capture)

`getUserMedia` selecting the device whose label contains `device_match`; render the
`MediaStream` in a `<video>`. Device absent / permission denied → a skinned `NO SIGNAL —
CHANNEL {n}` card (never a black screen, never a browser permission prompt on a TV). Capture
latency is fine for ambient use. Audio passthrough optional per-program.

## Multiview

Landscape canvas 1920×1080 splits into:
- **Panel (portrait sidebar):** a true 1080×1920 portrait surface scaled ×0.5625 → 607×1080.
  It renders the EXISTING portrait rotation stack (same templates, same resolver) for a
  **panel slot** — a real `signage_slots` row (`kind='panel'`, orientation portrait, no TV, no
  heartbeat) that appears in the hub as a screen card with a PANEL badge. Its queue is managed
  with the untouched QUEUE slide-over — this is exactly why the slot_queue junction matters:
  the panel is just another screen to the whole admin surface.
- **Main region (1313×1080):** the 16:9 playlist/capture content (1313×738) vertically
  centered, with the slot's chrome header above and ticker footer below filling the remainder
  (the frame IS the OS — the mockup also shows a full-bleed variant for the owner to choose).

Panel slot seeding is a migration concern only when the owner adds a multiview (hub gets an
ADD PANEL affordance rather than pre-seeded rows).

## Hub changes (`/signage`)

- New **MEDIA** section: library grid (thumb, title, duration, PRESENT/MISSING chip),
  playlist list + editor slide-over (ordered rows, ▲/▼, shuffle + audio toggles). Ingestion
  helper text points at the media PC folder — no upload path in v1.
- Media-capable screen cards gain the **PROGRAM** control (ROTATION / PLAYLIST / LIVE INPUT /
  MULTIVIEW) with a mode chip mirroring what the TV shows (hub/TV parity invariant — the
  program resolver is shared, like `resolveSlotMode`).
- Panel slots render as screen cards (PANEL badge, no health dot semantics — health belongs to
  their host screen).

## Electron shell (`apps/media-shell/`)

Config file on the device: slot slug, device token, media folder, port. Behaviors: kiosk
fullscreen on boot → `https://os.bunkerokc.com/signage/s/{slug}`; localhost media server
(range-request capable — `<video>` seeking needs it); folder watcher → `media-catalog-sync`;
camera permission auto-grant + autoplay policy; reload-on-crash watchdog; auto-launch at login.
No auth user on the device — the web page stays anon like every TV; only the catalog sync
authenticates, via the device token to the edge fn.

## Phasing (each = branch → PR → reviewer verdict verbatim → owner merges)

- **M1 — library + playlist:** migration (tables + `program` column + storage mime/size for
  thumbs), `media-catalog-sync` edge fn, shell v0 (serve + catalog + kiosk), hub MEDIA section,
  `playlist` program end-to-end on the office demo screen.
- **M2 — capture + external control (AMENDED 2026-07-17, owner: "push into M2 now and fold this in"):**
  the `capture` program (getUserMedia on the shell's capture card — the Roku; fullbleed
  default per the ratified answers, framed override; skinned NO SIGNAL card, never a black
  frame or a permission prompt; audio passthrough — always-on at the PC, staff gate at QSYS)
  + **the Q-SYS control surface**: a token-gated `media-control` edge fn accepting
  `{slug, cmd}` — program-level commands (`playlist <name|id>` / `rotation` / `capture`)
  write `signage_slots.program` exactly as the hub does (single source of truth; TV via
  realtime, hub chip follows), and transport-level commands (`pause` / `resume` / `next`)
  ride a Supabase realtime broadcast channel `media-cmd:{slug}` the player subscribes to.
  Q-SYS UCI buttons call the fn via Lua HttpClient (runbook with the command list, curl
  tests, and an example Lua snippet: `docs/runbooks/qsys-media-control.md`). New secret
  `QSYS_CONTROL_TOKEN` (separate from the shell's device token — different holder,
  independently revocable). M2 deliberately touches NO shell code — the installer already
  staged on the drive remains valid.
- **M3 — multiview + schedules:** panel slots, multiview renderer, `slot_program_schedule` +
  plain-phrase schedule UI.

## Owner answers — RATIFIED 2026-07-16 (all five open questions answered; M1 authorized)

1. **The media PC exists:** a mini Windows PC already at the bar, capture card already
   attached. ⇒ the Electron shell targets **Windows** (auto-launch at boot, kiosk, watchdog,
   one-time installer); dev verification runs the shell in dev mode on the build machine.
2. **Content:** a huge movie library on his home arrays, with a curated Bunker Club folder
   already maintained — and **movie playlists are preconfigured by folder structure** in his
   drive. ⇒ DESIGN AMENDMENT: **subfolders of the watched media folder are AUTO-PLAYLISTS**
   (folder name = playlist name, order by filename, `media_playlists.source='folder'`),
   synced by the catalog; hub-built `source='custom'` playlists exist beside them. Ambient /
   civil-defense-archival material is also coming. Getting files house→bar-PC is owner-side
   (any sync tool pointed at the folder); he'll expose the folder structure for a naming
   review before M1 closes.
3. **Audio: always on.** The shell outputs the audio of whatever is playing, full stop;
   whether the room hears it is staff's call at the QSYS/Sonos source selection they already
   use. ⇒ no per-playlist/per-program audio toggles in the app.
4. **One capture source: the Roku** (already QSYS-controlled). Single channel, no
   channel-switch UI in v1.
5. **Framed vs full-bleed = a PER-PLAYLIST toggle** (`media_playlists.presentation
   'framed'|'fullbleed'`, default framed): chrome suits archival/odd-ratio material, movies
   run full frame. Capture defaults **fullbleed** (program-level override available).

Playback host discovery: the shell serves media on a fixed default localhost port (constant in
shared code); a `?mediahost=` query param on the slot URL overrides for unusual setups.

## Guardrails

- Display perf rules hold: finite timeouts only, no infinite CSS animation; `<video>` is the
  only continuously-moving element.
- DisplayCanvas invariants hold: fixed-px layout on the 1920×1080 canvas, `?calibrate`,
  nightly-reload, kiosk viewport — the multiview panel is a nested fixed canvas, never
  responsive.
- Trivia is sacred: live game preempts every program exactly as it preempts rotation today.
- POS gates unchanged: the multiview panel's rotation obeys the same 86/POS-visibility rules
  as any portrait screen.
- No franchise IP in skins, copy, or identifiers (principle 5).

---

## M3 — RATIFIED (as amended) — multiview + schedules

> **Status: RATIFIED 2026-07-17 and BUILT (branch `phase-media-m3`, migration 0051).** The owner
> ratified `docs/media-m3-mockup.html` (D1…D9) with **D4 amended to a two-tier hold** and **D5
> resolved consistently** (the rulings are folded into D4/D5 below). M1 (library + playlist) and M2
> (capture + Q-SYS control) are shipped & live. This section supersedes the two thinner M3 notes
> above (§Concept "Schedules" and §Multiview); where they conflict, D4 governs (manual-until-boundary,
> not the old "schedule > manual" one-liner).
>
> **Owner rulings folded in:** D4 gains a SPECIAL EVENT hold (a manual/Q-SYS override that survives
> daypart boundaries and expires at the 04:00 business-day rollover — his "a game running long"
> case); D5 makes a Q-SYS program press default to that SPECIAL EVENT hold (event-driven), with a
> new `schedule` command to resume schedules early.

### What M3 adds

1. **MULTIVIEW** — a landscape program that runs a 16:9 main region (playlist or live capture)
   beside a true-portrait slide **panel**, so specials keep advertising while a game or movie plays.
2. **SCHEDULES** — a per-slot daypart layer that flips programs by time of day in plain phrases
   (day chips, TILL CLOSE — never cron), with a manager-friendly manual-override story.

Both sit at the **bottom of the existing mode ladder** (`takeover > MOMENT > live game > PROGRAM`).
`resolveSlotMode` is **unchanged** — a multiview or a scheduled program renders only while
`mode === 'rotation'`, so takeover / MOMENT / live trivia preempt them exactly as they preempt
rotation today (**D9**).

### D1 — Multiview geometry (the honest 1920×1080 split)

The landscape canvas is a fixed 1920×1080. Multiview splits it, to the pixel:

| Region | Size | Notes |
|---|---|---|
| **Panel** | **608 × 1080** | The real 1080×1920 portrait canvas scaled **×0.5625** (1920·0.5625 = 1080 fills the height; 1080·0.5625 = 607.5 ≈ 608 wide). A nested fixed canvas, never responsive. |
| **Main region** | **1312 × 1080** | 1920 − 608. A flex column: 171px chrome header · **1312×738 16:9 stage** (1312·9/16 = 738 exactly) · 171px ticker footer. The 171px letterbox bands (1080−738)/2 ARE the chrome — no wasted black. |

- Main content is **contained** (letterboxed inside the 1312×738 stage), **never cropped**. A true
  16:9 source (movie, the Roku) fills the stage exactly; odd-ratio archival clips letterbox inside it.
- The ~0.5px horizontal rounding on the panel width is absorbed as a hairline letterbox in the panel.
- **Rejected alt:** a bigger 1466×825 main + 454-wide panel — a 454-wide panel can't be a
  full-height true-portrait scale (it would letterbox to ~807 tall or distort). **608 / ×0.5625 is
  the widest panel that fills the full 1080 height at exact portrait ratio.**

⚠ **Build constraint (M1/M2 code):** the panel is a **nested fixed canvas**, but the shipped
`DisplayCanvas` mutates the **global** `<meta viewport>`, runs a nightly-reload timer, and reads
`window.innerWidth` — it **cannot be nested**. M3 needs a lightweight `FixedCanvas` (transform:scale
only, no global side-effects) for the panel. The transform math is liftable from DisplayCanvas; the
side-effectful hooks are not.

### D2 — Panel content source

The panel renders **some portrait slot's rotation** (ratified mechanism, M1-mockup D7). The open
call is *which* slot. Recommended: ship **both**, selected per multiview:

- **Dedicated panel slot (default):** `ADD PANEL` creates a `signage_slots` row with a new
  `kind='panel'` (orientation portrait, no TV, no heartbeat). Its own curated queue via the
  untouched QUEUE slide-over. Shows in the hub as a screen card with a **PANEL badge, no health dot**
  (health belongs to the host screen).
- **Mirror an existing portrait slot:** `panel_slot_id` points at e.g. `portrait-main`. One queue,
  always in sync with the door screen, zero extra curation. Trade-off: can't tune the panel separately.

Both use the **same** plumbing — the multiview program stores `panel_slot_id` pointing at **any**
portrait slot. Modeling `kind` on `signage_slots` (rather than a separate panel table) reuses the
entire queue/admin/render stack; the panel is "just another screen."

- **Parent link:** derive "hosted by" from `program.panel_slot_id` (scan slots whose multiview
  points at this panel — single-venue, cheap) rather than a denormalized `host_slot_id` back-ref
  (nothing to keep in sync; a panel can in principle be referenced by more than one multiview).
- **Rejected alt:** define the panel's slides inline in the multiview config — loses every queue
  feature (★ featured, POS gating, dwell) and adds a new editing surface.

### D3 — Schedule resolution mechanism

**Recommended: client-derived (Option A), no cron.** A pure `scheduleResolve.ts` (no react/supabase,
exactly like `eventStage.ts`) computes, from anon-readable `slot_program_schedule` rows:

- `activeScheduledProgram(now, venueTz, rows): SlotProgram | null` — the program the covering daypart
  runs (null = rotation / no covering row).
- `nextBoundary(now, venueTz, rows): Date | null` — when the current daypart ends (for a precise flip
  timeout + for computing an override's hold expiry from `program_set_at`, D4).

Re-derived on the SlotDisplay's existing 30s tick **plus a precise `setTimeout` to the next boundary**
(mirrors the takeover `ends_at` handling) so the flip is crisp, not up-to-30s late.

- **Why not a cron tick (Option B):** a pg_cron writing the active program into `signage_slots.program`
  is **less** resilient (a TV offline at the boundary misses the realtime write and stays stale) AND
  it **collides** with the manual-override column, destroying the manual-vs-scheduled distinction that
  D4 needs. Client derivation lets every TV flip **independently** and a TV that boots mid-daypart
  shows the right program immediately.
- **Failure modes (Option A):** a TV with a badly-wrong clock flips at the wrong minute — mitigated,
  TVs are NTP-synced and the boundary is venue-local wall time from `Intl` (the DST-safe part is just
  "what time is it in the venue now," which `Intl` gives). No missed-fire class exists (unlike cron).

### D4 — Schedule vs. manual precedence — RULED: TWO-TIER hold

The old §Concept one-liner ("active schedule row > manual program > rotation") is **amended**. The
bar case is the opposite: a schedule says PLAYLIST, staff flip the game on by hand, and the schedule
must NOT stomp them back. **The owner ruled a two-tier hold.** Stored as `signage_slots.program` (the
override program) **+ `program_hold text` + `program_set_at timestamptz`** (migration 0051):

| `program_hold` | Meaning | Expires |
|---|---|---|
| `'pin'` | permanent manual pin — **the no-schedule default (unchanged from M1/M2)** | never |
| `'boundary'` | a plain flip while a schedule exists | at the next schedule **boundary** after `program_set_at` |
| `'event'` | **SPECIAL EVENT** — a tag/toggle on the manual switch (the owner's "game running long" case) | at the venue **business-day rollover** (04:00 closeout) after `program_set_at` — SURVIVES daypart boundaries |

`program = null` ⇒ no override; follow the schedule (⇒ rotation when no daypart covers now). RESUME
SCHEDULE (hub) / the Q-SYS `schedule` command clears the override (`program = null, program_hold = null`).

Effective-program resolution (client, render-time — `resolveEffectiveProgram` in `scheduleResolve.ts`):
```
if slot.program && !isHoldExpired(program_hold, program_set_at, now, rows, rolloverHour):
    → slot.program                         # unexpired manual override (pin/boundary/event)
else:
    → activeScheduledProgram(now, rows)     # the daypart's program, or null = rotation
```
`isHoldExpired`: pin → false; boundary → `nextBoundary(program_set_at) <= now` (no schedule ⇒ never,
so a 'boundary' flip on a schedule-less slot is a permanent pin); event → `nextRollover(program_set_at)
<= now`. `resolveSlotMode` is **unchanged**; whatever this resolves to still renders only at
rotation-bottom. **DECISION:** storing the hold TIER + set-at (not a precomputed `program_until`) means
the expiry is derived at read time — robust to schedule edits, and the `media-control` fn only writes a
tier + `now()` (no boundary math in Deno, D5).

**Built:** `program_hold`/`program_set_at` are in `TV_SLOT_RENDER_FIELDS` + `HUB_SLOT_RENDER_FIELDS`
(`slotRealtime.ts`) so a hold change with the same program (plain flip → SPECIAL EVENT) still wakes the
TV/hub. The hub's SWITCH PROGRAM shows the SPECIAL EVENT toggle only when the slot has a schedule
(otherwise every flip is a `pin`).

### D5 — Q-SYS interaction under schedules — RULED

M2's `media-control` edge fn writes `signage_slots.program`. **RULED:** a Q-SYS program press
(`playlist`/`capture`) defaults to the **SPECIAL EVENT hold** (`program_hold='event'`) — Q-SYS presses
are typically event-driven (the overtime case). An optional `hold` param (`pin`|`boundary`|`event`) wires
a boundary-scoped UCI button. A new **`schedule` command** clears the override (`program = null,
program_hold = null`) to resume schedules early (the hub's RESUME SCHEDULE does the same).

**Built (media-control v2, DEPLOYED):** the fn sets `program_hold + program_set_at = now()` on a program
write — **no boundary math in Deno** (the D4 read-time design makes that unnecessary; the fn just stamps
the tier + time). `schedule`/`rotation` clear the override. Curl matrix verified: default→`event`,
`hold:'boundary'`→`boundary`, bad hold→400, `schedule`→program null, landscape-only→400, bad token→401.
Runbook `docs/runbooks/qsys-media-control.md` updated with the `schedule` command + `hold` param.

### D6 — Multiview audio

**Recommended: main region only; the panel renders muted.** The panel is silent slides (drink photos,
top sellers, Instagram stills) — nothing there makes sound. The main `<video>`/capture stream carries
audio on the same muted-boot-then-probe path M1/M2 use. (Audio stays always-on at the PC; the room
hears it only via the QSYS/Sonos source select — unchanged.) No real alternative exists.

### D7 — Chrome / ticker survival (is multiview full-bleed?)

**Recommended: multiview is ALWAYS framed — it never counts as full-bleed.** The main region keeps its
header + ticker, AND the panel is a whole extra promo surface. It is the **maximal-ads** program — the
entire reason multiview exists ("ads keep working while video plays"). The ads spectrum:

- **full-bleed playlist** → zero ads (movies, ratified M1-mockup D6, per-playlist toggle);
- **framed playlist** → header + ticker advertise under the video;
- **multiview** → header + ticker **+ a full portrait promo panel**.

A "full-bleed main inside multiview" (drop the main's header/ticker, keep only the panel) is rejected:
the panel already guarantees ads, and dropping the header/ticker buys only the 171px letterbox bands
the ratio-locked 16:9 stage can't grow into anyway. No full-bleed multiview toggle.

### D8 — Multiview program jsonb shape (main-content modeling)

**Recommended:** nest the M1/M2 program shapes; reuse their renderers verbatim.
```jsonc
{ "kind": "multiview",
  "main": { "kind": "playlist", "playlist_id": "…" },   // OR { "kind": "capture", "device_match": "…" }
  "panel_slot_id": "…"                                    // a portrait/panel slot (D2)
}
```
- `main` is a **nested `SlotProgram`** (the exact `playlist`/`capture` shapes). The main region embeds
  the **same** machinery: the playlist `<video>` loop + MEDIA HOST OFFLINE / FEED INTERRUPTED recovery
  + muted-boot audio probe + Q-SYS pause/resume/next transport; or the capture `getUserMedia` stream +
  NO SIGNAL card.
- `main.presentation` (framed/full-bleed) is **ignored** in multiview — the geometry owns the stage
  (always contained in 1312×738).
- Widen `WritableProgram` (`useMediaAdmin.ts`) to include `multiview` so the hub can set it (M1/M2
  deliberately excluded it).
- **Rejected alt:** flatten `main` into top-level fields — nesting the existing shape lets the M1/M2
  types + renderers extend with zero divergence.

⚠ **Build constraint (M1/M2 code):** `PlaylistProgram`/`PlaylistVideo` and `CaptureProgram` are written
to fill the **whole canvas** (`position:absolute; inset:0`, framed = full-height flex column with the
slot's chrome). Inside multiview the video must live in the **1312×738 sub-stage**, with multiview
supplying its own chrome + ticker + panel. M3 must **extract the inner video/capture stage**
(`PlaylistVideo` is currently module-private and unexported) into a reusable `MainMediaStage` that the
multiview main region embeds — the full-canvas chrome wrapper is NOT reusable as-is.

### D9 — Preemption (whole-multiview)

**Recommended:** multiview is a program at the bottom of the ladder; **takeover / MOMENT / live game
preempt the whole multiview (main + panel).** When mode flips off `'rotation'`, the entire multiview
unmounts — the `<video>` stops, the capture `MediaStream` tracks stop — and the standard full
1920×1080 surface takes over; multiview resumes when the interruption ends. `resolveSlotMode` is
**unchanged** (no new code — the multiview renderer sits exactly where `playlist` sits today).

- Active WINDOW/MESSAGE promos still surface — in the **panel's** rotation (venue-wide events flow
  through the panel's portrait resolver), never layered over the main video.

### Schema (migration 0051, APPLIED live)

```sql
-- signage_slots: panel modeling + the two-tier manual-override hold (D4)
alter table signage_slots add column if not exists kind text not null default 'screen'
  check (kind in ('screen','panel'));           -- 'panel' = a multiview sidebar slot (no TV/heartbeat)
alter table signage_slots add column if not exists program_hold text
  check (program_hold in ('pin','boundary','event'));  -- D4 tier; null = no override (follow schedule)
alter table signage_slots add column if not exists program_set_at timestamptz;  -- override anchor

-- slot_program_schedule: per-slot dayparts (D3 anon-readable, client-derived; no cron)
create table slot_program_schedule (
  id           uuid primary key default gen_random_uuid(),
  slot_id      uuid references signage_slots on delete cascade not null,
  program      jsonb not null,          -- a SlotProgram to run in this daypart; use {"kind":"rotation"}
                                         --   sentinel for an explicit "back to rotation" daypart
  days_of_week text[] not null,         -- ['MO','TU',…] (recurrence.daysOfWeek idiom; [] = every day)
  start_minute int not null check (start_minute between 0 and 1439),  -- venue-local minutes past midnight
  end_minute   int not null check (end_minute between 0 and 1440),    -- exclusive; end<=start = wraps past
                                         --   midnight (4PM→2AM). TILL CLOSE = venue close minute.
  position     int not null default 0,  -- overlap tiebreak: higher wins when two rows cover now
  active       boolean not null default true,
  created_at   timestamptz default now()
);
```

- **RLS on `slot_program_schedule`:** copies the `slot_queue`/media block verbatim — anon SELECT (TVs
  read anon; schedule rows carry no PII), `has_module('signage')` manage; derive venue via the existing
  `slot_venue()` definer for the write policy. Realtime added so a schedule edit re-derives without a
  reload.
- **`program_hold` / `program_set_at` / `kind`** are additive; `program` stays `jsonb` (holds the multiview shape).
- No new cron, no new tick, **no edge-fn change beyond `media-control` gaining the `schedule` command**
  and (per D5-i) the boundary computation.
- **DST:** resolution is against venue-local wall time via `Intl` (client) — no fixed-offset math. A
  boundary landing in a DST gap/overlap is a minor edge, covered by the unit suite (D-numbers noted).

### Resolver placement (recommended)

**Client render-time** (D3), NOT a tick. Extend `useSignage`/`SlotDisplay`:
1. `scheduleResolve.ts` (pure) — `activeScheduledProgram` + `nextBoundary`.
2. Effective program = the D4 ladder (`slot.program` if unexpired, else `activeScheduledProgram`).
3. The effective program still only renders while `mode === 'rotation'` (D9) — so the multiview
   renderer replaces today's "playlist-or-capture at rotation-bottom" branch, and preemption is free.
4. Re-derive on the existing 30s tick + a precise boundary timeout.

**Tradeoff stated:** client derivation adds no infra and is outage-proof, but the boundary math must be
shared with the `media-control` fn (D5) so a Q-SYS override expires identically. A cron tick would put
the logic server-side but is less resilient and breaks D4 — rejected.

### QA plan

All QA on **throwaway `qa-*` slots** — the standing rule; the REAL `portrait-main` / `landscape-bar`
slots are never touched, and `program`/`program_hold`/`program_set_at`/`kind` on them stay null/default.

1. **Geometry (D1):** a qa landscape slot in multiview; verify by DOM measurement at 1920×1080 that
   main = 1312×1080 (738 stage + 171×2 chrome) and panel = 608×1080 with the portrait content scaled
   ×0.5625, no reflow. (`?calibrate` bypasses children, so measure visually + via DOM.)
2. **Panel (D2):** create a `kind='panel'` qa slot, queue assets; confirm it renders in the nested
   canvas, honors POS/86 gates (86 a source → panel hides it), and shows in the hub with a PANEL badge
   and no health dot. Test the mirror path (point `panel_slot_id` at a qa portrait slot).
3. **Main content (D8):** playlist main (MEDIA HOST OFFLINE card in the stage when the shell is absent,
   panel keeps running) and capture main (NO SIGNAL card); Q-SYS pause/resume/next drives the main video.
4. **Schedule (D3/D4):** seed `slot_program_schedule` rows with near-future boundaries on a qa slot;
   verify the client flips at the boundary with no reload; a hand flip mid-daypart sets
   a plain (boundary) override yields at the next boundary while a SPECIAL EVENT (event) override holds
   through to the 04:00 rollover; RESUME SCHEDULE clears either; wrap-past-midnight and
   TILL CLOSE dayparts resolve correctly.
5. **Preemption (D9):** fire a takeover / MOMENT / start a game while multiview is up → the whole
   multiview unmounts (video + capture tracks stop), the standard surface shows, multiview resumes after.
6. **Q-SYS (D5):** `media-control` `multiview`/`playlist`/`schedule` writes → the D4 override semantics;
   curl tests + Lua snippet in the runbook.
7. **Unit suite** `scheduleResolve.ts` (`test:scheduleresolve`, like `test:eventstage`): wrap-past-
   midnight, TILL CLOSE, multi-row overlap tiebreak (`position`), boundary-exact, and **US DST-transition
   days** (spring-forward gap + fall-back overlap) against a fixed `America/Chicago`.
8. **Perf note:** multiview renders a `<video>` **and** a full portrait rotation (its own images) on the
   mini Windows PC — verify sustained playback + panel rotation don't stutter on the office demo screen
   before the drive ships to the bar.

### M1/M2 code that constrains M3 (summary)

- `DisplayCanvas` can't be nested (global viewport/reload side-effects) → build a `FixedCanvas` for the
  panel (D1 constraint above).
- `PlaylistVideo`/`CaptureProgram` are full-canvas + `PlaylistVideo` is unexported → extract a
  `MainMediaStage` for the 1312×738 region (D8 constraint above).
- `TV_SLOT_RENDER_FIELDS` (`slotRealtime.ts`) must gain `program_hold`/`program_set_at` (D4 constraint above).
- `WritableProgram` (`useMediaAdmin.ts`) deliberately excludes multiview → widen it (D8).
- Hub `ProgramPanel`/`ScreenCard` gate the PROGRAM control on `orientation === 'landscape'` — panel
  slots are portrait, so they're naturally excluded from a program control; but `ScreenCard` must gain a
  `kind === 'panel'` branch (PANEL badge, suppress health via `screenHealth`, suppress TAKEOVER —
  "follows its host"). Add `kind` to the admin slot select.
- `RotationSurface` (already extracted for the PiP trivia inset) is exactly the panel node — feed it the
  panel slot's resolved rotation/tease/ticker. The multiview renderer runs a **second** `useSlot(panelSlug)`
  subscription for the panel's data (a positive: the PiP work paved this; a cost: a second full data
  subscription on the media PC).
- Panel slots have a unique NOT NULL `slug` (schema) → hitting `/signage/s/{panelSlug}` directly renders
  a lone portrait rotation. Harmless, but the panel isn't meant as a standalone TV (note only).
- **apps/media-shell stays FROZEN** — multiview needs **zero shell changes** (panel slides come from
  Supabase over the internet; main video from the shell's existing localhost server; capture via the
  already-granted `getUserMedia`). The drive installer stays valid.

---

## Media shell v0.2 (2026-07-20 — two owner field asks from the bar install)

The shell is no longer frozen (M1's freeze was to protect the drive installer; that installer served
its purpose). v0.2 ships as a NEW installer delivered by a download link (uploaded to the public
`signage` bucket under `shell/`). Two asks:

### Fast boot (a restart should resume the film, not show MEDIA HOST OFFLINE for minutes)

- **Serve-before-scan.** The 127.0.0.1 media server (health + range file serving) binds BEFORE any
  catalog work; the ffprobe walk runs in the background afterward.
- **Persisted catalog cache** at `%APPDATA%/Bunker Media Shell/catalog-cache.json` (metadata) +
  `thumb-cache/{hash}.jpg` (thumbnails), keyed by path+size+mtime. A warm boot loads metadata
  synchronously (files servable immediately) and re-probes ONLY new/changed files. Corrupt/missing
  cache ⇒ cold walk (self-heals).
- **Clean quit/relaunch.** Single-instance lock (a second launch focuses the kiosk and exits); the
  media server closes gracefully before a watchdog/Alt-F4 relaunch, and the port binder retries on
  EADDRINUSE so a relaunch can't strand port 48151.

### Subtitles

- The shell indexes a sidecar `.srt` (same basename, e.g. `Labyrinth (1986).srt`; a language-tagged
  `.<lang>.srt` also matches) and serves it as **WebVTT at `/subs/{hash}`** (SRT→VTT: `WEBVTT` header +
  comma→dot in cue timestamps; BOM/latin1 tolerant). Catalog payload gains `has_subtitles`.
- Migration **0053** (additive): `media_files.has_subtitles` (default false — a v0.1 shell never
  reports it) + `media_playlists.subtitles` (**default TRUE**, all existing rows flipped — owner
  ruling; mirrors 0052's shuffle default; a manual hub un-toggle sticks, the sync never overwrites it).
- The web PlaylistProgram/MainMediaStage render a `<track kind="subtitles" default>` **only** when the
  playlist's `subtitles` is on AND the current file's `has_subtitles` is true — so the v0.1 shell
  currently at the bar is unaffected until it's updated. Hub MEDIA LIBRARY playlist rows gain a
  SUBTITLES on/off toggle beside FRAMED/SHUFFLE.

### Backlog (v0.2)

- **Resume-at-position across restarts (NOT built).** Transport/playlist position is ephemeral — a
  shell restart resumes the loop but restarts the current clip from the beginning (a warm boot makes
  the clip servable in ~tens of ms, so it resumes near-instantly, just not at the exact frame).
  Persisting the last file + offset per slot would restore the exact position; deferred.
- A sidecar `.srt` added while the shell is OFF and the video is otherwise unchanged (size+mtime same)
  is picked up on the next full scan / when the sync re-checks the sidecar on a cache hit — the
  watcher also re-processes the sibling video when a `.srt` lands/leaves at runtime.

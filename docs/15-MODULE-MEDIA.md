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
- **M2 — capture:** `capture` program + NO SIGNAL card + audio passthrough.
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

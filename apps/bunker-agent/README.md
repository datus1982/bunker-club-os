# BUNKER AGENT

The always-on service on the bar's **NUC** (the Windows mini PC beside the media shell — a
separate process, a separate install) for the **audio module** (docs/16). It holds one QRC
socket to the Q-SYS Core on the bar LAN and mirrors what the room is actually doing into
Supabase (`audio_live`) so the hub, the `/audio` page and the iPad read reality without ever
touching the Core themselves.

**THIS VERSION (PR A, 0.1.x) WRITES NOTHING TO THE Q-SYS CORE. IT ONLY READS.**
The client has no method that can change a control — the read methods are an allow-list and
the request path refuses anything else (`src/qrc.ts`, proven by `npm test`). Scene recall
arrives in PR B, and only after the owner's supervised first recall in the room.

It does three jobs:

1. **Verifies the room.** On every connect it checks `StatusGet.DesignName` starts with
   `BunkerClub` and that **every** component in the contract (`src/controls.ts`) exists. A
   missing or renamed component/control is logged as an ERROR, lands in
   `audio_live.snapshot.errors[]` by exact name, and the agent keeps running with what it can
   read — it degrades **loudly**, never silently.
2. **Mirrors the read-back set** at ≤ 1 Hz (ChangeGroup + AutoPoll, coalesced): zone sources
   and levels, inside trims, mic mutes/gains, Sonos transport/track/favorites, HDMI outputs +
   source signal, reverb/ducker bypass, the 17 meters, amp status/temps/clip.
3. **Posts the snapshot** to the `audio_agent_report` RPC (device-token gated, one fixed upsert of
   the venue's `audio_live` row). Logs to stdout and a rotating `logs/agent.log`.

---

## Install on the NUC (Windows)

Prereqs: Node.js **20+** (LTS installer, "Add to PATH"), and `nssm.exe`
(https://nssm.cc, 2.24+) dropped beside `scripts\install-service.ps1` or on PATH.

1. Get the folder onto the NUC — clone the repo or copy `apps\bunker-agent\` (without
   `node_modules`). Then, in that folder:

   ```powershell
   npm ci
   npm run build
   ```

2. **Create `config.json`** next to `package.json` (copy `config.example.json`). Lookup order:
   `$env:BUNKER_AGENT_CONFIG` → `.\config.json` → `<app dir>\config.json` →
   `%APPDATA%\Bunker Agent\config.json`.

   ```json
   {
     "coreHost": "192.168.68.201",
     "corePort": 1710,
     "supabaseUrl": "https://<project>.supabase.co",
     "supabaseAnonKey": "PASTE-THE-PUBLIC-ANON-KEY",
     "deviceToken": "PASTE-AUDIO-AGENT-TOKEN",
     "venueId": "11111111-1111-1111-1111-111111111111",
     "agentId": "bunkerclub-nuc",
     "expectedDesignPrefix": "BunkerClub",
     "logDir": "logs"
   }
   ```

   | field | required | meaning |
   |-------|----------|---------|
   | `coreHost` | **yes** | the Core's LAN address (QRC, port 1710, no auth on the LAN) |
   | `corePort` | no | default `1710` |
   | `supabaseUrl` | no* | the project URL |
   | `supabaseAnonKey` | no* | the project's PUBLIC anon key (the same one every TV bundle carries — PostgREST needs it as `apikey`; the real credential is the token) |
   | `deviceToken` | no* | the secret compared inside the RPC against Vault `audio_agent_token`. **Never commit it** (`config.json` is gitignored) |
   | `venueId` | **yes** | the venue uuid |
   | `agentId` | no | shows in `audio_live.agent_id`; default = hostname |
   | `expectedDesignPrefix` | no | default `BunkerClub`; a different running design is flagged |
   | `logDir` | no | rotating `agent.log` (5 × 5 MB) here; blank = stdout only |

   \* If any of `supabaseUrl` / `supabaseAnonKey` / `deviceToken` is missing (or still a
   `PASTE-…` placeholder) the agent runs in **dev mode**: it connects, verifies, mirrors and
   **logs** a one-line summary of each snapshot it would have posted — and posts nothing. That is
   the safe first run on the metal: `npm run dev` (or `node dist\index.js`) and watch the log.
   Set all three to go live.

3. **Install the service** (elevated PowerShell, in the folder):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
   ```

   Registers `BunkerAgent` (auto-start, restart-on-crash 5 s, stdout/stderr to `logs\service-*.log`).
   Watch it: `Get-Content -Wait logs\agent.log`. Remove it: `scripts\uninstall-service.ps1`.

4. **What "healthy" looks like** in the log:

   ```
   INFO  mirror: core NV-32-H (Core Mode) design=BunkerClub_v03.20260329 (…) status=OK - 16 OK
   INFO  mirror: bootstrapped — 92 controls subscribed, 0 error(s)
   ```

   and `audio_live.updated_at` advancing every second in Supabase. A Designer rename shows as
   `ERROR mirror: MISSING COMPONENT '…'` / `MISSING CONTROL '…' → '…'` plus
   `DEGRADED: N contract error(s)`, and the same names in `audio_live.snapshot.errors[]`.

---

## Tonight's capture (CLI)

Scene payloads are captured **from the room** — the app never invents levels. Until the scene
editor (PR B) ships, capture from the NUC with the agent's CLI while the room sounds right:

```powershell
npm run capture -- --scene NORMAL        # also DJ / KARAOKE / TRIVIA (case-insensitive)
npm run capture -- --scene KARAOKE --favorite 14   # pin the Sonos favorite index explicitly
npm run capture -- --scene DJ --dry-run  # print only, store nothing
```

It connects, **reads** (Component.Get — no control is changed) the current value of every scene
lever in `src/controls.ts` (`SCENE_LEVERS`: the three router selects, Inside level/mute + both
mic mutes/gains, the three inside trims, Patio + Listen Tech level/mute, reverb bypass +
WetLevel, plus the input 5 (Selected Source) and input 8 (Verb) source gains since PR C — 20 controls today), the Sonos favorite in play, and the two HDMI active source
names, prints the payload as JSON plus one summary line:

```
captured NORMAL: 20 controls, sonos fav 31 'Y2K Hits', hdmi out1=BunkerFeed out2=BunkerFeed — stored as scene a0d10000-…
```

and stores it into `audio_scenes.payload` for that scene through the `audio_agent_capture` RPC
(same device token; the scene must already exist — the four are seeded). Payload shape:

```
{ design_name, design_code,
  controls: [ { component, control, value, string, position } … ],   // flat, exact Q-SYS names
  sonos_favorite, sonos_favorite_name, sonos_favorite_resolved_by,   // override | source-name | album-art | album | null
  sonos: { transport, track, artist, album, current_source, track_source, album_art_url },
  video: { out1, out2 },
  missing: [ { component, control, message } … ],
  captured_at, captured_by }                                          // stamped by the RPC
```

**The Sonos favorite is best-effort.** The plugin exposes no favorite URIs, so the CLI matches
the 31 favorite names against `CurrentSource` / `TrackSource`, then the `AlbumArtURL` (Backgrounds
art is named after the program, e.g. `…/Y2KHits.png` ⇢ "Y2K Hits"), then `TrackAlbum`. If none
match it stores `sonos_favorite: null`, says so on stderr, and you re-run with `--favorite N`
(the list is `FavName 1..31` — the same order as Bunker Control's MUSIC page). Re-capturing a
scene simply replaces its payload. In dev mode (cloud fields unset) the CLI prints and stores
nothing, like `--dry-run`.

---

## What it reads (the contract — `src/controls.ts`)

Exact names from the pinned inventory `qrc-inventory-2026-09-16-final.json` (design
`BunkerClub_v03.20260329`). 18 components / 92 controls:

| Lever | Component → controls |
|---|---|
| Source per zone (1 Sonos · 2 Booth · 3 HDMI) | `Inside Router_8x8` / `Patio Router_8x8` / `Listen Tech Router_8x8` → `select.1` |
| Inside level + mics + the SOURCE gains (PR C) | `Inside Mixer` → `output.1.gain/mute`, `input.1/2.mute`, `input.1/2.gain` (mics), `input.5.gain` (Selected Source = whatever `select.1` routes), `input.8.gain` (Verb return) |
| Inside trims (surface / sub / ceiling) | `Mixer_8x8` → `output.1/2/3.gain` |
| Patio, Listen Tech | `Patio Mixer`, `Listen Tech Mixer` → `output.1.gain/mute` |
| Music | `SonosSonosControl` → `TransportState`, `TrackName`, `TrackArtist`, `AlbumArtURL`, `Status`, `FavName 1..31` |
| Video | `HDMI_I/O_Bunker-Core` → `hdmi.out.1/2.select.active.source.name`; `Bunker Feed` / `Roku` / `Booth HDMI` / `HDMI 3` → `channel.1.input.signal`, `5v` |
| Effects | `Lush_Reverb_Effect` → `bypass`; `Priority_Ducker` → `bypass` |
| Meters | `True_Peak/RMS_Meter_(dBFS)` → `meter.1..13`; `True_Peak/RMS_Meter_(dBFS)_1` → `meter.1..4` |
| Amp (status only, forever) | `Amp_Output_bunker-amp-1_CX-Q_2K4` → `status`, `channel.1..4.temperature`, `channel.1..4.input.clip.led` |

The snapshot shape (`src/snapshot.ts`) carries the raw `controls` map plus a `derived` block
(zones / inside_trims / mics / sources / sonos / video / effects / meters / amp) so UIs never
re-implement the mapping. Re-run the read-only inventory script before any PR that changes the
contract — the names are the contract with the room.

### Sources, presets, nudges (PR C — `src/sources.ts`, migration 0069)

Six staff-facing SOURCE keys: `mic1` → `input.1.gain`, `mic2` → `input.2.gain`, `verb` →
`input.8.gain`, and `sonos` / `booth` / `hdmi` → `input.5.gain` — but ONLY for the one of the
three `Inside Router_8x8 select.1` is on right now (read live before every source write; the
other two are refused `not_routed`). Two command kinds ride the 0068 queue behind the SAME double
gate + `SCENE_LEVERS` intersection:

- `source_preset {source, level}` — one `Component.Set` with `Ramp 2` to the authored gain; refused
  `preset_not_set` / `range_not_set` / `not_routed` / `out_of_range` (an authored value outside
  the owner's range is refused, never capped). Stamps the lever into `audio_state.baseline`.
- `source_nudge {source, direction: up|down, delta_db?}` — reads the CURRENT gain, moves it one
  `step_db` (default 1.5; a caller `delta_db` is bounded to the step), one `Component.Set` with
  `Ramp 0.5`. A target outside `[min_db, max_db]` is REFUSED `out_of_range` with current / target /
  range in the result and ZERO frames on the wire. Never touches the baseline — the page shows
  "nudged +1.5 dB" as live − baseline.

Ranges live in `audio_source_ranges` (owner-edited on `/audio/scenes`). They are seeded ONCE by
the agent after a **NORMAL** capture — captured ± 6 dB per source it could read, clamped to
[-100, 10] — through `audio_agent_seed_ranges`, which never overwrites an existing row. A recall
clamps every source gain it writes into the owner's range and reports each clamp in
`result.clamped` (the range wins over a stale capture).

---

## Developing / testing

```
npm ci
npm run typecheck
npm test          # fake QRC Core (TCP, NUL frames, replays the pinned inventory)
```

Tests (Node 22+ for the runner flags) cover: framing across split TCP writes, id matching under
unsolicited `EngineStatus`, `NoOp` keepalive, reconnect with backoff, JSON-RPC error mapping,
the read-only allow-list guard (the fake records every method it ever saw), the full snapshot
shape from the real inventory values, ChangeGroup coalescing + heartbeat + failed-post retry,
and the degraded paths (missing component / missing control / wrong design / socket drop →
re-bootstrap). The real Core is LAN-only and is not reachable from a dev machine; the on-metal
proof is a dev-mode run on the NUC.

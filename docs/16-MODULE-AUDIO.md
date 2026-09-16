# 16 — Module: Audio (scenes + zone presets over QRC)

> Drafted 2026-09-16 from the card `~/Marvin/projects/bunker/qsys/card-audio-scenes-2026-09-16.md`
> (Stephen, 2026-09-15: "is there a way to build the presets, ramps, etc, in this platform instead
> of qsys?"). Amends the 08-23 ruling on his ask: the **preset data, UI and ramps live in Bunker OS;
> Q-SYS still owns the room** (tuning, EQ, routing, amps stay in Designer — the app only recalls what
> he authored and reads back what is true). His limits: **no amp output control from the app**
> (status read-only) and "let's not go overboard with functionality."

## The gate that governs this module

**Nothing writes to the Q-SYS Core except the NUC agent, and the agent writes nothing until
Stephen's explicit word for the first supervised recall, with him in the room.** PR A (this doc's
first cut) ships the schema and a READ-ONLY mirror; the reviewer proves "no write method is
reachable" by code identity. `Control.Set` arrives in **PR B only**, after that supervised first
recall. Never `Volume` on Sonos, never amp gain/mute, never the pink-noise / signal-injector
blocks (not exposed — keep it that way). Room tuning stays in Designer.

## 1 · Control surface (pinned from `qrc-inventory-2026-09-16-final.json`, design `BunkerClub_v03.20260329`)

| Lever | Component → control | Notes |
|---|---|---|
| Source per zone | `Inside Router_8x8` / `Patio Router_8x8` / `Listen Tech Router_8x8` → `select.1` | **1 = Sonos · 2 = Booth (DJ, Dante) · 3 = HDMI (video)** |
| Inside level | `Inside Mixer` → `output.1.gain` (+ `output.1.mute`) | the one INSIDE knob; feeds the 1x3 |
| Inside trims | `Mixer_8x8` → `output.1.gain` surface · `output.2.gain` sub · `output.3.gain` ceiling | three trims under INSIDE, not zones |
| Patio level | `Patio Mixer` → `output.1.gain` (+ mute) | |
| Listen Tech | `Listen Tech Mixer` → `output.1.gain` (+ mute) | assistive listening; rarely touched |
| Mics | `Inside Mixer` → `input.1.mute`, `input.2.mute` (+ `input.1/2.gain`) | Mic 1 host, Mic 2 second/karaoke |
| Music | `SonosSonosControl` → read `TransportState`, `TrackName`, `TrackArtist`, `AlbumArtURL`, `Status`, `FavName 1..31`; (PR B) `FavPlay N`, transport | the 31 favorites ARE the approved station list; Sonos volume is fixed line-out |
| Video | `HDMI_I/O_Bunker-Core` → read `hdmi.out.1/2.select.active.source.name`; sources `Bunker Feed` / `Roku` / `Booth HDMI` / `HDMI 3` → `channel.1.input.signal` + `5v` | offer only sources with signal |
| Reverb | `Lush_Reverb_Effect` → `bypass` (+ `WetLevel`) | karaoke on / trivia off |
| Ducker | `Priority_Ducker` → `bypass` (true today) | read-only display; not a v1 lever |
| Meters | `True_Peak/RMS_Meter_(dBFS)` → `meter.1..13`; `…_1` → `meter.1..4` | inputs (1/2 mics, 9/10 Sonos, Booth, HDMI, Verb) / zones (Inside, Ceiling, Sub, Patio) |
| Amp (READ-ONLY) | `Amp_Output_bunker-amp-1_CX-Q_2K4` → `status`, `channel.N.temperature`, `channel.N.input.clip.led` | status only, forever |

Ramps (PR B): `Control.Set` accepts `Ramp` seconds on Float controls — the Core does the fade;
Booleans/Integers switch instantly, so a recall orders its writes mute → ramp gains → switch
source → unmute.

## 2 · Data model (migration 0067, new module key `audio`)

- **Module key `audio`** in the grant system (`venue_staff.modules`, `has_module()`, the TS
  `ModuleKey`, USERS checkbox "AUDIO", invite-staff's known keys). Admin implies it.
- `audio_scenes` — `id, venue_id, name, position, ramp_seconds (3), payload jsonb, is_default,
  requires_confirm, created_at, updated_at`; unique `(venue_id, name)`, one default per venue.
  Seeded NORMAL (default, no confirm) / DJ / KARAOKE / TRIVIA (confirm) with **empty payloads** —
  the app never invents levels; PR B's CAPTURE FROM ROOM fills them through the AGENT (`Component.Get` on every scene lever — the same path as the CLI capture), not from the `audio_live` mirror, which deliberately omits write-only levers such as `WetLevel`.
- `audio_zone_presets` — pk `(venue_id, zone inside|patio, level low|med|high)`, `gain_db` (null
  until authored), `ramp_seconds` (2). Six seeded rows.
- `audio_state` — one row per venue: `active_scene_id`, `recalled_at`, `recalled_by`, `last_error`.
  The LABEL of the last recall; the truth is always the live read-back.
- `audio_live` — one row per venue: `snapshot jsonb`, `agent_id`, `updated_at` — the agent's ≤1 Hz
  mirror. Staff SELECT only; written ONLY through `audio_agent_report(p_token, p_snapshot,
  p_agent_id)` (SECURITY DEFINER; token compared against Vault secret `audio_agent_token` via the
  client-unreachable helper `audio_agent_token_ok()`, seeded out-of-band, fail-closed; venue from
  `snapshot.venue_id`, must exist).
- `audio_agent_capture(p_token, p_scene_name, p_payload, p_agent_id)` — the agent CLI's ONE write
  into `audio_scenes.payload` (same token gate; scene matched by name case-insensitively within
  `payload.venue_id`; never creates a scene; stamps `captured_at`/`captured_by`). This is how
  tonight's scenes get captured before the PR B editor exists:
  `npm run capture -- --scene NORMAL` on the NUC (README "Tonight's capture (CLI)").
- RLS on all four: `has_module(venue_id,'audio')` for staff read/write (audio_live read-only);
  anon has NOTHING (grants stripped and revoked). Realtime on all four.

### Scene payload shape (`audio_scenes.payload`, captured — never authored by hand)

```
{ design_name, design_code,
  controls: [ { component, control, value, string, position } … ],   // the SCENE_LEVERS only:
     // routers select.1 ×3 · Inside Mixer output.1.gain/mute + input.1/2.mute/gain ·
     // Mixer_8x8 output.1/2/3.gain · Patio + Listen Tech output.1.gain/mute · Lush_Reverb bypass + WetLevel
  sonos_favorite: N|null, sonos_favorite_name, sonos_favorite_resolved_by: override|source-name|album-art|album|null,
  sonos: { transport, track, artist, album, current_source, track_source, album_art_url },
  video: { out1, out2 },                                              // HDMI active source names
  missing: [ … ], captured_at, captured_by }
```

The Sonos plugin exposes no favorite URIs, so the favorite index is best-effort text matching
with an explicit `--favorite N` override; unresolved stays `null` (never guessed). Meters, amp,
HDMI signal flags and the Priority Ducker are read-backs, not levers, and are not in a scene.

### Snapshot shape (`audio_live.snapshot`)

```
{ venue_id, agent_id, agent_version, at, connected,
  core: { host, design_name, design_code, platform, state, status },
  errors: [ { kind: design_mismatch|missing_component|missing_control|disconnected|core_error,
              component?, control?, message } ],
  controls: { "<Component>": { "<control>": { v, s, p, at } } },        // raw, exact Q-SYS names
  derived: { zones: {inside,patio,listen: {source, source_name, gain_db, mute}},
             inside_trims: {surface_db, sub_db, ceiling_db},
             mics: {"1","2": {mute, gain_db}},
             sonos: {transport, track, artist, album_art_url, status, favorites: [{n,name}]},
             video: {outputs: {"1","2": {active_source}}, sources: {<name>: {signal, plugged}}},
             effects: {reverb_bypass, ducker_bypass},
             meters: {inputs_db[13], zones_db[4]},
             amp: {status, temperatures_c[4], clip[4]} } }
```

`controls` is the source of truth; `derived` is a pure projection so no UI re-implements the mapping.

## 3 · The NUC agent (`apps/bunker-agent/`, memory [[ipad-never-infrastructure]])

The Core is LAN-only. `bunker-agent` is a Node service on the NUC (Windows service via NSSM,
beside the media shell, separate process) holding one QRC socket to `192.168.68.201:1710`
(NoOp keepalive 30 s, ChangeGroup + AutoPoll 1 Hz, reconnect with backoff). On every connect it
verifies the design name and that **every** contract component exists; a rename fails loudly
(ERROR log + `snapshot.errors[]` by exact name) and the agent keeps mirroring what it can. It
posts the snapshot ≤1 Hz (coalesced, 30 s heartbeat) through `audio_agent_report`. Dev mode
(cloud fields unset) mirrors and logs, posting nothing — the safe first run on the metal.

**PR A's agent exposes exactly seven QRC methods, all reads** (`StatusGet`, `Component.GetComponents`,
`Component.Get`, `ChangeGroup.AddComponentControl/AutoPoll/Poll`, `NoOp`); the request path refuses
any other method name. PR B adds the command channel (`audio-cmd`, private realtime + RLS — not
the public-channel backlog from PR #56) and the ordered recall batch; v1 adds no audio dayparts
(Stephen recalls scenes by hand; an `audio_schedule` evaluated locally by the agent is backlog).

## 4 · UI (PR B, v2 shell; the iPad follows the same tables)

**BAR OPS ▸ AUDIO** (`/audio`, `RequireModule('audio')`): SCENES row (four buttons, active one lit
from `audio_state` + live agreement), INSIDE / PATIO with LOW · MED · HIGH + live meter, MICS (two
mute toggles + level), MUSIC (now playing + the 31 favorites), VIDEO (two outs × sources with
signal), a small REVERB toggle. Scene editor (admin): name, ramp, **CAPTURE FROM ROOM** from
`audio_live`, per-lever overrides for the few he tweaks; "save current as LOW/MED/HIGH" per zone.
Confirm on DJ / KARAOKE / TRIVIA, none on NORMAL or presets. Hub/HOME: a one-line chip
("NORMAL · Sonos: 80s Hits · Inside MED") from `audio_live`.

## 5 · Sequence

1. **PR A — schema + read-only agent** (this doc): migration 0067 + `apps/bunker-agent`; the
   mirror proven live from the NUC in dev mode, then posting; **zero writes to the Core**.
2. **Supervised first recall** — Stephen in the room, one scene he captured, one window.
3. **PR B — `/audio` page + scene editor + the agent's write lane** (Control.Set with Ramp).
4. **PR C — Bunker Control iPad MUSIC/SCENES** on the same tables.
5. Backlog: audio dayparts; TV-input flips inside scenes; amp status page; Priority Ducker if
   ever tuned; a Designer snapshot-bank fallback for a UCI button.

Re-run the 5-second read-only inventory before every PR — the names in §1 are the contract.

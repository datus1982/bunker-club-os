---
name: bunker-sonos-module-brief
type: project
updated: 2026-08-22
summary: Handoff brief for Bunker Club OS dev — build the Sonos control module (one zone, transport + volume + favorites/scenes) from two existing reference implementations.
---

# Brief: Sonos control module for Bunker Club OS

*Prepared by Marvin, 2026-08-22, for handoff to a Bunker Club OS dev session. Self-contained; all paths are absolute on stphntylr-mini-2.*

## Goal

Give Bunker Club OS a Sonos music panel: see what's playing, control it, and switch between Sonos Backgrounds stations with one-tap scene buttons. The venue runs **one Sonos zone / one player** on a **Sonos Pro Premium** subscription (Sonos Backgrounds stations = the licensed music source).

Target feature set:
1. **Now playing** — station/track, transport state, volume (polled).
2. **Transport + volume** — play/pause, volume set, mute.
3. **Favorites** — list Sonos favorites, play one. Favorites are the programmatic handle for Backgrounds stations (they can't be addressed directly over the local API).
4. **Scenes** — named presets (e.g. Doors / Dinner / Late Night) = favorite + target volume, one tap. This is the actual product; items 1–3 are its plumbing.

## Approach

Control is **local UPnP/SOAP on the LAN, port 1400** — same architecture pattern as the OS's existing Q-SYS control. No cloud, no OAuth, no tokens. Use a library rather than hand-rolling SOAP; if the OS is Node, use **`@svrooij/sonos`** (proven, see reference 1); if Python, `SoCo` covers the same ground.

## Reference implementations (read, copy from, do not modify)

**1. LCARS Sonos module — working Node implementation of features 1–2.**
- `/Users/admin/projects/lcars/lib/sonos.ts` (241 lines, `@svrooij/sonos`)
- `/Users/admin/projects/lcars/app/api/sonos/state/route.ts` and `/Users/admin/projects/lcars/app/api/sonos/device/[id]/route.ts`
- The lcars repo is a separate project (Hal's domain) — copy what you need into Bunker OS, leave the source repo untouched.
- Hard-won details in it worth keeping:
  - Set `SONOS_DISABLE_LISTENER=1` in env **before constructing `SonosManager`**. The library otherwise binds a UPnP event-callback listener on :6329; rebuilding the manager races the teardown and threw uncaught `EADDRINUSE` in production. Poll-only consumers never need the listener.
  - **SSDP multicast does not cross Docker bridges.** If the OS runs in a container, seed discovery with the speaker's known IP (`SONOS_SEED_IP` pattern) instead of relying on multicast.
  - Poll interval 60s is fine for ambient state; poll on-demand after issuing a command for snappy UI feedback.

**2. Stephen's Q-SYS plugin — behavioral spec for feature 3 (favorites), in Lua.**
- `/Users/admin/Documents/QSC/Q-Sys Designer/Plugins/Plugins/sonos_v0.8.1.lua` (1,974 lines)
- A complete hand-rolled local Sonos client. The part LCARS lacks and this has: **favorites**.
  - Favorites live in ContentDirectory container **`FV:2`** (`urn:schemas-upnp-org:service:ContentDirectory:1`, endpoint `/MediaServer/ContentDirectory/Control`, Browse action).
  - Playing one = `SetAVTransportURI` on AVTransport with the favorite's **URI and its DIDL metadata** (both come back from the Browse result; metadata is required for stream favorites). See `BrwPlayItem` (~line 1459) for the exact escaping/decoding dance.
  - `@svrooij/sonos` has helpers for most of this (`device.GetFavorites()` / content-directory browse + `SetAVTransportURI`), so the port is ~50 lines, not a Lua translation.
- Also documented in the plugin if ever needed: line-in via `x-rincon-stream:<uid>`, TV audio via `x-sonos-htastream:<uid>:spdif`, album art at `http://<ip>:1400<artUri>`.

## Supporting data

- **Backgrounds station catalog:** `/Users/admin/Marvin/facts/sonos-backgrounds-stations.json` — all 218 Premium stations with name, description, 10 sample artists, energy level (5-step), genre/mood/business-type tags, and sample MP3 URL. Useful for a station-picker UI or for labeling scene buttons. (Source: `https://sonos-prod.mymood.com/preview/pro`, fetched 2026-08-22; refresh from there if stale.)
- Browsable version: "Backgrounds Catalog" artifact (Stephen has the link).

## Not in scope / decisions already made

- No grouping/topology logic — one zone. Skip the Groups/Devices complexity in both references.
- No cloud API — local control only. (Sonos's official cloud API is a possible later add for remote-from-home control; don't build for it now.)
- Scene definitions (which stations, which volumes) are Stephen's call at config time — build them data-driven (a small JSON/config list), don't hardcode.

## Setup checklist for whoever wires it up at the venue

1. Confirm the Bunker OS host is on the same LAN as the Sonos player; note the player's IP (reserve it in DHCP) for seeding.
2. In the Sonos app, save the working set of Backgrounds stations as **Sonos favorites** (this is the one-time manual step that makes them scriptable).
3. Stand up the module; verify favorites list matches, then define scenes.

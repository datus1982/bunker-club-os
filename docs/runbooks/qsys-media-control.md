# Q-SYS media control (`media-control` edge fn)

The `media-control` Supabase edge function lets the bar's **Q-SYS core** switch what a landscape
signage screen plays — from a UCI button, with no browser open. It is the same single source of
truth the `/signage` hub writes.

- **Program switches** (`playlist` / `rotation` / `capture`) write `signage_slots.program`. The TV
  and the hub's program chip both follow via realtime — identical to a manager clicking the
  screen card's PROGRAM control.
- **Transport commands** (`pause` / `resume` / `next`) do **not** touch the database. They ride a
  Supabase realtime broadcast on `media-cmd:{slug}` that the signage player subscribes to. Only a
  running **playlist** program reacts (a live capture feed has nothing to pause); `next` advances
  the loop.

The program tier is the **bottom** of the slot mode ladder — a live game, takeover, or scheduled
MOMENT still preempts whatever program is set. Switching a program here never overrides Wednesday
trivia.

## Endpoint

```
POST https://ysrqvdutayirpoibdlbf.functions.supabase.co/media-control
Header: x-qsys-token: <QSYS_CONTROL_TOKEN>
Body:   application/json
```

(The Pages domain `os.bunkerokc.com/functions/v1/*` does NOT proxy to Supabase — call the
functions host directly.)

Auth is the `x-qsys-token` header only (no JWT). The token is the secret **`QSYS_CONTROL_TOKEN`**,
held by the Q-SYS core. It is **separate** from the media shell's `MEDIA_DEVICE_TOKEN` — a
different holder, independently revocable. To rotate it (leaks, staff change), set a new value and
the old token stops working immediately; the shell is unaffected:

```bash
# rotate the Q-SYS control token (does NOT affect the media shell's device token)
curl -sS -X POST "https://api.supabase.com/v1/projects/ysrqvdutayirpoibdlbf/secrets" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '[{"name":"QSYS_CONTROL_TOKEN","value":"<new-random-token>"}]'
```

## Commands

| `cmd`      | extra field | effect                                                         |
|------------|-------------|----------------------------------------------------------------|
| `rotation` | —           | clear the override — `program = null` (follow the schedule / rotation) |
| `capture`  | `hold`      | `program = {kind:"capture"}` — the live capture feed (the Roku)|
| `playlist` | `playlist`, `hold` | `program = {kind:"playlist",…}` — loop a media-library playlist |
| `schedule` | —           | **M3:** clear the override so the slot follows its daypart SCHEDULE again |
| `pause`    | —           | broadcast: pause the playlist `<video>`                        |
| `resume`   | —           | broadcast: resume the playlist `<video>`                       |
| `next`     | —           | broadcast: skip to the next clip in the playlist               |
| `playlists`| — (**no slug**) | **v3:** list every playlist (id, name, non-missing fileCount) sorted by name |
| `status`   | —           | **v3:** what the slot is ACTUALLY playing right now (kind/source/hold + playlist) |

`slug` (the screen, e.g. `landscape-bar`) is required on every command **except `playlists`** (a
global list, no slug). For the program/transport commands the slot must exist and be **landscape**
(programs are a landscape-only feature); **`status` is read-only and works on any slot** (any
orientation). `playlist` accepts a playlist **id** (uuid) or a **name** (case-insensitive, exact —
ambiguous names return 409).

`cmd:"capture"` writes a bare `{kind:"capture"}` — it uses the fullbleed default with NO device
match, so a UCI capture press RESETS any DEVICE MATCH or FRAMED that was set on the screen card in
the hub. Configure those in the hub if they matter, or drive capture only from the hub.

**M3 — the `hold` field (schedules):** on a `playlist`/`capture` write, the optional `hold` sets how a
manual override behaves when the screen has a daypart SCHEDULE (docs/15 D4):
`event` (**default** — a SPECIAL EVENT hold that survives daypart boundaries and expires at the 04:00
business-day rollover; the "game running long" case), `boundary` (yields at the next daypart), or `pin`
(permanent until cleared). A Q-SYS press defaults to `event` because UCI presses are event-driven.
`rotation` and `schedule` both clear the override — use `schedule` on a "resume normal programming"
button. (With no schedule on the screen, `hold` is irrelevant — the override is a permanent pin.)

### JSON shapes

```json
{ "slug": "landscape-bar", "cmd": "capture" }
{ "slug": "landscape-bar", "cmd": "capture", "hold": "boundary" }
{ "slug": "landscape-bar", "cmd": "rotation" }
{ "slug": "landscape-bar", "cmd": "schedule" }
{ "slug": "landscape-bar", "cmd": "playlist", "playlist": "Atomic Age" }
{ "slug": "landscape-bar", "cmd": "next" }
```

### Responses

- `200 { ok:true, slug, cmd, kind:"program", program }` — program written.
- `200 { ok:true, slug, cmd, kind:"transport" }` — broadcast sent.
- `401 { error:"unauthorized" }` — bad/missing `x-qsys-token`.
- `400` — missing slug/cmd, unknown cmd, portrait slot, `playlist` missing for a playlist cmd, or an
  invalid `hold` (must be `pin`|`boundary`|`event`).
- `404` — unknown slug or no playlist matches.
- `409` — ambiguous playlist name.

## Discovery & status (v3)

Two read-only commands that let a UCI build a **dynamic** playlist picker and highlight what's really on.

### `playlists` — the picker feed (no `slug`)

Lists every playlist so a UCI can render buttons/rows without hardcoding names. `fileCount` counts
only files the shell currently sees (a `missing` file — one the media PC no longer has — is not
counted). Sorted by `name`. Prefer wiring each button to the returned **`id`** (a playlist `cmd`
by id is unambiguous — no 409 risk if two folders ever share a display name).

```json
// request
{ "cmd": "playlists" }

// response
{ "ok": true, "playlists": [
  { "id": "b4b90c48-…", "name": "90s Indie Explosion", "fileCount": 5 },
  { "id": "…",          "name": "Action 80s",          "fileCount": 9 }
] }
```

### `status` — what's really playing (needs `slug`)

Runs the SAME resolver the TV runs (program override + daypart schedule, in venue-local time) so a
UCI can show the truth — e.g. dim the picker's active playlist, or light a "SCHEDULED" vs
"MANUAL HOLD" lamp. Read-only; works on any screen (orientation-agnostic).

```json
// request
{ "slug": "landscape-bar", "cmd": "status" }

// response — a scheduled playlist daypart is running, no manual override
{ "ok": true, "slug": "landscape-bar", "status": {
  "kind": "playlist",            // playlist | capture | multiview | rotation
  "source": "scheduled",         // scheduled | override | pinned | rotation
  "hold": null,                  // pin | boundary | event — only while an override is live, else null
  "playlistId": "6a316bd0-…",    // present only when kind = playlist
  "playlistName": "Atomic Age"
} }
```

`source` tells the UCI *why* that program is on:
- `rotation` — no program, no covering daypart: the normal ad rotation (`kind` is then `"rotation"`).
- `scheduled` — a daypart schedule is running this program right now (no manual override).
- `override` — a manual/Q-SYS flip is live (a `boundary` or `event` hold — see the `hold` field).
- `pinned` — a manual program with a permanent `pin` hold (the no-schedule default).

An **expired** override reports as `scheduled`/`rotation` here — exactly what the TV shows once it
yields; the UCI never shows a stale "still on capture" once the hold has timed out.

## curl tests

```bash
BASE="https://ysrqvdutayirpoibdlbf.functions.supabase.co/media-control"
TOK="$QSYS_CONTROL_TOKEN"   # never paste the literal token into a script or ticket

# switch the bar screen to the live capture feed
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"capture"}'

# back to the normal rotation
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"rotation"}'

# resume the daypart schedule (clear a manual override) — M3
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"schedule"}'

# capture as a plain boundary override (yields at the next daypart) instead of the SPECIAL EVENT default
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"capture","hold":"boundary"}'

# play a playlist by name
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"playlist","playlist":"Atomic Age"}'

# transport (only affects a running playlist)
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"next"}'

# v3: the playlist picker feed (no slug) — id, name, fileCount, sorted by name
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"cmd":"playlists"}'

# v3: what landscape-bar is actually playing right now (kind/source/hold + playlist)
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"status"}'

# bad token → 401
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE" \
  -H "x-qsys-token: nope" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"rotation"}'
```

## Example Q-SYS UCI button (Lua HttpClient)

Paste behind a UCI button's event handler in a Text Controller / Control Script block. Store the
token in a Q-SYS String control or design-time constant — do not hardcode it in a shared file.

```lua
-- One button = "switch the bar TV to the live Roku feed"
local HttpClient = require("HttpClient")

local BASE  = "https://ysrqvdutayirpoibdlbf.functions.supabase.co/media-control"
local TOKEN = Controls.QsysControlToken.String  -- a String control holding QSYS_CONTROL_TOKEN

local function mediaControl(payload)
  HttpClient.Upload({
    Url = BASE,
    Method = "POST",
    Headers = {
      ["Content-Type"] = "application/json",
      ["x-qsys-token"] = TOKEN,
    },
    Data = payload,
    EventHandler = function(_, code, data, err)
      if err then
        print("media-control error: " .. tostring(err))
      else
        print("media-control " .. tostring(code) .. ": " .. tostring(data))
      end
    end,
  })
end

-- wire buttons:
Controls.BtnCaptureFeed.EventHandler = function() mediaControl('{"slug":"landscape-bar","cmd":"capture"}') end
Controls.BtnRotation.EventHandler    = function() mediaControl('{"slug":"landscape-bar","cmd":"rotation"}') end
Controls.BtnMovieNight.EventHandler  = function() mediaControl('{"slug":"landscape-bar","cmd":"playlist","playlist":"Atomic Age"}') end
Controls.BtnNextClip.EventHandler    = function() mediaControl('{"slug":"landscape-bar","cmd":"next"}') end
```

The dream demo: one UCI button that calls `cmd:"capture"` **and** routes the Roku's audio at the
Q-SYS mixer — the TV shows the feed, the room hears it, from a single tap on the iPad.

## Deploy

```bash
# source: supabase/functions/media-control/{index.ts, scheduleResolve.ts}
# (v3 bundles the ported M3 resolver — deploy BOTH file parts via the Management API multipart)
curl -sS -X POST \
  "https://api.supabase.com/v1/projects/ysrqvdutayirpoibdlbf/functions/deploy?slug=media-control" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F 'metadata={"name":"media-control","entrypoint_path":"index.ts","verify_jwt":false};type=application/json' \
  -F "file=@supabase/functions/media-control/index.ts;type=application/typescript;filename=index.ts" \
  -F "file=@supabase/functions/media-control/scheduleResolve.ts;type=application/typescript;filename=scheduleResolve.ts"
```

> ⚠ **`scheduleResolve.ts` is a PARITY port** of `apps/web/src/modules/signage/scheduleResolve.ts`
> (the resolver the TV runs). If you touch the schedule/hold logic in one, change the other and
> re-run `pnpm test:scheduleresolve` (web) + `pnpm test:qsysstatus` (this port).

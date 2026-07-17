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
| `rotation` | —           | `program = null` — the normal signage rotation (the default)   |
| `capture`  | —           | `program = {kind:"capture"}` — the live capture feed (the Roku)|
| `playlist` | `playlist`  | `program = {kind:"playlist",…}` — loop a media-library playlist |
| `pause`    | —           | broadcast: pause the playlist `<video>`                        |
| `resume`   | —           | broadcast: resume the playlist `<video>`                       |
| `next`     | —           | broadcast: skip to the next clip in the playlist               |

`slug` (the screen, e.g. `landscape-bar`) is required on every command. The slot must exist and be
**landscape** (programs are a landscape-only feature). `playlist` accepts a playlist **id** (uuid)
or a **name** (case-insensitive, exact — ambiguous names return 409).

`cmd:"capture"` writes a bare `{kind:"capture"}` — it uses the fullbleed default with NO device
match, so a UCI capture press RESETS any DEVICE MATCH or FRAMED that was set on the screen card in
the hub. Configure those in the hub if they matter, or drive capture only from the hub.

### JSON shapes

```json
{ "slug": "landscape-bar", "cmd": "capture" }
{ "slug": "landscape-bar", "cmd": "rotation" }
{ "slug": "landscape-bar", "cmd": "playlist", "playlist": "Atomic Age" }
{ "slug": "landscape-bar", "cmd": "next" }
```

### Responses

- `200 { ok:true, slug, cmd, kind:"program", program }` — program written.
- `200 { ok:true, slug, cmd, kind:"transport" }` — broadcast sent.
- `401 { error:"unauthorized" }` — bad/missing `x-qsys-token`.
- `400` — missing slug/cmd, unknown cmd, portrait slot, or `playlist` missing for a playlist cmd.
- `404` — unknown slug or no playlist matches.
- `409` — ambiguous playlist name.

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

# play a playlist by name
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"playlist","playlist":"Atomic Age"}'

# transport (only affects a running playlist)
curl -sS -X POST "$BASE" -H "x-qsys-token: $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"landscape-bar","cmd":"next"}'

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
# source: supabase/functions/media-control/index.ts (deploy via the Management API multipart)
curl -sS -X POST \
  "https://api.supabase.com/v1/projects/ysrqvdutayirpoibdlbf/functions/deploy?slug=media-control" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F 'metadata={"name":"media-control","entrypoint_path":"index.ts","verify_jwt":false};type=application/json' \
  -F "file=@supabase/functions/media-control/index.ts;type=application/typescript"
```

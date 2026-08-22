# MEDIA COURIER — adding movies to the bar remotely

How a film gets from Stephen's Mac onto the bar's media PC without a drive trip.

Companion pieces:
- `scripts/bunker-add-movie.sh` — the Mac-side prep command
- `scripts/bunker-ship-status.sh` — "has it landed yet?" (read-only, §2)
- `docs/runbooks/media-courier-pc-setup.ps1` — the one-time mini-PC installer
- `apps/media-shell/README.md` — the shell that plays what lands there

---

## 1. Architecture — a ONE-WAY courier

```
  Mac                                     Bar mini PC
  ---------------------------------       -------------------------------------
  ~/BunkerClubOutbox                      <media library>\  (the USB drive)
    16_Action_80s\                          16_Action_80s\
      Movie (1985)\                           Movie (1985)\
        Movie (1985).mp4   ==Syncthing==>       Movie (1985).mp4
        Movie (1985).en.srt                     Movie (1985).en.srt

  folder type: SENDONLY                    folder type: SENDRECEIVE
                                           ignoreDelete: TRUE
```

Both sides share one Syncthing folder, id **`bunkerclub-media`**.

**The Mac side is `sendonly`.** It never pulls the bar's 2 TB library down. The
outbox holds only what is in flight.

**The PC side is `sendreceive` with `ignoreDelete: true`.** That single setting
is what makes this safe:

- Deleting a file from the Mac outbox does **not** delete it at the bar.
- Emptying the whole outbox does **not** empty the bar.
- Even the red **Override Changes** button on the Mac — which normally means
  "make every other machine match me, including deletions" — cannot remove a bar
  file. (Still don't press it. It is noise, not a tool.)

The bar library therefore only ever **grows** through this channel. Removing a
film is a deliberate, separate act (see §6).

**Replacing a film = re-ship the same relative path.** Same playlist folder,
same title, and the new file overwrites the old one at the bar. That is the only
supported "edit".

### What the media shell does with a new arrival

The shell watches the media root with chokidar and only indexes
`.mp4 .mkv .webm .mov` (`apps/media-shell/src/constants.js`). Syncthing's
in-progress temp files are named `~syncthing~<name>.tmp`, so they are invisible
to the catalog; the finished file appears atomically on rename and gets probed,
hashed, thumbnailed and POSTed to `media-catalog-sync` within the debounce
window. A `.srt` sidecar dropped beside it is picked up the same way.

---

## 2. Mac workflow — shipping a film

```bash
scripts/bunker-add-movie.sh <source-video> "<Playlist Folder>" [--title "Title (Year)"] [--dry-run]
```

Examples:

```bash
# ordinary case - everything derived from the filename
scripts/bunker-add-movie.sh ~/Downloads/The.Thing.1982.1080p.BluRay.x264.mkv "16_Action_80s"

# messy filename, name it yourself
scripts/bunker-add-movie.sh ~/Downloads/tt0084787.mkv "16_Action_80s" --title "The Thing (1982)"

# see the plan without touching anything
scripts/bunker-add-movie.sh ~/Downloads/whatever.mkv "21_Comedy" --dry-run
```

The playlist argument is the **literal first-level folder name at the bar**
(`16_Action_80s`, not "Action 80s"). A name that already exists lands in that
playlist; a new name creates a new folder playlist (see the caveat in §7).

What the script does:

| step | detail |
|------|--------|
| title | derived Kodi-style from the filename (scene tags cut, year lifted), or `--title` |
| layout | `<outbox>/<Playlist>/<Title (Year)>/<Title (Year)>.mp4` |
| encode | four classes, see below. Same policy and same ffmpeg settings as `scripts/normalize-media-library.sh`, which produced the existing library. |
| verify | codecs, 1 MiB size floor, faststart, and **duration parity vs the source** (max(5s, 3%)). A failed copy/remux automatically falls back to a full transcode. |
| atomic | ffmpeg writes to a staging dir outside the outbox on the same filesystem, then `rename(2)`s the finished file in. Syncthing never sees a partial file. |
| subtitles | optional English `.srt` via `subliminal` (see §5) |

### Encode classes

| class | source looks like | what runs | cost |
|-------|-------------------|-----------|------|
| `COPY` | already an H.264/AAC `.mp4` with `+faststart` | plain file copy | instant |
| `REMUX` | mp4-copyable codecs, but wrong container or `moov` at the end | `ffmpeg -c copy` into `.mp4` | seconds |
| `AUDIO-REMUX` | fine video ≤1080p, audio that can't ride into `.mp4` (ac3/eac3/dts/truehd/flac/opus…) | `-c:v copy` + audio → stereo AAC 192k | seconds |
| `TRANSCODE` | bad video codec (hevc/vc1/mpeg2…), >1080p, or a copy/remux that failed verification | full H.264/AAC re-encode ≤1080p | ~an hour |

`AUDIO-REMUX` matters more than it sounds: most scene `.mkv` releases are
*already* H.264 1080p and only their AC3/DTS audio is a problem. It copies the
video stream bit-for-bit (proven by comparing `ffmpeg -map 0:v -c copy -f md5 -`
on source and output) and finishes in seconds, where a full transcode would
spend an hour and lose quality to fix nothing but the soundtrack.

Then Syncthing ships it (folder watcher delay ~10s).

### Has it landed? (do not trust "Up to Date")

The Mac's Syncthing UI **never** says Up to Date for this folder — it is
`sendonly` against a ~2 TB library it deliberately never pulls, so it reports
Out of Sync permanently (§7). Two signals that do exist:

1. **The title appears in the signage hub's MEDIA LIBRARY section.** The shell
   only catalogs a *complete* file, so this is the human-grade confirmation —
   and it proves the whole chain, not just the transfer.
2. **`scripts/bunker-ship-status.sh`** — asks the local Syncthing REST API how
   many bytes the bar still needs:

   ```bash
   scripts/bunker-ship-status.sh
   #   Bunker Mini PC     DELIVERED  needBytes=0  needItems=0  100%  remoteState=valid
   #   -> DELIVERED. The local copy in the outbox is safe to delete.
   ```

   Read-only. Exit `0` delivered · `2` no peer paired yet · `3` still in flight.
   The underlying call, if you'd rather run it by hand:

   ```bash
   API=$(sed -n 's/.*<apikey>\(.*\)<\/apikey>.*/\1/p' \
         "$HOME/Library/Application Support/Syncthing/config.xml")
   curl -sS -H "X-API-Key: $API" \
     "http://127.0.0.1:8384/rest/db/completion?folder=bunkerclub-media&device=<PC-DEVICE-ID>"
   ```

   `needBytes: 0` means delivered. (`completion` and `remoteState` are worth a
   glance too — a peer that has never connected can't need anything either.)

**Once it reads DELIVERED, the local copy in the outbox can be deleted** — the
bar keeps its copy. That is the whole point of `ignoreDelete`.

Options:

- `--no-normalize` — refuse to re-encode the **video**; fail loudly if the video
  itself would need one. `COPY`/`REMUX`/`AUDIO-REMUX` still run, since all three
  stream-copy the video. Use when you know the source is already correct and
  don't want to burn an hour of CPU.
- `--dry-run` — print the plan, change nothing.

Environment overrides:

- `BUNKER_OUTBOX` — outbox root (default `$HOME/BunkerClubOutbox`). **Always set
  this when testing** so the real outbox is untouched.
- `BUNKER_SUBLIMINAL` — explicit path to the `subliminal` binary.
- `BUNKER_SUB_MIN_SCORE` — subliminal `--min-score`, default 50.

---

## 3. One-time PC setup

Stephen, on the mini PC (via the TV + keyboard, or Remote Desktop):

1. Right-click Start -> **Terminal (Admin)** / **Windows PowerShell (Admin)**.
2. Get `media-courier-pc-setup.ps1` onto the machine and run it. Either:
   - `notepad $env:TEMP\bunker-courier.ps1`, say yes to "create it", paste the
     script, save, close, then:
     `powershell -ExecutionPolicy Bypass -File $env:TEMP\bunker-courier.ps1`
   - or, if it has been published as a gist:
     `iwr -useb <raw-gist-url> | iex`

   (Pasting ~450 lines straight into a console window is the one path to avoid —
   the legacy console executes line-by-line as it pastes.)
3. A browser opens once for the **Tailscale login**. That is the only
   interactive step.
4. The script finishes by printing three lines — `PC-DEVICE-ID:`,
   `PC-TAILSCALE-IP:`, `PC-USERNAME:`. **Send all three back.**

The script installs Syncthing to `C:\Syncthing`, registers a logon-triggered
Scheduled Task (the PC auto-logs-in), discovers the media library from the media
shell's own `config.json` (`mediaDir`), creates the folder with
`type=sendreceive` + `ignoreDelete=true`, adds a firewall rule, installs
Tailscale, and provisions key-only SSH reachable only over the tailnet (§8).
Re-running it is safe.

> **First scan is heavy.** Syncthing has to hash the entire existing library off
> the USB drive before it can sync anything. The script sets `hashers: 1` and a
> 24-hour rescan interval so it doesn't saturate the same USB bus the media
> shell probes over (the install-night "catalog storm" that produced 69 false
> `unsupported` flags). Expect hours, not minutes, and prefer a quiet morning.

---

## 4. Completing the pairing (Mac side)

Run once, after the PC reports its device ID. Substitute `<PC-DEVICE-ID>`.

```bash
API=$(sed -n 's/.*<apikey>\(.*\)<\/apikey>.*/\1/p' \
      "$HOME/Library/Application Support/Syncthing/config.xml")

# 1. add the PC as a device
curl -sS -X POST -H "X-API-Key: $API" -H 'Content-Type: application/json' \
  http://127.0.0.1:8384/rest/config/devices \
  -d '{"deviceID":"<PC-DEVICE-ID>","name":"Bunker Mini PC","addresses":["dynamic"],"compression":"metadata","introducer":false,"paused":false}'

# 2. share the outbox folder with it (read-modify-write; POST replaces by id)
curl -sS -H "X-API-Key: $API" \
  http://127.0.0.1:8384/rest/config/folders/bunkerclub-media \
| python3 -c '
import json,sys
f=json.load(sys.stdin)
ids={d["deviceID"] for d in f["devices"]}
if "<PC-DEVICE-ID>" not in ids:
    f["devices"].append({"deviceID":"<PC-DEVICE-ID>","introducedBy":"","encryptionPassword":""})
print(json.dumps(f))' \
| curl -sS -X POST -H "X-API-Key: $API" -H 'Content-Type: application/json' \
  http://127.0.0.1:8384/rest/config/folders --data-binary @-

# 3. confirm
curl -sS -H "X-API-Key: $API" \
  http://127.0.0.1:8384/rest/config/folders/bunkerclub-media \
| python3 -m json.tool | grep -E 'deviceID|"type"'
```

Verify the link is live:

```bash
curl -sS -H "X-API-Key: $API" http://127.0.0.1:8384/rest/system/connections \
| python3 -m json.tool | grep -A2 '<PC-DEVICE-ID>'
```

The PC should show `"connected": true` once both ends are up. They do not need
to be on the same LAN — Syncthing's discovery/relay pool (and Tailscale) will
find it.

`POST` on `/rest/config/devices` and `/rest/config/folders` adds a new entry or
replaces the one with the same id, so these commands are safe to re-run.

---

## 5. Subtitles

`bunker-add-movie.sh` calls `subliminal` when it can find it (PATH,
`$BUNKER_SUBLIMINAL`, `~/Library/Python/*/bin`, `~/.local/bin`). If it isn't
installed the step is skipped with a notice and nothing else changes.

Install: `pip3 install --user subliminal` (lands in
`~/Library/Python/<ver>/bin/subliminal`, which the script finds without PATH
changes).

Two flags are load-bearing and were established by testing, not guesswork:

- **`-F srt`** — subliminal otherwise saves the provider's *native* format. A
  real run produced a `.mpl` file, which the media shell cannot read
  (`SUBTITLE_EXTENSION = '.srt'`) and which would have shipped to the bar as
  dead weight. Anything that still slips through in another format is swept.
- **`-m 50`** (`--min-score`) — with no threshold, subliminal will confidently
  download a **completely unrelated film's subtitles** for a title it can't
  find. Measured: an invented title pulled real subtitles at min-score 0-30 and
  was correctly rejected at 40+; a genuine `Labyrinth (1986)` match came through
  at 60. 50 sits between them. Lower it via `BUNKER_SUB_MIN_SCORE` only if you
  are willing to check what lands.

A missing subtitle is harmless — the film plays. A *wrong* subtitle is visible
to the whole room. If one drifts or is plainly wrong, delete its `.srt` (locally
before shipping; at the bar via Tailscale — see §6).

---

## 6. Removing something from the bar

Deliberately out of band, because the courier is one-way by design.

Over Tailscale, from the Mac:

- `tailscale status` to find the PC, then Microsoft Remote Desktop to it, or
  mount its share.
- Delete the film's folder (or just its `.srt`) from the media library.
- The shell's watcher notices and re-catalogs; the file drops out of its
  playlist and out of the carousel on its own.
- Syncthing will simply see a local-only deletion on a folder it isn't pulling
  that path into any more. It does not resurrect it.

Do **not** try to remove a bar file by deleting it from the Mac outbox. That is
exactly the action `ignoreDelete` exists to ignore.

---

## 7. Caveats worth knowing before they bite

**The Mac will show the folder as out of sync, forever.** The bar has ~2 TB the
Mac doesn't. A `sendonly` folder reports every remote-only file as a difference
and offers **Override Changes**. This is cosmetic. `ignoreDelete` on the PC
neutralises the button, but don't press it. Because of this, "Up to Date" is
never a usable delivery signal — use the two in §2 instead.

**Don't rename a file after it has shipped.** Syncthing has no concept of "the
same film, renamed" — a rename on the Mac ships a *second* copy under the new
name and (thanks to `ignoreDelete`) never removes the first. The bar ends up
with the film twice, in two folders. Get the title right *before* shipping;
`--dry-run` prints it.

**A new playlist folder is born carousel-ON** (PR #90, NOTE-3). If you ship a TV
series or anything that shouldn't join the all-playlists rotation, open the
signage hub after the folder appears and toggle **CAROUSEL** off on it — the
same un-toggle done for the six TV-show playlists.

**Run the poster fetch after new titles land**, or the NOW PLAYING slide and the
Q-SYS panel have no artwork for them:

```bash
npx tsx scripts/fetch-movie-posters.ts     # TMDB_API_KEY in root .env
```

It is idempotent and skips files that already have a poster.

**Subtitle format and match quality** — see §5.

**The bar TV picks up nothing from a web deploy here.** This whole pipeline is
files-on-disk; no migration, no edge function, no bundle. The only moving parts
at the bar are Syncthing and the shell's existing watcher.

---

## 8. Claude remote access (SSH over Tailscale)

Owner-requested: the PC setup script also enables Windows' built-in OpenSSH
Server so Claude sessions on Stephen's Mac can run maintenance on the mini PC
directly — shell log checks and restarts, media surgery (§6 without RDP),
future shell upgrades — no more paste-blocks or drive trips.

> **If step 7 hangs** (Add-WindowsCapability waiting on a Windows Update the
> kiosk debloat disabled — this is what happened on the real PC): kill it and
> run `docs/runbooks/media-courier-pc-ssh-standalone.ps1` instead. It installs
> Microsoft's standalone Win32-OpenSSH MSI (no Windows Update involved) and then
> applies the exact same key/lockdown/firewall steps. That script is how the
> bar PC's SSH was actually provisioned, field-verified 2026-08-21.

From the Mac:

```bash
ssh -i ~/.ssh/bunker_pc_ed25519 <PC-USERNAME>@<PC-TAILSCALE-IP>
```

(the last two values come from the setup script's final printout; commands run
in `cmd` by default — prefix with `powershell -Command` as needed).

Security posture:

- **Key-only** — `PasswordAuthentication no`; the only authorized key is
  `~/.ssh/bunker_pc_ed25519.pub` from Stephen's Mac, in
  `C:\ProgramData\ssh\administrators_authorized_keys` (ACL-locked to
  Administrators + SYSTEM, as sshd requires).
- **Tailnet-only** — the default wide-open port-22 firewall rule is disabled and
  replaced with one scoped to `100.64.0.0/10`. SSH is not reachable from the bar
  LAN or the internet, only from devices on the tailnet.
- The private key never leaves the Mac.

⚠ This is the live bar appliance. Heartbeat-first discipline applies: check
`signage_slots.last_seen` before and after anything that could disturb playback,
and prefer quiet mornings for disruptive work.

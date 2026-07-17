# BUNKER MEDIA SHELL

Thin Electron kiosk shell for the bar's **mini Windows PC** — the machine that
drives the media-capable landscape TV (media module **M1**).

It does three jobs and nothing else (all real UI lives in the web app):

1. Opens a fullscreen kiosk browser at `{appUrl}/signage/s/{slug}`.
2. Serves the local video library over `http://127.0.0.1:{port}/media/{hash}`
   with full HTTP Range support so the signage board can play + seek it.
3. Watches the media folder, probes each clip, and POSTs a catalog to the
   `media-catalog-sync` edge fn so the web app knows what's on this PC.

The shell is **thin** — it has no interface of its own beyond a loud error
screen when config is wrong.

---

## Setup on the mini Windows PC

1. **Install the app** — run `BunkerMediaShell-Setup-<version>.exe` (built with
   `npm run dist:win`). It installs per-user, creates Start-menu + desktop
   shortcuts, and — once launched — registers itself to **auto-launch on
   Windows login** (so it comes back after a power blip). To disable, remove it
   from Task Manager → Startup.

2. **Create `config.json`.** The app looks for it, in order:
   1. the path in the `BUNKER_MEDIA_CONFIG` environment variable,
   2. `config.json` next to the app,
   3. `config.json` in the current working directory,
   4. `%APPDATA%\Bunker Media Shell\config.json` (the app's userData dir — the
      recommended spot on Windows).

   ```json
   {
     "slug": "landscape-bar",
     "mediaDir": "C:\\BunkerMedia",
     "port": 48151,
     "catalogUrl": "https://<project>.supabase.co/functions/v1/media-catalog-sync",
     "deviceToken": "PASTE-DEVICE-TOKEN-HERE",
     "appUrl": "https://os.bunkerokc.com"
   }
   ```

   | field | required | meaning |
   |-------|----------|---------|
   | `slug` | **yes** | signage slot slug; the kiosk opens `/signage/s/{slug}` |
   | `mediaDir` | **yes** | absolute path to the media folder (must exist) |
   | `port` | no | local media-server port. Default **48151** |
   | `catalogUrl` | no* | `media-catalog-sync` edge fn URL |
   | `deviceToken` | no* | device token sent as `x-device-token` |
   | `appUrl` | no | web app origin. Default `https://os.bunkerokc.com` |

   \* If `catalogUrl` **or** `deviceToken` is missing the shell runs in **dev
   mode**: it still serves media locally but does not POST — it logs the catalog
   payload it *would* send. Set both to go live.

   If `config.json` is missing or invalid, the app shows a full-screen red
   error describing exactly what's wrong instead of a black screen.

3. **Media folder layout — subfolders become playlists.** Drop videos under
   `mediaDir`. Each **first-level subfolder is an auto-playlist** (its `name` and
   ordered file list are sent in the catalog); loose files at the root are
   cataloged individually but belong to no playlist.

   ```
   C:\BunkerMedia\
     Ambient Loops\        <- playlist "Ambient Loops"
       citylights.mp4
       neon-rain.mp4
     Archival\             <- playlist "Archival"
       route66-1957.mov
     bumper.mp4            <- loose file, no playlist
   ```

   Supported containers: **.mp4 .mkv .webm .mov**. Anything that won't probe
   (corrupt / DRM / unknown codec) is still listed with `status: "unsupported"`.
   Files are re-scanned automatically when the folder changes; big files still
   copying are left alone until the copy finishes.

   > House → bar sync of the curated folder is handled on the owner's side; the
   > shell only reads whatever is in `mediaDir`.

4. **Audio is always on from this PC.** The shell unlocks autoplay + audio
   (`--autoplay-policy=no-user-gesture-required`) so video starts unattended.
   Staff gate sound at the bar's QSYS/Sonos source selection — there is no
   in-app audio toggle by design.

5. **Capture passthrough (Roku via the USB capture card).** The kiosk auto-grants
   camera/mic (`getUserMedia`) **only** to the app origin, so the web app's
   capture slide can show the capture device. No per-boot clicking.

---

## Verify it's working

- **Health:** browse (or `curl`) `http://127.0.0.1:48151/health` on the PC →
  `{"ok":true,"fileCount":<n>,"version":"..."}`. `fileCount` should match the
  number of videos under `mediaDir`.
- **A clip streams:** `http://127.0.0.1:48151/media/<hash>` returns the video
  with `Accept-Ranges: bytes` (seeking works).
- **Catalog:** with `catalogUrl`+`deviceToken` set, the logs (in
  `%APPDATA%\Bunker Media Shell\logs\`) show `catalog synced: N files ...` after
  startup and after any folder change.

---

## Dev mode (macOS / any dev machine)

```bash
cd apps/media-shell
npm install                 # electron + chokidar + ffmpeg/ffprobe-static
# point a config.json at a local folder of test videos, then:
npm start                   # opens the kiosk window against appUrl
```

Run the headless self-test (no window; builds a temp clip, exercises the server
Range logic, thumbnailing, and the dev-mode catalog payload):

```bash
npm run verify
```

`ffmpeg`/`ffprobe` come from the bundled `ffmpeg-static`/`ffprobe-static`
packages; if those aren't installed the tools fall back to `ffmpeg`/`ffprobe` on
`PATH` (e.g. Homebrew), which is how `npm run verify` works with no install.

---

## Packaging

`npm run dist:win` builds the Windows NSIS installer (`BunkerMediaShell-Setup-<version>.exe`)
via electron-builder (config in `package.json` → `build`). It runs
`scripts/fetch-win-ffmpeg.js` first, then `electron-builder --win nsis --x64`.
`npm run pack` produces an unpacked dir for local inspection.

**The cross-platform ffmpeg gotcha.** `ffmpeg-static` only downloads the *build
machine's* platform binary at install time — on a Mac that's an arm64 Mach-O,
useless inside a Windows package. So the real Windows binaries are staged
separately:

- `npm run fetch:win-ff` (`scripts/fetch-win-ffmpeg.js`) fetches the win32-x64
  `ffmpeg.exe` from the same `ffmpeg-static` GitHub release its `binary-release-tag`
  pins, and copies the win32-x64 `ffprobe.exe` that `ffprobe-static` already bundles
  for every platform, into **`vendor/win32-x64/`** (gitignored; regenerated by the
  script, network needed for ffmpeg).
- electron-builder maps `vendor/win32-x64/` into the packaged app under
  `resources/vendor/win32-x64/` (`build.win.extraResources`).
- `src/fftools.js` prefers `{process.resourcesPath}/vendor/win32-x64/{ffmpeg,ffprobe}.exe`
  on win32 packaged builds, ahead of the `ffmpeg-static`/`ffprobe-static` module
  paths and the `PATH` fallback. **macOS dev is unchanged** — the vendor branch
  never fires off-win32, so `npm start` / `npm run verify` still use the static
  modules.
- The (mac) static binaries are excluded from the packaged app (`build.files`
  negations) so the Windows installer doesn't carry ~100 MB of unrunnable Mach-O
  binaries; only the JS that resolves paths remains in the asar.

This means the installer **can be cross-built on macOS** (electron-builder runs
NSIS under its bundled wine; no manual wine needed) and the packaged win32-x64
binaries verify as `PE32+ executable ... for MS Windows`. It cannot be *run* on
macOS — runtime proof happens on the Windows mini PC.

**Auto-launch on login** is handled in `src/main.js` — `app.setLoginItemSettings({
openAtLogin: true })`, guarded to packaged win32 only — plus the NSIS
`runAfterFinish` launch. Remove it via Task Manager → Startup.

---

## Web-app contract

- **Default port:** the single source of truth is `DEFAULT_MEDIA_PORT` in
  [`src/constants.js`](./src/constants.js) (**48151**). The web app must resolve
  media at `http://127.0.0.1:48151/media/{hash}` by default. Because this is a
  CommonJS constant in a separate app, the web side should mirror the value (or
  import it) and keep the two in sync — 48151 is the contract.

- **Catalog payload** POSTed to `catalogUrl` with header
  `x-device-token: {deviceToken}`:

  ```jsonc
  {
    "files": [
      {
        "filename": "Ambient Loops/citylights.mp4", // path relative to mediaDir (POSIX slashes)
        "hash": "<40-hex sha1>",                     // fast content hash (see below)
        "duration_seconds": 92,
        "width": 1920,
        "height": 1080,
        "size_bytes": 48210433,
        "status": "present",                          // or "unsupported" ("missing" is server-derived)
        "thumb_b64": "<jpeg base64>"                  // ONLY for not-yet-acked hashes
      }
    ],
    "folders": [
      {
        "path": "Ambient Loops",                      // first-level subfolder
        "name": "Ambient Loops",
        "hashes": ["<hash1>", "<hash2>"]              // ordered by filename
      }
    ]
  }
  ```

  - `thumb_b64` is a JPEG ≤200KB (long edge ≤480px), sent **only** for hashes the
    server hasn't acknowledged yet. The shell keeps a local sent-thumbs cache
    (`%APPDATA%\Bunker Media Shell\sent-thumbs.json`) and also honors an optional
    `acknowledged` / `known_hashes` array in the POST response.
  - `folders` = each first-level subfolder = one playlist; root-level loose files
    are omitted from `folders` (they still appear in `files`).

- **Hash strategy:** `sha1( 8-byte big-endian size ++ first 1MB ++ last 1MB )`.
  Whole multi-GB movies are never fully read. Files ≤2MB hash `size ++ whole
  file`. Stable across machines for identical bytes — this keys `/media/{hash}`
  and de-dupes the library.

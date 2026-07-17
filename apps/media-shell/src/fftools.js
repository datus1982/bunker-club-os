'use strict';

/**
 * Resolve the ffmpeg / ffprobe binaries.
 *
 * Preference order:
 *   1. On win32 in a packaged app: the vendored win32-x64 binaries shipped as
 *      extraResources at `{resourcesPath}/vendor/win32-x64/{ffmpeg,ffprobe}.exe`.
 *      `ffmpeg-static` only downloads the build machine's platform binary (an
 *      arm64 Mach-O on the Mac that packages this), so the real Windows binaries
 *      are staged separately by `scripts/fetch-win-ffmpeg.js` and mapped in via
 *      electron-builder (see package.json build.win.extraResources). This is the
 *      path that actually runs on the mini PC.
 *   2. The bundled static modules (`ffmpeg-static` / `ffprobe-static`) — the
 *      dev-machine path (macOS/Linux `npm start` + `npm run verify`). `ffmpeg-static`
 *      exports a binary path; `ffprobe-static` exports `{ path }`. Inside a packaged
 *      app these resolve to an asar path, so we rewrite `app.asar` -> `app.asar.unpacked`.
 *   3. `ffmpeg` / `ffprobe` on PATH — the last-resort fallback (e.g. Homebrew).
 *
 * macOS dev behavior is unchanged: step 1 never fires off-win32, so resolution
 * falls straight through to the static modules as before.
 */

const fs = require('fs');
const path = require('path');

/**
 * The packaged win32-x64 vendor binary, if present. Only consulted on win32 —
 * `process.resourcesPath` is Electron-only and points at the app's resources dir
 * in a packaged build. Returns null in dev / off-win32 / when the file is absent.
 */
function resolveVendorWin(name) {
  if (process.platform !== 'win32') return null;
  const base = process.resourcesPath;
  if (!base) return null;
  const p = path.join(base, 'vendor', 'win32-x64', `${name}.exe`);
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function resolveStatic(mod, memberIsPath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const val = require(mod);
    let p = memberIsPath ? val : val && val.path;
    if (typeof p !== 'string' || !p) return null;
    // Inside a packaged app the module resolves to an asar path; the actual
    // binary is unpacked next to it.
    p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    p = p.replace('app.asar/', 'app.asar.unpacked/');
    return p;
  } catch {
    return null;
  }
}

function resolveFfmpeg() {
  return resolveVendorWin('ffmpeg') || resolveStatic('ffmpeg-static', true) || 'ffmpeg';
}

function resolveFfprobe() {
  return resolveVendorWin('ffprobe') || resolveStatic('ffprobe-static', false) || 'ffprobe';
}

module.exports = {
  ffmpegPath: resolveFfmpeg(),
  ffprobePath: resolveFfprobe(),
};

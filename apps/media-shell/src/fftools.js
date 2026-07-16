'use strict';

/**
 * Resolve the ffmpeg / ffprobe binaries.
 *
 * Preference order:
 *   1. The bundled static binaries (ffmpeg-static / ffprobe-static) — these ship
 *      inside the packaged Windows app so the mini PC needs nothing installed.
 *   2. `ffmpeg` / `ffprobe` on PATH — the dev-machine fallback (e.g. Homebrew).
 *
 * When packaged by electron-builder the static binaries live inside the asar's
 * unpacked dir; we rewrite the `app.asar` path segment to `app.asar.unpacked`
 * (electron-builder's asarUnpack convention) so the real executable is found.
 */

function resolveStatic(mod, memberIsPath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const val = require(mod);
    let p = memberIsPath ? val : val && val.path;
    if (typeof p !== 'string' || !p) return null;
    // Inside a packaged app the module resolves to an asar path; the actual
    // binary is unpacked next to it.
    p = p.replace('app.asar' + require('path').sep, 'app.asar.unpacked' + require('path').sep);
    p = p.replace('app.asar/', 'app.asar.unpacked/');
    return p;
  } catch {
    return null;
  }
}

function resolveFfmpeg() {
  return resolveStatic('ffmpeg-static', true) || 'ffmpeg';
}

function resolveFfprobe() {
  const staticPath = resolveStatic('ffprobe-static', false);
  return staticPath || 'ffprobe';
}

module.exports = {
  ffmpegPath: resolveFfmpeg(),
  ffprobePath: resolveFfprobe(),
};

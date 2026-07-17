'use strict';

/**
 * Stage the win32-x64 ffmpeg.exe + ffprobe.exe into vendor/win32-x64/.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ffmpeg-static` downloads only the CURRENT platform's ffmpeg binary at install
 * time. On this Mac that means an arm64 Mach-O binary — useless inside a Windows
 * package. electron-builder therefore has nothing to hand the win target. This
 * script fetches the win32-x64 ffmpeg binary for the SAME release the installed
 * `ffmpeg-static` pins (its `binary-release-tag`), and copies the win32-x64
 * ffprobe binary that `ffprobe-static` already bundles for every platform.
 *
 *   vendor/win32-x64/ffmpeg.exe   <- gunzipped from the ffmpeg-static GH release
 *   vendor/win32-x64/ffprobe.exe  <- copied from node_modules/ffprobe-static
 *
 * electron-builder maps vendor/win32-x64/ into the packaged app's resources/
 * (see package.json build.win.extraResources), and src/fftools.js prefers those
 * resource binaries on win32. macOS dev behavior is untouched — fftools still
 * resolves ffmpeg-static / ffprobe-static on this machine.
 *
 * Run:  node scripts/fetch-win-ffmpeg.js   (network required for ffmpeg.exe)
 * Idempotent: skips a target that already looks like a valid PE32+ .exe.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'vendor', 'win32-x64');
const MIN_BYTES = 5 * 1024 * 1024; // sanity floor: real ffmpeg/ffprobe are tens of MB

function log(...a) {
  console.log('[fetch-win-ffmpeg]', ...a);
}

/** GET with redirect following, resolving to a Buffer of the body. */
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'bunker-media-shell-build' } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        const next = new URL(headers.location, url).toString();
        return resolve(download(next, redirects + 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET ${url} -> HTTP ${statusCode}`));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

/** True if the file exists, is a Windows PE (starts with "MZ"), and is big enough. */
function looksLikeWinExe(p) {
  try {
    const st = fs.statSync(p);
    if (st.size < MIN_BYTES) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // 'M','Z'
  } catch {
    return false;
  }
}

function assertWinExe(p, label) {
  if (!looksLikeWinExe(p)) {
    throw new Error(`${label} at ${p} is not a valid Windows PE executable (missing MZ header or too small)`);
  }
  log(`OK ${label}: ${p} (${(fs.statSync(p).size / 1e6).toFixed(1)} MB, MZ header verified)`);
}

async function fetchFfmpeg() {
  const target = path.join(VENDOR_DIR, 'ffmpeg.exe');
  if (looksLikeWinExe(target)) {
    log('ffmpeg.exe already staged, skipping download');
    return;
  }
  const ffmpegStaticPkg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static', 'package.json'));
  const tag = ffmpegStaticPkg['ffmpeg-static'] && ffmpegStaticPkg['ffmpeg-static']['binary-release-tag'];
  if (!tag) throw new Error('could not read ffmpeg-static binary-release-tag from its package.json');
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/ffmpeg-win32-x64.gz`;
  log(`downloading ffmpeg win32-x64 (release ${tag})`);
  log(`  ${url}`);
  const gz = await download(url);
  log(`  downloaded ${(gz.length / 1e6).toFixed(1)} MB gzipped, decompressing...`);
  const bin = zlib.gunzipSync(gz);
  fs.writeFileSync(target, bin);
  assertWinExe(target, 'ffmpeg.exe');
}

function stageFfprobe() {
  const target = path.join(VENDOR_DIR, 'ffprobe.exe');
  if (looksLikeWinExe(target)) {
    log('ffprobe.exe already staged, skipping copy');
    return;
  }
  // ffprobe-static ships every platform's binary inside the npm package.
  const bundled = path.join(ROOT, 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe');
  if (!fs.existsSync(bundled)) {
    throw new Error(
      `ffprobe-static win32/x64 binary not found at ${bundled} — run npm install first`
    );
  }
  log(`copying ffprobe.exe from ffprobe-static (${bundled})`);
  fs.copyFileSync(bundled, target);
  assertWinExe(target, 'ffprobe.exe');
}

async function main() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  await fetchFfmpeg();
  stageFfprobe();
  log(`done. vendor dir: ${VENDOR_DIR}`);
  log(`  ${fs.readdirSync(VENDOR_DIR).join('\n  ')}`);
  // Non-fatal note if run on a machine where these can't execute (they only run on Windows).
  if (os.platform() !== 'win32') {
    log('(these are Windows binaries; they package into the win build, not run on this host)');
  }
}

main().catch((e) => {
  console.error('[fetch-win-ffmpeg] FAILED:', e.message);
  process.exit(1);
});

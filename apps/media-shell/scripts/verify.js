'use strict';

/**
 * Dev verification harness — runs the media server + library scan + catalog
 * sync WITHOUT opening the Electron kiosk window, so it works headless on macOS.
 *
 * It builds a temp media dir with one tiny ffmpeg-generated test clip inside a
 * subfolder, scans it, serves it, and exercises /health, a Range request on
 * /media/{hash}, thumbnail production, and the dev-mode catalog payload.
 *
 * Usage:  node scripts/verify.js
 * Exits non-zero on any failed assertion.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const { MediaLibrary } = require('../src/mediaLibrary');
const { createMediaServer } = require('../src/mediaServer');
const { CatalogSync } = require('../src/catalogSync');
const { ffmpegPath } = require('../src/fftools');
const { DEFAULT_MEDIA_PORT } = require('../src/constants');
const pkg = require('../package.json');

const PORT = 48752; // isolated test port (not the default, to avoid collisions)
let failures = 0;
function ok(cond, label, extra) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? '  ::  ' + extra : ''}`);
  }
}

/**
 * Async HTTP request against the in-process server. We must NOT use spawnSync
 * here: it would block the single Node event loop and the server (same loop)
 * could never answer, deadlocking. Returns { status, headers, body, raw }.
 */
function httpReq(reqPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: reqPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const raw =
            `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\n` +
            Object.entries(res.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n');
          resolve({ status: res.statusCode, headers: res.headers, body, raw });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('BUNKER MEDIA SHELL — verification\n');
  console.log(`  default port constant (web app must mirror): ${DEFAULT_MEDIA_PORT}\n`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bms-verify-'));
  const mediaDir = path.join(tmp, 'media');
  const subDir = path.join(mediaDir, 'Ambient Loops');
  fs.mkdirSync(subDir, { recursive: true });
  const clip = path.join(subDir, 'colorbars.mp4');

  // 5s color bars, H.264, small. testsrc pattern @ 320x240.
  console.log('  generating test clip via ffmpeg...');
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=15:duration=5',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-t', '5',
      clip,
    ],
    { stdio: 'ignore' }
  );
  ok(fs.existsSync(clip) && fs.statSync(clip).size > 0, 'test clip generated');

  // --- scan ---
  const library = new MediaLibrary(mediaDir);
  await library.scanAll();
  ok(library.fileCount() === 1, 'library scanned 1 file', `got ${library.fileCount()}`);

  const entry = [...library.byHash.values()][0];
  ok(!!entry, 'entry present');
  ok(entry && entry.status === 'ready', 'entry status ready', entry && entry.status);
  ok(entry && entry.duration_seconds === 5, 'duration ~5s', entry && String(entry.duration_seconds));
  ok(entry && entry.width === 320 && entry.height === 240, 'dimensions 320x240',
    entry && `${entry.width}x${entry.height}`);
  ok(entry && entry.filename === 'Ambient Loops/colorbars.mp4', 'relative filename (posix)',
    entry && entry.filename);
  ok(entry && Buffer.isBuffer(entry.thumb) && entry.thumb.length > 0,
    'thumbnail jpeg produced', entry && (entry.thumb ? entry.thumb.length + ' bytes' : 'null'));
  ok(entry && entry.thumb && entry.thumb.slice(0, 2).toString('hex') === 'ffd8',
    'thumbnail has JPEG SOI marker (ffd8)');
  ok(entry && entry.thumb && entry.thumb.length <= 200 * 1024, 'thumbnail <= 200KB');

  const hash = entry.hash;

  // --- server ---
  const srv = createMediaServer(library, {
    port: PORT,
    appOrigin: 'https://os.bunkerokc.com',
    version: pkg.version,
  });
  await srv.listen(PORT);

  // /health
  const health = await httpReq('/health');
  let healthJson = {};
  try { healthJson = JSON.parse(health.body.toString('utf8')); } catch { /* */ }
  ok(healthJson.ok === true && healthJson.fileCount === 1,
    '/health -> ok:true fileCount:1', JSON.stringify(healthJson));
  ok(healthJson.version === pkg.version, '/health version matches package', healthJson.version);
  console.log('\n  --- GET /health ---');
  console.log('  ' + health.raw.split('\n').join('\n  '));
  console.log('  ' + health.body.toString('utf8'));

  // Range request
  console.log('\n  --- GET /media/{hash}  (Range: bytes=0-1023) ---');
  const ranged = await httpReq(`/media/${hash}`, { Range: 'bytes=0-1023' });
  console.log('  ' + ranged.raw.split('\n').join('\n  '));
  ok(ranged.status === 206, 'status 206 Partial Content', String(ranged.status));
  const size = fs.statSync(clip).size;
  ok(ranged.headers['content-range'] === `bytes 0-1023/${size}`,
    'Content-Range header correct', ranged.headers['content-range']);
  ok(ranged.headers['content-length'] === '1024', 'Content-Length 1024',
    ranged.headers['content-length']);
  ok(ranged.body.length === 1024, 'body is exactly 1024 bytes', String(ranged.body.length));
  ok(ranged.headers['accept-ranges'] === 'bytes', 'Accept-Ranges: bytes');
  ok(ranged.headers['access-control-allow-origin'] === 'https://os.bunkerokc.com',
    'CORS pinned to app origin', ranged.headers['access-control-allow-origin']);
  ok(ranged.headers['content-type'] === 'video/mp4', 'Content-Type video/mp4',
    ranged.headers['content-type']);

  // Suffix range (last 100 bytes)
  const suffix = await httpReq(`/media/${hash}`, { Range: 'bytes=-100' });
  ok(suffix.status === 206 && suffix.headers['content-range'] === `bytes ${size - 100}-${size - 1}/${size}`,
    'suffix range bytes=-100 correct', suffix.headers['content-range']);

  // Unsatisfiable range -> 416
  const bad = await httpReq(`/media/${hash}`, { Range: `bytes=${size + 10}-${size + 20}` });
  ok(bad.status === 416, 'unsatisfiable range -> 416', String(bad.status));

  // Full request Content-Length equals file size
  const full = await httpReq(`/media/${hash}`, {}, 'HEAD');
  ok(full.headers['content-length'] === String(size),
    'full HEAD Content-Length == file size', `size=${size}`);

  // Unknown hash -> 404
  const missing = await httpReq('/media/deadbeef');
  ok(missing.status === 404, 'unknown hash -> 404', String(missing.status));

  // Path traversal attempt in the hash slot -> 404 (regex won't match)
  const traversal = await httpReq('/media/..%2f..%2fetc%2fpasswd');
  ok(traversal.status === 404, 'traversal-shaped path -> 404', String(traversal.status));

  // --- catalog (dev mode: no url/token -> logs payload, returns it) ---
  console.log('\n  --- catalog dev-mode payload ---');
  const sync = new CatalogSync(library, { catalogUrl: '', deviceToken: '' });
  await sync._run();
  const { payload } = library.buildCatalog(() => false);
  // Print the real payload (thumb elided) for the report.
  const printable = {
    files: payload.files.map((f) => f.thumb_b64
      ? { ...f, thumb_b64: `<jpeg base64, ${f.thumb_b64.length} chars>` }
      : f),
    folders: payload.folders,
  };
  console.log(JSON.stringify(printable, null, 2).split('\n').map((l) => '  ' + l).join('\n'));

  // Contract assertions.
  const f0 = payload.files[0];
  ok(payload.files.length === 1, 'payload.files length 1');
  ok(f0 && typeof f0.filename === 'string' && typeof f0.hash === 'string'
     && typeof f0.duration_seconds === 'number' && typeof f0.width === 'number'
     && typeof f0.height === 'number' && typeof f0.size_bytes === 'number'
     && typeof f0.status === 'string' && typeof f0.thumb_b64 === 'string',
    'file object has all contract fields incl. thumb_b64');
  ok(payload.folders.length === 1, 'payload.folders length 1');
  const fo = payload.folders[0];
  ok(fo && fo.path === 'Ambient Loops' && fo.name === 'Ambient Loops'
     && Array.isArray(fo.hashes) && fo.hashes[0] === hash,
    'folder object: path/name/ordered hashes', fo && JSON.stringify(fo).slice(0, 120));

  // sent-thumbs behavior: second build with hash acked -> no thumb_b64.
  const { payload: p2 } = library.buildCatalog((h) => h === hash);
  ok(p2.files[0] && p2.files[0].thumb_b64 === undefined,
    'acknowledged hash omits thumb_b64 on next build');

  await srv.close();

  // cleanup
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(!fs.existsSync(tmp), 'temp files cleaned up');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('verify harness crashed:', e);
  process.exit(1);
});

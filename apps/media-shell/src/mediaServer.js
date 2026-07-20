'use strict';

/**
 * Local media HTTP server, bound to 127.0.0.1 only.
 *
 * Routes:
 *   GET /health        -> { ok, fileCount, version }
 *   GET /media/{hash}  -> streams the mapped file with full HTTP Range support
 *                         (video seeking), correct Content-Type, and a CORS
 *                         header pinned to the app origin.
 *
 * Security: the URL never carries a filesystem path — only an opaque hash that
 * must already be in the library. The resolved absolute path is re-checked to
 * be inside mediaDir (defense in depth). Unknown hash -> 404. Any other path
 * -> 404.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { CONTENT_TYPES, PORT_BIND_RETRIES, PORT_BIND_RETRY_MS } = require('./constants');
const { readSubtitleAsVtt } = require('./subtitles');
const log = require('./log');

function contentTypeFor(filename) {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function parseRange(header, size) {
  // Only single-range "bytes=start-end" is supported (all browsers send this).
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m) return null;
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  let start;
  let end;
  if (hasStart) {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
  } else if (hasEnd) {
    // suffix range: last N bytes
    const n = parseInt(m[2], 10);
    if (n === 0) return { unsatisfiable: true };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  end = Math.min(end, size - 1);
  if (start > end || start < 0) return { unsatisfiable: true };
  return { start, end };
}

/**
 * @param {import('./mediaLibrary').MediaLibrary} library
 * @param {{ port:number, appOrigin:string, version:string }} opts
 */
function createMediaServer(library, opts) {
  const { appOrigin, version } = opts;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const cors = () => {
      if (appOrigin) {
        res.setHeader('Access-Control-Allow-Origin', appOrigin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    };

    if (req.method === 'OPTIONS') {
      cors();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('method not allowed');
      return;
    }

    if (url.pathname === '/health') {
      cors();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, fileCount: library.fileCount(), version }));
      return;
    }

    // Subtitles: /subs/{hash}[.vtt] -> the sidecar .srt converted to WebVTT on demand (v0.2).
    // Cross-origin: the <track> is CORS-fetched (the video carries crossorigin="anonymous"), so
    // this must send the same pinned CORS headers as /media. Unknown hash / no sidecar -> 404.
    const subMatch = /^\/subs\/([A-Za-z0-9]+)(?:\.vtt)?$/.exec(url.pathname);
    if (subMatch) {
      cors();
      const entry = library.getByHash(subMatch[1]);
      if (!entry || !entry.srtPath) {
        res.writeHead(404);
        res.end('no subtitles');
        return;
      }
      const subAbs = path.resolve(entry.srtPath);
      const subRoot = path.resolve(library.mediaDir);
      if (subAbs !== subRoot && !subAbs.startsWith(subRoot + path.sep)) {
        log.error('subtitle path escaped media root, refusing', subAbs);
        res.writeHead(404);
        res.end('not found');
        return;
      }
      let vtt;
      try {
        vtt = readSubtitleAsVtt(subAbs);
      } catch {
        res.writeHead(404);
        res.end('subtitle unreadable');
        return;
      }
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(vtt, 'utf8'));
      res.writeHead(200);
      if (req.method === 'HEAD') return res.end();
      res.end(vtt);
      return;
    }

    const mediaMatch = /^\/media\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (!mediaMatch) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const hash = mediaMatch[1];
    const entry = library.getByHash(hash);
    if (!entry) {
      res.writeHead(404);
      res.end('unknown hash');
      return;
    }

    // Defense in depth: the mapped path MUST live under the media root.
    const abs = path.resolve(entry.absPath);
    const root = path.resolve(library.mediaDir);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      log.error('path escaped media root, refusing', abs);
      res.writeHead(404);
      res.end('not found');
      return;
    }

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const size = stat.size;
    const type = contentTypeFor(entry.filename);
    cors();
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', type);

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, size);
      if (!range) {
        // Unparseable range -> serve whole (spec allows ignoring).
        res.setHeader('Content-Length', size);
        res.writeHead(200);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(abs).pipe(res);
        return;
      }
      if (range.unsatisfiable) {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.writeHead(416);
        res.end();
        return;
      }
      const { start, end } = range;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      res.writeHead(206);
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(abs, { start, end });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Length', size);
    res.writeHead(200);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(abs);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  // Bind 127.0.0.1:{port}, retrying on EADDRINUSE. On a watchdog relaunch the just-killed prior
  // instance can still be holding the port for a moment (TIME_WAIT / not-yet-released socket); a
  // few short retries let the relaunched shell recover the port instead of dying on the error
  // screen and stranding the TV on MEDIA HOST OFFLINE.
  function listen(port, { retries = PORT_BIND_RETRIES, delayMs = PORT_BIND_RETRY_MS } = {}) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tryBind = () => {
        const onErr = (e) => {
          if (e && e.code === 'EADDRINUSE' && attempt < retries) {
            attempt += 1;
            log.warn(`port ${port} in use — retry ${attempt}/${retries} in ${delayMs}ms`);
            setTimeout(tryBind, delayMs);
            return;
          }
          reject(e);
        };
        server.once('error', onErr);
        // 127.0.0.1 ONLY — never expose the library to the LAN.
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onErr);
          log.info(`media server listening on http://127.0.0.1:${port}`);
          resolve(server);
        });
      };
      tryBind();
    });
  }

  function close() {
    return new Promise((resolve) => {
      // http.Server.close() stops accepting new connections but NEVER terminates ESTABLISHED
      // ones — on the watchdog path the kiosk's keep-alive/video sockets are still open, so a
      // bare close() would hang forever and the relaunch/exit would never run. Forcibly destroy
      // in-flight sockets first (Node ≥18.2) so close() resolves promptly.
      try {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      } catch {
        /* ignore */
      }
      server.close(() => resolve());
    });
  }

  return { server, listen, close };
}

module.exports = { createMediaServer, parseRange };

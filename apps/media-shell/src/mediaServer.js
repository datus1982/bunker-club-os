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
const { CONTENT_TYPES } = require('./constants');
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

  function listen(port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      // 127.0.0.1 ONLY — never expose the library to the LAN.
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        log.info(`media server listening on http://127.0.0.1:${port}`);
        resolve(server);
      });
    });
  }

  function close() {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, listen, close };
}

module.exports = { createMediaServer, parseRange };

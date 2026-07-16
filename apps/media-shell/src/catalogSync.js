'use strict';

/**
 * Catalog sync client.
 *
 * POSTs the full catalog to the `media-catalog-sync` edge fn:
 *   POST {catalogUrl}
 *   header  x-device-token: {deviceToken}
 *   body    { files:[...], folders:[...] }   (see mediaLibrary.buildCatalog)
 *
 * Behavior:
 *   - Full POST on startup and after any debounced change (the caller debounces
 *     to CATALOG_DEBOUNCE_MS; we also coalesce overlapping sends).
 *   - On failure: exponential backoff retry, logged, NEVER throws to the caller.
 *   - Sent-thumbs cache: after a successful POST, every hash whose thumb_b64 we
 *     included is recorded (persisted to a JSON file in userData) so future
 *     POSTs omit already-acknowledged thumbnails. If the server returns an
 *     `acknowledged`/`known_hashes` array we merge that in too (forward compat).
 *   - Dev mode: when catalogUrl OR deviceToken is unset, nothing is sent; we log
 *     the exact payload that WOULD be posted (thumbs elided to a marker so the
 *     log stays readable) and return it.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const log = require('./log');

class CatalogSync {
  /**
   * @param {import('./mediaLibrary').MediaLibrary} library
   * @param {{ catalogUrl?:string, deviceToken?:string, sentThumbsPath?:string }} cfg
   */
  constructor(library, cfg) {
    this.library = library;
    this.catalogUrl = cfg.catalogUrl || '';
    this.deviceToken = cfg.deviceToken || '';
    this.sentThumbsPath = cfg.sentThumbsPath || null;
    this.devMode = !this.catalogUrl || !this.deviceToken;

    // DECISION: "acknowledged" is interpreted as "we successfully POSTed a thumb
    // for this hash" (2xx), persisted locally. We ALSO merge any
    // `acknowledged`/`known_hashes` array the edge fn returns, so the server can
    // authoritatively suppress re-sends. If the edge fn expects a different
    // handshake, adjust _postWithBackoff's response parsing.
    /** @type {Set<string>} hashes whose thumbnail the server has. */
    this.sentThumbs = new Set();
    this._loadSentThumbs();

    this._sending = false;
    this._queued = false;
    this._backoffMs = 1000;
  }

  _loadSentThumbs() {
    if (!this.sentThumbsPath) return;
    try {
      const raw = fs.readFileSync(this.sentThumbsPath, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.sentThumbs = new Set(arr);
    } catch {
      /* first run / missing file — fine */
    }
  }

  _persistSentThumbs() {
    if (!this.sentThumbsPath) return;
    try {
      fs.mkdirSync(path.dirname(this.sentThumbsPath), { recursive: true });
      fs.writeFileSync(this.sentThumbsPath, JSON.stringify([...this.sentThumbs]));
    } catch (e) {
      log.warn('could not persist sent-thumbs cache', String(e));
    }
  }

  /** Public entry: request a sync. Coalesces if one is already in flight. */
  requestSync() {
    if (this._sending) {
      this._queued = true;
      return;
    }
    this._run();
  }

  async _run() {
    this._sending = true;
    try {
      const { payload, thumbHashesIncluded } = this.library.buildCatalog((h) =>
        this.sentThumbs.has(h)
      );

      if (this.devMode) {
        log.warn(
          'DEV MODE (no catalogUrl/deviceToken) — would POST catalog:',
          '\n' + this._prettyForLog(payload)
        );
        this._lastDevPayload = payload;
        return;
      }

      await this._postWithBackoff(payload);

      // Success: record thumbs we just delivered.
      for (const h of thumbHashesIncluded) this.sentThumbs.add(h);
      this._persistSentThumbs();
      this._backoffMs = 1000;
      log.info(
        `catalog synced: ${payload.files.length} files, ${payload.folders.length} folders,` +
          ` ${thumbHashesIncluded.length} new thumbs`
      );
    } catch (e) {
      log.error('catalog sync failed (will retry on next change)', String(e));
    } finally {
      this._sending = false;
      if (this._queued) {
        this._queued = false;
        this.requestSync();
      }
    }
  }

  _prettyForLog(payload) {
    const clone = {
      files: payload.files.map((f) =>
        f.thumb_b64
          ? { ...f, thumb_b64: `<jpeg base64, ${f.thumb_b64.length} chars>` }
          : f
      ),
      folders: payload.folders,
    };
    return JSON.stringify(clone, null, 2);
  }

  async _postWithBackoff(payload, attempt = 0) {
    try {
      const res = await this._post(payload);
      // Merge any server-declared acknowledged hashes (forward compatible).
      if (res && res.body) {
        try {
          const j = JSON.parse(res.body);
          const acked = j.acknowledged || j.known_hashes || j.knownHashes;
          if (Array.isArray(acked)) for (const h of acked) this.sentThumbs.add(h);
        } catch {
          /* body need not be JSON */
        }
      }
      return res;
    } catch (e) {
      if (attempt >= 5) throw e;
      const wait = Math.min(this._backoffMs * 2 ** attempt, 60000);
      log.warn(`POST attempt ${attempt + 1} failed (${String(e)}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      return this._postWithBackoff(payload, attempt + 1);
    }
  }

  _post(payload) {
    return new Promise((resolve, reject) => {
      let u;
      try {
        u = new URL(this.catalogUrl);
      } catch (e) {
        reject(new Error(`bad catalogUrl: ${String(e)}`));
        return;
      }
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        u,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'x-device-token': this.deviceToken,
          },
          timeout: 30000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (d) => chunks.push(d));
          res.on('end', () => {
            const status = res.statusCode || 0;
            const text = Buffer.concat(chunks).toString('utf8');
            if (status >= 200 && status < 300) resolve({ status, body: text });
            else reject(new Error(`HTTP ${status}: ${text.slice(0, 300)}`));
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('request timeout')));
      req.write(body);
      req.end();
    });
  }
}

module.exports = { CatalogSync };

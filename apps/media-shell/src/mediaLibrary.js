'use strict';

/**
 * In-memory catalog of the media folder.
 *
 * Holds one entry per video file keyed by its fast hash, plus the first-level
 * subfolder structure (each subfolder = one auto-playlist, per the owner's
 * "folders become playlists" rule). Produces the exact catalog payload the
 * `media-catalog-sync` edge fn expects.
 *
 * Thumbnails are kept in memory as Buffers; the payload emits base64 only for
 * hashes not yet acknowledged by the server (see catalogSync's sent-thumbs
 * cache) to keep POSTs small.
 */

const fs = require('fs');
const path = require('path');
const { hashFile } = require('./hash');
const { probe } = require('./prober');
const { findSidecar } = require('./subtitles');
const {
  VIDEO_EXTENSIONS, CATALOG_CACHE_FILE, THUMB_CACHE_DIR, CATALOG_CACHE_VERSION, PROBE_CONCURRENCY,
} = require('./constants');
const log = require('./log');

/**
 * Tiny async semaphore (permit-handoff). Caps how many heavy per-file operations (hash + ffprobe +
 * ffmpeg thumbnail) run at once so the USB bus never saturates — the fix for the install-night
 * "catalog storm" that FALSELY timed-out big files into 'unsupported' (PR #61). Serve-before-scan
 * means the slower walk no longer affects boot latency.
 */
class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max | 0);
    this.count = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.count < this.max) {
      this.count += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve)); // permit handed over on release()
  }
  release() {
    const next = this.queue.shift();
    if (next) next(); // hand this permit straight to a waiter (count unchanged)
    else this.count -= 1;
  }
}

class MediaLibrary {
  /**
   * @param {string} mediaDir absolute path to the watched media root
   * @param {{ cacheDir?: string, concurrency?: number, probeFn?: Function, hashFn?: Function }} [opts]
   *   cacheDir = where to persist the catalog cache (Electron userData in prod; a temp dir in
   *   tests). null/omitted = no persistence. concurrency/probeFn/hashFn override the defaults
   *   (probeFn/hashFn are test seams so the concurrency cap + status logic are unit-testable
   *   without spawning ffprobe/ffmpeg).
   */
  constructor(mediaDir, opts = {}) {
    this.mediaDir = path.resolve(mediaDir);
    /** @type {Map<string, object>} absPath -> entry */
    this.byPath = new Map();
    /** @type {Map<string, object>} hash -> entry (last writer wins on dupes) */
    this.byHash = new Map();

    // Persisted catalog cache (v0.2 fast boot). Metadata JSON keyed by path+size+mtime; thumbs
    // one-jpeg-per-hash in a sibling dir so the JSON stays small. Absent cacheDir = no persistence.
    this.cacheDir = opts.cacheDir ? path.resolve(opts.cacheDir) : null;
    this.cachePath = this.cacheDir ? path.join(this.cacheDir, CATALOG_CACHE_FILE) : null;
    this.thumbCacheDir = this.cacheDir ? path.join(this.cacheDir, THUMB_CACHE_DIR) : null;

    // Heavy-work concurrency cap + injectable probe/hash (test seams).
    this._probeSem = new Semaphore(opts.concurrency ?? PROBE_CONCURRENCY);
    this._probe = opts.probeFn ?? probe;
    this._hash = opts.hashFn ?? hashFile;
  }

  static isVideo(p) {
    return VIDEO_EXTENSIONS.includes(path.extname(p).toLowerCase());
  }

  /** POSIX-style path relative to the media root (stable across OSes). */
  relFilename(absPath) {
    return path.relative(this.mediaDir, absPath).split(path.sep).join('/');
  }

  /** Serve-side lookup: returns the entry for a hash, or undefined. */
  getByHash(hash) {
    return this.byHash.get(hash);
  }

  fileCount() {
    return this.byPath.size;
  }

  /** Recursively list every video file under the media root. */
  async _walk(dir, acc) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      log.warn('walk failed', dir, String(e));
      return acc;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // skip dotfiles / .DS_Store
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await this._walk(abs, acc);
      } else if (ent.isFile() && MediaLibrary.isVideo(abs)) {
        acc.push(abs);
      }
    }
    return acc;
  }

  /** Hash + probe a single file into the library. Returns the entry. */
  async processFile(absPath) {
    const abs = path.resolve(absPath);
    let stat;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      // Gone between discovery and processing.
      this.removeFile(abs);
      return null;
    }

    // Sidecar subtitle presence is cheap (an existsSync) and can change without the video
    // changing (someone drops a .srt beside it), so re-detect it every time — even on a
    // cache-hit skip — to keep has_subtitles fresh without re-probing the whole video.
    const srtPath = findSidecar(abs);

    const prev = this.byPath.get(abs);
    // Skip the (expensive) hash + probe if size + mtime are unchanged — a warm-boot cache hit.
    // ⚠ NEVER cache-trust an 'unsupported' status (PR #61): an unsupported entry carries no useful
    // metadata and may be a FALSE flag from the install-night timeout storm, so always re-probe it
    // (cheap — only failures re-run). With the concurrency cap + timeout-retry the re-probe now
    // succeeds, which also self-heals the live 'unsupported' rows on the owner's first v0.2 boot.
    if (
      prev &&
      prev.size_bytes === stat.size &&
      prev._mtimeMs === stat.mtimeMs &&
      prev.status !== 'unsupported'
    ) {
      if (prev.srtPath !== srtPath) {
        prev.srtPath = srtPath;
        prev.has_subtitles = !!srtPath;
      }
      return prev;
    }

    // Gate the heavy work (hash + ffprobe + ffmpeg thumbnail) through the concurrency cap so a
    // watcher storm can't saturate the USB bus (the root cause of the false timeouts).
    await this._probeSem.acquire();
    let hash;
    let probed;
    try {
      hash = await this._hash(abs, stat.size);
      probed = await this._probe(abs);
    } finally {
      this._probeSem.release();
    }

    const entry = {
      filename: this.relFilename(abs),
      absPath: abs,
      hash,
      duration_seconds: probed.duration_seconds,
      width: probed.width,
      height: probed.height,
      size_bytes: stat.size,
      status: probed.status,
      codec: probed.codec,
      thumb: probed.thumb, // Buffer | null (kept in memory, not in payload directly)
      srtPath, // absolute path to the sidecar .srt, or null
      has_subtitles: !!srtPath,
      _mtimeMs: stat.mtimeMs,
    };

    // Persist the freshly-probed thumbnail to the thumb-cache so a warm boot has it without
    // re-probing (best-effort; a failure just means we re-probe that one file next cold walk).
    if (probed.thumb && probed.thumb.length > 0) this._writeThumbCache(hash, probed.thumb);

    // If a previous entry at this path had a different hash, drop its hash key.
    if (prev && prev.hash !== hash) this.byHash.delete(prev.hash);
    this.byPath.set(abs, entry);
    this.byHash.set(hash, entry);
    log.info('processed', entry.filename, `[${entry.status}]`, hash.slice(0, 10), srtPath ? '+srt' : '');
    return entry;
  }

  removeFile(absPath) {
    const abs = path.resolve(absPath);
    const prev = this.byPath.get(abs);
    if (!prev) return;
    this.byPath.delete(abs);
    // Only clear the hash key if it still points at this path (dupe safety).
    if (this.byHash.get(prev.hash) === prev) this.byHash.delete(prev.hash);
    log.info('removed', prev.filename);
  }

  /** Full rescan: process everything on disk, drop entries that vanished. */
  async scanAll() {
    const files = await this._walk(this.mediaDir, []);
    const seen = new Set(files.map((f) => path.resolve(f)));
    for (const abs of files) {
      // eslint-disable-next-line no-await-in-loop
      await this.processFile(abs);
    }
    for (const abs of [...this.byPath.keys()]) {
      if (!seen.has(abs)) this.removeFile(abs);
    }
    return this.fileCount();
  }

  /**
   * Build the catalog payload.
   * @param {(hash:string)=>boolean} thumbAlreadySent predicate — true means the
   *   server has acknowledged this hash's thumbnail, so we omit thumb_b64.
   * @returns {{payload: object, thumbHashesIncluded: string[]}}
   */
  buildCatalog(thumbAlreadySent = () => false) {
    const entries = [...this.byPath.values()].sort((a, b) =>
      a.filename.localeCompare(b.filename)
    );

    // WARN-3: dedupe files by content hash. Two identical files at different paths share a hash;
    // emitting both makes the edge fn's onConflict upsert hit "ON CONFLICT cannot affect row a
    // second time" and 500 the whole POST. `entries` is sorted by filename ascending, so the FIRST
    // occurrence per hash is the lexicographically-first path — keep it, drop the rest (logged).
    // Folder `hashes` arrays still list the hash from every path, which is correct: the file row
    // exists once, and both folders legitimately reference it.
    const thumbHashesIncluded = [];
    const seenHash = new Set();
    const files = [];
    for (const e of entries) {
      if (seenHash.has(e.hash)) {
        log.warn('duplicate content — dropping extra path from files', e.filename, e.hash.slice(0, 10));
        continue;
      }
      seenHash.add(e.hash);
      const file = {
        filename: e.filename,
        hash: e.hash,
        duration_seconds: e.duration_seconds,
        width: e.width,
        height: e.height,
        size_bytes: e.size_bytes,
        status: e.status,
        has_subtitles: !!e.has_subtitles,
      };
      if (e.thumb && e.thumb.length > 0 && !thumbAlreadySent(e.hash)) {
        file.thumb_b64 = e.thumb.toString('base64');
        thumbHashesIncluded.push(e.hash);
      }
      files.push(file);
    }

    // DECISION: only FIRST-level subfolders become playlists (owner: "playlists
    // are preconfigured by folder structure"). Nested deeper folders collapse
    // into their first-level ancestor's playlist; root-level loose files belong
    // to no playlist (still listed in `files`). Revisit if the owner wants
    // nested playlists.
    // First-level subfolders become playlists. Root-level loose files are not a
    // folder/playlist (they still appear in `files`).
    const folderMap = new Map(); // firstSegment -> ordered filenames
    for (const e of entries) {
      const parts = e.filename.split('/');
      if (parts.length < 2) continue; // loose root file
      const first = parts[0];
      if (!folderMap.has(first)) folderMap.set(first, []);
      folderMap.get(first).push(e);
    }

    const folders = [...folderMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, es]) => ({
        path: name,
        name,
        hashes: es
          .slice()
          .sort((a, b) => a.filename.localeCompare(b.filename))
          .map((e) => e.hash),
      }));

    return { payload: { files, folders }, thumbHashesIncluded };
  }

  // ── Persisted catalog cache (v0.2 fast boot) ───────────────────────────────────
  //
  // The point of the cache is that files are servable + the catalog is (mostly) known the
  // instant the process is alive, so a shell restart resumes playback instead of showing
  // MEDIA HOST OFFLINE while a full ffprobe walk runs. Design:
  //   • loadCacheMetadata() — sync, fast: populate byPath/byHash from one JSON file (thumbs
  //     null). This is enough for the media server to serve /media/{hash} immediately.
  //   • loadCacheThumbs()   — async, background: fill each entry.thumb from thumb-cache/{hash}.jpg
  //     so posters + un-acked thumb_b64 survive a restart without re-probing.
  //   • persistCache()      — write metadata (debounced by the caller after a scan settles).
  // processFile's existing size+mtime skip does the "re-probe only new/changed" work once the
  // cache is loaded into byPath. A corrupt/missing cache just yields an empty library → cold
  // walk repopulates it (self-heals).

  _thumbCachePath(hash) {
    return this.thumbCacheDir ? path.join(this.thumbCacheDir, `${hash}.jpg`) : null;
  }

  _writeThumbCache(hash, buf) {
    const p = this._thumbCachePath(hash);
    if (!p) return;
    try {
      fs.mkdirSync(this.thumbCacheDir, { recursive: true });
      fs.writeFileSync(p, buf);
    } catch (e) {
      log.warn('thumb-cache write failed', hash.slice(0, 10), String(e));
    }
  }

  /**
   * Load cached metadata into byPath/byHash SYNCHRONOUSLY (thumbs deferred). Fast — one JSON
   * read + parse. Safe to call before the media server binds so it can serve immediately on a
   * warm boot. Any error (missing/corrupt cache, moved mediaDir) leaves the library empty → the
   * background scan cold-walks and self-heals. Returns the number of entries loaded.
   */
  loadCacheMetadata() {
    if (!this.cachePath) return 0;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
    } catch {
      return 0; // first run / missing / corrupt — cold walk repopulates
    }
    if (!parsed || parsed.version !== CATALOG_CACHE_VERSION || !Array.isArray(parsed.entries)) {
      return 0;
    }
    let n = 0;
    for (const c of parsed.entries) {
      if (!c || typeof c.filename !== 'string' || typeof c.hash !== 'string') continue;
      const abs = path.resolve(this.mediaDir, c.filename.split('/').join(path.sep));
      const entry = {
        filename: c.filename,
        absPath: abs,
        hash: c.hash,
        duration_seconds: c.duration_seconds ?? null,
        width: c.width ?? null,
        height: c.height ?? null,
        size_bytes: c.size_bytes ?? null,
        status: c.status || 'present',
        codec: c.codec ?? null,
        thumb: null, // filled by loadCacheThumbs() in the background
        srtPath: c.subFilename ? path.resolve(this.mediaDir, c.subFilename.split('/').join(path.sep)) : null,
        has_subtitles: !!c.subFilename,
        _mtimeMs: c.mtimeMs ?? -1,
      };
      this.byPath.set(abs, entry);
      this.byHash.set(entry.hash, entry);
      n += 1;
    }
    log.info(`catalog cache: loaded ${n} entr${n === 1 ? 'y' : 'ies'} (metadata) — serving immediately`);
    return n;
  }

  /**
   * Fill in-memory entry thumbnails from the thumb-cache dir, in the background (mutates the
   * live entry objects in place so a concurrent processFile skip keeps the loaded thumb). Never
   * throws. Returns the count of thumbnails restored.
   */
  async loadCacheThumbs() {
    if (!this.thumbCacheDir) return 0;
    let restored = 0;
    for (const entry of this.byHash.values()) {
      if (entry.thumb) continue;
      const p = this._thumbCachePath(entry.hash);
      if (!p) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const buf = await fs.promises.readFile(p);
        if (buf && buf.length > 0) {
          entry.thumb = buf;
          restored += 1;
        }
      } catch {
        /* no cached thumb for this hash — regenerated on the next fresh probe */
      }
    }
    if (restored > 0) log.info(`catalog cache: restored ${restored} thumbnail(s) from disk`);
    return restored;
  }

  /**
   * Write the current library metadata to the cache file (atomic tmp+rename) and prune orphan
   * thumb-cache files whose hash is no longer in the library. Best-effort; never throws.
   */
  async persistCache() {
    if (!this.cachePath) return;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const entries = [...this.byPath.values()].map((e) => ({
        filename: e.filename,
        hash: e.hash,
        duration_seconds: e.duration_seconds,
        width: e.width,
        height: e.height,
        size_bytes: e.size_bytes,
        status: e.status,
        codec: e.codec,
        mtimeMs: e._mtimeMs,
        subFilename: e.srtPath ? this.relFilename(e.srtPath) : null,
      }));
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: CATALOG_CACHE_VERSION, entries }));
      fs.renameSync(tmp, this.cachePath);
    } catch (e) {
      log.warn('catalog cache persist failed', String(e));
      return;
    }
    // Prune orphan thumbs (library churn). Best-effort — a leftover jpeg is harmless.
    try {
      const live = new Set([...this.byHash.keys()].map((h) => `${h}.jpg`));
      for (const name of fs.readdirSync(this.thumbCacheDir)) {
        if (!live.has(name)) fs.rmSync(path.join(this.thumbCacheDir, name), { force: true });
      }
    } catch {
      /* thumb-cache dir may not exist yet — fine */
    }
  }
}

module.exports = { MediaLibrary };

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
const { VIDEO_EXTENSIONS } = require('./constants');
const log = require('./log');

class MediaLibrary {
  /** @param {string} mediaDir absolute path to the watched media root */
  constructor(mediaDir) {
    this.mediaDir = path.resolve(mediaDir);
    /** @type {Map<string, object>} absPath -> entry */
    this.byPath = new Map();
    /** @type {Map<string, object>} hash -> entry (last writer wins on dupes) */
    this.byHash = new Map();
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

    const prev = this.byPath.get(abs);
    // Skip re-work if size + mtime are unchanged.
    if (prev && prev.size_bytes === stat.size && prev._mtimeMs === stat.mtimeMs) {
      return prev;
    }

    const hash = await hashFile(abs, stat.size);
    const probed = await probe(abs);

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
      _mtimeMs: stat.mtimeMs,
    };

    // If a previous entry at this path had a different hash, drop its hash key.
    if (prev && prev.hash !== hash) this.byHash.delete(prev.hash);
    this.byPath.set(abs, entry);
    this.byHash.set(hash, entry);
    log.info('processed', entry.filename, `[${entry.status}]`, hash.slice(0, 10));
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

    const thumbHashesIncluded = [];
    const files = entries.map((e) => {
      const file = {
        filename: e.filename,
        hash: e.hash,
        duration_seconds: e.duration_seconds,
        width: e.width,
        height: e.height,
        size_bytes: e.size_bytes,
        status: e.status,
      };
      if (e.thumb && e.thumb.length > 0 && !thumbAlreadySent(e.hash)) {
        file.thumb_b64 = e.thumb.toString('base64');
        thumbHashesIncluded.push(e.hash);
      }
      return file;
    });

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
}

module.exports = { MediaLibrary };

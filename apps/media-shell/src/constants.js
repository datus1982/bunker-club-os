'use strict';

/**
 * BUNKER MEDIA SHELL — shared constants.
 *
 * This file is the SINGLE SOURCE OF TRUTH for the local media server's default
 * port. The web app (apps/web) resolves media files from the kiosk machine at
 *   http://127.0.0.1:{port}/media/{hash}
 * and must use the SAME default. The web-app side should mirror
 * DEFAULT_MEDIA_PORT (see README "Web-app contract").
 *
 * Port choice: 48151 — inside the IANA registered range, well below the OS
 * ephemeral range (macOS/Windows start ephemeral at 49152), uncommon enough to
 * avoid collisions with dev servers (3000/5173/8080/8000/4000).
 */

// DECISION: default port = 48151 (registered range, below the OS ephemeral
// floor of 49152, uncommon). This CJS constant is the single source of truth;
// the web app (Vite/TS) can't cleanly import a CJS module from a sibling app,
// so the web-app task must mirror this literal (documented in README "Web-app
// contract"). Flag if a shared package is preferred over mirroring.
const DEFAULT_MEDIA_PORT = 48151;

const DEFAULT_APP_URL = 'https://os.bunkerokc.com';

// Video containers we probe + serve. Browsers on the kiosk PC (Chromium) decode
// H.264 / VP9 / AV1 in these; unsupported codecs inside a supported container
// still get cataloged (status set by the prober).
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov'];

// Sidecar subtitle extension (Kodi convention: "Movie (1986).srt" beside the video).
// Served as WebVTT at /subs/{hash}; reported up as has_subtitles in the catalog.
const SUBTITLE_EXTENSION = '.srt';

// Persisted catalog cache (v0.2 fast boot): probe results keyed by path+size+mtime so a
// warm boot re-probes only new/changed files. Metadata lives in one JSON file; thumbnails
// live one-jpeg-per-hash under a sibling dir so the JSON stays small + fast to read/write.
const CATALOG_CACHE_FILE = 'catalog-cache.json';
const THUMB_CACHE_DIR = 'thumb-cache';
const CATALOG_CACHE_VERSION = 1;

// Media-server bind retry (v0.2 clean relaunch): if the port is momentarily held by a just-
// killed prior instance, retry the bind a few times before giving up (release/retry-bind).
const PORT_BIND_RETRIES = 12;
const PORT_BIND_RETRY_MS = 500;

// Probe/thumbnail concurrency cap (v0.2, PR #61 owner find). The install-night "catalog storm"
// probed+thumbnailed all 361 files at once over one USB bus → big files timed out and were
// FALSELY flagged 'unsupported'. Serve-before-scan means boot latency no longer matters, so we
// gate the heavy per-file work (hash + ffprobe + ffmpeg thumbnail) through a small worker pool so
// the bus never saturates. 3 keeps a little parallelism without contention.
const PROBE_CONCURRENCY = 3;

// ffprobe metadata read timeout. Header reads are only slow under bus contention (now capped), so
// a generous window lets a genuinely large file's first read finish rather than time out. On a
// TIMEOUT specifically the prober retries once before giving up (distinct from a real probe error).
const META_PROBE_TIMEOUT_MS = 120 * 1000;

// Thumbnail: JPEG, long edge <= 480px, encoded payload kept <= 200KB.
const THUMB_MAX_EDGE = 480;
const THUMB_MAX_BYTES = 200 * 1024;

// Fast-hash: sha1 over an 8-byte size header + first HASH_CHUNK bytes + last
// HASH_CHUNK bytes. Never reads the whole (multi-GB) file.
const HASH_CHUNK_BYTES = 1024 * 1024; // 1 MB

// Debounce window between a filesystem change settling and a catalog POST.
const CATALOG_DEBOUNCE_MS = 10 * 1000;

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

module.exports = {
  DEFAULT_MEDIA_PORT,
  DEFAULT_APP_URL,
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSION,
  CATALOG_CACHE_FILE,
  THUMB_CACHE_DIR,
  CATALOG_CACHE_VERSION,
  PORT_BIND_RETRIES,
  PORT_BIND_RETRY_MS,
  PROBE_CONCURRENCY,
  META_PROBE_TIMEOUT_MS,
  THUMB_MAX_EDGE,
  THUMB_MAX_BYTES,
  HASH_CHUNK_BYTES,
  CATALOG_DEBOUNCE_MS,
  CONTENT_TYPES,
};

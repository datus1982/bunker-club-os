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
  THUMB_MAX_EDGE,
  THUMB_MAX_BYTES,
  HASH_CHUNK_BYTES,
  CATALOG_DEBOUNCE_MS,
  CONTENT_TYPES,
};

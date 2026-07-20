'use strict';

/**
 * Filesystem watcher over the media root (chokidar).
 *
 * On add/change we hash+probe the single file; on unlink we drop it. Any change
 * schedules a debounced onChange callback (the catalog POST driver debounces
 * further to CATALOG_DEBOUNCE_MS). chokidar's awaitWriteFinish keeps us from
 * hashing a movie that is still being copied onto the array-synced folder.
 *
 * chokidar is required lazily inside start() so the rest of the shell (scan,
 * server, catalog) can run in environments where chokidar isn't installed.
 */

const fs = require('fs');
const path = require('path');
const { MediaLibrary } = require('./mediaLibrary');
const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSION } = require('./constants');
const log = require('./log');

/**
 * When a sidecar `.srt` is added/removed, re-process the sibling video(s) so has_subtitles
 * updates without waiting for the next full scan. Returns the sibling video abs paths that
 * exist on disk (an exact-basename match, plus any language-tagged `base.<lang>.srt`).
 */
function siblingVideosFor(srtAbsPath) {
  const dir = path.dirname(srtAbsPath);
  // Strip ".srt", then also strip a possible ".<lang>" tag to recover the video basename.
  let base = path.basename(srtAbsPath, SUBTITLE_EXTENSION);
  const langStripped = base.replace(/\.[^.]+$/, '');
  const bases = new Set([base, langStripped]);
  const out = [];
  for (const b of bases) {
    for (const ext of VIDEO_EXTENSIONS) {
      const vid = path.join(dir, b + ext);
      try {
        if (fs.existsSync(vid)) out.push(vid);
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/**
 * @param {MediaLibrary} library
 * @param {{ onChange: () => void, settleMs?: number }} opts
 */
function startWatcher(library, opts) {
  const { onChange, settleMs = 1500 } = opts;
  // eslint-disable-next-line global-require
  const chokidar = require('chokidar');

  const watcher = chokidar.watch(library.mediaDir, {
    ignoreInitial: false,
    persistent: true,
    ignored: /(^|[/\\])\../, // dotfiles
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 300 },
    depth: 20,
  });

  let settleTimer = null;
  const fire = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      try {
        onChange();
      } catch (e) {
        log.error('onChange threw', String(e));
      }
    }, settleMs);
  };

  const isSubtitle = (p) => path.extname(p).toLowerCase() === SUBTITLE_EXTENSION;

  const handle = async (event, filePath) => {
    // A sidecar .srt landing/leaving flips has_subtitles on its sibling video — re-process it
    // (processFile re-detects the sidecar; an unlink triggers a re-process too, dropping the flag).
    if (isSubtitle(filePath)) {
      try {
        for (const vid of siblingVideosFor(filePath)) {
          // eslint-disable-next-line no-await-in-loop
          if (library.byPath.has(path.resolve(vid))) await library.processFile(vid);
        }
        fire();
      } catch (e) {
        log.error('subtitle watch handler failed', event, filePath, String(e));
      }
      return;
    }
    if (!MediaLibrary.isVideo(filePath)) return;
    try {
      if (event === 'unlink') library.removeFile(filePath);
      else await library.processFile(filePath);
      fire();
    } catch (e) {
      log.error('watch handler failed', event, filePath, String(e));
    }
  };

  watcher
    .on('add', (p) => handle('add', p))
    .on('change', (p) => handle('change', p))
    .on('unlink', (p) => handle('unlink', p))
    .on('ready', () => log.info('watcher ready; initial scan complete'))
    .on('error', (e) => log.error('watcher error', String(e)));

  return {
    close: () => watcher.close(),
  };
}

module.exports = { startWatcher };

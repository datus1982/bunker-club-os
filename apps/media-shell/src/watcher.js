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

const { MediaLibrary } = require('./mediaLibrary');
const log = require('./log');

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

  const handle = async (event, filePath) => {
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

'use strict';

/**
 * BUNKER MEDIA SHELL — Electron entry point.
 *
 * Thin kiosk shell for the bar's mini Windows PC. It:
 *   1. loads + validates config.json (loud error window on failure),
 *   2. loads the PERSISTED CATALOG CACHE (v0.2) so files are servable immediately,
 *   3. runs the local media server (127.0.0.1:{port}) + folder watcher +
 *      catalog sync in the main process,
 *   4. opens the fullscreen kiosk window at {appUrl}/signage/s/{slug},
 *   5. relaunches itself cleanly on any uncaught main-process error (watchdog).
 *
 * v0.2 fast boot: the media server + kiosk come up BEFORE any ffprobe walk. On a warm boot the
 * catalog cache is loaded first (metadata sync, thumbs in the background), so /media/{hash} answers
 * the instant the process is alive and playback resumes instead of showing MEDIA HOST OFFLINE while
 * a full scan runs. A single-instance lock + retry-bind on the port keep an Alt+F4 + watchdog
 * relaunch from racing the old instance into a stranded port.
 *
 * All real UI lives in the web app — this process shows nothing but the kiosk (or the error screen).
 */

// Unlock autoplay/audio BEFORE app is ready (must precede window creation).
const { app, Menu } = require('electron');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const path = require('path');
const log = require('./log');
const { loadConfig, ConfigError } = require('./config');
const { MediaLibrary } = require('./mediaLibrary');
const { createMediaServer } = require('./mediaServer');
const { startWatcher } = require('./watcher');
const { CatalogSync } = require('./catalogSync');
const { createKioskWindow } = require('./kioskWindow');
const { showErrorWindow } = require('./errorWindow');
const { CATALOG_DEBOUNCE_MS } = require('./constants');

const pkg = require('../package.json');

let started = false; // becomes true once the kiosk is up (gates crash-relaunch)
let serverHandle = null;
let watcherHandle = null;
let library = null;
let kioskWindow = null;

// Single instance — a second launch focuses the existing window and exits. Guard EVERYTHING
// behind the lock so a losing second process never boots a second server (which would strand
// the port and confuse the relaunch dance).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  log.warn('another instance already holds the lock — exiting this one');
  app.quit();
} else {
  app.on('second-instance', () => {
    log.warn('second instance launched — focusing existing kiosk');
    if (kioskWindow && !kioskWindow.isDestroyed()) {
      if (kioskWindow.isMinimized()) kioskWindow.restore();
      kioskWindow.focus();
    }
  });

  app.whenReady().then(boot);
  app.on('window-all-closed', onWindowAllClosed);
}

async function boot() {
  Menu.setApplicationMenu(null);

  // Auto-launch on Windows login (packaged only — never touch login items in dev). The NSIS
  // shortcut alone doesn't relaunch after a power blip; this does. Toggle by editing this call
  // or removing the login item in Task Mgr.
  if (app.isPackaged && process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  let cfg;
  try {
    cfg = loadConfig({
      appDir: app.getAppPath(),
      userDataDir: app.getPath('userData'),
    });
  } catch (e) {
    const msg = e instanceof ConfigError ? e.message : String(e);
    log.error('config error', msg);
    showErrorWindow(msg);
    return; // stay on the error screen; do not relaunch-loop
  }

  log.setLogDir(path.join(app.getPath('userData'), 'logs'));
  log.info(`BUNKER MEDIA SHELL v${pkg.version}`);
  log.info(`slug=${cfg.slug} mediaDir=${cfg.mediaDir} port=${cfg.port} devMode=${cfg.devMode}`);

  const userData = app.getPath('userData');
  library = new MediaLibrary(cfg.mediaDir, { cacheDir: userData });

  // WARM BOOT: load cached metadata SYNCHRONOUSLY so the media server can serve /media/{hash}
  // the instant it binds — playback resumes without waiting on the ffprobe walk.
  library.loadCacheMetadata();

  const sync = new CatalogSync(library, {
    catalogUrl: cfg.catalogUrl,
    deviceToken: cfg.deviceToken,
    sentThumbsPath: path.join(userData, 'sent-thumbs.json'),
  });

  // Debounce catalog POSTs (and a cache persist) after filesystem churn settles.
  let syncTimer = null;
  const scheduleSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync.requestSync();
      library.persistCache().catch(() => {});
    }, CATALOG_DEBOUNCE_MS);
  };

  // Media server first so the kiosk can fetch immediately (retry-binds if the port is briefly held).
  try {
    serverHandle = createMediaServer(library, {
      port: cfg.port,
      appOrigin: cfg.appOrigin,
      version: pkg.version,
    });
    await serverHandle.listen(cfg.port);
  } catch (e) {
    const msg = `Local media server failed to bind port ${cfg.port}:\n${String(e)}`;
    log.error(msg);
    showErrorWindow(msg);
    return;
  }

  // Kiosk window up right away — an empty library still shows the signage board, and with the
  // cache loaded the previously-playing clip is already servable.
  kioskWindow = createKioskWindow({ kioskUrl: cfg.kioskUrl, appOrigin: cfg.appOrigin });
  kioskWindow.on('closed', () => { kioskWindow = null; });
  started = true;

  // Restore cached thumbnails in the background (posters + un-acked thumb_b64) — never blocks boot.
  library.loadCacheThumbs().catch(() => {});

  // Watcher drives incremental updates + debounced syncs. Its initial scan (ignoreInitial:false)
  // re-probes ONLY new/changed files (processFile's size+mtime skip over the loaded cache) and
  // fires the first sync when it settles.
  try {
    watcherHandle = startWatcher(library, { onChange: scheduleSync });
  } catch (e) {
    // Without chokidar we degrade to a one-time scan + periodic rescans.
    log.warn('watcher unavailable, falling back to periodic scan', String(e));
    await library.scanAll();
    sync.requestSync();
    library.persistCache().catch(() => {});
    setInterval(async () => {
      await library.scanAll();
      sync.requestSync();
      library.persistCache().catch(() => {});
    }, 5 * 60 * 1000);
  }

  // Also POST once shortly after boot in case the watcher is slow to settle.
  setTimeout(() => sync.requestSync(), 15000);
}

// ---- Clean shutdown / relaunch -----------------------------------------------
// Close the watcher + server (releasing the port) BEFORE the process exits, so a relaunch's fresh
// instance can bind cleanly. Combined with the server's retry-bind, this ends the Alt+F4 +
// watchdog race that used to strand port 48151.
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5000;

async function shutdown({ relaunch }) {
  if (shuttingDown) return; // never run the exit dance twice (e.g. window-all-closed + a fatal)
  shuttingDown = true;

  // WARN-1: on the watchdog path the kiosk window is still open mid-stream, so a bare
  // server.close() can block forever on the kiosk's keep-alive/video sockets — mediaServer.close()
  // now force-destroys in-flight connections, and we ALSO race the whole teardown against a hard
  // timeout so app.relaunch()/exit ALWAYS run promptly (belt + suspenders on the self-heal path).
  const teardown = (async () => {
    // NOTE-4: persist the cache first so churn since the last watcher debounce isn't re-probed
    // on the next boot (best-effort; must not block the exit).
    try {
      if (library) await library.persistCache();
    } catch {
      /* ignore */
    }
    try {
      if (watcherHandle) await watcherHandle.close();
    } catch {
      /* ignore */
    }
    try {
      if (serverHandle) await serverHandle.close();
    } catch {
      /* ignore */
    }
  })();

  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS));
  await Promise.race([teardown, timeout]);

  if (relaunch) app.relaunch();
  app.exit(0);
}

async function onWindowAllClosed() {
  // The kiosk should stay alive; if all windows close (Alt+F4), relaunch — but only after a clean
  // close so the relaunched instance doesn't fight the old one for the port. If we never got past
  // the error screen, just exit (no relaunch loop).
  if (started) {
    log.warn('all windows closed after start -> clean relaunch');
    await shutdown({ relaunch: true });
  } else {
    app.exit(0);
  }
}

// ---- Main-process watchdog ---------------------------------------------------
function relaunchOnFatal(kind, err) {
  log.error(`fatal ${kind}`, err && err.stack ? err.stack : String(err));
  if (!started) {
    // Failure before the kiosk came up — don't spin a relaunch loop.
    return;
  }
  // Fire-and-forget the graceful shutdown+relaunch (releases the port first).
  shutdown({ relaunch: true }).catch(() => app.exit(1));
}

process.on('uncaughtException', (e) => relaunchOnFatal('uncaughtException', e));
process.on('unhandledRejection', (e) => relaunchOnFatal('unhandledRejection', e));

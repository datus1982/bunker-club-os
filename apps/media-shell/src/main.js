'use strict';

/**
 * BUNKER MEDIA SHELL — Electron entry point.
 *
 * Thin kiosk shell for the bar's mini Windows PC. It:
 *   1. loads + validates config.json (loud error window on failure),
 *   2. runs the local media server (127.0.0.1:{port}) + folder watcher +
 *      catalog sync in the main process,
 *   3. opens the fullscreen kiosk window at {appUrl}/signage/s/{slug},
 *   4. relaunches itself on any uncaught main-process error (watchdog).
 *
 * All real UI lives in the web app — this process shows nothing but the kiosk
 * (or the error screen).
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

// Single instance — a second launch just focuses/relaunches the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

async function boot() {
  Menu.setApplicationMenu(null);

  // Auto-launch on Windows login (packaged only — never touch login items in
  // dev). The NSIS shortcut alone doesn't relaunch after a power blip; this
  // does. Toggle by editing this call or removing the login item in Task Mgr.
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

  const library = new MediaLibrary(cfg.mediaDir);

  const sync = new CatalogSync(library, {
    catalogUrl: cfg.catalogUrl,
    deviceToken: cfg.deviceToken,
    sentThumbsPath: path.join(app.getPath('userData'), 'sent-thumbs.json'),
  });

  // Debounce catalog POSTs after filesystem churn settles.
  let syncTimer = null;
  const scheduleSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync.requestSync();
    }, CATALOG_DEBOUNCE_MS);
  };

  // Media server first so the kiosk can fetch immediately.
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

  // Kiosk window up right away — an empty library still shows the signage board.
  createKioskWindow({ kioskUrl: cfg.kioskUrl, appOrigin: cfg.appOrigin });
  started = true;

  // Watcher drives incremental updates + debounced syncs. Its initial scan
  // (ignoreInitial:false) populates the library and fires the first sync.
  try {
    watcherHandle = startWatcher(library, { onChange: scheduleSync });
  } catch (e) {
    // Without chokidar we degrade to a one-time scan + periodic rescans.
    log.warn('watcher unavailable, falling back to periodic scan', String(e));
    await library.scanAll();
    sync.requestSync();
    setInterval(async () => {
      await library.scanAll();
      sync.requestSync();
    }, 5 * 60 * 1000);
  }

  // Also POST once shortly after boot in case the watcher is slow to settle.
  setTimeout(() => sync.requestSync(), 15000);
}

app.whenReady().then(boot);

app.on('second-instance', () => {
  log.warn('second instance launched');
});

app.on('window-all-closed', () => {
  // Kiosk should stay alive; if all windows close, relaunch (unless we never
  // got past the error screen).
  if (started) {
    log.warn('all windows closed after start -> relaunching');
    app.relaunch();
  }
  app.exit(0);
});

// ---- Main-process watchdog ---------------------------------------------------
function relaunchOnFatal(kind, err) {
  log.error(`fatal ${kind}`, err && err.stack ? err.stack : String(err));
  if (!started) {
    // Failure before the kiosk came up — don't spin a relaunch loop.
    return;
  }
  try {
    if (watcherHandle) watcherHandle.close();
    if (serverHandle) serverHandle.close();
  } catch {
    /* ignore */
  }
  app.relaunch();
  app.exit(1);
}

process.on('uncaughtException', (e) => relaunchOnFatal('uncaughtException', e));
process.on('unhandledRejection', (e) => relaunchOnFatal('unhandledRejection', e));

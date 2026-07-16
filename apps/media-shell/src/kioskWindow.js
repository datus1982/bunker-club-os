'use strict';

/**
 * The kiosk BrowserWindow: fullscreen, frameless, pointed at
 *   {appUrl}/signage/s/{slug}
 *
 * - Autoplay is unlocked process-wide in main.js (autoplay-policy switch) so
 *   video + audio start with no user gesture (audio is always on from this PC;
 *   staff gate it at the QSYS/Sonos source — no in-app toggle).
 * - The session's permission handlers auto-GRANT only 'media' (camera/mic, for
 *   the UVC/Roku capture passthrough via getUserMedia) and ONLY when the request
 *   comes from the app origin. Everything else is denied.
 * - Renderer crash / hang -> reload (watchdog for the render side; main-process
 *   watchdog lives in main.js).
 * - Cursor is hidden after a few seconds idle.
 */

const { BrowserWindow, session } = require('electron');
const log = require('./log');

const CURSOR_HIDE_JS = `
(function(){
  var t;
  var style = document.createElement('style');
  style.textContent = '.__bms_nocursor, .__bms_nocursor * { cursor: none !important; }';
  document.documentElement.appendChild(style);
  function show(){ document.documentElement.classList.remove('__bms_nocursor');
    clearTimeout(t); t = setTimeout(hide, 4000); }
  function hide(){ document.documentElement.classList.add('__bms_nocursor'); }
  ['mousemove','mousedown','touchstart','keydown'].forEach(function(e){
    window.addEventListener(e, show, {passive:true}); });
  hide();
})();`;

/**
 * @param {{ kioskUrl:string, appOrigin:string }} cfg
 */
function createKioskWindow(cfg) {
  // Auto-grant ONLY media (camera/mic) requests originating from the app.
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingOrigin = originOf(details && details.requestingUrl) || originOf(webContents.getURL());
    const allow = permission === 'media' && requestingOrigin === cfg.appOrigin;
    if (!allow) log.warn('permission denied', permission, requestingOrigin);
    callback(allow);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === 'media' && requestingOrigin === cfg.appOrigin;
  });

  const win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    kiosk: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep video playing when unfocused
    },
  });

  win.setMenuBarVisibility(false);

  const wc = win.webContents;

  wc.on('did-finish-load', () => {
    wc.executeJavaScript(CURSOR_HIDE_JS).catch(() => {});
  });

  // Renderer-side watchdog.
  wc.on('render-process-gone', (_e, details) => {
    log.error('renderer gone', JSON.stringify(details), '-> reloading in 2s');
    setTimeout(() => safeReload(win, cfg.kioskUrl), 2000);
  });
  wc.on('unresponsive', () => {
    log.error('renderer unresponsive -> reloading');
    safeReload(win, cfg.kioskUrl);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    log.error('load failed', code, desc, url, '-> retry in 5s');
    setTimeout(() => safeReload(win, cfg.kioskUrl), 5000);
  });

  log.info('loading kiosk', cfg.kioskUrl);
  win.loadURL(cfg.kioskUrl);
  return win;
}

function safeReload(win, url) {
  if (win.isDestroyed()) return;
  try {
    win.webContents.reloadIgnoringCache();
  } catch {
    try {
      win.loadURL(url);
    } catch {
      /* give up until next tick */
    }
  }
}

function originOf(u) {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

module.exports = { createKioskWindow };

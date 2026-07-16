'use strict';

/**
 * Loud, readable full-screen error window. Shown when config is missing/invalid
 * (or the shell can't start) instead of a silent black kiosk screen — a manager
 * standing at the bar can read exactly what's wrong.
 */

const { BrowserWindow } = require('electron');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showErrorWindow(message) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#140b06;color:#ffb454;
      font-family:"Courier New",monospace;}
    .wrap{box-sizing:border-box;min-height:100%;padding:6vmin;display:flex;
      flex-direction:column;justify-content:center;}
    h1{color:#ff5f56;font-size:5vmin;letter-spacing:.1em;margin:0 0 3vmin;}
    pre{white-space:pre-wrap;font-size:2.6vmin;line-height:1.5;
      border-left:4px solid #ff5f56;padding-left:3vmin;}
    .foot{margin-top:5vmin;font-size:2.2vmin;color:#a9782f;}
  </style></head><body><div class="wrap">
    <h1>BUNKER MEDIA SHELL — CANNOT START</h1>
    <pre>${escapeHtml(message)}</pre>
    <div class="foot">Fix config.json on this PC, then relaunch the app.</div>
  </div></body></html>`;

  const win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#140b06',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return win;
}

module.exports = { showErrorWindow };

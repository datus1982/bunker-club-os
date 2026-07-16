'use strict';

/**
 * Tiny timestamped logger. Writes to the console always, and (when a log dir is
 * configured via setLogDir) appends to a rolling daily file so the mini PC keeps
 * a record even with no terminal attached.
 */

const fs = require('fs');
const path = require('path');

let logDir = null;

function setLogDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logDir = dir;
  } catch {
    logDir = null;
  }
}

function stamp() {
  return new Date().toISOString();
}

function write(level, args) {
  const line = `[${stamp()}] [${level}] ${args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (logDir) {
    try {
      const file = path.join(logDir, `media-shell-${stamp().slice(0, 10)}.log`);
      fs.appendFileSync(file, line + '\n');
    } catch {
      /* never let logging crash the app */
    }
  }
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

module.exports = {
  setLogDir,
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};

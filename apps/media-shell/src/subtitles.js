'use strict';

/**
 * Sidecar subtitle handling (media-shell v0.2).
 *
 * The owner's Kodi-style library carries `.srt` sidecar files next to many videos
 * ("Labyrinth (1986).mp4" -> "Labyrinth (1986).srt"). The shell:
 *   1. detects a sidecar for a video (findSidecar),
 *   2. serves it as WebVTT at /subs/{hash} (readSubtitleAsVtt),
 *   3. reports has_subtitles up in the catalog payload.
 *
 * SRT -> VTT is a mechanical transform: a "WEBVTT\n\n" header plus comma->dot in the
 * millisecond field of every cue timestamp (`00:00:01,000 --> 00:00:04,000` becomes
 * `00:00:01.000 --> 00:00:04.000`). Everything else (cue text, indices, blank lines) is
 * valid enough for the browser's native track parser. We are tolerant about encoding:
 * a UTF-8 BOM is stripped, and a file that doesn't decode as clean UTF-8 falls back to
 * latin1 (a common encoding for older subtitle rips).
 */

const fs = require('fs');
const path = require('path');
const { SUBTITLE_EXTENSION } = require('./constants');

/** Escape a string for safe use inside a RegExp (a basename may contain regex metachars). */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate a sidecar subtitle for a video file. Preference:
 *   1. exact `{base}.srt` next to the video (the common Kodi case),
 *   2. a language-tagged `{base}.<lang>.srt` (e.g. `Movie.en.srt`) — first match wins.
 * Returns the absolute path, or null when none exists.
 * @param {string} videoAbsPath
 * @returns {string|null}
 */
function findSidecar(videoAbsPath) {
  const dir = path.dirname(videoAbsPath);
  const ext = path.extname(videoAbsPath);
  const base = path.basename(videoAbsPath, ext);

  const exact = path.join(dir, base + SUBTITLE_EXTENSION);
  try {
    if (fs.existsSync(exact)) return exact;
  } catch {
    /* ignore */
  }

  // Language-tagged sidecar: `{base}.<something>.srt`. Only readdir on the exact miss.
  try {
    const re = new RegExp(`^${escapeRegex(base)}\\.[^.]+${escapeRegex(SUBTITLE_EXTENSION)}$`, 'i');
    const names = fs.readdirSync(dir);
    const m = names.find((n) => re.test(n));
    if (m) return path.join(dir, m);
  } catch {
    /* directory unreadable — no sidecar */
  }
  return null;
}

/**
 * Convert SRT text to WebVTT. Strips a UTF-8 BOM, normalizes newlines, and rewrites the
 * comma decimal separator in cue timestamps to a dot. Only the millisecond comma inside an
 * `HH:MM:SS,mmm` timestamp is touched — commas in cue text are left alone.
 * @param {string} srtText
 * @returns {string}
 */
function srtToVtt(srtText) {
  let s = srtText;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // stray BOM after a non-BOM decode
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${s}`;
}

/**
 * Read a sidecar `.srt` (tolerating BOM + odd encodings) and return WebVTT text.
 * @param {string} absPath
 * @returns {string}
 */
function readSubtitleAsVtt(absPath) {
  const buf = fs.readFileSync(absPath);
  let text;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    text = buf.slice(3).toString('utf8'); // explicit UTF-8 BOM
  } else {
    const utf8 = buf.toString('utf8');
    // A U+FFFD replacement char means the bytes weren't valid UTF-8; fall back to latin1.
    text = utf8.includes('�') ? buf.toString('latin1') : utf8;
  }
  return srtToVtt(text);
}

module.exports = { findSidecar, srtToVtt, readSubtitleAsVtt };

'use strict';

/**
 * Probe a video file for duration / dimensions and grab a thumbnail frame.
 *
 * - Metadata via ffprobe (JSON).
 * - Thumbnail via ffmpeg: one frame ~10% into the runtime, scaled so the long
 *   edge is <= THUMB_MAX_EDGE, JPEG, re-encoded down until the payload is
 *   <= THUMB_MAX_BYTES.
 *
 * ⚠ TIMEOUT ≠ UNSUPPORTED (v0.2, PR #61). A ffprobe TIMEOUT is treated distinctly from a genuine
 * probe error (corrupt / no video stream / a codec ffprobe can't read). Under the install-night
 * "catalog storm" (361 files probed at once over one USB bus) big files' header reads timed out and
 * were FALSELY flagged 'unsupported'. Now: the metadata probe uses a generous timeout
 * (META_PROBE_TIMEOUT_MS) and, on a TIMEOUT specifically, RETRIES ONCE before giving up — by which
 * point the caller's concurrency cap has drained most of the contention. A genuine error flags
 * 'unsupported' immediately (no retry). Only a file that fails for real, or times out even after the
 * retry, ends up 'unsupported'.
 *
 * The catalog `status` values the shell emits are 'present' | 'unsupported', matching the
 * media_files.status CHECK constraint (migration 0047; 'missing' is server-derived). A probe that
 * yields metadata but no thumbnail still counts as 'present' (thumb_b64 simply absent).
 */

const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath } = require('./fftools');
const { THUMB_MAX_EDGE, THUMB_MAX_BYTES, META_PROBE_TIMEOUT_MS } = require('./constants');

/** Spawn a binary, capture stdout. Rejects on non-zero exit or timeout; a TIMEOUT error carries
 *  `.timedOut = true` so the caller can distinguish it from a genuine failure. */
function run(bin, args, { capture = 'utf8', timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const out = [];
    const err = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      const e = new Error(`${bin} timed out after ${timeoutMs}ms`);
      e.timedOut = true;
      reject(e);
    }, timeoutMs);

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${bin} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(-500)}`));
        return;
      }
      resolve(capture === 'buffer' ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'));
    });
  });
}

/** Parse the ffprobe JSON into our metadata shape. Throws (a non-timeout error) when there is no
 *  decodable video stream — a GENUINE unsupported. */
function parseMeta(json) {
  const parsed = JSON.parse(json);
  const stream = (parsed.streams && parsed.streams[0]) || {};
  const format = parsed.format || {};
  const width = Number(stream.width) || null;
  const height = Number(stream.height) || null;
  const duration = format.duration != null ? Math.round(Number(format.duration)) : null;
  if (!width || !height) {
    throw new Error('no video stream / dimensions');
  }
  return {
    width,
    height,
    duration_seconds: Number.isFinite(duration) ? duration : null,
    codec: stream.codec_name || null,
  };
}

const metaArgs = (absPath) => [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,codec_name:format=duration',
  '-of', 'json',
  absPath,
];

/**
 * Read metadata via ffprobe, RETRYING ONCE on a timeout (not on a genuine error). `runner(args,
 * timeoutMs)` resolves the raw ffprobe JSON string — injectable so the retry/timeout classification
 * is unit-testable without spawning ffprobe. Throws after `retries` timeouts, or immediately on a
 * genuine error (no video stream / spawn failure) — the caller maps a throw to 'unsupported'.
 *
 * @param {string} absPath
 * @param {{ timeoutMs?:number, retries?:number, runner?:(args:string[],timeoutMs:number)=>Promise<string> }} [opts]
 */
async function probeMeta(absPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? META_PROBE_TIMEOUT_MS;
  const retries = opts.retries ?? 1; // one retry on timeout
  const runner = opts.runner ?? ((args, to) => run(ffprobePath, args, { timeoutMs: to }));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return parseMeta(await runner(metaArgs(absPath), timeoutMs));
    } catch (e) {
      if (e && e.timedOut && attempt < retries) {
        // Timed out — retry once; by now the concurrency cap has drained most bus contention.
        continue;
      }
      throw e; // genuine error, or a timeout that survived the retry -> caller flags unsupported
    }
  }
}

async function grabThumb(absPath, durationSeconds) {
  const seek = durationSeconds && durationSeconds > 0 ? Math.max(0.1, durationSeconds * 0.1) : 1;
  // Try decreasing quality (higher -q:v number = smaller/worse) until under cap.
  for (const q of [4, 6, 9, 14, 20]) {
    const buf = await run(
      ffmpegPath,
      [
        '-ss', String(seek),
        '-i', absPath,
        '-frames:v', '1',
        '-vf', `scale=w=${THUMB_MAX_EDGE}:h=${THUMB_MAX_EDGE}:force_original_aspect_ratio=decrease`,
        '-q:v', String(q),
        '-f', 'mjpeg',
        'pipe:1',
      ],
      { capture: 'buffer' }
    );
    if (buf && buf.length > 0 && buf.length <= THUMB_MAX_BYTES) return buf;
    if (buf && buf.length > 0 && q === 20) {
      // Still too big at lowest quality — return null rather than a bloated blob.
      return null;
    }
  }
  return null;
}

/**
 * @returns {Promise<{status:'present'|'unsupported', duration_seconds:number|null,
 *   width:number|null, height:number|null, codec:string|null, thumb:Buffer|null}>}
 */
async function probe(absPath) {
  try {
    const meta = await probeMeta(absPath);
    let thumb = null;
    try {
      thumb = await grabThumb(absPath, meta.duration_seconds);
    } catch {
      thumb = null; // metadata is good even if the thumbnail frame failed
    }
    return { status: 'present', ...meta, thumb };
  } catch {
    // Genuine unsupported (corrupt / no video stream) OR a timeout that survived the retry.
    return {
      status: 'unsupported',
      duration_seconds: null,
      width: null,
      height: null,
      codec: null,
      thumb: null,
    };
  }
}

module.exports = { probe, probeMeta };

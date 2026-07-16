'use strict';

/**
 * Probe a video file for duration / dimensions and grab a thumbnail frame.
 *
 * - Metadata via ffprobe (JSON).
 * - Thumbnail via ffmpeg: one frame ~10% into the runtime, scaled so the long
 *   edge is <= THUMB_MAX_EDGE, JPEG, re-encoded down until the payload is
 *   <= THUMB_MAX_BYTES.
 *
 * Anything that fails to probe (corrupt, DRM, no video stream, codec ffprobe
 * can't read) is returned with status 'unsupported' and no thumbnail — the
 * catalog still lists it so staff can see it exists.
 *
 * The catalog `status` values the shell emits are 'present' | 'unsupported',
 * matching the media_files.status CHECK constraint (migration 0047; 'missing'
 * is server-derived when a hash vanishes from the catalog — the shell never
 * sends it). A probe that yields metadata but no thumbnail still counts as
 * 'present' (thumb_b64 simply absent) — the frame grab is best-effort.
 */

const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath } = require('./fftools');
const { THUMB_MAX_EDGE, THUMB_MAX_BYTES } = require('./constants');

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
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
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

async function probeMeta(absPath) {
  const json = await run(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name:format=duration',
    '-of', 'json',
    absPath,
  ]);
  const parsed = JSON.parse(json);
  const stream = (parsed.streams && parsed.streams[0]) || {};
  const format = parsed.format || {};
  const width = Number(stream.width) || null;
  const height = Number(stream.height) || null;
  const duration = format.duration != null ? Math.round(Number(format.duration)) : null;
  if (!width || !height) {
    // No decodable video stream.
    throw new Error('no video stream / dimensions');
  }
  return {
    width,
    height,
    duration_seconds: Number.isFinite(duration) ? duration : null,
    codec: stream.codec_name || null,
  };
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

module.exports = { probe };

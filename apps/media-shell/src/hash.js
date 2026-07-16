'use strict';

/**
 * Fast, stable content hash for large media files.
 *
 * STRATEGY (documented — do not "improve" into a full-file sha without reason):
 *   We must not read whole multi-gigabyte movies just to identify them. Instead
 *   the hash is sha1 over a small composite buffer:
 *       [ 8-byte big-endian file size ] + [ first 1 MB ] + [ last 1 MB ]
 *   The leading size makes two same-prefix/same-suffix files of different
 *   lengths hash differently. For files <= 2 * 1 MB the head and tail overlap,
 *   so we simply hash the size header + the entire file (still cheap).
 *
 * This is a *content* identity, not a cryptographic guarantee against a crafted
 * collision — that is not a threat here (files are the owner's own library). It
 * is stable across machines (house array -> bar PC) as long as the bytes match,
 * which is exactly what the catalog needs to de-dupe and to key /media/{hash}.
 */

const fs = require('fs');
const crypto = require('crypto');
const { HASH_CHUNK_BYTES } = require('./constants');

/**
 * @param {string} absPath
 * @param {number} [sizeBytes] pre-stat'd size (avoids a second stat)
 * @returns {Promise<string>} 40-char lowercase hex sha1
 */
async function hashFile(absPath, sizeBytes) {
  const size =
    typeof sizeBytes === 'number' ? sizeBytes : (await fs.promises.stat(absPath)).size;

  const sha = crypto.createHash('sha1');
  const header = Buffer.alloc(8);
  header.writeBigUInt64BE(BigInt(size));
  sha.update(header);

  const fd = await fs.promises.open(absPath, 'r');
  try {
    if (size <= HASH_CHUNK_BYTES * 2) {
      // Small file: hash the whole thing.
      const buf = Buffer.alloc(size);
      await fd.read(buf, 0, size, 0);
      sha.update(buf);
    } else {
      const head = Buffer.alloc(HASH_CHUNK_BYTES);
      await fd.read(head, 0, HASH_CHUNK_BYTES, 0);
      sha.update(head);

      const tail = Buffer.alloc(HASH_CHUNK_BYTES);
      await fd.read(tail, 0, HASH_CHUNK_BYTES, size - HASH_CHUNK_BYTES);
      sha.update(tail);
    }
  } finally {
    await fd.close();
  }

  return sha.digest('hex');
}

module.exports = { hashFile };

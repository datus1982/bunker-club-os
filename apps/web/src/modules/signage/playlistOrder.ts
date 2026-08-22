/**
 * START-AT-FILE ordering for a playlist program (owner beat: "start a specific film").
 *
 * A `playlist` program may carry an optional `start_file_id` (docs/15 — the shape stays
 * `{kind:'playlist', playlist_id, start_file_id?}`). The TV plays THAT file first and then
 * continues exactly as the playlist normally would:
 *
 *   • IN ORDER (shuffle off) — the loop is ROTATED so it opens on the chosen file and walks the
 *     rest of the playlist in its authored order, wrapping to the top as it always did.
 *   • SHUFFLE (shuffle on)   — the chosen file plays FIRST, then the normal shuffled walk over
 *     every other file (the shuffled order is untouched, the start file is simply lifted out of
 *     wherever it landed and put in front).
 *
 * A start_file_id that is absent, unknown, missing from the host, or not a member of this
 * playlist DEGRADES SILENTLY to the playlist's normal start — the same array comes back
 * unchanged (identity), so an operator's stale id can never blank a screen. (The media-control
 * edge fn validates membership at write time so the operator hears about it there instead; this
 * is the display-side fail-safe.)
 *
 * Pure + dependency-free so `pnpm test:playliststart` can exercise it directly (no react, no
 * supabase, no `@/` alias) — the same shape as scheduleResolve.ts / rankGates.ts.
 */

/** The minimum a row needs for start-at-file ordering (media_files rows satisfy it). */
export interface Identified {
  id: string;
}

/**
 * Apply an optional start file to an already-resolved play order.
 *
 * @param ordered      the play order the playlist would use anyway — the authored order when
 *                     shuffle is off, or the already-shuffled order when it is on.
 * @param shuffle      the playlist's SHUFFLE toggle; decides rotate (off) vs lift-to-front (on).
 * @param startFileId  the program's start_file_id, if any.
 * @returns the same array reference when nothing applies (no id / not found / already first),
 *          otherwise a new array. Never mutates the input.
 */
export function applyStartFile<T extends Identified>(
  ordered: T[],
  shuffle: boolean,
  startFileId: string | null | undefined,
): T[] {
  if (!startFileId) return ordered;
  const i = ordered.findIndex((f) => f.id === startFileId);
  // Not in this loop (wrong playlist, file missing from the host, stale id) → normal start.
  if (i < 0) return ordered;
  // Already the opener → nothing to do (also keeps the reference stable for React memos).
  if (i === 0) return ordered;
  if (shuffle) {
    // Lift it to the front; the rest keep their shuffled order.
    return [ordered[i], ...ordered.slice(0, i), ...ordered.slice(i + 1)];
  }
  // Rotate so the loop opens on it and continues in authored order (wrapping as usual).
  return [...ordered.slice(i), ...ordered.slice(0, i)];
}

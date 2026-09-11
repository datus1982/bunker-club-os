/**
 * THE TV CHUNK. Nothing staff-facing may EVER be exported from this file.
 *
 * A physical bar screen is pointed at /signage/s/:slug once, permanently, and then runs
 * unattended for months. App.tsx loads this module — and only this module — for that route,
 * so its transitive static-import closure IS the JavaScript a TV downloads.
 *
 * Before this split, `SlotDisplay` was exported from `./routes` alongside `SignageHub`,
 * `EditRotation` and the three `/media/*` pages, so one shared `import()` specifier bundled
 * the entire staff console into the TV's chunk as dead code (PR #104 reviewer NOTE-6:
 * +7 KB from a single staff beat, and every future staff beat would add more). Splitting the
 * loader gives Vite a second entry into the signage module graph: genuinely shared leaf
 * modules (DisplayCanvas, supabaseClient, the trivia boards, the signage templates) still
 * land in shared chunks that BOTH sides import — that is correct and intended — but the
 * hub's own surfaces no longer ride the TV's download.
 *
 * RULE: adding a staff export here silently re-couples the bar screens to the console.
 * Staff surfaces belong in `./routes`. Keep this file to display components only, and
 * re-run the chunk-closure check if you ever add an export here.
 */
export { SlotDisplay } from "./SlotDisplay";

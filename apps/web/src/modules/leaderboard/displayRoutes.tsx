/**
 * A DISPLAY CHUNK. Nothing staff-facing may be exported from this file.
 *
 * Same contract as `modules/signage/displayRoutes.tsx` (the bar-TV chunk): a route that a
 * screen can be left sitting on gets its own `import()` specifier, so the staff console it
 * used to share a chunk with can never grow onto it.
 *
 * /drinks is legacy-but-live (superseded by the Top Sellers slide inside signage, and
 * `NoIndex`-wrapped in App.tsx), and it is public + zero-auth, so it can be pointed at a
 * screen. It was exported from `./routes` next to `DrinksAdmin`, which drags in the staff
 * form primitives, ConfirmDialog and the v2 shell — all dead code on a display.
 */
export { DrinksDisplay } from "./DrinksDisplay";

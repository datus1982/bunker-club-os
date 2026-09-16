/**
 * `npm run capture -- --scene NORMAL [--favorite N] [--dry-run] [--config=path]`
 *
 * Tonight's capture, without the UI: connect to the Core, READ the current value of every scene
 * lever (Component.Get — no control is changed), build the scene payload, print it, and store it
 * as that scene's payload through the audio_agent_capture RPC (scene matched by name,
 * case-insensitively: NORMAL / DJ / KARAOKE / TRIVIA as seeded). --dry-run prints and stores
 * nothing (also the behaviour in dev mode, when the cloud fields are not configured).
 */
import { runCapture } from "./capture-run.js";

function arg(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  if (a.includes("=")) return a.slice(a.indexOf("=") + 1);
  return process.argv[i + 1];
}

const scene = arg("scene");
if (!scene) {
  console.error("usage: npm run capture -- --scene NORMAL|DJ|KARAOKE|TRIVIA [--favorite N] [--dry-run] [--config=path]");
  process.exit(2);
}
const favRaw = arg("favorite");
const favorite = favRaw === undefined ? null : Number(favRaw);
if (favorite !== null && (!Number.isInteger(favorite) || favorite < 1 || favorite > 31)) {
  console.error("--favorite must be an integer 1..31");
  process.exit(2);
}

runCapture({ sceneName: scene, favoriteOverride: favorite, dryRun: process.argv.includes("--dry-run"), configPath: arg("config") })
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`capture failed: ${(e as Error).message}`);
    process.exit(1);
  });

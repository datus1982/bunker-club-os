/**
 * The capture flow as a function (so the fake-Core test drives it with an injected sender and
 * client, and capture-cli.ts stays a thin arg parser).
 */
import { buildScenePayload, readCaptureSet, summarizeCapture, type ScenePayload } from "./capture.js";
import { describeConfig, loadConfig, type AgentConfig } from "./config.js";
import { QrcClient } from "./qrc.js";
import { createCaptureSender, createRangeSeeder, type CaptureSender, type RangeSeeder } from "./report.js";
import { seedRangesFromCapture } from "./sources.js";

/** PR C: the scene whose capture seeds the source ranges (0069) — the seeded default's name. */
export const RANGE_SEED_SCENE = "NORMAL";

export interface CaptureRunOptions {
  sceneName: string;
  favoriteOverride: number | null;
  dryRun: boolean;
  configPath?: string;
  /** test seams */
  config?: AgentConfig;
  client?: QrcClient;
  sender?: CaptureSender | null;
  /** PR C test seam: the ranges seed (null = never seed; undefined = production wiring) */
  rangeSeeder?: RangeSeeder | null;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface CaptureRunResult {
  payload: ScenePayload;
  summary: string;
  stored: boolean;
  sceneId?: string;
}

/** Returns the process exit code (0 ok, 1 store failed, 3 nothing readable). */
export async function runCapture(o: CaptureRunOptions): Promise<number> {
  const r = await captureScene(o);
  return r.stored || o.dryRun || r.sceneId === "dev-mode" ? (r.payload.controls.length === 0 ? 3 : 0) : 1;
}

export async function captureScene(o: CaptureRunOptions): Promise<CaptureRunResult> {
  const out = o.out ?? ((l: string) => process.stdout.write(l + "\n"));
  const err = o.err ?? ((l: string) => process.stderr.write(l + "\n"));
  const config = o.config ?? loadConfig(o.configPath);
  const sceneName = o.sceneName.trim().toUpperCase();
  err(`capture: config ${describeConfig(config)}`);

  const client = o.client ?? new QrcClient({ host: config.coreHost, port: config.corePort, keepaliveMs: 60_000, log: (lvl, m) => err(`${lvl} ${m}`) });
  const ownClient = !o.client;
  if (ownClient) await client.start();
  try {
    const st = await client.statusGet();
    if (!(st.DesignName ?? "").startsWith(config.expectedDesignPrefix)) {
      err(`capture: WARNING design '${st.DesignName}' does not start with '${config.expectedDesignPrefix}'`);
    }
    const { readings, missing } = await readCaptureSet(client);
    const payload = buildScenePayload({ venueId: config.venueId, designName: st.DesignName ?? null, designCode: st.DesignCode ?? null, readings, missing, favoriteOverride: o.favoriteOverride });
    for (const m of missing) err(`capture: MISSING ${m.component} → ${m.control} (${m.message})`);
    out(JSON.stringify(payload, null, 2));
    const summary = summarizeCapture(sceneName, payload);
    if (payload.sonos_favorite == null) err("capture: the Sonos favorite could not be resolved from the plugin's text — re-run with --favorite N to pin it, or leave it null");

    if (payload.controls.length === 0) {
      err(`capture: NOTHING readable — not stored`);
      out(summary + " — NOT STORED (nothing readable)");
      return { payload, summary, stored: false };
    }
    if (o.dryRun) {
      out(summary + " — DRY RUN, not stored");
      return { payload, summary, stored: false };
    }
    const sender = o.sender !== undefined ? o.sender : config.devMode ? null : createCaptureSender({ supabaseUrl: config.supabaseUrl!, anonKey: config.supabaseAnonKey!, deviceToken: config.deviceToken!, agentId: config.agentId });
    if (!sender) {
      out(summary + " — DEV MODE (cloud fields not configured), not stored");
      return { payload, summary, stored: false, sceneId: "dev-mode" };
    }
    const res = await sender(sceneName, payload as unknown as Record<string, unknown>);
    if (!res.ok) {
      err(`capture: store FAILED (${res.status}) ${res.error ?? ""}`);
      out(summary + " — STORE FAILED");
      return { payload, summary, stored: false };
    }
    out(summary + ` — stored as scene ${res.sceneId ?? "(id not returned)"}`);

    // PR C (0069): a NORMAL capture seeds the nudge RANGES (captured ± 6 dB per source it could
    // read) for any source that has no range yet — the RPC never overwrites an existing row, so
    // this is a one-time default until the owner edits them. DECISION: keyed on the scene NAME
    // "NORMAL" (the seeded default's name — what the CLI addresses; a renamed default no longer
    // auto-seeds and the editor sets ranges by hand). Nothing is written to the Core here.
    if (sceneName === RANGE_SEED_SCENE) {
      const seeder = o.rangeSeeder !== undefined ? o.rangeSeeder : config.devMode ? null : createRangeSeeder({ supabaseUrl: config.supabaseUrl!, anonKey: config.supabaseAnonKey!, deviceToken: config.deviceToken!, agentId: config.agentId });
      const seed = seedRangesFromCapture(payload.controls);
      if (seeder && seed.length) {
        const sr = await seeder(config.venueId, seed);
        if (!sr.ok) err(`capture: range seed FAILED (${sr.status}) ${sr.error ?? ""}`);
        else err(`capture: ranges seeded for ${sr.seeded?.length ? sr.seeded.join(", ") : "no new sources (all already set)"}`);
      }
    }
    return { payload, summary, stored: true, sceneId: res.sceneId };
  } finally {
    if (ownClient) client.stop();
  }
}

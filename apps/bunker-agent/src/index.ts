/**
 * bunker-agent — boot.
 *
 *   load config → connect QRC → verify design + every contract component → subscribe the
 *   read-back set → mirror into audio_live (≤ 1 Hz) forever; reconnect on drop; degrade loudly.
 *
 * THIS VERSION WRITES NOTHING TO THE Q-SYS CORE. It reads. (docs/16 — the write lane arrives
 * in PR B only after the owner's supervised first recall.)
 */
import { CONTRACT_COMPONENTS, CONTRACT_REFS } from "./controls.js";
import { describeConfig, loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { Mirror } from "./mirror.js";
import { QrcClient } from "./qrc.js";
import { createCaptureSender, createCommandApi, createReporter } from "./report.js";
import { startCommandLoop } from "./commands.js";
import { AGENT_VERSION } from "./snapshot.js";

async function main(): Promise<void> {
  const cfgArg = process.argv.find((a) => a.startsWith("--config="))?.slice("--config=".length);
  let log = createLogger({ dir: null });
  let config;
  try {
    config = loadConfig(cfgArg);
  } catch (e) {
    log.error(`bunker-agent ${AGENT_VERSION}: ${(e as Error).message}`);
    process.exit(2);
  }
  log = createLogger({ dir: config.logDir, minLevel: process.env.BUNKER_AGENT_DEBUG ? "debug" : "info" });
  log.info(`bunker-agent ${AGENT_VERSION} starting — mirror + command queue; Core writes ${config.writesEnabled ? "ENABLED (gate a open — gate b is the platform ARM WRITES)" : "DISABLED (config.writesEnabled=false)"}`);
  log.info(`config: ${describeConfig(config)}`);
  log.info(`contract: ${CONTRACT_COMPONENTS.length} components / ${CONTRACT_REFS.length} controls`);
  if (config.devMode) log.warn("DEV MODE: supabaseUrl / supabaseAnonKey / deviceToken not all set — snapshots are LOGGED, never posted");

  // PR B: gate (a) is set ONCE, at construction — a client built without it has no reachable
  // write method (qrc.ts writeRequest refuses before touching the socket).
  const client = new QrcClient({ host: config.coreHost, port: config.corePort, writesEnabled: config.writesEnabled, log: (lvl, m) => log(lvl, m) });
  const post = config.devMode
    ? null
    : createReporter({ supabaseUrl: config.supabaseUrl!, anonKey: config.supabaseAnonKey!, deviceToken: config.deviceToken!, agentId: config.agentId });
  const mirror = new Mirror({
    client,
    venueId: config.venueId,
    agentId: config.agentId,
    coreHost: config.coreHost,
    expectedDesignPrefix: config.expectedDesignPrefix,
    post,
    log,
  });
  mirror.on("bootstrapped", (r: { errors: unknown[]; subscribed: number }) => {
    if (r.errors.length) log.error(`DEGRADED: ${r.errors.length} contract error(s) — see snapshot.errors[]; the agent keeps running`);
  });

  // PR B: the command queue. Dev mode (no cloud fields) = no queue at all — there is nothing
  // to poll and nothing to report, exactly like the mirror.
  const cloud = config.devMode ? null : { supabaseUrl: config.supabaseUrl!, anonKey: config.supabaseAnonKey!, deviceToken: config.deviceToken!, agentId: config.agentId };
  const commandLoop = cloud
    ? startCommandLoop({
        api: createCommandApi(cloud),
        writer: client,
        config,
        log,
        captureOptions: { config, client, sender: createCaptureSender(cloud) },
      })
    : null;
  if (!commandLoop) log.warn("DEV MODE: command queue not started (no cloud fields)");

  const shutdown = (sig: string) => {
    log.info(`bunker-agent: ${sig} — shutting down`);
    mirror.stop();
    commandLoop?.stop();
    client.stop();
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (e) => log.error(`uncaught: ${e.stack ?? e.message}`));
  process.on("unhandledRejection", (e) => log.error(`unhandled rejection: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));

  mirror.start();
  // start() resolves on the first connect; the client keeps reconnecting on its own after that
  await client.start();
}

void main();

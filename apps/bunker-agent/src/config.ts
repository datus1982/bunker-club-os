/**
 * config.json — same shape/discipline as the media shell: a small JSON file beside the app (or
 * in %APPDATA%), the device token lives ONLY there (gitignored; config.example.json is the
 * template). Lookup order mirrors apps/media-shell:
 *   1. $BUNKER_AGENT_CONFIG
 *   2. ./config.json (cwd)
 *   3. <app dir>/config.json (next to package.json)
 *   4. %APPDATA%\Bunker Agent\config.json  (or ~/.config/bunker-agent/config.json)
 *
 * Dev mode: if supabaseUrl / supabaseAnonKey / deviceToken are missing the agent still mirrors
 * the Core and LOGS each snapshot it would have posted, but never POSTs — the on-metal proof can
 * run with zero cloud writes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentConfig {
  coreHost: string;
  corePort: number;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  deviceToken: string | null;
  venueId: string;
  agentId: string;
  expectedDesignPrefix: string;
  logDir: string | null;
  /** derived: true when any of the three cloud fields is missing */
  devMode: boolean;
  /** where it was loaded from (for the boot log) */
  path: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function candidatePaths(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url)); // src/ or dist/
  const appDir = path.resolve(here, "..");
  const out: string[] = [];
  if (process.env.BUNKER_AGENT_CONFIG) out.push(process.env.BUNKER_AGENT_CONFIG);
  out.push(path.resolve(process.cwd(), "config.json"));
  out.push(path.join(appDir, "config.json"));
  const appdata = process.env.APPDATA;
  out.push(appdata ? path.join(appdata, "Bunker Agent", "config.json") : path.join(os.homedir(), ".config", "bunker-agent", "config.json"));
  return out;
}

export function loadConfig(explicit?: string): AgentConfig {
  const paths = explicit ? [explicit] : candidatePaths();
  const found = paths.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`config.json not found. Looked in:\n  ${paths.join("\n  ")}\nCopy config.example.json to one of those paths and fill it in.`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(found, "utf8")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${found}: not valid JSON (${(e as Error).message})`);
  }
  return parseConfig(raw, found);
}

/** Pure: validate + normalize a parsed config object (unit-tested without the filesystem). */
export function parseConfig(raw: Record<string, unknown>, from = "<inline>"): AgentConfig {
  const str = (k: string): string | null => {
    const v = raw[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") throw new Error(`${from}: "${k}" must be a string`);
    const t = v.trim();
    return t === "" || /^PASTE-/.test(t) ? null : t;
  };
  const coreHost = str("coreHost");
  if (!coreHost) throw new Error(`${from}: "coreHost" is required (the Q-SYS Core's LAN address)`);
  const portRaw = raw.corePort ?? 1710;
  if (typeof portRaw !== "number" || !Number.isInteger(portRaw) || portRaw < 1 || portRaw > 65535) throw new Error(`${from}: "corePort" must be an integer port`);
  const venueId = str("venueId");
  if (!venueId || !UUID_RE.test(venueId)) throw new Error(`${from}: "venueId" must be the venue's uuid`);
  const agentId = str("agentId") ?? os.hostname();
  const supabaseUrl = str("supabaseUrl");
  if (supabaseUrl && !/^https?:\/\//.test(supabaseUrl)) throw new Error(`${from}: "supabaseUrl" must be an http(s) URL`);
  const supabaseAnonKey = str("supabaseAnonKey");
  const deviceToken = str("deviceToken");
  const devMode = !(supabaseUrl && supabaseAnonKey && deviceToken);
  const logDir = str("logDir");
  return {
    coreHost,
    corePort: portRaw,
    supabaseUrl,
    supabaseAnonKey,
    deviceToken,
    venueId,
    agentId,
    expectedDesignPrefix: str("expectedDesignPrefix") ?? "BunkerClub",
    logDir: logDir === null ? null : path.resolve(path.dirname(from === "<inline>" ? process.cwd() + "/x" : from), logDir),
    devMode,
    path: from,
  };
}

/** For logs: never print the token or the anon key. */
export function describeConfig(c: AgentConfig): string {
  return JSON.stringify({
    path: c.path,
    coreHost: c.coreHost,
    corePort: c.corePort,
    supabaseUrl: c.supabaseUrl,
    supabaseAnonKey: c.supabaseAnonKey ? "<set>" : null,
    deviceToken: c.deviceToken ? "<set>" : null,
    venueId: c.venueId,
    agentId: c.agentId,
    expectedDesignPrefix: c.expectedDesignPrefix,
    logDir: c.logDir,
    devMode: c.devMode,
  });
}

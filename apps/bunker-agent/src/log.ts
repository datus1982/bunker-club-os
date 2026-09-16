/**
 * Logger: stdout + a size-rotated file (agent.log, agent.log.1 … agent.log.N) so a service
 * running for months never fills the NUC. No dependencies.
 */
import fs from "node:fs";
import path from "node:path";

export type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  (level: Level, msg: string): void;
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface LoggerOptions {
  dir?: string | null; // null/undefined = stdout only
  file?: string;
  maxBytes?: number;
  keep?: number;
  minLevel?: Level;
  stdout?: boolean;
}

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(opts: LoggerOptions = {}): Logger {
  const dir = opts.dir ?? null;
  const file = opts.file ?? "agent.log";
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const keep = opts.keep ?? 5;
  const minLevel = ORDER[opts.minLevel ?? "info"];
  const stdout = opts.stdout ?? true;
  const filePath = dir ? path.join(dir, file) : null;

  if (dir) fs.mkdirSync(dir, { recursive: true });

  function rotate(): void {
    if (!filePath) return;
    try {
      const st = fs.statSync(filePath);
      if (st.size < maxBytes) return;
    } catch {
      return; // no file yet
    }
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(filePath, `${filePath}.1`);
  }

  const write = (level: Level, msg: string) => {
    if (ORDER[level] < minLevel) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
    if (stdout) (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
    if (filePath) {
      try {
        rotate();
        fs.appendFileSync(filePath, line + "\n");
      } catch {
        /* never let logging take the agent down */
      }
    }
  };

  const fn = write as Logger;
  fn.debug = (m) => write("debug", m);
  fn.info = (m) => write("info", m);
  fn.warn = (m) => write("warn", m);
  fn.error = (m) => write("error", m);
  return fn;
}

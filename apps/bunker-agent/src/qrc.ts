/**
 * QRC client — Q-SYS Remote Control over TCP (JSON-RPC 2.0, one JSON object per frame,
 * each frame terminated by a single NUL byte). Reference: the read-only inventory script
 * qrc-inventory.ps1 (same wire protocol, same unsolicited-frame handling).
 *
 * READ-ONLY BY CONSTRUCTION. The only methods this client can put on the wire are the ones in
 * READ_ONLY_METHODS below; the private request path refuses anything else, and no public method
 * takes a method name from its caller. There is no code path in this agent that changes a
 * control on the Core — PR A is the mirror phase (card §5 / §6).
 *
 * Behaviour:
 *   • request/response matched by numeric id; unsolicited frames (no id: EngineStatus,
 *     ChangeGroup.Poll notifications) are routed to `onNotification` and never confuse a caller
 *   • NoOp keepalive every `keepaliveMs` (default 30 s) while connected
 *   • reconnect with capped exponential backoff after any close/error; in-flight requests reject
 *   • per-request timeout (default 10 s)
 */
import { EventEmitter } from "node:events";
import net from "node:net";

export const READ_ONLY_METHODS = new Set([
  "NoOp",
  "StatusGet",
  "Component.GetComponents",
  "Component.Get",
  "ChangeGroup.AddComponentControl",
  "ChangeGroup.AutoPoll",
  "ChangeGroup.Poll",
]);

export interface QrcStatus {
  Platform: string;
  State: string;
  DesignName: string;
  DesignCode: string;
  IsRedundant: boolean;
  IsEmulator: boolean;
  Status: { Code: number; String: string };
}

export interface QrcComponentInfo {
  Name: string;
  Type: string;
  ID?: string;
  Properties?: unknown[];
}

export interface QrcControlValue {
  Name: string;
  Type?: string;
  Value?: unknown;
  String?: string;
  Position?: number;
}

export interface QrcComponentGetResult {
  Name: string;
  Controls: QrcControlValue[];
}

export interface QrcChange {
  Component?: string;
  Name: string;
  Value?: unknown;
  String?: string;
  Position?: number;
}

export interface QrcPollResult {
  Id: string;
  Changes: QrcChange[];
}

export interface QrcNotification {
  method: string;
  params?: unknown;
}

export interface QrcRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class QrcError extends Error {
  constructor(public readonly method: string, public readonly rpc: QrcRpcError) {
    super(`${method}: [${rpc.code}] ${rpc.message}`);
    this.name = "QrcError";
  }
}

export interface QrcClientOptions {
  host: string;
  port?: number;
  keepaliveMs?: number;
  requestTimeoutMs?: number;
  /** backoff floor / ceiling for reconnects */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  log?: (level: "info" | "warn" | "error" | "debug", msg: string) => void;
}

interface Pending {
  method: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Events: 'connected' | 'disconnected' (reason) | 'notification' (QrcNotification) */
export class QrcClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly keepaliveMs: number;
  private readonly requestTimeoutMs: number;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly log: NonNullable<QrcClientOptions["log"]>;

  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private keepalive: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number;
  private stopped = true;
  private _connected = false;

  constructor(opts: QrcClientOptions) {
    super();
    this.host = opts.host;
    this.port = opts.port ?? 1710;
    this.keepaliveMs = opts.keepaliveMs ?? 30_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    this.reconnectMinMs = opts.reconnectMinMs ?? 1_000;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 30_000;
    this.reconnectDelay = this.reconnectMinMs;
    this.log = opts.log ?? (() => {});
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Open the socket and keep it open (reconnecting) until stop(). Resolves on first connect. */
  start(): Promise<void> {
    this.stopped = false;
    return new Promise((resolve) => {
      const onFirst = () => resolve();
      this.once("connected", onFirst);
      this.connect();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown(new Error("stopped"));
  }

  // ── read-only surface ────────────────────────────────────────────────────────
  statusGet(): Promise<QrcStatus> {
    return this.request("StatusGet", {}) as Promise<QrcStatus>;
  }

  getComponents(): Promise<QrcComponentInfo[]> {
    return this.request("Component.GetComponents", {}) as Promise<QrcComponentInfo[]>;
  }

  componentGet(name: string, controls: readonly string[]): Promise<QrcComponentGetResult> {
    return this.request("Component.Get", { Name: name, Controls: controls.map((c) => ({ Name: c })) }) as Promise<QrcComponentGetResult>;
  }

  changeGroupAddComponentControl(groupId: string, component: string, controls: readonly string[]): Promise<unknown> {
    return this.request("ChangeGroup.AddComponentControl", {
      Id: groupId,
      Component: { Name: component, Controls: controls.map((c) => ({ Name: c })) },
    });
  }

  changeGroupAutoPoll(groupId: string, rateSeconds: number): Promise<unknown> {
    return this.request("ChangeGroup.AutoPoll", { Id: groupId, Rate: rateSeconds });
  }

  changeGroupPoll(groupId: string): Promise<QrcPollResult> {
    return this.request("ChangeGroup.Poll", { Id: groupId }) as Promise<QrcPollResult>;
  }

  noOp(): Promise<unknown> {
    return this.request("NoOp", {});
  }

  // ── internals ────────────────────────────────────────────────────────────────
  private request(method: string, params: unknown): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method)) {
      // The guard that makes "read-only" a property of the code, not a promise.
      return Promise.reject(new Error(`QrcClient: method '${method}' is not in the read-only allow-list`));
    }
    if (!this.socket || !this._connected) {
      return Promise.reject(new Error(`QrcClient: not connected (${method})`));
    }
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`QrcClient: ${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket!.write(Buffer.concat([Buffer.from(frame, "utf8"), Buffer.from([0])]), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private connect(): void {
    if (this.stopped) return;
    this.log("info", `qrc: connecting to ${this.host}:${this.port}`);
    const s = new net.Socket();
    this.socket = s;
    this.buffer = Buffer.alloc(0);
    s.setNoDelay(true);
    s.setKeepAlive(true, 15_000);
    s.once("connect", () => {
      this._connected = true;
      this.reconnectDelay = this.reconnectMinMs;
      this.log("info", "qrc: connected");
      this.startKeepalive();
      this.emit("connected");
    });
    s.on("data", (chunk) => this.onData(chunk));
    s.once("error", (err) => {
      this.log("warn", `qrc: socket error: ${err.message}`);
      this.onClose(err);
    });
    s.once("close", () => this.onClose(new Error("socket closed")));
    s.connect(this.port, this.host);
  }

  private onClose(reason: Error): void {
    if (this.socket === null) return; // already torn down
    const wasConnected = this._connected;
    this.teardown(reason);
    if (wasConnected) this.emit("disconnected", reason.message);
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxMs);
    this.log("warn", `qrc: reconnecting in ${delay}ms (${reason.message})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private teardown(reason: Error): void {
    this._connected = false;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.removeAllListeners();
      s.on("error", () => {}); // swallow late errors from a socket we abandoned
      s.destroy();
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`QrcClient: ${p.method} aborted (${reason.message})`));
      this.pending.delete(id);
    }
    this.buffer = Buffer.alloc(0);
  }

  private startKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = setInterval(() => {
      this.noOp().catch((e: Error) => this.log("debug", `qrc: keepalive failed: ${e.message}`));
    }, this.keepaliveMs);
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const nul = this.buffer.indexOf(0);
      if (nul < 0) break;
      const raw = this.buffer.subarray(0, nul).toString("utf8");
      this.buffer = this.buffer.subarray(nul + 1);
      if (raw.trim() === "") continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.log("warn", `qrc: dropped unparseable frame (${raw.length} bytes)`);
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    const id = msg.id;
    if (typeof id === "number" && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.error && typeof msg.error === "object") {
        p.reject(new QrcError(p.method, msg.error as QrcRpcError));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (typeof msg.method === "string") {
      // unsolicited: EngineStatus, ChangeGroup.Poll (AutoPoll deliveries), etc.
      this.emit("notification", { method: msg.method, params: msg.params } as QrcNotification);
      return;
    }
    const result = msg.result as { Changes?: unknown } | undefined;
    if (result && typeof result === "object" && Array.isArray(result.Changes)) {
      // some Core firmwares deliver AutoPoll pushes as a repeated RESULT carrying the AutoPoll id
      this.emit("notification", { method: "ChangeGroup.Poll", params: result } as QrcNotification);
      return;
    }
    this.log("debug", `qrc: ignored frame without a known id or method: ${JSON.stringify(msg).slice(0, 200)}`);
  }
}

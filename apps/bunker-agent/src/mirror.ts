/**
 * Mirror — subscribes a ChangeGroup to the contract's read-back set and keeps audio_live fresh.
 *
 * Lifecycle (every time the QRC socket comes up, including after a reconnect):
 *   1. StatusGet → core info; DesignName must start with `expectedDesignPrefix` or we record a
 *      loud `design_mismatch` error and still carry on (the mirror is still useful)
 *   2. Component.GetComponents → every contract component must exist; each missing one is a
 *      `missing_component` error naming it EXACTLY (a Designer rename fails loudly, never silently)
 *   3. Component.Get per present component → initial values; a control the Core does not know is
 *      isolated by a per-control probe and recorded as `missing_control`
 *   4. ChangeGroup.AddComponentControl (present controls only) + ChangeGroup.AutoPoll(1 Hz)
 *   5. incoming ChangeGroup.Poll notifications update the store; the report loop coalesces to at
 *      most one POST per `reportIntervalMs` (1 s) and always posts at least every `heartbeatMs`
 *
 * Nothing here can change a control: the client only exposes read methods (see qrc.ts).
 */
import { EventEmitter } from "node:events";
import { CONTRACT } from "./controls.js";
import type { Logger } from "./log.js";
import { QrcClient, QrcError, type QrcChange, type QrcNotification } from "./qrc.js";
import type { SnapshotPoster } from "./report.js";
import { buildSnapshot, ControlStore, type CoreInfo, type Snapshot, type SnapshotError } from "./snapshot.js";

export interface MirrorOptions {
  client: QrcClient;
  venueId: string;
  agentId: string;
  coreHost: string;
  expectedDesignPrefix: string;
  /** null = dev mode: log the snapshot instead of posting */
  post: SnapshotPoster | null;
  log: Logger;
  reportIntervalMs?: number;
  heartbeatMs?: number;
  pollRateSeconds?: number;
  changeGroupId?: string;
}

export interface BootstrapResult {
  errors: SnapshotError[];
  subscribed: number;
}

/** Events: 'bootstrapped' (BootstrapResult) | 'reported' (Snapshot) | 'report-failed' (string) */
export class Mirror extends EventEmitter {
  private readonly o: Required<Omit<MirrorOptions, "post">> & { post: SnapshotPoster | null };
  private readonly store = new ControlStore();
  private errors: SnapshotError[] = [];
  private core: CoreInfo;
  private reportTimer: NodeJS.Timeout | null = null;
  private lastPostAt = 0;
  private posting = false;
  private consecutiveFailures = 0;
  private bootstrapping = false;

  constructor(opts: MirrorOptions) {
    super();
    this.o = {
      reportIntervalMs: 1_000,
      heartbeatMs: 30_000,
      pollRateSeconds: 1,
      changeGroupId: "bunker-agent-mirror",
      ...opts,
    };
    this.core = { host: opts.coreHost, design_name: null, design_code: null, platform: null, state: null, status: null };
  }

  start(): void {
    const { client } = this.o;
    client.on("connected", () => {
      void this.bootstrap();
    });
    client.on("disconnected", (reason: string) => {
      this.setErrors([{ kind: "disconnected", message: `QRC socket lost: ${reason}` }]);
      this.o.log.warn(`mirror: disconnected (${reason}) — snapshot marked disconnected`);
    });
    client.on("notification", (n: QrcNotification) => this.onNotification(n));
    this.reportTimer = setInterval(() => void this.tick(), this.o.reportIntervalMs);
    if (client.connected) void this.bootstrap();
  }

  stop(): void {
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = null;
  }

  /** Current snapshot (also what gets posted). */
  snapshot(now?: Date): Snapshot {
    const controls = this.store.snapshotControls();
    delete controls["__meta"]; // internal dirty-marker pseudo-component, never leaves the process
    return buildSnapshot({
      venueId: this.o.venueId,
      agentId: this.o.agentId,
      connected: this.o.client.connected,
      core: { ...this.core },
      errors: this.errors,
      controls,
      now,
    });
  }

  currentErrors(): SnapshotError[] {
    return this.errors.map((e) => ({ ...e }));
  }

  // ── bootstrap ────────────────────────────────────────────────────────────────
  async bootstrap(): Promise<BootstrapResult> {
    if (this.bootstrapping) return { errors: this.errors, subscribed: 0 };
    this.bootstrapping = true;
    const { client, log } = this.o;
    const errors: SnapshotError[] = [];
    let subscribed = 0;
    try {
      // 1. status + design check
      try {
        const st = await client.statusGet();
        this.core = {
          host: this.o.coreHost,
          design_name: st.DesignName ?? null,
          design_code: st.DesignCode ?? null,
          platform: st.Platform ?? null,
          state: st.State ?? null,
          status: st.Status?.String ?? null,
        };
        if (!(st.DesignName ?? "").startsWith(this.o.expectedDesignPrefix)) {
          errors.push({
            kind: "design_mismatch",
            message: `DesignName '${st.DesignName}' does not start with '${this.o.expectedDesignPrefix}' — is the right design running?`,
          });
        }
        log.info(`mirror: core ${st.Platform} design=${st.DesignName} (${st.DesignCode}) status=${st.Status?.String}`);
      } catch (e) {
        errors.push({ kind: "core_error", message: `StatusGet failed: ${(e as Error).message}` });
      }

      // 2. every contract component must exist
      let present = new Set<string>();
      try {
        const comps = await client.getComponents();
        present = new Set(comps.map((c) => c.Name));
        for (const c of CONTRACT) {
          if (!present.has(c.component)) {
            errors.push({ kind: "missing_component", component: c.component, message: `component '${c.component}' not found in the running design (renamed or Script Access not External?)` });
            log.error(`mirror: MISSING COMPONENT '${c.component}'`);
          }
        }
      } catch (e) {
        errors.push({ kind: "core_error", message: `Component.GetComponents failed: ${(e as Error).message}` });
      }

      // 3. initial values + isolate missing controls
      for (const c of CONTRACT) {
        if (!present.has(c.component)) continue;
        const ok = await this.readInitial(c.component, c.controls, errors);
        // 4. subscribe the present controls
        if (ok.length > 0) {
          try {
            await client.changeGroupAddComponentControl(this.o.changeGroupId, c.component, ok);
            subscribed += ok.length;
          } catch (e) {
            errors.push({ kind: "core_error", component: c.component, message: `ChangeGroup.AddComponentControl failed: ${(e as Error).message}` });
          }
        }
      }
      if (subscribed > 0) {
        try {
          await client.changeGroupAutoPoll(this.o.changeGroupId, this.o.pollRateSeconds);
        } catch (e) {
          errors.push({ kind: "core_error", message: `ChangeGroup.AutoPoll failed: ${(e as Error).message}` });
        }
      }
      this.setErrors(errors);
      log.info(`mirror: bootstrapped — ${subscribed} controls subscribed, ${errors.length} error(s)${errors.length ? ": " + errors.map((e) => e.message).join(" | ") : ""}`);
      const result = { errors: this.errors, subscribed };
      this.emit("bootstrapped", result);
      return result;
    } finally {
      this.bootstrapping = false;
    }
  }

  /** Component.Get for a whole component; on failure probe each control to name the missing ones. */
  private async readInitial(component: string, controls: readonly string[], errors: SnapshotError[]): Promise<string[]> {
    const { client, log } = this.o;
    try {
      const res = await client.componentGet(component, controls);
      const seen = new Set<string>();
      for (const ctl of res.Controls ?? []) {
        seen.add(ctl.Name);
        this.store.set(component, ctl.Name, ctl.Value, ctl.String, ctl.Position);
      }
      const ok: string[] = [];
      for (const name of controls) {
        if (seen.has(name)) ok.push(name);
        else {
          errors.push({ kind: "missing_control", component, control: name, message: `control '${name}' on '${component}' was not returned by the Core` });
          log.error(`mirror: MISSING CONTROL '${component}' → '${name}'`);
        }
      }
      return ok;
    } catch (e) {
      if (!(e instanceof QrcError)) {
        errors.push({ kind: "core_error", component, message: `Component.Get failed: ${(e as Error).message}` });
        return [];
      }
      // the whole call was refused (typically one unknown control name) — probe one at a time
      const ok: string[] = [];
      for (const name of controls) {
        try {
          const res = await client.componentGet(component, [name]);
          const ctl = (res.Controls ?? []).find((x) => x.Name === name);
          if (ctl) {
            this.store.set(component, name, ctl.Value, ctl.String, ctl.Position);
            ok.push(name);
          } else {
            errors.push({ kind: "missing_control", component, control: name, message: `control '${name}' on '${component}' was not returned by the Core` });
            log.error(`mirror: MISSING CONTROL '${component}' → '${name}'`);
          }
        } catch (e2) {
          errors.push({ kind: "missing_control", component, control: name, message: `control '${name}' on '${component}': ${(e2 as Error).message}` });
          log.error(`mirror: MISSING CONTROL '${component}' → '${name}' (${(e2 as Error).message})`);
        }
      }
      return ok;
    }
  }

  private setErrors(errors: SnapshotError[]): void {
    this.errors = errors;
    // force a post so a new error state reaches audio_live promptly
    this.store.set("__meta", "errors", errors.length, JSON.stringify(errors.map((e) => e.kind)), null);
  }

  // ── live updates ─────────────────────────────────────────────────────────────
  private onNotification(n: QrcNotification): void {
    if (n.method === "EngineStatus") {
      const p = (n.params ?? {}) as Partial<{ DesignName: string; DesignCode: string; Platform: string; State: string; Status: { String: string } }>;
      this.core = {
        host: this.o.coreHost,
        design_name: p.DesignName ?? this.core.design_name,
        design_code: p.DesignCode ?? this.core.design_code,
        platform: p.Platform ?? this.core.platform,
        state: p.State ?? this.core.state,
        status: p.Status?.String ?? this.core.status,
      };
      return;
    }
    if (n.method === "ChangeGroup.Poll") {
      const p = (n.params ?? {}) as { Id?: string; Changes?: QrcChange[] };
      if (p.Id && p.Id !== this.o.changeGroupId) return;
      for (const ch of p.Changes ?? []) {
        if (!ch.Component) continue;
        this.store.set(ch.Component, ch.Name, ch.Value, ch.String, ch.Position);
      }
    }
  }

  // ── reporting (≤ 1 Hz, coalesced, heartbeat) ─────────────────────────────────
  private async tick(): Promise<void> {
    if (this.posting) return;
    const now = Date.now();
    const due = this.store.dirty || now - this.lastPostAt >= this.o.heartbeatMs;
    if (!due) return;
    this.posting = true;
    try {
      const snap = this.snapshot();
      this.store.clearDirty();
      if (!this.o.post) {
        this.lastPostAt = now;
        this.o.log.info(`mirror (dev mode, not posted): ${summarize(snap)}`);
        this.emit("reported", snap);
        return;
      }
      const r = await this.o.post(snap as unknown as Record<string, unknown>);
      if (r.ok) {
        this.lastPostAt = now;
        if (this.consecutiveFailures > 0) this.o.log.info(`mirror: report ok again after ${this.consecutiveFailures} failure(s)`);
        this.consecutiveFailures = 0;
        this.emit("reported", snap);
      } else {
        this.consecutiveFailures++;
        // retry next tick; the store stays dirty so the next tick posts again
        this.store.set("__meta", "retry", this.consecutiveFailures, null, null);
        if (this.consecutiveFailures <= 3 || this.consecutiveFailures % 60 === 0) {
          this.o.log.warn(`mirror: report failed (${r.status}) ${r.error ?? ""} — attempt ${this.consecutiveFailures}`);
        }
        this.emit("report-failed", r.error ?? String(r.status));
      }
    } finally {
      this.posting = false;
    }
  }
}

export function summarize(s: Snapshot): string {
  const d = s.derived;
  return [
    s.connected ? "online" : "OFFLINE",
    `inside=${d.zones.inside.source_name ?? "?"}@${fmt(d.zones.inside.gain_db)}${d.zones.inside.mute ? "(muted)" : ""}`,
    `patio=${d.zones.patio.source_name ?? "?"}@${fmt(d.zones.patio.gain_db)}`,
    `mics=${d.mics["1"].mute === false ? "1open" : "1muted"}/${d.mics["2"].mute === false ? "2open" : "2muted"}`,
    `sonos=${d.sonos.transport ?? "?"}${d.sonos.track ? ` "${d.sonos.track}"` : ""}`,
    `hdmi=${d.video.outputs["1"].active_source ?? "?"}/${d.video.outputs["2"].active_source ?? "?"}`,
    `amp=${d.amp.status ?? "?"}`,
    s.errors.length ? `ERRORS=${s.errors.length}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const fmt = (n: number | null): string => (n === null ? "?" : `${n.toFixed(1)}dB`);

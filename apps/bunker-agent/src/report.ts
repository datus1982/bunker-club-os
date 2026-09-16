/**
 * Reporter — POSTs a snapshot to Supabase through the ONE write path the schema allows the
 * agent: the SECURITY DEFINER RPC `audio_agent_report(p_token, p_snapshot, p_agent_id)`
 * (migration 0067). PostgREST needs the project's PUBLIC anon key as `apikey`; the actual
 * credential is the device token, compared inside the RPC against Vault. The RPC's body is a
 * fixed upsert of one venue's audio_live row — nothing else can happen on this call.
 *
 * DECISION: `supabaseAnonKey` is a config field beside `deviceToken`. The anon key is not a
 * secret (every TV bundle carries it) but the card's field list omitted it; PostgREST cannot be
 * reached without it, and an edge function wrapper would have meant a deploy in this PR.
 */
export interface ReporterOptions {
  supabaseUrl: string;
  anonKey: string;
  deviceToken: string;
  agentId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ReportResult {
  ok: boolean;
  status: number;
  error?: string;
}

export type SnapshotPoster = (snapshot: Record<string, unknown>) => Promise<ReportResult>;

/** One PostgREST RPC call. Returns the parsed JSON body on success when `wantBody` (capture returns the scene id). */
async function rpc(opts: ReporterOptions, fn: string, body: Record<string, unknown>, wantBody: boolean): Promise<ReportResult & { body?: unknown }> {
  const url = `${opts.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const f = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(url, {
      method: "POST",
      headers: {
        apikey: opts.anonKey,
        Authorization: `Bearer ${opts.anonKey}`,
        "Content-Type": "application/json",
        ...(wantBody ? {} : { Prefer: "return=minimal" }),
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (res.ok) {
      if (!wantBody) return { ok: true, status: res.status };
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* a 204 has no body */
      }
      return { ok: true, status: res.status, body: parsed };
    }
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    // never echo the token back into logs — it is not in the response, but be explicit about what we log
    return { ok: false, status: res.status, error: detail.replace(opts.deviceToken, "<token>") };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export function createReporter(opts: ReporterOptions): SnapshotPoster {
  return (snapshot) => rpc(opts, "audio_agent_report", { p_token: opts.deviceToken, p_snapshot: snapshot, p_agent_id: opts.agentId }, false);
}

export type CaptureSender = (sceneName: string, payload: Record<string, unknown>) => Promise<ReportResult & { sceneId?: string }>;

/** The CLI capture's ONE write path: audio_agent_capture(p_token, p_scene_name, p_payload, p_agent_id) → scene id. */
export function createCaptureSender(opts: ReporterOptions): CaptureSender {
  return async (sceneName, payload) => {
    const r = await rpc(opts, "audio_agent_capture", { p_token: opts.deviceToken, p_scene_name: sceneName, p_payload: payload, p_agent_id: opts.agentId }, true);
    return r.ok ? { ok: true, status: r.status, sceneId: typeof r.body === "string" ? r.body : undefined } : { ok: false, status: r.status, error: r.error };
  };
}

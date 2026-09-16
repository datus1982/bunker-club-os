/**
 * config parsing (dev mode / validation / no secrets in the boot log) and the reporter's exact
 * request shape against the audio_agent_report RPC (headers, body, error handling).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeConfig, parseConfig } from "../src/config.js";
import { createReporter } from "../src/report.js";

const VENUE = "11111111-1111-1111-1111-111111111111";

describe("config", () => {
  it("parses the example shape and derives devMode=false when all three cloud fields are set", () => {
    const c = parseConfig({ coreHost: "192.168.68.201", corePort: 1710, supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", deviceToken: "tok", venueId: VENUE, agentId: "nuc", logDir: "logs" });
    assert.equal(c.devMode, false);
    assert.equal(c.expectedDesignPrefix, "BunkerClub");
    assert.equal(c.agentId, "nuc");
    assert.ok(c.logDir?.endsWith("logs"));
  });

  it("treats PASTE-… placeholders and blanks as unset → dev mode", () => {
    const c = parseConfig({ coreHost: "1.2.3.4", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "PASTE-THE-PUBLIC-ANON-KEY", deviceToken: "", venueId: VENUE });
    assert.equal(c.devMode, true);
    assert.equal(c.supabaseAnonKey, null);
    assert.equal(c.deviceToken, null);
    assert.equal(c.corePort, 1710);
    assert.equal(c.logDir, null);
  });

  it("rejects a missing coreHost / bad venueId / bad port / bad URL with a plain message", () => {
    assert.throws(() => parseConfig({ venueId: VENUE }), /coreHost/);
    assert.throws(() => parseConfig({ coreHost: "h", venueId: "nope" }), /venueId/);
    assert.throws(() => parseConfig({ coreHost: "h", venueId: VENUE, corePort: 70000 }), /corePort/);
    assert.throws(() => parseConfig({ coreHost: "h", venueId: VENUE, supabaseUrl: "ftp://x" }), /supabaseUrl/);
  });

  it("never prints the token or the anon key", () => {
    const c = parseConfig({ coreHost: "h", venueId: VENUE, supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "SECRET-ANON", deviceToken: "SECRET-TOKEN" });
    const d = describeConfig(c);
    assert.ok(!d.includes("SECRET-ANON") && !d.includes("SECRET-TOKEN"));
    assert.ok(d.includes('"deviceToken":"<set>"'));
  });
});

describe("reporter", () => {
  it("POSTs exactly the RPC's three named params with the anon key as apikey", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const post = createReporter({ supabaseUrl: "https://proj.supabase.co/", anonKey: "ANON", deviceToken: "TOK", agentId: "nuc", fetchImpl });
    const r = await post({ venue_id: VENUE, hello: 1 });
    assert.deepEqual(r, { ok: true, status: 204 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/rpc/audio_agent_report");
    assert.equal(calls[0].init.method, "POST");
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h.apikey, "ANON");
    assert.equal(h.Authorization, "Bearer ANON");
    assert.equal(h["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body as string), { p_token: "TOK", p_snapshot: { venue_id: VENUE, hello: 1 }, p_agent_id: "nuc" });
  });

  it("surfaces non-2xx as ok:false with the status and a trimmed body, and network errors as status 0", async () => {
    const bad = (async () => new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    const p1 = createReporter({ supabaseUrl: "https://p.supabase.co", anonKey: "A", deviceToken: "T", agentId: "n", fetchImpl: bad });
    const r1 = await p1({ venue_id: VENUE });
    assert.equal(r1.ok, false);
    assert.equal(r1.status, 401);
    assert.match(r1.error ?? "", /unauthorized/);
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const p2 = createReporter({ supabaseUrl: "https://p.supabase.co", anonKey: "A", deviceToken: "T", agentId: "n", fetchImpl: dead });
    const r2 = await p2({ venue_id: VENUE });
    assert.deepEqual(r2, { ok: false, status: 0, error: "ECONNREFUSED" });
  });
});

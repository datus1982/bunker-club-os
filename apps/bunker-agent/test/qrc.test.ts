/**
 * QrcClient against the fake Core: framing, id matching under unsolicited frames, keepalive,
 * reconnect with backoff, error mapping, and the read-only allow-list guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { QrcClient, QrcError, READ_ONLY_METHODS } from "../src/qrc.js";
import { FakeCore, sleep, waitFor } from "./fakeCore.js";

describe("QrcClient framing + id matching", () => {
  let core: FakeCore;
  before(async () => {
    core = new FakeCore({ splitFrames: true, engineStatusBeforeEachResponse: true });
    await core.start();
  });
  after(() => core.stop());

  it("reassembles NUL-terminated frames split across TCP writes and ignores interleaved EngineStatus", async () => {
    const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000 });
    const notes: string[] = [];
    client.on("notification", (n: { method: string }) => notes.push(n.method));
    await client.start();
    const st = await client.statusGet();
    assert.equal(st.DesignName, "BunkerClub_v03.20260329");
    assert.equal(st.DesignCode, "vyysM4BoQKaY");
    const comps = await client.getComponents();
    assert.equal(comps.length, 28);
    // three concurrent requests resolve to their OWN results despite EngineStatus frames between every reply
    const [a, b, c] = await Promise.all([
      client.componentGet("Inside Router_8x8", ["select.1"]),
      client.componentGet("SonosSonosControl", ["TransportState", "FavName 2"]),
      client.componentGet("Patio Mixer", ["output.1.gain"]),
    ]);
    assert.equal(a.Name, "Inside Router_8x8");
    assert.equal(a.Controls[0].Value, 1);
    assert.equal(b.Controls.find((x) => x.Name === "TransportState")?.String, "PAUSED_PLAYBACK");
    assert.equal(b.Controls.find((x) => x.Name === "FavName 2")?.String, "80s Hits");
    assert.equal(c.Controls[0].String, "-3.71dB");
    assert.ok(notes.filter((m) => m === "EngineStatus").length >= 5, "unsolicited EngineStatus frames were surfaced as notifications, not matched to requests");
    client.stop();
  });

  it("maps a JSON-RPC error reply to QrcError with the Core's code", async () => {
    const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000 });
    await client.start();
    await assert.rejects(client.componentGet("No Such Component", ["x"]), (e: unknown) => e instanceof QrcError && e.rpc.code === 7);
    await assert.rejects(client.componentGet("Inside Mixer", ["output.1.gain", "nope"]), (e: unknown) => e instanceof QrcError && e.rpc.code === 8);
    client.stop();
  });
});

describe("QrcClient keepalive + reconnect", () => {
  it("sends NoOp on the keepalive interval", async () => {
    const core = new FakeCore();
    await core.start();
    const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 40 });
    await client.start();
    await sleep(230);
    const noops = core.received.filter((r) => r.method === "NoOp").length;
    assert.ok(noops >= 3, `expected ≥3 NoOp keepalives in 230ms at 40ms, got ${noops}`);
    client.stop();
    await core.stop();
  });

  it("reconnects with backoff after the Core drops the socket; in-flight request rejects, next succeeds", async () => {
    const core = new FakeCore({ dropAfterRequests: 1 });
    await core.start();
    const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000, reconnectMinMs: 30, reconnectMaxMs: 200 });
    const events: string[] = [];
    client.on("connected", () => events.push("connected"));
    client.on("disconnected", () => events.push("disconnected"));
    await client.start();
    const first = await client.statusGet(); // answered, then the fake destroys the socket
    assert.equal(first.DesignName, "BunkerClub_v03.20260329");
    await waitFor(() => events.includes("disconnected"), 2000, "disconnect");
    assert.equal(client.connected, false);
    await assert.rejects(client.statusGet(), /not connected/);
    await waitFor(() => core.connections >= 2 && client.connected, 3000, "reconnect");
    const again = await client.statusGet();
    assert.equal(again.DesignName, "BunkerClub_v03.20260329");
    assert.deepEqual(events, ["connected", "disconnected", "connected"]);
    client.stop();
    await core.stop();
  });

  it("keeps retrying while the Core is unreachable, then connects when it appears", async () => {
    const probe = new FakeCore();
    const port = await probe.start();
    await probe.stop(); // port is now free — nothing listening
    const client = new QrcClient({ host: "127.0.0.1", port, keepaliveMs: 60_000, reconnectMinMs: 30, reconnectMaxMs: 120 });
    const started = client.start(); // resolves only on first connect
    await sleep(150);
    assert.equal(client.connected, false);
    const core = new FakeCore();
    await core.start(port); // the Core "comes back" on the port the client is retrying
    await started;
    assert.equal(client.connected, true);
    client.stop();
    await core.stop();
  });
});

describe("QrcClient read-only guard", () => {
  it("exposes exactly the read methods and refuses anything else at the request layer", async () => {
    assert.deepEqual([...READ_ONLY_METHODS].sort(), ["ChangeGroup.AddComponentControl", "ChangeGroup.AutoPoll", "ChangeGroup.Poll", "Component.Get", "Component.GetComponents", "NoOp", "StatusGet"]);
    const core = new FakeCore();
    await core.start();
    const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000 });
    await client.start();
    // reach the private request path the only way anything could: by name. It must refuse
    // before touching the socket — the fake must never see the frame.
    const priv = client as unknown as { request(method: string, params: unknown): Promise<unknown> };
    for (const m of ["Control.Get", "Component.GetControls", "Logon", "Design.Get", "Totally.Fake"]) {
      await assert.rejects(priv.request(m, {}), /not in the read-only allow-list/);
    }
    await client.statusGet();
    assert.deepEqual(core.methodsSeen(), ["StatusGet"]);
    client.stop();
    await core.stop();
  });

  it("has no public method that takes a method name", () => {
    const publicMethods = Object.getOwnPropertyNames(QrcClient.prototype).filter((n) => n !== "constructor" && !n.startsWith("_"));
    const expected = ["start", "stop", "statusGet", "getComponents", "componentGet", "changeGroupAddComponentControl", "changeGroupAutoPoll", "changeGroupPoll", "noOp"];
    for (const m of expected) assert.ok(publicMethods.includes(m), `missing ${m}`);
    // everything else on the prototype is an internal (private in TS, but enumerable at runtime)
    const internals = publicMethods.filter((m) => !expected.includes(m));
    assert.deepEqual(internals.sort(), ["connect", "connected", "dispatch", "onClose", "onData", "request", "startKeepalive", "teardown"].sort());
  });
});

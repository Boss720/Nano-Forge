import { describe, expect, it, vi } from "vitest";
import {
  HostAuthError,
  HostClient,
  HostConnectionError,
  parseHostMessage,
  type HostMessage,
  type WebSocketLike,
} from "@/lib/hostClient";
import type { ExecutionPlan } from "@/types";

/** Minimal fake socket: records frames, lets the test drive open/message/close. */
class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /* --- test drives --- */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  receiveRaw(raw: string): void {
    this.onmessage?.({ data: raw });
  }
  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function makeClient(port = 4711, token = "tok-abc") {
  FakeWebSocket.instances = [];
  const client = new HostClient({
    port,
    token,
    WebSocketImpl: (url) => new FakeWebSocket(url),
  });
  return { client, ws: () => FakeWebSocket.instances[0] };
}

async function connect(client: HostClient): Promise<FakeWebSocket> {
  const p = client.connect();
  const ws = FakeWebSocket.instances[0];
  ws.open();
  await p;
  return ws;
}

const plan: ExecutionPlan = {
  id: "p1",
  goal: "demo",
  state: "awaiting_approval",
  steps: [{ id: "s1", title: "Step", dependsOn: [], status: "pending" }],
};

describe("HostClient connection", () => {
  it("connects to the loopback agent URL with the single-use token", async () => {
    const { client, ws } = makeClient(4820, "one-time");
    await connect(client);
    expect(ws().url).toBe("ws://127.0.0.1:4820/agent?token=one-time");
    expect(client.connected).toBe(true);
  });

  it("maps a 4401 close during connect to a typed HostAuthError", async () => {
    const { client } = makeClient();
    const p = client.connect();
    FakeWebSocket.instances[0].close(4401, "token consumed");
    await expect(p).rejects.toBeInstanceOf(HostAuthError);
    await expect(p).rejects.toThrow(/4401/);
  });

  it("surfaces 4401 closes to event subscribers as an unauthorized error", async () => {
    const { client } = makeClient();
    const events: HostMessage[] = [];
    client.onEvent((m) => events.push(m));
    await connect(client);
    FakeWebSocket.instances[0].close(4401, "unauthorized");
    expect(events).toEqual([
      expect.objectContaining({ type: "error", code: "unauthorized" }),
    ]);
  });
});

describe("HostClient requests", () => {
  it("correlates workspace read results and host errors by request id", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const read = client.readFile("src/main.ts");
    const frame = ws.sentFrames()[0];
    ws.receive({ type: "workspace.readFile.result", requestId: frame.requestId, path: "src/main.ts", content: "export {}", language: "typescript", size: 9 });
    await expect(read).resolves.toMatchObject({ path: "src/main.ts", language: "typescript" });

    const stat = client.stat("missing.ts");
    const statFrame = ws.sentFrames()[1];
    ws.receive({ type: "error", requestId: statFrame.requestId, code: "not_found", message: "missing.ts" });
    await expect(stat).rejects.toThrow(/not_found: missing.ts/);
  });

  it("rejects an unanswered workspace request at the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const { client } = makeClient();
      const ws = await connect(client);
      const pending = client.readDir();
      vi.advanceTimersByTime(15_000);
      await expect(pending).rejects.toThrow(/timed out/);
      expect(ws.sentFrames()[0]).toMatchObject({ type: "workspace.readDir" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("correlates command results deterministically and preserves structured failures", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const first = client.executeCommand({
      command: "/swarm",
      args: ["list"],
      rawText: "/swarm list",
    });
    const second = client.dispatchCommand({
      command: "/swarm",
      args: ["unknown"],
      rawText: "/swarm unknown",
    });
    const frames = ws.sentFrames();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ type: "command.execute", command: "/swarm" });
    expect(frames[0].requestId).not.toBe(frames[1].requestId);

    ws.receive({
      type: "command.result",
      requestId: frames[1].requestId,
      command: "/swarm",
      success: false,
      error: "unsupported swarm action",
      data: { code: "unsupported_action" },
    });
    ws.receive({
      type: "command.result",
      requestId: frames[0].requestId,
      command: "/swarm",
      success: true,
      output: "0 subagents",
      data: { action: "list", subagents: [] },
    });

    await expect(first).resolves.toMatchObject({ success: true, output: "0 subagents" });
    await expect(second).resolves.toMatchObject({
      success: false,
      error: "unsupported swarm action",
      data: { code: "unsupported_action" },
    });
  });

  it("rejects a pending command when the host disconnects", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const pending = client.executeCommand({ command: "/swarm", args: ["list"], rawText: "/swarm list" });
    ws.close(1006, "host crashed");
    await expect(pending).rejects.toBeInstanceOf(HostConnectionError);
    await expect(pending).rejects.toThrow(/host crashed/);
  });

  it("plan.submit sends the full plan and resolves on the ack", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const done = client.submitPlan(plan);
    const frame = ws.sentFrames()[0];
    expect(frame).toMatchObject({ type: "plan.submit", plan });
    expect(frame.requestId).toEqual(expect.any(String));
    ws.receive({ type: "run.event", runId: "r1", event: "accepted", requestId: frame.requestId });
    await expect(done).resolves.toBeDefined();
  });

  it("approval.grant / approval.deny emit the exact approval frames", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const grant = client.grantApproval("run-1", "step-7");
    const grantFrame = ws.sentFrames()[0];
    expect(grantFrame).toEqual({
      type: "approval.grant",
      requestId: grantFrame.requestId,
      runId: "run-1",
      stepId: "step-7",
    });
    ws.receive({ type: "run.event", runId: "run-1", event: "approval.granted", requestId: grantFrame.requestId });
    await expect(grant).resolves.toBeDefined();

    const deny = client.denyApproval("run-1", "step-8");
    const denyFrame = ws.sentFrames()[1];
    expect(denyFrame).toEqual({
      type: "approval.deny",
      requestId: denyFrame.requestId,
      runId: "run-1",
      stepId: "step-8",
    });
    ws.receive({ type: "run.event", runId: "run-1", event: "approval.denied", requestId: denyFrame.requestId });
    await expect(deny).resolves.toBeDefined();
  });

  it("run.pause and run.cancel send their control frames", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const p1 = client.pauseRun("r9");
    const f1 = ws.sentFrames()[0];
    expect(f1).toMatchObject({ type: "run.pause", runId: "r9" });
    ws.receive({ type: "run.state", runId: "r9", state: "paused", requestId: f1.requestId });
    await expect(p1).resolves.toBeDefined();

    const p2 = client.cancelRun("r9");
    const f2 = ws.sentFrames()[1];
    expect(f2).toMatchObject({ type: "run.cancel", runId: "r9" });
    ws.receive({ type: "run.event", runId: "r9", event: "cancelled", requestId: f2.requestId });
    await expect(p2).resolves.toBeDefined();
  });

  it("rejecting a request produces NO tool execution frame — only approval.deny", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    // host proposes a tool; the user denies it
    const deny = client.denyApproval("run-1", "step-3");
    const frame = ws.sentFrames()[0];
    ws.receive({ type: "run.event", runId: "run-1", event: "approval.denied", requestId: frame.requestId });
    await expect(deny).resolves.toBeDefined();

    // the exact and only frame on the wire is the denial — the client never
    // sends anything that could trigger an execution
    expect(ws.sentFrames()).toEqual([
      { type: "approval.deny", requestId: frame.requestId, runId: "run-1", stepId: "step-3" },
    ]);
    expect(ws.sentFrames().every((f) => typeof f.type === "string" && !/exec|run\.tool|terminal/.test(f.type as string))).toBe(true);
  });

  it("a host error frame rejects the matching pending request", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const done = client.submitPlan(plan);
    const frame = ws.sentFrames()[0];
    ws.receive({ type: "error", code: "invalid_plan", message: "cycle in dependencies", requestId: frame.requestId });
    await expect(done).rejects.toThrow(/invalid_plan/);
  });

  it("rejects requests when the socket is not open", async () => {
    const { client } = makeClient();
    await expect(client.cancelRun("r1")).rejects.toThrow(/not connected/);
  });
});

describe("HostClient events", () => {
  it("surfaces tool.approval_required to subscribers", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const events: HostMessage[] = [];
    const unsub = client.onEvent((m) => events.push(m));

    ws.receive({
      type: "tool.approval_required",
      runId: "r1",
      toolId: "t1",
      executable: "npm",
      args: ["install", "left-pad"],
      cwd: "C:\\repo",
      policyReason: "package installation requires approval",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool.approval_required",
      toolId: "t1",
      executable: "npm",
      policyReason: "package installation requires approval",
    });

    unsub();
    ws.receive({ type: "run.event", runId: "r1", event: "resumed" });
    expect(events).toHaveLength(1);
  });

  it("streams tool.output and run.state events to subscribers", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const events: HostMessage[] = [];
    client.onEvent((m) => events.push(m));
    ws.receive({ type: "tool.output", runId: "r1", toolId: "t1", chunk: "hello", truncated: false });
    ws.receive({ type: "run.state", runId: "r1", state: "executing" });
    expect(events.map((e) => e.type)).toEqual(["tool.output", "run.state"]);
  });

  it("drops malformed and unknown frames instead of delivering them", async () => {
    const { client } = makeClient();
    const ws = await connect(client);
    const handler = vi.fn();
    client.onEvent(handler);
    ws.receiveRaw("not json {{{");
    ws.receive({ type: "tool.execute", evil: true });
    ws.receive({ type: "tool.output", runId: 5 }); // wrong shapes
    ws.receiveRaw("null");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("parseHostMessage", () => {
  it("accepts every documented host->client type", () => {
    expect(parseHostMessage(JSON.stringify({ type: "run.state", runId: "r", state: "executing" }))).toMatchObject({ type: "run.state" });
    expect(
      parseHostMessage(
        JSON.stringify({
          type: "tool.approval_required",
          runId: "r",
          toolId: "t",
          executable: "git",
          args: ["status"],
          cwd: "/repo",
          policyReason: "read-only",
        }),
      ),
    ).toMatchObject({ type: "tool.approval_required" });
    expect(parseHostMessage(JSON.stringify({ type: "tool.output", runId: "r", toolId: "t", chunk: "x" }))).toMatchObject({ type: "tool.output" });
    expect(parseHostMessage(JSON.stringify({ type: "run.event", runId: "r", event: "done" }))).toMatchObject({ type: "run.event" });
    expect(parseHostMessage(JSON.stringify({ type: "error", code: "boom", message: "m" }))).toMatchObject({ type: "error" });
    expect(
      parseHostMessage(
        JSON.stringify({
          type: "command.result",
          requestId: "req-1",
          command: "/swarm",
          success: true,
          data: { action: "list", subagents: [] },
        }),
      ),
    ).toMatchObject({ type: "command.result", requestId: "req-1" });
  });

  it("rejects non-JSON, arrays, unknown types, and bad field types", () => {
    expect(parseHostMessage("{")).toBeNull();
    expect(parseHostMessage("[]")).toBeNull();
    expect(parseHostMessage(JSON.stringify({ type: "plan.submit" }))).toBeNull();
    expect(parseHostMessage(JSON.stringify({ type: "run.state", runId: "r", state: 42 }))).toBeNull();
  });
});

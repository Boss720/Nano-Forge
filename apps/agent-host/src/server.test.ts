/**
 * Tests for the authenticated local host — Module 2, Task 4.
 *
 * Uses Node's built-in WebSocket client (stable in Node >= 22.4) so the
 * suite has no client-side dependency quirks under the test runner.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOSE_INVALID_MESSAGE,
  CLOSE_UNAUTHORIZED,
  createHost,
  createTokenStore,
  HOST_VERSION,
  type HostHandle,
} from "./server";

/* Minimal structural typing over the native WebSocket (no DOM lib needed). */
interface WsCloseEvent {
  code: number;
  reason: string;
}
interface WsMessageEvent {
  data: unknown;
}
interface WsLike {
  addEventListener(
    type: "open" | "error",
    cb: () => void,
    opts?: { once?: boolean },
  ): void;
  addEventListener(
    type: "close",
    cb: (event: WsCloseEvent) => void,
    opts?: { once?: boolean },
  ): void;
  addEventListener(
    type: "message",
    cb: (event: WsMessageEvent) => void,
    opts?: { once?: boolean },
  ): void;
  send(data: string): void;
  close(): void;
}
const NativeWebSocket = globalThis.WebSocket as unknown as new (
  url: string,
) => WsLike;

let host: HostHandle | undefined;

afterEach(async () => {
  await host?.close();
  host = undefined;
});

const agentUrl = (h: HostHandle, token?: string): string =>
  `ws://127.0.0.1:${h.port}/agent${token === undefined ? "" : `?token=${token}`}`;

function waitForClose(ws: WsLike): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    );
  });
}

function waitForOpen(ws: WsLike): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), {
      once: true,
    });
  });
}

function nextMessage(ws: WsLike): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.addEventListener(
      "message",
      (event) => resolve(JSON.parse(String(event.data))),
      { once: true },
    );
  });
}

describe("token store", () => {
  it("issues well-formed tokens consumable exactly once", () => {
    const store = createTokenStore();
    const token = store.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(store.consume(token)).toBe(true);
    expect(store.consume(token)).toBe(false);
  });

  it("rejects malformed and unknown tokens", () => {
    const store = createTokenStore();
    expect(store.consume(undefined)).toBe(false);
    expect(store.consume(null)).toBe(false);
    expect(store.consume("")).toBe(false);
    expect(store.consume("short")).toBe(false);
    expect(store.consume("not a token at all !!!")).toBe(false);
    // Well-formed but never registered.
    expect(store.consume("a".repeat(32))).toBe(false);
  });
});

describe("authenticated local host", () => {
  it("binds loopback only and answers /health", async () => {
    host = await createHost();
    expect(host.port).toBeGreaterThan(0);
    const address = host.app.server.address();
    expect(typeof address === "object" && address?.address).toBe("127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${host.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body).toEqual({ ok: true, version: HOST_VERSION });
  });

  it("closes an unauthenticated socket (missing token) with 4401", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host));
    const { code } = await waitForClose(ws);
    expect(code).toBe(CLOSE_UNAUTHORIZED);
  });

  it("closes sockets with malformed or unknown tokens with 4401", async () => {
    host = await createHost();
    const malformed = new NativeWebSocket(agentUrl(host, "not-a-real-token"));
    expect((await waitForClose(malformed)).code).toBe(CLOSE_UNAUTHORIZED);

    const unknown = new NativeWebSocket(agentUrl(host, "b".repeat(32)));
    expect((await waitForClose(unknown)).code).toBe(CLOSE_UNAUTHORIZED);
  });

  it("accepts a valid token once, then rejects its reuse with 4401", async () => {
    host = await createHost();

    const first = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(first);
    const ready = await nextMessage(first);
    expect(ready.type).toBe("host.ready");
    expect(ready.version).toBe(HOST_VERSION);
    first.close();
    await waitForClose(first);

    const second = new NativeWebSocket(agentUrl(host, host.token));
    const { code, reason } = await waitForClose(second);
    expect(code).toBe(CLOSE_UNAUTHORIZED);
    expect(reason).toBe("unauthorized");
  });

  it("answers ping with pong over an authenticated socket", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready
    const pongPromise = nextMessage(ws);
    ws.send(JSON.stringify({ type: "ping" }));
    const pong = await pongPromise;
    expect(pong.type).toBe("pong");
    ws.close();
  });

  it("queues a run on plan.submit", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready
    const statePromise = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "plan.submit",
        plan: { id: "p1", goal: "demo", steps: [{ id: "s1" }] },
      }),
    );
    const state = await statePromise;
    expect(state.type).toBe("run.state");
    expect(state.state).toBe("queued");
    expect(typeof state.runId).toBe("string");
    ws.close();
  });

  it("closes with 4400 on a malformed (non-JSON) frame", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready
    ws.send("{ this is not json");
    const { code } = await waitForClose(ws);
    expect(code).toBe(CLOSE_INVALID_MESSAGE);
  });

  it("closes with 4400 on a schema violation", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready
    ws.send(JSON.stringify({ type: "plan.submit", plan: "not-an-object" }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(CLOSE_INVALID_MESSAGE);
  });

  it("closes with 4400 on an unknown message type", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready
    ws.send(JSON.stringify({ type: "shell.exec", cmd: "rm -rf /" }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(CLOSE_INVALID_MESSAGE);
  });

  it("handles memory RPCs (set, get, query, delete) and broadcasts memory events", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host, host.token));
    const received: Record<string, unknown>[] = [];
    const waiters: ((msg: Record<string, unknown>) => void)[] = [];

    ws.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data));
      if (waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve(parsed);
      } else {
        received.push(parsed);
      }
    });

    const getNext = (): Promise<Record<string, unknown>> => {
      if (received.length > 0) {
        return Promise.resolve(received.shift()!);
      }
      return new Promise((resolve) => waiters.push(resolve));
    };

    await waitForOpen(ws);
    const ready = await getNext();
    expect(ready.type).toBe("host.ready");

    // 1. memory.set
    ws.send(
      JSON.stringify({
        type: "memory.set",
        requestId: "req-mem-1",
        params: {
          key: "cluster_status",
          value: "healthy",
          namespace: "swarm",
          tags: ["cluster", "status"],
        },
      })
    );

    // Expect to receive both memory.event and memory.set.result
    const msg1 = await getNext();
    const msg2 = await getNext();
    const receivedTypes = [msg1.type, msg2.type];
    expect(receivedTypes).toContain("memory.set.result");
    expect(receivedTypes).toContain("memory.event");

    const setResultMsg = (msg1.type === "memory.set.result" ? msg1 : msg2) as any;
    expect(setResultMsg.requestId).toBe("req-mem-1");
    expect(setResultMsg.result.success).toBe(true);
    expect(setResultMsg.result.entry.key).toBe("cluster_status");
    expect(setResultMsg.result.entry.namespace).toBe("swarm");

    // 2. memory.get
    ws.send(
      JSON.stringify({
        type: "memory.get",
        requestId: "req-mem-2",
        params: {
          key: "cluster_status",
          namespace: "swarm",
        },
      })
    );

    const getResultMsg = (await getNext()) as any;
    expect(getResultMsg.type).toBe("memory.get.result");
    expect(getResultMsg.requestId).toBe("req-mem-2");
    expect(getResultMsg.result.found).toBe(true);
    expect(getResultMsg.result.entry.value).toBe("healthy");

    // 3. memory.query
    ws.send(
      JSON.stringify({
        type: "memory.query",
        requestId: "req-mem-3",
        params: {
          namespace: "swarm",
          query: "status",
        },
      })
    );

    const queryResultMsg = (await getNext()) as any;
    expect(queryResultMsg.type).toBe("memory.query.result");
    expect(queryResultMsg.requestId).toBe("req-mem-3");
    expect(queryResultMsg.result.total).toBe(1);
    expect(queryResultMsg.result.entries[0].key).toBe("cluster_status");

    // 4. memory.delete
    ws.send(
      JSON.stringify({
        type: "memory.delete",
        requestId: "req-mem-4",
        params: {
          key: "cluster_status",
          namespace: "swarm",
        },
      })
    );

    const msg3 = await getNext();
    const msg4 = await getNext();
    const delTypes = [msg3.type, msg4.type];
    expect(delTypes).toContain("memory.delete.result");
    expect(delTypes).toContain("memory.event");

    const delResultMsg = (msg3.type === "memory.delete.result" ? msg3 : msg4) as any;
    expect(delResultMsg.requestId).toBe("req-mem-4");
    expect(delResultMsg.result.success).toBe(true);
    expect(delResultMsg.result.deleted).toBe(true);

    ws.close();
  });
});

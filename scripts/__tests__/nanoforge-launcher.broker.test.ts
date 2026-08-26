import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStaticServer, createWorkspaceBroker } = require("../nanoforge-launcher.cjs");
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("launcher workspace broker protocol", () => {
  it("requires auth and returns a path-free protocol choose result", async () => {
    const registry = {
      open: (workspacePath: string) => ({ id: "ws_demo", path: workspacePath, pinned: false }),
      list: () => [{ id: "ws_demo", path: "C:\\Private\\Demo", pinned: false }],
      resolve: () => ({ id: "ws_demo", path: "C:\\Private\\Demo", pinned: false }),
      pin: () => null,
      remove: () => false,
    };
    const broker = createWorkspaceBroker({
      picker: { pick: async () => ({ status: "selected", path: "C:\\Private\\Demo" }) },
      registry,
      capabilities: { read: true, stat: true, watch: true, search: true, git: true, terminal: false, subagents: true, memory: true, reviewedWrite: false },
    });
    const server = createStaticServer(path.resolve(__dirname, "../../dist"), { token: "secret", workspaceBroker: broker });
    servers.push(server);

    const unauthorized = await request(server, "POST", "/workspace/choose", JSON.stringify({ type: "workspace.choose", requestId: "choose-1" }));
    expect(unauthorized.status).toBe(401);

    const chosen = await request(server, "POST", "/workspace/choose", JSON.stringify({ type: "workspace.choose", requestId: "choose-1" }), "Bearer secret", "choose-1");
    expect(chosen.status).toBe(200);
    expect(JSON.parse(chosen.text)).toEqual({
      type: "workspace.choose.result",
      requestId: "choose-1",
      workspace: {
        workspaceId: "ws_demo",
        label: "Demo",
        generation: 1,
        capabilities: { read: true, stat: true, watch: true, search: true, git: true, terminal: false, subagents: true, memory: true, reviewedWrite: false },
      },
    });
    expect(chosen.text).not.toContain("C:\\Private\\Demo");

    const recents = await request(server, "GET", "/workspace/recent", undefined, "Bearer secret", "recent-1");
    expect(recents.status).toBe(200);
    expect(JSON.parse(recents.text)).toMatchObject({
      type: "workspace.recent.list.result",
      requestId: "recent-1",
      workspaces: [{ workspaceId: "ws_demo", label: "Demo" }],
    });
    expect(recents.text).not.toContain("path");
    expect(recents.text).not.toContain("C:\\Private\\Demo");
  });

  it("revalidates opaque ids, activates once per idempotency key, and returns connection metadata", async () => {
    let activations = 0;
    const broker = createWorkspaceBroker({
      picker: { pick: async () => ({ status: "cancelled" }) },
      registry: {
        open: () => { throw new Error("unused"); },
        list: () => [],
        resolve: (id: string) => id === "ws_demo" ? { id, path: "C:\\Private\\Demo", pinned: false } : null,
        pin: () => null,
        remove: () => false,
      },
      activateWorkspace: async (workspacePath: string) => { activations += 1; expect(workspacePath).toBe("C:\\Private\\Demo"); },
      hostPort: 4174,
      token: "connection-token",
    });
    const server = createStaticServer(path.resolve(__dirname, "../../dist"), { token: "secret", workspaceBroker: broker });
    servers.push(server);
    const payload = JSON.stringify({ type: "workspace.activate", requestId: "activate-1", workspaceId: "ws_demo", idempotencyKey: "same-operation" });
    const first = await request(server, "POST", "/workspace/activate", payload, "Bearer secret", "activate-1");
    const second = await request(server, "POST", "/workspace/activate", payload, "Bearer secret", "activate-1");
    expect(first.status).toBe(200);
    expect(JSON.parse(first.text)).toMatchObject({ type: "workspace.activate.result", requestId: "activate-1", connection: { port: 4174, token: "connection-token", generation: 2 } });
    expect(second.text).toBe(first.text);
    expect(activations).toBe(1);
    expect(first.text).not.toContain("C:\\Private\\Demo");
  });
});

function request(server: http.Server, method: string, requestPath: string, body?: string, authorization?: string, requestId?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number } | null;
    if (!address) { server.listen(0, "127.0.0.1", () => request(server, method, requestPath, body, authorization, requestId).then(resolve, reject)); return; }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;
    if (requestId) headers["x-request-id"] = requestId;
    const req = http.request({ host: "127.0.0.1", port: address.port, path: requestPath, method, headers }, (response) => {
      let text = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { text += chunk; }); response.on("end", () => resolve({ status: response.statusCode || 0, text }));
    });
    req.on("error", reject); req.end(body);
  });
}

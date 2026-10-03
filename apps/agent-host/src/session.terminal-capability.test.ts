import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { attachAgentSession } from "./session";

class TestSocket extends EventEmitter {
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
}

const workspaceDescriptor = {
  id: "workspace-test",
  name: "Test workspace",
  displayPath: "workspace-test",
  generation: 1,
  capabilities: {
    read: true,
    stat: true,
    watch: true,
    search: true,
    git: true,
    terminal: true,
    subagents: true,
    memory: true,
    reviewedWrite: false,
  },
} as const;

describe("direct interactive terminal capability boundary", () => {
  it("rejects agent-originated terminal.create by default", async () => {
    const socket = new TestSocket();
    const createSession = vi.fn().mockResolvedValue({ id: "pty-1" });
    attachAgentSession(socket as never, { hostId: "host-test" }, {
      workspaceRoot: process.cwd(),
      workspaceDescriptor,
      ptyManager: { createSession, on: vi.fn(), off: vi.fn() } as never,
    });

    socket.emit("message", JSON.stringify({
      type: "terminal.create",
      id: "pty-1",
      cwd: ".",
    }));
    await Promise.resolve();

    expect(createSession).not.toHaveBeenCalled();
    expect(socket.sent).toContainEqual({
      type: "error",
      code: "terminal_interactive_denied",
      message: "Direct interactive terminal creation is disabled by host policy",
      at: expect.any(String),
    });
  });
});

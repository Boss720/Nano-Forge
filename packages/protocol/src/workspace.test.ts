import { describe, expect, it } from "vitest";
import {
  workspaceDescriptorSchema,
  workspaceOpenRequestSchema,
  workspaceReadySchema,
  workspaceErrorSchema,
  workspaceWriteRequestSchema,
} from "./workspace";

describe("workspace protocol", () => {
  const descriptor = {
    id: "workspace-0123456789abcdef",
    name: "alpha",
    displayPath: "C:\\projects\\alpha",
    generation: 2,
    capabilities: {
      read: true,
      stat: true,
      watch: true,
      search: true,
      git: true,
      terminal: true,
      subagents: true,
      memory: true,
      reviewedWrite: true,
    },
  };

  it("validates descriptors and ready frames", () => {
    expect(workspaceDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(workspaceReadySchema.parse({
      type: "workspace.ready",
      requestId: "req-1",
      workspace: descriptor,
      at: "2026-08-22T12:00:00.000Z",
    }).workspace.generation).toBe(2);
  });

  it("requires generation-aware open and write requests", () => {
    expect(workspaceOpenRequestSchema.safeParse({
      type: "workspace.open",
      requestId: "req-open",
      path: "C:\\projects\\alpha",
      generation: 1,
    }).success).toBe(true);
    expect(workspaceWriteRequestSchema.safeParse({
      type: "workspace.writeFile",
      requestId: "req-write",
      path: "src/index.ts",
      content: "next",
      generation: 2,
      expectedSha256: "a".repeat(64),
      expectedModified: "2026-08-22T12:00:00.000Z",
    }).success).toBe(true);
  });

  it("carries correlated structured workspace errors", () => {
    const parsed = workspaceErrorSchema.parse({
      type: "workspace.error",
      requestId: "req-2",
      code: "stale_generation",
      message: "Workspace generation is stale",
      generation: 3,
      recoverable: true,
      at: "2026-08-22T12:00:00.000Z",
    });
    expect(parsed.requestId).toBe("req-2");
  });
});

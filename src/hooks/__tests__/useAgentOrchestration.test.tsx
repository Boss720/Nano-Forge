// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useAgentOrchestration, type UseAgentOrchestrationProps } from "@/hooks/useAgentOrchestration";
import type { ConnectionState, Patch, Session, UsageRun, UsageTotals, VirtualFile } from "@/types";

afterEach(() => vi.restoreAllMocks());

const connection: ConnectionState = {
  apiKey: "",
  baseUrl: "https://nano-gpt.com/api/v1",
  status: "disconnected",
  liveModels: false,
};

const patch: Patch = {
  file: "src/demo.ts",
  lines: [
    { type: "ctx", text: "const ready = false;" },
    { type: "add", text: "const live = true;" },
  ],
  status: "pending",
};

const session: Session = {
  id: "session-1",
  title: "Demo",
  model: "model-1",
  createdAt: 1,
  messages: [
    { id: "assistant-1", role: "assistant", content: "Here is a patch.", ts: 1, patch },
  ],
};

function useHarness(
  capability: UseAgentOrchestrationProps["workspaceWriteCapability"],
  readWorkspaceFile: NonNullable<UseAgentOrchestrationProps["readWorkspaceFile"]>,
  writeWorkspaceFile: NonNullable<UseAgentOrchestrationProps["writeWorkspaceFile"]>,
) {
  const [files, setFiles] = useState<VirtualFile[]>([
    { path: patch.file, language: "typescript", content: "const ready = false;" },
  ]);
  const [sessions, setSessions] = useState<Session[]>([session]);
  const [, setUsage] = useState<UsageTotals>({ input: 0, output: 0, costUsd: 0, requests: 0 });
  const [, setRuns] = useState<UsageRun[]>([]);

  return {
    files,
    sessions,
    ...useAgentOrchestration({
      session,
      connected: false,
      connection,
      selectedModel: "model-1",
      genPrefs: { temperature: 0.3, maxTokens: 100 },
      files,
      setFiles,
      setSessions,
      setUsage,
      setRuns,
      artifactsManager: { addPatchArtifact: vi.fn() },
      readWorkspaceFile,
      writeWorkspaceFile,
      workspaceWriteCapability: capability,
    }),
  };
}

describe("useAgentOrchestration workspace write gate", () => {
  it("keeps accepted patches virtual when live capability is not supplied", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: patch.file,
      content: "const ready = false;",
      language: "typescript",
      size: 20,
    }));
    const writeWorkspaceFile = vi.fn(async () => undefined);
    const { result } = renderHook(() => useHarness("virtual", readWorkspaceFile, writeWorkspaceFile));

    result.current.handlePatchDecision("assistant-1", "applied");

    await waitFor(() => expect(result.current.files[0].content).toContain("const live = true;"));
    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("writes only when App explicitly supplies the live capability", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: patch.file,
      content: "const ready = false;",
      language: "typescript",
      size: 20,
    }));
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useHarness("live", readWorkspaceFile, writeWorkspaceFile));

    result.current.handlePatchDecision("assistant-1", "applied");

    await waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledWith(patch.file, "const ready = false;\nconst live = true;"));
    expect(readWorkspaceFile).toHaveBeenCalledWith(patch.file);
  });
});

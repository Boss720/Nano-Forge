import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  SlidingTokenBudget,
  ToolOutputPruner,
  StepSummarizer,
  ContextCompactor,
  RepositoryMapGenerator,
} from "@nanoforge/llm-router";
import { SubagentSupervisor } from "./supervisor.js";

describe("Subagent Context Compaction & Sliding Budget Integration", () => {
  let tmpWorkspace: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-compaction-test-"));
    supervisor = new SubagentSupervisor({ workspaceRoot: tmpWorkspace });
  });

  afterEach(async () => {
    await supervisor.dispose();
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("dynamically prunes oversized tool outputs and preserves prompt headroom", async () => {
    const budget = new SlidingTokenBudget({
      maxContextTokens: 4000,
      reservedOutputTokens: 1000,
      compactionWatermarkRatio: 0.75, // 2250 prompt tokens
    });

    const pruner = new ToolOutputPruner();

    // Simulate huge tool output with repeated lines and ANSI color codes
    const hugeOutputLines: string[] = [];
    for (let i = 0; i < 20; i++) {
      hugeOutputLines.push(`\u001b[33m[WARN]\u001b[0m Retrying service handshake...`);
    }
    for (let i = 0; i < 150; i++) {
      hugeOutputLines.push(`\u001b[32m[INFO]\u001b[0m Compiling module package_${i % 10}`);
    }
    const rawToolOutput = hugeOutputLines.join("\n");

    const pruned = pruner.prune(rawToolOutput, { maxTokens: 250 });
    expect(pruned.isTruncated).toBe(true);
    expect(pruned.tokensSaved).toBeGreaterThan(0);
    expect(pruned.content).not.toContain("\u001b");
    expect(pruned.content).toContain("repeated");

    budget.setZone("systemPrompt", 300);
    budget.setZone("activeStep", 200);
    budget.setZone("toolOutputs", pruned.prunedTokens);

    expect(budget.getTotalPromptTokens()).toBeLessThan(budget.maxPromptBudget);
    expect(budget.isCompactionNeeded()).toBe(false);
  });

  it("compacts context while strictly preserving critical architectural decisions and modified files", () => {
    const budget = new SlidingTokenBudget({
      maxContextTokens: 5000,
      reservedOutputTokens: 1000,
    });

    const compactor = new ContextCompactor();
    const repoGen = new RepositoryMapGenerator();

    const repoMap = repoGen.generate({
      projectName: "NanoForge",
      runtime: "Node.js v22",
      branch: "main",
      packages: [
        { name: "@nanoforge/protocol", path: "packages/protocol" },
        { name: "@nanoforge/llm-router", path: "packages/llm-router" },
      ],
    });

    const result = compactor.compact(
      {
        systemPrompt: "You are the specialist test repair agent.",
        objective: "Fix regression in router test suite",
        requirements: ["Zero test failures", "Preserve wire protocol compatibility"],
        activeStep: {
          id: "step-1",
          title: "Repair candidate filter timeout",
          description: "Update filter with cached provider status",
        },
        relevantFiles: [
          {
            path: "packages/llm-router/src/routing/candidateFilter.ts",
            content: "export function filterCandidates() { return []; }",
          },
        ],
        recentChanges: [
          { path: "packages/llm-router/src/routing/candidateFilter.ts", action: "modified" },
        ],
        toolResults: [
          {
            toolId: "bash_exec",
            status: "error",
            summary: "Error: timeout waiting for provider response after 5000ms\nStack trace: ...",
            timestamp: Date.now(),
          },
        ],
        repoMap,
        completedTasks: [{ id: "step-0", title: "Audit router logs" }],
        decisions: [
          {
            id: "dec-1",
            decision: "Cache provider status",
            rationale: "Avoid network roundtrips during candidate evaluation",
            at: new Date().toISOString(),
          },
        ],
      },
      budget
    );

    // Verify critical elements are strictly preserved
    expect(result.renderedContext).toContain("You are the specialist test repair agent.");
    expect(result.renderedContext).toContain("Zero test failures");
    expect(result.renderedContext).toContain("Preserve wire protocol compatibility");
    expect(result.renderedContext).toContain("Cache provider status");
    expect(result.renderedContext).toContain("Avoid network roundtrips during candidate evaluation");
    expect(result.renderedContext).toContain("candidateFilter.ts");
    expect(result.renderedContext).toContain("REPOSITORY MAP");
  });

  it("tracks subagent token telemetry through multi-turn execution", async () => {
    const subagent = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "compaction_worker",
      prompt: "Execute long-running build tasks",
      budgetTokens: 50000,
    });

    expect(subagent.subagentId).toBeDefined();

    // Turn 1
    const telem1 = supervisor.recordTurnTelemetry(subagent.subagentId, {
      promptTokens: 2500,
      completionTokens: 800,
      turnLatencyMs: 450,
      toolExecutions: 2,
    });
    expect(telem1.totalTokens).toBe(3300);
    expect(telem1.turnCount).toBe(1);

    // Turn 2
    const telem2 = supervisor.recordTurnTelemetry(subagent.subagentId, {
      promptTokens: 3100,
      completionTokens: 1200,
      turnLatencyMs: 600,
      toolExecutions: 3,
    });
    expect(telem2.totalTokens).toBe(7600); // 3300 + 4300
    expect(telem2.turnCount).toBe(2);

    const node = supervisor.registry.get(subagent.subagentId);
    expect(node?.tokensUsed).toBe(7600);
    expect(node?.turnCount).toBe(2);
    expect(node?.state).toBe("running");
  });
});

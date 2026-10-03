import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SubagentSupervisor } from "./supervisor.js";
import {
  SUBAGENT_ERROR_CODES,
  ARCHETYPE_DEFAULT_TIERS,
  TIER_DEFAULT_TOKEN_BUDGETS,
  MAX_CONCURRENT_PRO_SUBAGENTS,
} from "@protocol/subagents";
import { LLMRouter, ModelRegistry, ModelDescriptor } from "@nanoforge/llm-router";

describe("Sub-Agent Model Assignment & Tier-Based Specialization (Phase 7)", () => {
  let tmpRoot: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-subagent-routing-test-"));
    supervisor = new SubagentSupervisor({ workspaceRoot: tmpRoot });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("automatically assigns model tiers and token budgets based on archetype defaults", async () => {
    // 1. Explorer -> flash_lite, 25k tokens
    const explorer = await supervisor.spawnSubagent({
      archetype: "explorer",
      name: "scout_1",
      prompt: "Explore repository structure and list top-level packages",
    });
    expect(explorer.modelTier).toBe("flash_lite");
    const explorerNode = supervisor.registry.get(explorer.subagentId)!;
    expect(explorerNode.modelTier).toBe("flash_lite");
    expect(explorerNode.budgetTokens).toBe(TIER_DEFAULT_TOKEN_BUDGETS.flash_lite);
    expect(explorerNode.model).toBe("gemini-2.0-flash-lite");

    // 2. Implementer -> flash, 100k tokens
    const implementer = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "coder_1",
      prompt: "Implement Fastify route handlers",
    });
    expect(implementer.modelTier).toBe("flash");
    const implementerNode = supervisor.registry.get(implementer.subagentId)!;
    expect(implementerNode.modelTier).toBe("flash");
    expect(implementerNode.budgetTokens).toBe(TIER_DEFAULT_TOKEN_BUDGETS.flash);
    expect(implementerNode.model).toBe("gemini-2.0-flash");

    // 3. Planner -> pro, 250k tokens
    const planner = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "architect_1",
      prompt: "Decompose mission into DAG execution plan",
    });
    expect(planner.modelTier).toBe("pro");
    const plannerNode = supervisor.registry.get(planner.subagentId)!;
    expect(plannerNode.modelTier).toBe("pro");
    expect(plannerNode.budgetTokens).toBe(TIER_DEFAULT_TOKEN_BUDGETS.pro);
    expect(plannerNode.model).toBe("gemini-2.5-pro");
  });

  it("honors explicit model and modelTier overrides", async () => {
    const custom = await supervisor.spawnSubagent({
      archetype: "explorer",
      name: "override_scout",
      prompt: "Inspect code",
      model: "custom-local-model:latest",
      modelTier: "flash",
      budgetTokens: 50_000,
    });

    expect(custom.model).toBe("custom-local-model:latest");
    expect(custom.modelTier).toBe("flash");

    const node = supervisor.registry.get(custom.subagentId)!;
    expect(node.model).toBe("custom-local-model:latest");
    expect(node.modelTier).toBe("flash");
    expect(node.budgetTokens).toBe(50_000);
    expect(node.routingDecision?.providerId).toBe("override");
  });

  it("inherits model tier from parent agent when modelTier is 'inherit'", async () => {
    const parent = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "parent_planner",
      prompt: "Lead architect task",
      modelTier: "pro",
    });
    expect(parent.modelTier).toBe("pro");

    const child = await supervisor.spawnSubagent(
      {
        archetype: "implementer",
        name: "child_worker",
        prompt: "Worker child task",
        modelTier: "inherit",
      },
      parent.subagentId
    );

    expect(child.modelTier).toBe("pro");
    const childNode = supervisor.registry.get(child.subagentId)!;
    expect(childNode.modelTier).toBe("pro");
  });

  it("integrates LLMRouter to dynamically route models with capability floor", async () => {
    const registry = new ModelRegistry();
    const defaultRuntime = {
      latency: 50,
      tokensPerSecond: 100,
      successRate: 1.0,
      recentFailures: 0,
      rateLimitedUntil: null,
      remainingQuota: null,
    };

    const flashLiteModel: ModelDescriptor = {
      providerId: "ollama",
      modelId: "qwen2.5-coder:1.5b",
      displayName: "Qwen 2.5 Coder 1.5B (Local)",
      availability: "available",
      pricing: { isFree: true, inputCostPer1k: 0, outputCostPer1k: 0, currency: "USD" },
      contextWindow: 32768,
      maxOutputTokens: 8192,
      capabilities: {
        coding: true,
        reasoning: false,
        vision: false,
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
      },
      estimatedQuality: {
        coding: 0.5,
        reasoning: 0.3,
        debugging: 0.4,
        planning: 0.2,
        summarization: 0.6,
        classification: 0.7,
      },
      runtime: defaultRuntime,
    };

    const flashModel: ModelDescriptor = {
      providerId: "google",
      modelId: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      availability: "available",
      pricing: { isFree: true, inputCostPer1k: 0, outputCostPer1k: 0, currency: "USD" },
      contextWindow: 1048576,
      maxOutputTokens: 8192,
      capabilities: {
        coding: true,
        reasoning: true,
        vision: true,
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
      },
      estimatedQuality: {
        coding: 0.85,
        reasoning: 0.8,
        debugging: 0.85,
        planning: 0.75,
        summarization: 0.85,
        classification: 0.9,
      },
      runtime: defaultRuntime,
    };

    const proModel: ModelDescriptor = {
      providerId: "google",
      modelId: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      availability: "available",
      pricing: { isFree: true, inputCostPer1k: 0, outputCostPer1k: 0, currency: "USD" },
      contextWindow: 2097152,
      maxOutputTokens: 8192,
      capabilities: {
        coding: true,
        reasoning: true,
        vision: true,
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
      },
      estimatedQuality: {
        coding: 0.95,
        reasoning: 0.98,
        debugging: 0.95,
        planning: 0.95,
        summarization: 0.95,
        classification: 0.95,
      },
      runtime: defaultRuntime,
    };

    registry.registerModel(flashLiteModel);
    registry.registerModel(flashModel);
    registry.registerModel(proModel);

    const router = new LLMRouter(registry);
    const routerSupervisor = new SubagentSupervisor({
      workspaceRoot: tmpRoot,
      router,
    });

    // 1. Spawning explorer should select local/light model
    const scout = await routerSupervisor.spawnSubagent({
      archetype: "explorer",
      name: "smart_scout",
      prompt: "Find all test files in the directory",
    });
    expect(scout.modelTier).toBe("flash_lite");
    const scoutNode = routerSupervisor.registry.get(scout.subagentId)!;
    expect(scoutNode.model).toBe("qwen2.5-coder:1.5b");
    expect(scoutNode.routingDecision).toBeDefined();
    expect(scoutNode.routingDecision?.providerId).toBe("ollama");

    // 2. Spawning planner should select pro model
    const architect = await routerSupervisor.spawnSubagent({
      archetype: "planner",
      name: "smart_planner",
      prompt: "Architectural design and threat model analysis for auth subsystem",
    });
    expect(architect.modelTier).toBe("pro");
    const architectNode = routerSupervisor.registry.get(architect.subagentId)!;
    expect(architectNode.model).toBe("gemini-2.5-pro");
    expect(architectNode.routingDecision?.modelId).toBe("gemini-2.5-pro");

    // Summary reflection
    const summary = routerSupervisor.registry.getSummary(architect.subagentId)!;
    expect(summary.modelTier).toBe("pro");
    expect(summary.model).toBe("gemini-2.5-pro");
    expect(summary.routingDecision?.modelId).toBe("gemini-2.5-pro");
  });

  it("enforces pro tier concurrency limits (max 2 active pro agents)", async () => {
    // Spawn 1st pro subagent
    const pro1 = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "pro_1",
      prompt: "Plan task 1",
      modelTier: "pro",
    });
    expect(pro1.modelTier).toBe("pro");

    // Spawn 2nd pro subagent
    const pro2 = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "pro_2",
      prompt: "Plan task 2",
      modelTier: "pro",
    });
    expect(pro2.modelTier).toBe("pro");

    // Attempt 3rd pro subagent - must be rejected
    await expect(
      supervisor.spawnSubagent({
        archetype: "planner",
        name: "pro_3",
        prompt: "Plan task 3",
        modelTier: "pro",
      })
    ).rejects.toThrow(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_PRO_CONCURRENCY_EXCEEDED);

    // Non-pro subagents can still be spawned concurrently
    const light = await supervisor.spawnSubagent({
      archetype: "explorer",
      name: "light_agent",
      prompt: "Explore files",
    });
    expect(light.modelTier).toBe("flash_lite");

    // Terminate one pro subagent
    await supervisor.manageSubagents({
      action: "kill",
      subagentId: pro1.subagentId,
    });

    // Now spawning a 3rd pro subagent should succeed
    const pro3 = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "pro_3_retry",
      prompt: "Plan task 3 after pro_1 terminated",
      modelTier: "pro",
    });
    expect(pro3.modelTier).toBe("pro");
  });

  it("escalates model tier on failure ladder replace rung (flash_lite -> flash -> pro)", async () => {
    // 1. Start with a flash_lite subagent
    const initial = await supervisor.spawnSubagent({
      archetype: "explorer",
      name: "fragile_scout",
      prompt: "Parse complex AST",
      modelTier: "flash_lite",
    });
    expect(initial.modelTier).toBe("flash_lite");

    // Escalate on failure
    const step1 = await supervisor.escalateFailure(
      initial.subagentId,
      "MODEL_INCAPABLE: Syntax tree too complex for Tier 0 model",
      "replace"
    );
    expect(step1.rung).toBe("replace");
    expect(step1.replacementSubagentId).toBeDefined();

    const clone1 = supervisor.registry.get(step1.replacementSubagentId!)!;
    expect(clone1.modelTier).toBe("flash"); // Escalated to flash!

    // Escalate clone1 on failure
    const step2 = await supervisor.escalateFailure(
      clone1.id,
      "LOW_CONFIDENCE: Edge cases ambiguous across cross-package boundaries",
      "replace"
    );
    expect(step2.rung).toBe("replace");
    const clone2 = supervisor.registry.get(step2.replacementSubagentId!)!;
    expect(clone2.modelTier).toBe("pro"); // Escalated to pro!
  });
});

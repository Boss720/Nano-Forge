/**
 * @file packages/llm-router/tests/empirical-challenger.test.ts
 * Empirical Challenger Stress Harness for AgentState, Compact Handoff, and 429 Failover Integration.
 */

import { describe, expect, it } from "vitest";
import { AgentStateManager } from "../src/context/agentState.js";
import { CompactHandoffEngine } from "../src/context/handoff.js";
import { ModelRegistry } from "../src/registry/modelRegistry.js";
import { LLMRouter } from "../src/routing/router.js";
import { BaseLLMProvider } from "../src/providers/base.js";
import {
  LLMEvent,
  LLMProviderError,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
} from "../src/providers/types.js";

class MockTestProvider extends BaseLLMProvider {
  private handler?: (req: LLMRequest) => Promise<LLMResponse>;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly models: ModelDescriptor[]
  ) {
    super();
  }

  setHandler(handler: (req: LLMRequest) => Promise<LLMResponse>): void {
    this.handler = handler;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return this.models;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, latencyMs: 10, checkedAt: Date.now() };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (this.handler) return this.handler(request);
    return {
      providerId: this.id,
      modelId: request.modelId,
      text: `Success from ${this.id}:${request.modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 20, completionTokens: 40, totalTokens: 60 },
      latencyMs: 15,
    };
  }

  async *stream(_request: LLMRequest): AsyncIterable<LLMEvent> {
    yield { type: "text_delta", text: "ok" };
    yield { type: "done", finishReason: "stop" };
  }
}

function makeModel(providerId: string, modelId: string, quality: number, latency: number): ModelDescriptor {
  return {
    providerId,
    modelId,
    displayName: `${providerId} - ${modelId}`,
    availability: "available",
    pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
    contextWindow: 65536,
    maxOutputTokens: 4096,
    capabilities: {
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    estimatedQuality: {
      coding: quality,
      reasoning: quality,
      debugging: quality,
      planning: quality,
      summarization: quality,
      classification: quality,
    },
    runtime: {
      latency,
      tokensPerSecond: 100,
      successRate: 1.0,
      recentFailures: 0,
      rateLimitedUntil: null,
      remainingQuota: null,
    },
  };
}

describe("Empirical Challenge 1: Compact Handoff Word and Token Hard Budget Bounds", () => {
  const engine = new CompactHandoffEngine();

  it("verifies word count < 250 and token count < 500 on small state", () => {
    const manager = new AgentStateManager("Implement login page styling", {
      requirements: ["Responsive layout", "Accessible color contrast"],
    });
    manager.addPlanTask({ id: "t1", title: "Create CSS module", description: "Scoped button styles" });
    manager.completeTask("t1");
    manager.addPlanTask({ id: "t2", title: "Add responsive media query" }, "active");
    manager.recordChange({ path: "src/login.module.css", action: "created", notes: "Scoped classes" });
    manager.recordDecision("CSS Modules", "Avoid global namespace collisions");

    const handoff = engine.generateHandoff(manager.getState());
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const tokens = Math.ceil(handoff.length / 3);

    expect(words).toBeLessThan(250);
    expect(tokens).toBeLessThan(500);
  });

  it("verifies word count < 250 and token count < 500 on moderate state (15 tasks, 12 files, 6 decisions)", () => {
    const manager = new AgentStateManager("Refactor API gateway microservice architecture", {
      requirements: [
        "Zero downtime rolling deployment support",
        "OpenTelemetry distributed tracing",
        "JWT token validation with public key rotation",
      ],
      constraints: ["Strict 50ms latency ceiling", "Backward compatible endpoints"],
    });

    for (let i = 1; i <= 15; i++) {
      manager.addPlanTask({
        id: `task_${i}`,
        title: `Implement gateway subsystem module ${i}`,
        description: `Complete subsystem implementation with comprehensive unit tests for module ${i}`,
      });
      manager.completeTask(`task_${i}`);
    }

    manager.addPlanTask({ id: "active_task", title: "Configure Redis distributed rate limiting" }, "active");

    for (let i = 1; i <= 12; i++) {
      manager.recordChange({
        path: `packages/gateway/src/subsystems/module_${i}.ts`,
        action: i % 2 === 0 ? "modified" : "created",
        notes: `Subsystem module ${i} logic implementation`,
      });
    }

    for (let i = 1; i <= 6; i++) {
      manager.recordDecision(`Architecture decision ${i}`, `Technical justification for design choice ${i}`);
    }

    manager.recordError("RATE_LIMIT", "Provider primary hit 429 quota exhaustion; cooldown activated", false);

    const handoff = engine.generateHandoff(manager.getState(), "Resume active task on alternate model");
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const tokens = Math.ceil(handoff.length / 3);

    expect(words).toBeLessThan(250);
    expect(tokens).toBeLessThan(500);

    const parsed = engine.parseHandoff(handoff);
    expect(parsed.completedTasks).toHaveLength(5);
    expect(parsed.relevantFiles.length).toBeLessThanOrEqual(5);
    expect(parsed.decisions.length).toBeLessThanOrEqual(3);
    expect(parsed.knownFailures.length).toBeGreaterThan(0);
  });

  it("verifies word count < 250 and token count < 500 on massive state (500 tasks, 500 files, 100 decisions, 100 errors)", () => {
    const manager = new AgentStateManager("Enterprise-scale database migration across 50 regional clusters", {
      requirements: Array.from({ length: 50 }, (_, i) => `Requirement ${i}: Strict compliance with regulation ${i}`),
    });

    for (let i = 1; i <= 500; i++) {
      manager.addPlanTask({
        id: `task_${i}`,
        title: `Migrate regional shard database table ${i}`,
        description: `Run schema alteration, checksum validation, and rollback rehearsal for table ${i}`,
      });
      manager.completeTask(`task_${i}`);
    }

    manager.addPlanTask({ id: "massive_active", title: "Validate cross-cluster eventual consistency" }, "active");

    for (let i = 1; i <= 500; i++) {
      manager.recordChange({
        path: `migrations/v2/shard_${i}/schema_ddl_${i}.sql`,
        action: "created",
        notes: `DDL definition for shard ${i}`,
      });
    }

    for (let i = 1; i <= 100; i++) {
      manager.recordDecision(`Consensus policy ${i}`, `Raft election timeout tuned for shard ${i}`);
    }

    for (let i = 1; i <= 100; i++) {
      manager.recordError(`ERR_${i}`, `Simulated cluster replication timeout on node ${i}`);
    }

    const handoff = engine.generateHandoff(manager.getState());
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const tokens = Math.ceil(handoff.length / 3);

    expect(words).toBeLessThan(250);
    expect(tokens).toBeLessThan(500);

    const parsed = engine.parseHandoff(handoff);
    expect(parsed.completedTasks).toHaveLength(5);
    // Truncated to 40 characters in compact mode
    expect(parsed.currentTask).toBe("Validate cross-cluster eventual consi...");
  });

  it("demonstrates word count inflation under adversarial high word-density text", () => {
    // Generate text composed of single-character words separated by spaces: "a b c d e f ..."
    const maxDensityString = Array.from({ length: 80 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(" ");

    const manager = new AgentStateManager(maxDensityString, {
      requirements: [maxDensityString, maxDensityString, maxDensityString, maxDensityString],
      constraints: [maxDensityString, maxDensityString],
    });

    for (let i = 1; i <= 20; i++) {
      manager.addPlanTask({
        id: `t_${i}`,
        title: maxDensityString,
        description: maxDensityString,
      });
      manager.completeTask(`t_${i}`);
    }

    manager.addPlanTask({ id: "t_act", title: maxDensityString, description: maxDensityString }, "active");

    for (let i = 1; i <= 20; i++) {
      manager.recordChange({
        path: `src/${maxDensityString.slice(0, 30).replace(/\s/g, "_")}_${i}.ts`,
        action: "modified",
        notes: maxDensityString,
      });
    }

    for (let i = 1; i <= 10; i++) {
      manager.recordDecision(maxDensityString, maxDensityString);
    }

    for (let i = 1; i <= 10; i++) {
      manager.recordError("ERR", maxDensityString, false);
    }

    const handoff = engine.generateHandoff(manager.getState(), maxDensityString);
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const tokens = Math.ceil(handoff.length / 3);

    // Finding: Character truncation maintains token count < 500, but high-density single-letter words reach 483 words
    expect(tokens).toBeLessThan(500);
    expect(words).toBeGreaterThan(250); // Empirically reveals that word count has no final clamp
  });

  it("adversarially stress tests pathological multibyte Unicode and CJK characters", () => {
    const unicodeString = "🚀 データベース 移行 🔐 暗号化 テスト ⚡ 高速化 漢字 ひらがな カタカナ";
    const manager = new AgentStateManager(unicodeString, {
      requirements: [unicodeString, unicodeString],
    });

    for (let i = 1; i <= 10; i++) {
      manager.addPlanTask({ id: `u_${i}`, title: `${unicodeString} ${i}`, description: unicodeString });
      manager.completeTask(`u_${i}`);
    }

    manager.addPlanTask({ id: "u_act", title: `${unicodeString} active` }, "active");
    manager.recordChange({ path: `パス/ファイル_${unicodeString.slice(0, 10)}.ts`, action: "created" });
    manager.recordDecision(unicodeString, unicodeString);
    manager.recordError("ERR_UNICODE", unicodeString);

    const handoff = engine.generateHandoff(manager.getState());
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const tokens = Math.ceil(handoff.length / 3);

    expect(words).toBeLessThan(250);
    expect(tokens).toBeLessThan(500);

    const parsed = engine.parseHandoff(handoff);
    expect(parsed.completedTasks.length).toBeGreaterThan(0);
    expect(parsed.currentTask).toContain("データベース");
  });
});

describe("Empirical Challenge 2: Sequential Cascading 429 Failover Resilience", () => {
  it("survives 5-stage sequential cascading failover (P1 -> P2 -> P3 -> P4 -> P5) on STANDARD tasks", async () => {
    const registry = new ModelRegistry();
    const handoffEngine = new CompactHandoffEngine();

    // Setup 5 providers with descending preference (quality 0.95 down to 0.75, latency 10ms to 50ms)
    // For STANDARD task (floor 0.6), all are eligible and ranked 1 -> 2 -> 3 -> 4 -> 5
    const providers: MockTestProvider[] = [];
    for (let i = 1; i <= 5; i++) {
      const model = makeModel(`provider-${i}`, `model-${i}`, 1.0 - i * 0.05, i * 10);
      const provider = new MockTestProvider(`provider-${i}`, `Provider ${i}`, [model]);
      providers.push(provider);
      registry.registerProvider(provider);
    }
    await registry.refreshModels();

    const router = new LLMRouter(registry);

    // Initial state
    const stateManager = new AgentStateManager("Multi-cloud orchestrator deployment", {
      requirements: ["Resilience across 5 cloud providers", "Zero data loss during cascading failure"],
    });

    for (let i = 1; i <= 5; i++) {
      stateManager.addPlanTask({ id: `step_${i}`, title: `Execute multi-cloud phase ${i}` });
    }

    // Step 1: Provider 1 completes
    stateManager.activateTask("step_1");
    stateManager.recordChange({ path: "infra/p1.tf", action: "created" });
    stateManager.recordDecision("Terraform modules", "Standardized IaC across cloud providers");
    stateManager.completeTask("step_1");
    stateManager.recordModelUsage("model-1", 100, 0);

    // Step 2: Providers 1, 2, 3, 4 all throw HTTP 429 sequentially!
    stateManager.activateTask("step_2");

    providers[0].setHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider 1 rate limit 429", true, 30000);
    });
    providers[1].setHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider 2 rate limit 429", true, 30000);
    });
    providers[2].setHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider 3 rate limit 429", true, 30000);
    });
    providers[3].setHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider 4 rate limit 429", true, 30000);
    });
    // Provider 5 succeeds
    providers[4].setHandler(async (req) => {
      return {
        providerId: "provider-5",
        modelId: req.modelId,
        text: "Step 2 executed successfully by Provider 5",
        finishReason: "stop",
        usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        latencyMs: 50,
      };
    });

    // STANDARD complexity prompt (length > 30, no keywords) ensures ranking is 1 -> 2 -> 3 -> 4 -> 5
    const execResult = await router.execute({
      modelId: "auto",
      messages: [{ role: "user", content: "Implement cloud deployment orchestrator service module" }],
    });

    // Verify 4 failovers recorded in sequence
    expect(execResult.providerId).toBe("provider-5");
    expect(execResult.modelId).toBe("model-5");
    expect(execResult.failovers).toHaveLength(4);
    expect(execResult.failovers![0]).toContain("model-1");
    expect(execResult.failovers![1]).toContain("model-2");
    expect(execResult.failovers![2]).toContain("model-3");
    expect(execResult.failovers![3]).toContain("model-4");

    // Record failover handoff
    stateManager.recordError("RATE_LIMIT", "Cascading 429 across providers 1-4", false);
    const handoff = handoffEngine.generateHandoff(stateManager.getState(), "Resume step 2 with provider 5");
    const parsed = handoffEngine.parseHandoff(handoff);

    expect(parsed.completedTasks).toContain("Execute multi-cloud phase 1");
    expect(parsed.currentTask).toContain("Execute multi-cloud phase 2");

    // Complete Step 2 with Provider 5
    stateManager.recordChange({ path: "infra/p2.tf", action: "created" });
    stateManager.completeTask("step_2");
    stateManager.recordModelUsage("model-5", 100, 0);

    // Verify all 4 throttled models are in cooldown
    for (let i = 1; i <= 4; i++) {
      const m = registry.getModel(`provider-${i}`, `model-${i}`);
      expect(m?.runtime.rateLimitedUntil).toBeGreaterThan(Date.now());
    }

    // Zero data loss & no restart invariants
    const state = stateManager.getState();
    expect(state.plan.completed.map((t) => t.id)).toEqual(["step_1", "step_2"]);
    expect(state.plan.pending.map((t) => t.id)).toEqual(["step_3", "step_4", "step_5"]);
    expect(state.plan.active).toHaveLength(0);
    expect(state.changes).toHaveLength(2);
    expect(state.decisions).toHaveLength(1);
    expect(state.modelHistory).toHaveLength(2);
  });

  it("verifies state preservation when all available models fail with 429", async () => {
    const registry = new ModelRegistry();
    const model1 = makeModel("p1", "m1", 0.9, 10);
    const p1 = new MockTestProvider("p1", "P1", [model1]);
    p1.setHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "P1 429", true, 60000);
    });

    registry.registerProvider(p1);
    await registry.refreshModels();

    const router = new LLMRouter(registry);
    const stateManager = new AgentStateManager("Critical task");
    stateManager.addPlanTask({ id: "t1", title: "Finished task" });
    stateManager.completeTask("t1");
    stateManager.recordChange({ path: "important.ts", action: "created" });
    stateManager.recordDecision("Important decision", "Safety first");

    // Execution fails because all models are rate limited
    await expect(
      router.execute({
        modelId: "auto",
        messages: [{ role: "user", content: "Implement standard task feature" }],
      })
    ).rejects.toThrow(LLMProviderError);

    // State is 100% intact
    const finalState = stateManager.getState();
    expect(finalState.plan.completed).toHaveLength(1);
    expect(finalState.changes).toHaveLength(1);
    expect(finalState.decisions).toHaveLength(1);
  });
});

describe("Empirical Challenge 3: Parsing Robustness (CRLF, Tabs, Bullets, Edge Cases)", () => {
  const engine = new CompactHandoffEngine();

  it("parses tab-separated headers correctly", () => {
    const input = [
      "##\tOBJECTIVE",
      "Tab separated objective test",
      "##\tCOMPLETED",
      "- [x] Tab task 1",
      "- [x] Tab task 2",
      "##\t\tCURRENT TASK",
      "- [ ] Tab active task",
      "## \t RELEVANT FILES",
      "- src/tab.ts (CREATED)",
      "##\t DECISIONS MADE",
      "- Tab decision (Rationale: Tab test)",
      "##\tKNOWN FAILURES & COOLDOWNS",
      "- [ERR] Tab failure",
      "##\tNEXT ACTION",
      "Tab next action",
    ].join("\n");

    const parsed = engine.parseHandoff(input);
    expect(parsed.objective).toBe("Tab separated objective test");
    expect(parsed.completedTasks).toEqual(["Tab task 1", "Tab task 2"]);
    expect(parsed.currentTask).toBe("Tab active task");
    expect(parsed.relevantFiles).toEqual(["src/tab.ts (CREATED)"]);
    expect(parsed.decisions).toEqual(["Tab decision (Rationale: Tab test)"]);
    expect(parsed.knownFailures).toEqual(["[ERR] Tab failure"]);
    expect(parsed.nextAction).toBe("Tab next action");
  });

  it("parses pure Windows CRLF and mixed line endings identically to LF", () => {
    const crlfInput =
      "## OBJECTIVE\r\nCRLF objective\r\n## COMPLETED\r\n- [x] CRLF task 1\r\n- [x] CRLF task 2\r\n## CURRENT TASK\r\n- [ ] CRLF active\r\n## RELEVANT FILES\r\n- crlf.ts (MODIFIED)\r\n## DECISIONS MADE\r\n- CRLF decision\r\n## KNOWN FAILURES & COOLDOWNS\r\n- [429] CRLF error\r\n## NEXT ACTION\r\nCRLF action\r\n";

    const parsed = engine.parseHandoff(crlfInput);
    expect(parsed.objective).toBe("CRLF objective");
    expect(parsed.completedTasks).toHaveLength(2);
    expect(parsed.currentTask).toBe("CRLF active");
    expect(parsed.relevantFiles).toEqual(["crlf.ts (MODIFIED)"]);
    expect(parsed.decisions).toEqual(["CRLF decision"]);
    expect(parsed.knownFailures).toEqual(["[429] CRLF error"]);
    expect(parsed.nextAction).toBe("CRLF action");

    // Mixed CRLF, LF, CR
    const mixedInput = "## OBJECTIVE\rMixed objective\n## COMPLETED\r\n- [x] Mixed task\n## NEXT ACTION\rFinish";
    const mixedParsed = engine.parseHandoff(mixedInput);
    expect(mixedParsed.objective).toBe("Mixed objective");
    expect(mixedParsed.completedTasks).toEqual(["Mixed task"]);
    expect(mixedParsed.nextAction).toBe("Finish");
  });

  it("parses deeply indented bullets, asterisks, and mixed whitespace", () => {
    const indentedInput = [
      "## COMPLETED",
      "  - [x] 2-space indented",
      "    - [x] 4-space indented",
      "\t- [x] Tab indented",
      "  * [x] Asterisk bullet with spaces",
      "* [X] Asterisk bullet with uppercase X",
      "- Plain bullet without checkbox",
    ].join("\n");

    const parsed = engine.parseHandoff(indentedInput);
    expect(parsed.completedTasks).toContain("2-space indented");
    expect(parsed.completedTasks).toContain("4-space indented");
    expect(parsed.completedTasks).toContain("Tab indented");
    expect(parsed.completedTasks).toContain("Asterisk bullet with spaces");
    expect(parsed.completedTasks).toContain("Asterisk bullet with uppercase X");
    expect(parsed.completedTasks).toContain("Plain bullet without checkbox");
  });

  it("handles case-insensitive sentinels and omission lines without polluting parsed results", () => {
    const sentinelInput = [
      "## OBJECTIVE",
      "Sentinel test",
      "## COMPLETED",
      "+ 25 earlier tasks omitted",
      "+ 10 earlier completed items omitted",
      "NONE YET.",
      "## CURRENT TASK",
      "NO ACTIVE TASK",
      "## RELEVANT FILES",
      "+ 5 earlier files omitted",
      "NO FILES MODIFIED YET.",
      "## DECISIONS MADE",
      "+ 3 earlier decisions omitted",
      "NO ARCHITECTURAL DECISIONS RECORDED.",
      "## KNOWN FAILURES & COOLDOWNS",
      "+ 2 earlier errors omitted",
      "NONE.",
    ].join("\n");

    const parsed = engine.parseHandoff(sentinelInput);
    expect(parsed.completedTasks).toEqual([]);
    expect(parsed.currentTask).toBe("");
    expect(parsed.relevantFiles).toEqual([]);
    expect(parsed.decisions).toEqual([]);
    expect(parsed.knownFailures).toEqual([]);
  });
});

describe("Empirical Challenge 4: AgentStateManager Boundary Invariants", () => {
  it("prevents state corruption when non-existent task is completed or activated", () => {
    const manager = new AgentStateManager("Resilience check");
    manager.addPlanTask({ id: "real_1", title: "Real task" });

    // Try completing a non-existent task
    manager.completeTask("non_existent");
    expect(manager.getState().plan.completed).toHaveLength(0);
    expect(manager.getState().plan.pending).toHaveLength(1);

    // Try activating a non-existent task
    manager.activateTask("non_existent");
    expect(manager.getState().plan.active).toHaveLength(0);
    expect(manager.getState().plan.pending).toHaveLength(1);
  });

  it("ensures model usage history aggregates multiple calls to same modelId", () => {
    const manager = new AgentStateManager("Usage check");
    manager.recordModelUsage("model-x", 100, 0.001);
    manager.recordModelUsage("model-y", 200, 0.002);
    manager.recordModelUsage("model-x", 300, 0.003);

    const history = manager.getState().modelHistory;
    expect(history).toHaveLength(2);
    const mx = history.find((m) => m.modelId === "model-x");
    expect(mx?.tokensUsed).toBe(400);
    expect(mx?.costUsd).toBeCloseTo(0.004);
  });
});

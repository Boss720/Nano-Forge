/**
 * @file packages/llm-router/tests/adversarial-handoff-failover.test.ts
 * Dedicated adversarial stress test suite for AgentState, compact handoff,
 * and 429 failover integration in packages/llm-router.
 *
 * Scope:
 * 1. Multi-provider sequential cascading failover (A -> B -> C) without data loss
 * 2. Edge-case markdown handoff parsing (extra whitespace, missing sections, unexpected characters)
 * 3. Word and token budget constraints across varying state sizes
 * 4. Task state immutability and round-trip preservation
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

/**
 * Controllable mock provider for testing sequential multi-provider failover
 */
class ControllableMockProvider extends BaseLLMProvider {
  private generateHandler?: (req: LLMRequest) => Promise<LLMResponse>;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly models: ModelDescriptor[]
  ) {
    super();
  }

  setGenerateHandler(handler: (req: LLMRequest) => Promise<LLMResponse>): void {
    this.generateHandler = handler;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return this.models;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, latencyMs: 15, checkedAt: Date.now() };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (this.generateHandler) {
      return this.generateHandler(request);
    }
    return {
      providerId: this.id,
      modelId: request.modelId,
      text: `Default response from ${this.id}:${request.modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 25, completionTokens: 50, totalTokens: 75 },
      latencyMs: 20,
    };
  }

  async *stream(_request: LLMRequest): AsyncIterable<LLMEvent> {
    yield { type: "text_delta", text: "chunk" };
    yield { type: "done", finishReason: "stop" };
  }
}

function createModelDescriptor(
  providerId: string,
  modelId: string,
  codingQuality: number,
  latency: number
): ModelDescriptor {
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
      coding: codingQuality,
      reasoning: 0.8,
      debugging: 0.8,
      planning: 0.8,
      summarization: 0.8,
      classification: 0.8,
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

describe("Adversarial Challenge: Multi-Provider Sequential Failover", () => {
  it("survives sequential 429 failover across 3 providers without data loss", async () => {
    const registry = new ModelRegistry();
    const handoffEngine = new CompactHandoffEngine();

    // Provider A: Primary (quality 0.90, latency 20ms)
    const modelA = createModelDescriptor("provider-a", "model-a", 0.90, 20);
    const providerA = new ControllableMockProvider("provider-a", "Provider A", [modelA]);

    // Provider B: Secondary (quality 0.85, latency 40ms)
    const modelB = createModelDescriptor("provider-b", "model-b", 0.85, 40);
    const providerB = new ControllableMockProvider("provider-b", "Provider B", [modelB]);

    // Provider C: Tertiary (quality 0.80, latency 60ms)
    const modelC = createModelDescriptor("provider-c", "model-c", 0.80, 60);
    const providerC = new ControllableMockProvider("provider-c", "Provider C", [modelC]);

    registry.registerProvider(providerA);
    registry.registerProvider(providerB);
    registry.registerProvider(providerC);
    await registry.refreshModels();

    const router = new LLMRouter(registry);

    // Initial state with 4-step plan
    const stateManager = new AgentStateManager("Implement multi-cloud failover pipeline", {
      requirements: ["Zero data loss on cascading 429", "Preserve token usage across all models"],
    });

    for (let i = 1; i <= 4; i++) {
      stateManager.addPlanTask({
        id: `step_${i}`,
        title: `Execute failover pipeline phase ${i}`,
        description: `Detailed implementation of phase ${i}`,
      });
    }

    // Step 1: Executes on Provider A
    stateManager.activateTask("step_1");
    const route1 = router.route("phase 1");
    expect(route1.selectedModel.modelId).toBe("model-a");

    stateManager.recordChange({
      path: "src/pipeline/phase1.ts",
      action: "created",
      notes: "Phase 1 initial scaffolding",
    });
    stateManager.recordDecision("Pipeline Scaffolding", "Modular design per phase");
    stateManager.completeTask("step_1");
    stateManager.recordModelUsage("model-a", 250, 0);

    // Step 2: Provider A encounters 429, fails over to B which ALSO encounters 429, then C succeeds
    stateManager.activateTask("step_2");

    // Configure Provider A to fail with 429
    providerA.setGenerateHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider A throttled 429", true, 45000);
    });

    // Configure Provider B to ALSO fail with 429
    providerB.setGenerateHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider B throttled 429", true, 60000);
    });

    // Configure Provider C to succeed
    providerC.setGenerateHandler(async (req) => {
      return {
        providerId: "provider-c",
        modelId: req.modelId,
        text: "Phase 2 completed by Provider C",
        finishReason: "stop",
        usage: { promptTokens: 60, completionTokens: 120, totalTokens: 180 },
        latencyMs: 70,
      };
    });

    // Execute via router.execute to test automatic multi-provider cascade
    const executeRes = await router.execute({
      modelId: "auto",
      messages: [{ role: "user", content: "Execute phase 2 of the pipeline" }],
    });

    // Verify Provider C succeeded after 2 sequential failovers
    expect(executeRes.providerId).toBe("provider-c");
    expect(executeRes.modelId).toBe("model-c");
    expect(executeRes.failovers).toHaveLength(2);
    expect(executeRes.failovers![0]).toContain("model-a");
    expect(executeRes.failovers![1]).toContain("model-b");

    // Record error events in state manager as would occur during agent failover
    stateManager.recordError("RATE_LIMIT", "Provider A throttled 429", false);
    stateManager.recordError("RATE_LIMIT", "Provider B throttled 429", false);

    // Generate handoff to simulate agent packet during failover
    const handoff = handoffEngine.generateHandoff(stateManager.getState(), "Resume Step 2 on Provider C");
    const parsedHandoff = handoffEngine.parseHandoff(handoff);
    expect(parsedHandoff.completedTasks).toContain("Execute failover pipeline phase 1: Detailed implementation of phase 1");
    expect(parsedHandoff.knownFailures).toHaveLength(2);

    // Complete Step 2 with Provider C
    stateManager.recordChange({
      path: "src/pipeline/phase2.ts",
      action: "created",
      notes: "Phase 2 implementation via Provider C",
    });
    stateManager.completeTask("step_2");
    stateManager.recordModelUsage("provider-c", 180, 0);

    // Step 3 & 4 executed by Provider C
    stateManager.activateTask("step_3");
    stateManager.recordChange({ path: "src/pipeline/phase3.ts", action: "created" });
    stateManager.completeTask("step_3");
    stateManager.recordModelUsage("provider-c", 150, 0);

    stateManager.activateTask("step_4");
    stateManager.recordChange({ path: "src/pipeline/phase4.ts", action: "created" });
    stateManager.completeTask("step_4");
    stateManager.recordModelUsage("provider-c", 160, 0);

    // Zero Data Loss Assertions
    const finalState = stateManager.getState();
    expect(finalState.plan.completed).toHaveLength(4);
    expect(finalState.plan.completed.map((t) => t.id)).toEqual(["step_1", "step_2", "step_3", "step_4"]);
    expect(finalState.plan.pending).toHaveLength(0);
    expect(finalState.plan.active).toHaveLength(0);

    // All file changes preserved
    expect(finalState.changes).toHaveLength(4);
    expect(finalState.relevantFiles).toHaveLength(4);

    // Model history tracks both Provider A and Provider C
    expect(finalState.modelHistory).toHaveLength(2);
    expect(finalState.modelHistory.find((m) => m.modelId === "model-a")?.tokensUsed).toBe(250);
    expect(finalState.modelHistory.find((m) => m.modelId === "provider-c")?.tokensUsed).toBe(490);

    // Both throttled providers are in active cooldown in ModelRegistry
    const modelAState = registry.getModel("provider-a", "model-a");
    const modelBState = registry.getModel("provider-b", "model-b");
    expect(modelAState?.runtime.rateLimitedUntil).toBeGreaterThan(Date.now());
    expect(modelBState?.runtime.rateLimitedUntil).toBeGreaterThan(Date.now());
  });

  it("handles catastrophic exhaustion when ALL available providers throw 429", async () => {
    const registry = new ModelRegistry();
    const modelA = createModelDescriptor("provider-a", "model-a", 0.9, 20);
    const modelB = createModelDescriptor("provider-b", "model-b", 0.8, 30);
    const providerA = new ControllableMockProvider("provider-a", "Provider A", [modelA]);
    const providerB = new ControllableMockProvider("provider-b", "Provider B", [modelB]);

    providerA.setGenerateHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider A 429", true, 30000);
    });
    providerB.setGenerateHandler(async () => {
      throw new LLMProviderError("RATE_LIMIT", "Provider B 429", true, 30000);
    });

    registry.registerProvider(providerA);
    registry.registerProvider(providerB);
    await registry.refreshModels();

    const router = new LLMRouter(registry);

    // Existing agent state before catastrophic crash
    const stateManager = new AgentStateManager("Mission critical deployment");
    stateManager.addPlanTask({ id: "t1", title: "Completed Task 1" });
    stateManager.completeTask("t1");
    stateManager.recordChange({ path: "config.yaml", action: "modified" });

    // Expect router.execute to rethrow the last 429 error
    await expect(
      router.execute({
        modelId: "auto",
        messages: [{ role: "user", content: "Task requiring generation" }],
      })
    ).rejects.toThrow(LLMProviderError);

    // Crucial: verify that the existing state was NOT corrupted by the provider crash
    const postCrashState = stateManager.getState();
    expect(postCrashState.plan.completed).toHaveLength(1);
    expect(postCrashState.plan.completed[0].id).toBe("t1");
    expect(postCrashState.changes).toHaveLength(1);
  });
});

describe("Adversarial Challenge: Edge-Case Markdown Handoff Parsing", () => {
  const engine = new CompactHandoffEngine();

  it("handles extra whitespace, multiple spaces, and carriage returns (CRLF)", () => {
    const rawMarkdown = [
      "# TASK HANDOFF REPORT\r\n",
      "##   OBJECTIVE   \r\n",
      "Deploy robust microservice gateway  \r\n",
      "\r\n",
      "##   COMPLETED   \r\n",
      "- [x] Task A: Setup database schema   \r\n",
      "- [x] Task B: Configure connection pooling\r\n",
      "\r\n",
      "##   CURRENT TASK   \r\n",
      "- [ ] Implement circuit breaker\r\n",
      "\r\n",
      "## RELEVANT FILES   \r\n",
      "- src/gateway.ts (MODIFIED): updated timeout handler   \r\n",
      "\r\n",
      "## DECISIONS MADE\r\n",
      "- Timeout strategy (Rationale: 5s timeout prevents cascading socket pool exhaustion)\r\n",
      "\r\n",
      "## KNOWN FAILURES & COOLDOWNS\r\n",
      "- [RATE_LIMIT] Provider A hit 429   \r\n",
      "\r\n",
      "## NEXT ACTION\r\n",
      "Proceed to integration testing\r\n",
    ].join("");

    const parsed = engine.parseHandoff(rawMarkdown);
    expect(parsed.objective).toBe("Deploy robust microservice gateway");
    expect(parsed.completedTasks).toHaveLength(2);
    expect(parsed.completedTasks[0]).toBe("Task A: Setup database schema");
    expect(parsed.completedTasks[1]).toBe("Task B: Configure connection pooling");
    expect(parsed.currentTask).toBe("Implement circuit breaker");
    expect(parsed.relevantFiles[0]).toContain("src/gateway.ts");
    expect(parsed.decisions[0]).toContain("Timeout strategy");
    expect(parsed.knownFailures[0]).toContain("[RATE_LIMIT] Provider A hit 429");
    expect(parsed.nextAction).toBe("Proceed to integration testing");
  });

  it("robustly handles tab headers, indented bullets, and case-insensitive sentinels", () => {
    // 1. Tab in header: ##\t is split cleanly
    const tabHeaderMarkdown = [
      "## OBJECTIVE",
      "Deploy gateway",
      "##\tCOMPLETED",
      "- [x] Should be completed",
    ].join("\n");

    const tabParsed = engine.parseHandoff(tabHeaderMarkdown);
    expect(tabParsed.completedTasks).toHaveLength(1);
    expect(tabParsed.completedTasks[0]).toBe("Should be completed");
    expect(tabParsed.objective).toBe("Deploy gateway");

    // 2. Indented bullet points: leading whitespace is stripped
    const indentedMarkdown = [
      "## COMPLETED",
      "- [x] First completed task",
      "  - [x] Second indented completed task",
    ].join("\n");

    const indentedParsed = engine.parseHandoff(indentedMarkdown);
    expect(indentedParsed.completedTasks[0]).toBe("First completed task");
    expect(indentedParsed.completedTasks[1]).toBe("Second indented completed task");

    // 3. Case-sensitivity of placeholder sentinel 'None yet.'
    const lowercaseSentinelMarkdown = [
      "## COMPLETED",
      "none yet.",
    ].join("\n");

    const sentinelParsed = engine.parseHandoff(lowercaseSentinelMarkdown);
    expect(sentinelParsed.completedTasks).toHaveLength(0);
  });

  it("handles completely empty, minimal, or missing markdown sections without throwing", () => {
    // Empty markdown
    const emptyParsed = engine.parseHandoff("");
    expect(emptyParsed.objective).toBe("");
    expect(emptyParsed.completedTasks).toEqual([]);
    expect(emptyParsed.currentTask).toBe("");
    expect(emptyParsed.relevantFiles).toEqual([]);
    expect(emptyParsed.decisions).toEqual([]);
    expect(emptyParsed.knownFailures).toEqual([]);
    expect(emptyParsed.nextAction).toBe("");

    // Markdown missing objective, completed, and nextAction
    const partialMarkdown = [
      "## RELEVANT FILES",
      "- config.json (READ)",
      "## DECISIONS MADE",
      "- Use Redis (Rationale: Speed)",
    ].join("\n");

    const partialParsed = engine.parseHandoff(partialMarkdown);
    expect(partialParsed.objective).toBe("");
    expect(partialParsed.completedTasks).toEqual([]);
    expect(partialParsed.relevantFiles).toEqual(["config.json (READ)"]);
    expect(partialParsed.decisions).toEqual(["Use Redis (Rationale: Speed)"]);
    expect(partialParsed.nextAction).toBe("");
  });

  it("handles unexpected sections and markdown formatting safely", () => {
    const markdownWithExtraSections = [
      "## OBJECTIVE",
      "Refactor authentication token parser",
      "## UNEXPECTED SECTION",
      "Some unrecognized arbitrary telemetry data",
      "## COMPLETED",
      "- [x] Parse JWT header",
      "## RAW PROMPT DUMP",
      "```json\n{\"injected\": true}\n```",
      "## NEXT ACTION",
      "Verify token signature",
    ].join("\n");

    const parsed = engine.parseHandoff(markdownWithExtraSections);
    expect(parsed.objective).toBe("Refactor authentication token parser");
    expect(parsed.completedTasks).toEqual(["Parse JWT header"]);
    expect(parsed.nextAction).toBe("Verify token signature");
  });

  it("handles special characters, emojis, HTML, and uppercase checkbox marks", () => {
    const specialMarkdown = [
      "## OBJECTIVE",
      "Support 🚀 UTF-8 characters & <script>alert('test')</script>",
      "## COMPLETED",
      "- [X] Uppercase checkbox mark",
      "- [x] Emojis in task: 🔒 Encryption & ⚡ Performance",
      "- [x] `Inline code` and **bold** formatting",
      "## CURRENT TASK",
      "- [ ] <Component id='a' />",
      "## KNOWN FAILURES & COOLDOWNS",
      "- [ERR_500] Unicode error: ñ, ö, 漢字, 🚀",
      "## NEXT ACTION",
      "Finish & ship 🚀",
    ].join("\n");

    const parsed = engine.parseHandoff(specialMarkdown);
    expect(parsed.completedTasks).toContain("Uppercase checkbox mark");
    expect(parsed.completedTasks).toContain("Emojis in task: 🔒 Encryption & ⚡ Performance");
    expect(parsed.completedTasks).toContain("`Inline code` and **bold** formatting");
    expect(parsed.knownFailures[0]).toContain("Unicode error: ñ, ö, 漢字, 🚀");
    expect(parsed.nextAction).toBe("Finish & ship 🚀");
  });
});

describe("Adversarial Challenge: Word and Token Budget Constraints", () => {
  const engine = new CompactHandoffEngine();

  it("satisfies budget (< 250 words, < 500 tokens) on compact/small state", () => {
    const smallState = new AgentStateManager("Fix CSS overflow on mobile nav", {
      requirements: ["Prevent horizontal scrollbar"],
    });
    smallState.addPlanTask({ id: "t1", title: "Add overflow-x hidden to body" });
    smallState.completeTask("t1");
    smallState.addPlanTask({ id: "t2", title: "Test on mobile breakpoint" }, "active");
    smallState.recordChange({ path: "src/styles.css", action: "modified" });
    smallState.recordDecision("overflow-x hidden", "Standard CSS technique for viewport bounds");

    const handoff = engine.generateHandoff(smallState.getState(), "Test on mobile breakpoint");
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const tokens = Math.ceil(handoff.length / 3);

    expect(words).toBeLessThan(250);
    expect(tokens).toBeLessThan(500);
  });

  it("strictly enforces budget (< 250 words, < 500 tokens) on moderate-to-large states via windowing", () => {
    // Probe moderate state: 12 completed tasks, 10 file changes, 4 decisions, 2 errors
    const manager = new AgentStateManager(
      "Architect and implement distributed multi-tenant storage replication system",
      {
        requirements: [
          "S3-compatible API layer with authentication",
          "Distributed consensus with Raft cluster",
          "Automated backup snapshots and restore verification",
        ],
        constraints: ["Zero external memory leaks", "Strict POSIX semantics"],
      }
    );

    for (let i = 1; i <= 12; i++) {
      manager.addPlanTask({
        id: `task_${i}`,
        title: `Implement replication component module ${i}`,
        description: `Author unit tests, data structures, and serialization for component ${i}`,
      });
      manager.completeTask(`task_${i}`);
    }

    manager.addPlanTask(
      { id: "active_task", title: "Implement heartbeat leader election", description: "Verify split-brain handling" },
      "active"
    );

    for (let i = 1; i <= 10; i++) {
      manager.recordChange({
        path: `packages/replication/src/node_${i}.ts`,
        action: "created",
        notes: `Replication peer node handler ${i}`,
      });
    }

    for (let i = 1; i <= 4; i++) {
      manager.recordDecision(`Consensus architecture choice ${i}`, `Rationale ${i} for cluster safety`);
    }

    manager.recordError("RATE_LIMIT", "Provider throttled with status 429: quota exhausted");

    const handoff = engine.generateHandoff(manager.getState());
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const estimatedTokens = Math.ceil(handoff.length / 3);

    // Verified: Windowing and pruning strictly guarantee budgets are met
    expect(words).toBeLessThan(250);
    expect(estimatedTokens).toBeLessThan(500);

    // Verify round-trip parsing on windowed handoff
    const parsed = engine.parseHandoff(handoff);
    expect(parsed.completedTasks).toHaveLength(5);
    expect(parsed.currentTask).toContain("Implement heartbeat leader election");
  });

  it("strictly enforces budget (< 250 words, < 500 tokens) on massive adversarial state", () => {
    const manager = new AgentStateManager("Large monorepo migration and multi-package compilation", {
      requirements: Array.from({ length: 20 }, (_, i) => `Mandatory requirement ${i + 1} with extensive detail`),
    });

    for (let i = 1; i <= 50; i++) {
      manager.addPlanTask({
        id: `t_${i}`,
        title: `Completed package task ${i} with long title description`,
        description: `Detailed description for completed task ${i} verifying stability`,
      });
      manager.completeTask(`t_${i}`);
    }

    manager.addPlanTask(
      { id: "active_large", title: "Active task for large state", description: "Verifying active state" },
      "active"
    );

    for (let i = 1; i <= 50; i++) {
      manager.recordChange({
        path: `packages/large/src/submodule_${i}/implementation_${i}.ts`,
        action: i % 2 === 0 ? "modified" : "created",
        notes: `Change note description for file ${i}`,
      });
    }

    for (let i = 1; i <= 15; i++) {
      manager.recordDecision(`Architecture decision ${i}`, `Extended rationale for decision ${i}`);
    }

    for (let i = 1; i <= 10; i++) {
      manager.recordError(`ERR_${i}`, `Simulated subsystem failure ${i}`);
    }

    const handoff = engine.generateHandoff(manager.getState());
    const words = handoff.split(/\s+/).filter(Boolean).length;
    const estimatedTokens = Math.ceil(handoff.length / 3);

    expect(words).toBeLessThan(250);
    expect(estimatedTokens).toBeLessThan(500);

    const parsed = engine.parseHandoff(handoff);
    expect(parsed.completedTasks).toHaveLength(5);
    expect(parsed.currentTask).toBe("Active task for large state: Verifying active state");
    expect(parsed.decisions.length).toBeGreaterThan(0);
    expect(parsed.knownFailures.length).toBeGreaterThan(0);
  });
});

describe("Adversarial Challenge: Task State Immutability and Round-Trip Invariants", () => {
  it("prevents completed tasks from being reset to active via standard transitions", () => {
    const manager = new AgentStateManager("Task workflow verification");
    manager.addPlanTask({ id: "task_1", title: "Build initial data models" });

    // Move to active, then complete
    manager.activateTask("task_1");
    manager.completeTask("task_1");

    expect(manager.getState().plan.completed.map((t) => t.id)).toEqual(["task_1"]);
    expect(manager.getState().plan.active).toHaveLength(0);
    expect(manager.getState().plan.pending).toHaveLength(0);

    // Adversarial transition: calling activateTask on an already completed task
    manager.activateTask("task_1");

    // Must remain completed, NOT moved back to active
    expect(manager.getState().plan.completed.map((t) => t.id)).toEqual(["task_1"]);
    expect(manager.getState().plan.active).toHaveLength(0);

    // Adversarial transition: calling completeTask again
    manager.completeTask("task_1");
    // Must remain exactly 1 completed item, not duplicated
    expect(manager.getState().plan.completed).toHaveLength(1);
  });

  it("documents gap: addPlanTask allows accidental duplicate IDs if caller blindly re-adds completed tasks", () => {
    const manager = new AgentStateManager("Task deduplication check");
    manager.addPlanTask({ id: "t1", title: "Initial Task" });
    manager.completeTask("t1");

    expect(manager.getState().plan.completed.map((t) => t.id)).toEqual(["t1"]);

    // If an external consumer blindly calls addPlanTask with the same ID as pending
    manager.addPlanTask({ id: "t1", title: "Initial Task" }, "pending");

    // Observe: AgentStateManager currently does not check for cross-status ID duplication
    const state = manager.getState();
    const hasInCompleted = state.plan.completed.some((t) => t.id === "t1");
    const hasInPending = state.plan.pending.some((t) => t.id === "t1");

    // Both are true: caller can accidentally pollute pending with already completed task
    expect(hasInCompleted).toBe(true);
    expect(hasInPending).toBe(true);
  });

  it("preserves task titles and descriptions across handoff round-trips", () => {
    const engine = new CompactHandoffEngine();
    const manager = new AgentStateManager("State preservation test");

    manager.addPlanTask({ id: "t1", title: "Task 1", description: "Desc 1" });
    manager.addPlanTask({ id: "t2", title: "Task 2", description: "Desc 2" });
    manager.completeTask("t1");
    manager.completeTask("t2");
    manager.addPlanTask({ id: "t3", title: "Task 3 Active" }, "active");

    const handoff = engine.generateHandoff(manager.getState());
    const parsed = engine.parseHandoff(handoff);

    expect(parsed.completedTasks).toHaveLength(2);
    expect(parsed.completedTasks[0]).toBe("Task 1: Desc 1");
    expect(parsed.completedTasks[1]).toBe("Task 2: Desc 2");
    expect(parsed.currentTask).toBe("Task 3 Active");
  });
});

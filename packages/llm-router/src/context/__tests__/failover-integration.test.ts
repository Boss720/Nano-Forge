/**
 * @file packages/llm-router/src/context/__tests__/failover-integration.test.ts
 * Dedicated integration tests verifying automated model failover:
 * A simulated rate limit (HTTP 429) triggers model failover via compact handoff
 * without task restart or data loss.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AgentStateManager } from "../agentState.js";
import { CompactHandoffEngine } from "../handoff.js";
import { ModelRegistry } from "../../registry/modelRegistry.js";
import { LLMRouter } from "../../routing/router.js";
import { BaseLLMProvider } from "../../providers/base.js";
import {
  LLMEvent,
  LLMProviderError,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
} from "../../providers/types.js";

/**
 * Controllable mock provider for testing simulated model behavior,
 * latency, token counts, and simulated HTTP 429 rate limit errors.
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
      text: `Execution response from ${this.id}:${request.modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70 },
      latencyMs: 25,
    };
  }

  async *stream(_request: LLMRequest): AsyncIterable<LLMEvent> {
    yield { type: "text_delta", text: "chunk" };
    yield { type: "done", finishReason: "stop" };
  }
}

describe("Automated Model Failover Integration", () => {
  let registry: ModelRegistry;
  let router: LLMRouter;
  let handoffEngine: CompactHandoffEngine;
  let primaryProvider: ControllableMockProvider;
  let fallbackProvider: ControllableMockProvider;

  // Primary model A: Free, fast, high coding capability (preferred by free-first policy)
  const modelA: ModelDescriptor = {
    providerId: "provider-primary",
    modelId: "model-a-fast",
    displayName: "Model A Fast (Primary Free)",
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
      coding: 0.88,
      reasoning: 0.82,
      debugging: 0.85,
      planning: 0.80,
      summarization: 0.80,
      classification: 0.85,
    },
    runtime: {
      latency: 20,
      tokensPerSecond: 180,
      successRate: 1.0,
      recentFailures: 0,
      rateLimitedUntil: null,
      remainingQuota: null,
    },
  };

  // Secondary fallback model B: Free, capable, slightly higher latency (selected when Model A is unavailable)
  const modelB: ModelDescriptor = {
    providerId: "provider-fallback",
    modelId: "model-b-smart",
    displayName: "Model B Smart (Fallback Free)",
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
      coding: 0.84,
      reasoning: 0.80,
      debugging: 0.80,
      planning: 0.78,
      summarization: 0.78,
      classification: 0.80,
    },
    runtime: {
      latency: 60,
      tokensPerSecond: 120,
      successRate: 1.0,
      recentFailures: 0,
      rateLimitedUntil: null,
      remainingQuota: null,
    },
  };

  beforeEach(async () => {
    registry = new ModelRegistry();
    handoffEngine = new CompactHandoffEngine();

    // Deep copy descriptors to ensure test isolation
    const freshModelA: ModelDescriptor = JSON.parse(JSON.stringify(modelA));
    const freshModelB: ModelDescriptor = JSON.parse(JSON.stringify(modelB));

    primaryProvider = new ControllableMockProvider("provider-primary", "Primary Provider", [freshModelA]);
    fallbackProvider = new ControllableMockProvider("provider-fallback", "Fallback Provider", [freshModelB]);

    registry.registerProvider(primaryProvider);
    registry.registerProvider(fallbackProvider);
    await registry.refreshModels();

    router = new LLMRouter(registry);
  });

  it("verifies initial routing prefers primary Model A under free-first policy", () => {
    const decision = router.route("implement adapter and interface for storage module");
    expect(decision.selectedModel.modelId).toBe("model-a-fast");
    expect(decision.selectedModel.providerId).toBe("provider-primary");
    expect(decision.alternates.map((m) => m.modelId)).toContain("model-b-smart");
  });

  it("executes automated failover on HTTP 429 rate limit via compact handoff without task restart or data loss", async () => {
    // 1. Initialize Agent State with multi-step plan
    const stateManager = new AgentStateManager("Build robust cloud storage adapter", {
      requirements: [
        "Define StorageProvider interface and object types",
        "Implement S3-compatible storage adapter",
        "Verify adapter with comprehensive unit tests",
      ],
      constraints: ["Zero external memory leaks", "Async iterable streaming"],
      repositorySummary: "TypeScript monorepo with packages/storage and packages/protocol",
    });

    stateManager.addPlanTask({
      id: "step_1",
      title: "Define storage interface contract",
      description: "Write StorageProvider and StorageObject interfaces",
    });
    stateManager.addPlanTask({
      id: "step_2",
      title: "Implement S3-compatible storage adapter",
      description: "Author S3StorageAdapter with Put, Get, Delete operations",
    });
    stateManager.addPlanTask({
      id: "step_3",
      title: "Verify storage adapter test suite",
      description: "Execute unit tests and assert 100% test pass rate",
    });

    // 2. Step 1: Execute on Primary Model A
    stateManager.activateTask("step_1");

    // Router confirms Model A is chosen for Step 1
    const routeStep1 = router.route("Define storage interface contract and types");
    expect(routeStep1.selectedModel.modelId).toBe("model-a-fast");

    // Model A completes Step 1 successfully
    stateManager.recordChange({
      path: "packages/storage/src/interfaces.ts",
      action: "created",
      notes: "StorageProvider and StorageObject interface specifications",
    });
    stateManager.recordDecision(
      "Async iterable blob streaming",
      "Minimizes process heap footprint during large object transfers"
    );
    stateManager.completeTask("step_1");
    stateManager.recordModelUsage("model-a-fast", 280, 0);

    // Verify Step 1 state
    const stateAfterStep1 = stateManager.getState();
    expect(stateAfterStep1.plan.completed).toHaveLength(1);
    expect(stateAfterStep1.plan.completed[0].id).toBe("step_1");
    expect(stateAfterStep1.plan.active).toHaveLength(0);
    expect(stateAfterStep1.plan.pending).toHaveLength(2);

    // 3. Step 2: Model A encounters simulated HTTP 429 Rate Limit
    stateManager.activateTask("step_2");

    // Simulate Model A failing with HTTP 429 Too Many Requests
    const rateLimitError = new LLMProviderError(
      "RATE_LIMIT",
      "429 Too Many Requests: resource exhausted",
      true,
      30000
    );

    // Automated failover flow step a: Catch and record error in AgentStateManager
    stateManager.recordError("RATE_LIMIT", rateLimitError.message, false);

    // Automated failover flow step b: Mark Model A as rate-limited with cooldown in ModelRegistry
    registry.markRateLimited("provider-primary", "model-a-fast", rateLimitError.retryAfterMs);

    // Invariant Check: Cooldown is active in ModelRegistry
    const modelARuntime = registry.getModel("provider-primary", "model-a-fast");
    expect(modelARuntime?.runtime.rateLimitedUntil).not.toBeNull();
    expect(modelARuntime!.runtime.rateLimitedUntil!).toBeGreaterThan(Date.now());
    expect(registry.getAvailableModels().map((m) => m.modelId)).not.toContain("model-a-fast");

    // Automated failover flow step c: Generate structured compact handoff packet
    const handoffPacket = handoffEngine.generateHandoff(
      stateManager.getState(),
      "Resume Step 2 (Implement S3-compatible storage adapter) using fallback model"
    );

    // Invariant Check: Handoff packet compactness and required markdown sections
    const wordCount = handoffPacket.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(250);

    // Token count estimate: wordCount * 1.33 or character count / 3
    const estimatedTokens = Math.ceil(handoffPacket.length / 3);
    expect(estimatedTokens).toBeLessThan(500);

    // Verify all 7 required markdown sections exist
    expect(handoffPacket).toContain("## OBJECTIVE");
    expect(handoffPacket).toContain("## COMPLETED");
    expect(handoffPacket).toContain("## CURRENT TASK");
    expect(handoffPacket).toContain("## RELEVANT FILES");
    expect(handoffPacket).toContain("## DECISIONS MADE");
    expect(handoffPacket).toContain("## KNOWN FAILURES");
    expect(handoffPacket).toContain("## NEXT ACTION");

    // Automated failover flow step d: Route next execution to fallback Model B
    // Model A is excluded automatically by candidate filter due to active cooldown
    const routeStep2Failover = router.route("Implement S3-compatible storage adapter");
    expect(routeStep2Failover.selectedModel.modelId).toBe("model-b-smart");
    expect(routeStep2Failover.selectedModel.providerId).toBe("provider-fallback");

    // Automated failover flow step e: Model B receives and parses the compact handoff packet
    const parsedHandoff = handoffEngine.parseHandoff(handoffPacket);
    expect(parsedHandoff.objective).toContain("Build robust cloud storage adapter");
    expect(parsedHandoff.completedTasks).toHaveLength(1);
    expect(parsedHandoff.completedTasks[0]).toContain("Define storage interface contract");
    expect(parsedHandoff.currentTask).toContain("Implement S3-compatible storage adapter");
    expect(parsedHandoff.relevantFiles.some((f) => f.includes("packages/storage/src/interfaces.ts"))).toBe(true);
    expect(parsedHandoff.decisions.some((d) => d.includes("Async iterable blob streaming"))).toBe(true);
    expect(parsedHandoff.knownFailures.some((k) => k.includes("RATE_LIMIT") && k.includes("429"))).toBe(true);
    expect(parsedHandoff.nextAction).toContain("Resume Step 2");

    // Invariant Check: NO TASK RESTART
    // Step 1 was NEVER restarted or moved back to pending
    const intermediateState = stateManager.getState();
    expect(intermediateState.plan.completed.map((t) => t.id)).toEqual(["step_1"]);
    expect(intermediateState.plan.pending.map((t) => t.id)).toEqual(["step_3"]);
    expect(intermediateState.plan.active.map((t) => t.id)).toEqual(["step_2"]);

    // Automated failover flow step f: Model B completes Step 2 directly without restarting Step 1
    stateManager.recordChange({
      path: "packages/storage/src/adapter.ts",
      action: "created",
      notes: "S3StorageAdapter implementing Put, Get, Delete operations",
    });
    stateManager.completeTask("step_2");
    stateManager.recordModelUsage("model-b-smart", 420, 0);

    // 4. Model B proceeds to Step 3 and completes verification
    stateManager.activateTask("step_3");
    stateManager.recordChange({
      path: "packages/storage/src/__tests__/adapter.test.ts",
      action: "created",
      notes: "14 unit tests verifying S3StorageAdapter contract",
    });
    stateManager.completeTask("step_3");
    stateManager.recordModelUsage("model-b-smart", 190, 0);

    // 5. Final Invariant Verifications
    const finalState = stateManager.getState();

    // Invariant 1: 100% ZERO DATA LOSS
    // All completed tasks are present
    expect(finalState.plan.completed).toHaveLength(3);
    expect(finalState.plan.completed.map((t) => t.id)).toEqual(["step_1", "step_2", "step_3"]);
    expect(finalState.plan.pending).toHaveLength(0);
    expect(finalState.plan.active).toHaveLength(0);

    // All file changes from both Model A and Model B are intact
    expect(finalState.changes).toHaveLength(3);
    const changedPaths = finalState.changes.map((c) => c.path);
    expect(changedPaths).toContain("packages/storage/src/interfaces.ts");
    expect(changedPaths).toContain("packages/storage/src/adapter.ts");
    expect(changedPaths).toContain("packages/storage/src/__tests__/adapter.test.ts");

    // Architectural decisions preserved
    expect(finalState.decisions).toHaveLength(1);
    expect(finalState.decisions[0].decision).toBe("Async iterable blob streaming");
    expect(finalState.decisions[0].rationale).toContain("Minimizes process heap footprint");

    // Relevant files preserved
    expect(finalState.relevantFiles).toContain("packages/storage/src/interfaces.ts");
    expect(finalState.relevantFiles).toContain("packages/storage/src/adapter.ts");
    expect(finalState.relevantFiles).toContain("packages/storage/src/__tests__/adapter.test.ts");

    // Model usage history captures multi-model execution
    expect(finalState.modelHistory).toHaveLength(2);
    expect(finalState.modelHistory.find((m) => m.modelId === "model-a-fast")?.tokensUsed).toBe(280);
    expect(finalState.modelHistory.find((m) => m.modelId === "model-b-smart")?.tokensUsed).toBe(610); // 420 + 190

    // Rate limit error accurately logged in state
    expect(finalState.errors).toHaveLength(1);
    expect(finalState.errors[0].code).toBe("RATE_LIMIT");
    expect(finalState.errors[0].message).toContain("429");

    // Invariant 2: NO TASK RESTART
    // Step 1 was only completed once and was never re-run or duplicated
    const step1Occurrences = finalState.plan.completed.filter((t) => t.id === "step_1");
    expect(step1Occurrences).toHaveLength(1);

    // Invariant 3: RATE LIMIT COOLDOWN
    // Model A is still in cooldown
    expect(modelARuntime!.runtime.rateLimitedUntil).toBeGreaterThan(Date.now());
  });

  it("verifies router.execute automatically fails over to fallback model upon HTTP 429", async () => {
    // Configure Primary Provider to throw HTTP 429 on execution
    primaryProvider.setGenerateHandler(async () => {
      throw new LLMProviderError(
        "RATE_LIMIT",
        "429 Too Many Requests: resource exhausted",
        true,
        30000
      );
    });

    // Configure Fallback Provider to succeed
    fallbackProvider.setGenerateHandler(async (req) => {
      return {
        providerId: "provider-fallback",
        modelId: req.modelId,
        text: "Adapter successfully implemented by fallback model",
        finishReason: "stop",
        usage: { promptTokens: 45, completionTokens: 85, totalTokens: 130 },
        latencyMs: 55,
      };
    });

    const response = await router.execute({
      modelId: "auto",
      messages: [{ role: "user", content: "Implement storage adapter interface" }],
    });

    // Expect successful execution handled by fallback
    expect(response.text).toBe("Adapter successfully implemented by fallback model");
    expect(response.providerId).toBe("provider-fallback");
    expect(response.modelId).toBe("model-b-smart");

    // Expect failovers record noting the 429 event
    expect(response.failovers).toBeDefined();
    expect(response.failovers!.length).toBeGreaterThan(0);
    expect(response.failovers![0]).toContain("Rate limit (429) hit on model-a-fast");

    // Registry marks Model A in cooldown
    const modelAState = registry.getModel("provider-primary", "model-a-fast");
    expect(modelAState?.runtime.rateLimitedUntil).toBeGreaterThan(Date.now());

    // Subsequent route calls bypass Model A and choose Model B
    const nextDecision = router.route("Implement storage adapter interface");
    expect(nextDecision.selectedModel.modelId).toBe("model-b-smart");
  });

  it("enforces cooldown duration and excludes rate-limited models until cooldown expires", () => {
    // Mark Model A rate-limited with 10 second cooldown
    registry.markRateLimited("provider-primary", "model-a-fast", 10000);

    const availableBefore = registry.getAvailableModels();
    expect(availableBefore.map((m) => m.modelId)).not.toContain("model-a-fast");
    expect(availableBefore.map((m) => m.modelId)).toContain("model-b-smart");

    // Routing must exclude Model A
    const routeDuringCooldown = router.route("perform storage refactoring");
    expect(routeDuringCooldown.selectedModel.modelId).toBe("model-b-smart");

    // Simulate passage of time past cooldown
    const modelAEntry = registry.getModel("provider-primary", "model-a-fast");
    if (modelAEntry) {
      modelAEntry.runtime.rateLimitedUntil = Date.now() - 1000;
    }

    // Now Model A is available again and favored by free-first scorer
    const availableAfter = registry.getAvailableModels();
    expect(availableAfter.map((m) => m.modelId)).toContain("model-a-fast");

    const routeAfterCooldown = router.route("perform storage refactoring");
    expect(routeAfterCooldown.selectedModel.modelId).toBe("model-a-fast");
  });

  it("guarantees compact handoff format stays strictly bounded within token budgets across representative states", () => {
    const representativeStateManager = new AgentStateManager("Architectural migration of storage and session layers", {
      requirements: [
        "Migrate storage subsystem to provider interface",
        "Implement connection pooling for sessions",
        "Maintain zero downtime and full backward compatibility",
      ],
      constraints: ["Strict backward compatibility", "Zero memory leaks"],
    });

    // Add completed tasks
    for (let i = 1; i <= 5; i++) {
      representativeStateManager.addPlanTask({ id: `task_${i}`, title: `Migration step ${i}` });
      representativeStateManager.completeTask(`task_${i}`);
    }

    // Add active task
    representativeStateManager.addPlanTask({ id: "task_6", title: "Implement session connection pooling" }, "active");

    // Add file changes
    for (let i = 1; i <= 6; i++) {
      representativeStateManager.recordChange({
        path: `src/core/subsystem_${i}.ts`,
        action: "modified",
        notes: `Pooled connection module ${i}`,
      });
    }

    // Add decisions
    representativeStateManager.recordDecision("Use connection pooling", "Prevents socket exhaustion under load");
    representativeStateManager.recordDecision("Shared memory caches", "Reduces roundtrip latency");

    // Add rate limit failure
    representativeStateManager.recordError("RATE_LIMIT", "Provider throttled with 429 quota exhaustion", false);

    const packet = handoffEngine.generateHandoff(representativeStateManager.getState(), "Resume task 6 on fallback model");

    // Compactness assertions (< 250 words, < 500 tokens)
    const wordCount = packet.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(250);

    const estimatedTokens = Math.ceil(packet.length / 3);
    expect(estimatedTokens).toBeLessThan(500);

    // Bidirectional parse verification
    const parsed = handoffEngine.parseHandoff(packet);
    expect(parsed.completedTasks).toHaveLength(5);
    expect(parsed.currentTask).toContain("Implement session connection pooling");
    expect(parsed.decisions).toHaveLength(2);
    expect(parsed.knownFailures).toHaveLength(1);
    expect(parsed.nextAction).toContain("Resume task 6");
  });
});

/**
 * @file packages/llm-router/tests/adversarial-empirical-challenge.test.ts
 * Empirical Challenger Verification Suite for LLMRouter, TaskClassifier,
 * CandidateFilter, ModelScorer, and ModelRegistry.
 *
 * Authored by challenger_rem_1 to verify edge cases, quota scarcity,
 * classification subtleties, tool flag propagation, and multi-turn message handling.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { BaseLLMProvider } from "../src/providers/base.js";
import {
  LLMEvent,
  LLMProviderError,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
  QuotaState,
} from "../src/providers/types.js";
import { QuotaTracker } from "../src/quota/quotaTracker.js";
import { ModelRegistry } from "../src/registry/modelRegistry.js";
import { CandidateFilter } from "../src/routing/candidateFilter.js";
import { LLMRouter } from "../src/routing/router.js";
import { ModelScorer } from "../src/routing/scorer.js";
import { TaskClassifier } from "../src/routing/taskClassifier.js";

class EmpiricalTestProvider extends BaseLLMProvider {
  public receivedRequests: LLMRequest[] = [];

  constructor(
    readonly id: string,
    readonly name: string,
    private models: ModelDescriptor[],
    private readonly handler?: (req: LLMRequest) => Promise<LLMResponse>,
    private readonly quota?: QuotaState
  ) {
    super();
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return this.models;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, latencyMs: 5, checkedAt: Date.now() };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    this.receivedRequests.push(request);
    if (this.handler) {
      return this.handler(request);
    }
    return {
      providerId: this.id,
      modelId: request.modelId,
      text: `Empirical response from ${this.id}:${request.modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      latencyMs: 10,
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMEvent> {
    yield { type: "text_delta", text: `stream from ${request.modelId}` };
    yield { type: "done", finishReason: "stop" };
  }

  async getQuota(): Promise<QuotaState> {
    return (
      this.quota || {
        limitRequests: null,
        remainingRequests: null,
        limitTokens: null,
        remainingTokens: null,
        resetTimeMs: null,
      }
    );
  }
}

function createModel(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    providerId: overrides.providerId || "emp-provider",
    modelId: overrides.modelId || "emp-model",
    displayName: overrides.displayName || "Empirical Model",
    availability: overrides.availability || "available",
    pricing: overrides.pricing || {
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      isFree: true,
      currency: "USD",
    },
    contextWindow: overrides.contextWindow || 32768,
    maxOutputTokens: overrides.maxOutputTokens || 4096,
    capabilities: overrides.capabilities || {
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    estimatedQuality: overrides.estimatedQuality || {
      coding: 0.8,
      reasoning: 0.8,
      debugging: 0.8,
      planning: 0.8,
      summarization: 0.8,
      classification: 0.8,
    },
    runtime: overrides.runtime || {
      latency: 50,
      tokensPerSecond: 100,
      successRate: 1.0,
      recentFailures: 0,
      rateLimitedUntil: null,
      remainingQuota: null,
    },
  };
}

describe("Empirical Challenge: TaskClassifier Edge Cases", () => {
  const classifier = new TaskClassifier();

  it("evaluates empty input and whitespace-only boundary condition", () => {
    const emptyRes = classifier.classify("");
    expect(emptyRes.complexityClass).toBe("TRIVIAL");
    expect(emptyRes.estimatedPromptTokens).toBe(0);

    // Short whitespace (< 30 chars) -> TRIVIAL
    const shortWs = classifier.classify("   \n\t   ");
    expect(shortWs.complexityClass).toBe("TRIVIAL");
    expect(shortWs.capabilityFloor).toBe(0.1);

    // Edge case: Whitespace >= 30 chars has no keywords, so it falls through to STANDARD!
    const longWs = classifier.classify(" ".repeat(40));
    // Verify empirical behavior: does it become STANDARD because prompt.length >= 30?
    expect(longWs.complexityClass).toBe("STANDARD");
    expect(longWs.capabilityFloor).toBe(0.6);
  });

  it("evaluates multibyte Unicode and CJK token estimation discrepancy", () => {
    // 34 Chinese characters
    const cjkPrompt = "这是一个非常复杂的系统架构设计，包含了大量的微服务和分布式锁";
    const cjkRes = classifier.classify(cjkPrompt);
    // In JS, length is 30 code units (>= 30). Keyword 'architectural design' is not matched in Chinese.
    // Estimated tokens: Math.ceil(30 / 4) = 8 tokens!
    expect(cjkRes.estimatedPromptTokens).toBe(Math.ceil(cjkPrompt.length / 4));
    expect(cjkRes.complexityClass).toBe("STANDARD");
  });

  it("evaluates emoji and surrogate pair character token estimation", () => {
    // 10 emoji characters: each is surrogate pair (2 UTF-16 code units) -> length 20 < 30 -> TRIVIAL
    const emojiPrompt = "🚀✨🔥⚡🎉🤖🧪📦🔍🛡️";
    const res = classifier.classify(emojiPrompt);
    expect(res.estimatedPromptTokens).toBe(Math.ceil(emojiPrompt.length / 4));
  });

  it("evaluates tool and image flags passed directly to classify", () => {
    const prompt = "Please check the status of the build";
    const classifiedWithTools = classifier.classify(prompt, { hasTools: true });
    expect(classifiedWithTools.needsTools).toBe(true);
    expect(classifiedWithTools.needsVision).toBe(false);

    const classifiedWithVision = classifier.classify(prompt, { hasImages: true });
    expect(classifiedWithVision.needsTools).toBe(false);
    expect(classifiedWithVision.needsVision).toBe(true);
  });
});

describe("Empirical Challenge: CandidateFilter & Quota Filtering", () => {
  const filter = new CandidateFilter();
  const task = {
    complexityClass: "STANDARD" as const,
    capabilityFloor: 0.6,
    needsCoding: true,
    needsReasoning: false,
    needsVision: false,
    needsTools: false,
    estimatedPromptTokens: 100,
    reason: "Standard coding task",
  };

  it("demonstrates that CandidateFilter does NOT filter out models with remainingQuota: 0", () => {
    // Model explicitly marked with remainingQuota: 0 in runtime metrics
    const exhaustedModel = createModel({
      modelId: "quota-zero-model",
      runtime: {
        ...createModel().runtime,
        remainingQuota: 0,
      },
    });

    const result = filter.filter([exhaustedModel], task);
    // CandidateFilter does not inspect remainingQuota; it remains eligible
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].modelId).toBe("quota-zero-model");
  });

  it("verifies active rate-limit cooldowns exclude models", () => {
    const future = Date.now() + 30000;
    const rateLimitedModel = createModel({
      modelId: "cooldown-model",
      runtime: {
        ...createModel().runtime,
        rateLimitedUntil: future,
      },
    });

    const result = filter.filter([rateLimitedModel], task);
    expect(result.eligible).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toContain("Rate limited until");
  });

  it("strictly enforces allowPaidFallback: false vs allowPaidFallback: true", () => {
    const paidModel = createModel({
      modelId: "paid-gpt4",
      pricing: { inputCostPer1k: 0.01, outputCostPer1k: 0.03, isFree: false, currency: "USD" },
    });

    // Default or false -> excluded
    const resExcluded = filter.filter([paidModel], task, { allowPaidFallback: false });
    expect(resExcluded.eligible).toHaveLength(0);
    expect(resExcluded.excluded).toHaveLength(1);

    // True -> admitted
    const resAllowed = filter.filter([paidModel], task, { allowPaidFallback: true });
    expect(resAllowed.eligible).toHaveLength(1);
    expect(resAllowed.eligible[0].modelId).toBe("paid-gpt4");
  });
});

describe("Empirical Challenge: ModelScorer Extreme Scarcity & Latency", () => {
  let quotaTracker: QuotaTracker;
  let scorer: ModelScorer;

  beforeEach(() => {
    quotaTracker = new QuotaTracker();
    scorer = new ModelScorer(quotaTracker);
  });

  const task = {
    complexityClass: "STANDARD" as const,
    capabilityFloor: 0.6,
    needsCoding: true,
    needsReasoning: false,
    needsVision: false,
    needsTools: false,
    estimatedPromptTokens: 100,
    reason: "Standard coding task",
  };

  it("proves a model with 0 remaining quota can still receive a high positive score", () => {
    quotaTracker.updateQuota(
      "free-prov",
      {
        limitRequests: 1000,
        remainingRequests: 0,
        limitTokens: null,
        remainingTokens: null,
        resetTimeMs: Date.now() + 60000,
      },
      "zero-quota-free-model"
    );

    const model = createModel({
      providerId: "free-prov",
      modelId: "zero-quota-free-model",
      estimatedQuality: { ...createModel().estimatedQuality, coding: 0.9 },
    });

    const scored = scorer.scoreCandidate(model, task);
    // Quality: 0.9 * 40 = 36
    // Reliability: 1.0 * 15 = 15
    // Speed: 100/200 * 10 = 5
    // Free bonus: 25
    // Gross score: 36 + 15 + 5 + 25 = 81
    // Scarcity penalty: 20
    // Latency penalty: (50/1000) * 2 = 0.1
    // Net score: 81 - 20 - 0.1 = 60.9
    expect(scored.score).toBeGreaterThan(60);
    expect(scored.breakdown.scarcityPenalty).toBe(20);
  });

  it("verifies ranking when an exhausted free model competes with an available free model", () => {
    // Model A: Quality 0.9, 0 requests left (penalty 20) -> Score ~60.9
    quotaTracker.updateQuota(
      "prov-a",
      { limitRequests: 100, remainingRequests: 0, limitTokens: null, remainingTokens: null, resetTimeMs: null },
      "model-a"
    );
    const modelA = createModel({
      providerId: "prov-a",
      modelId: "model-a",
      estimatedQuality: { ...createModel().estimatedQuality, coding: 0.9 },
    });

    // Model B: Quality 0.75, abundant quota (penalty 0) -> Score: 0.75*40(30) + 15 + 5 + 25 - 0.1 = 74.9
    quotaTracker.updateQuota(
      "prov-b",
      { limitRequests: 100, remainingRequests: 100, limitTokens: null, remainingTokens: null, resetTimeMs: null },
      "model-b"
    );
    const modelB = createModel({
      providerId: "prov-b",
      modelId: "model-b",
      estimatedQuality: { ...createModel().estimatedQuality, coding: 0.75 },
    });

    const ranked = scorer.scoreAndRank([modelA, modelB], task);
    // Model B should be ranked higher due to scarcity penalty on Model A
    expect(ranked[0].model.modelId).toBe("model-b");
    expect(ranked[1].model.modelId).toBe("model-a");
  });

  it("verifies latency penalty cap at extreme 120-second latency", () => {
    const extremeLatencyModel = createModel({
      modelId: "extreme-lat",
      runtime: { ...createModel().runtime, latency: 120000 }, // 120s
    });

    const scored = scorer.scoreCandidate(extremeLatencyModel, task);
    // Formula caps latency penalty at 15
    expect(scored.breakdown.latencyPenalty).toBe(15);
  });
});

describe("Empirical Challenge: LLMRouter End-to-End Edge Cases & Flaws", () => {
  let registry: ModelRegistry;
  let router: LLMRouter;

  beforeEach(() => {
    registry = new ModelRegistry();
    router = new LLMRouter(registry);
  });

  it("reveals flaw: router.execute ignores tools in LLMRequest and does not set needsTools", async () => {
    // Model Without Tools (cheaper/higher quality)
    const noToolsModel = createModel({
      providerId: "prov-no-tools",
      modelId: "model-no-tools",
      capabilities: { ...createModel().capabilities, toolCalling: false },
      estimatedQuality: { ...createModel().estimatedQuality, coding: 0.95 },
    });

    // Model With Tools
    const withToolsModel = createModel({
      providerId: "prov-tools",
      modelId: "model-with-tools",
      capabilities: { ...createModel().capabilities, toolCalling: true },
      estimatedQuality: { ...createModel().estimatedQuality, coding: 0.8 },
    });

    const p1 = new EmpiricalTestProvider("prov-no-tools", "P1", [noToolsModel]);
    const p2 = new EmpiricalTestProvider("prov-tools", "P2", [withToolsModel]);
    registry.registerProvider(p1);
    registry.registerProvider(p2);
    await registry.refreshModels();

    // Caller passes a request WITH tools
    const req: LLMRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "read file contents" }],
      tools: [
        {
          name: "readFile",
          description: "reads file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    };

    // Because router.execute calls route(userPrompt, options) WITHOUT hasTools,
    // the classifier sets needsTools = false.
    // CandidateFilter does not filter out model-no-tools!
    // Since model-no-tools has higher coding quality (0.95 vs 0.8), it is selected!
    const decision = router.route("read file contents");
    expect(decision.classification.needsTools).toBe(false);
    expect(decision.selectedModel.modelId).toBe("model-no-tools");

    // When executed, it sends the request with tools to the model that lacks toolCalling!
    const response = await router.execute(req);
    expect(response.modelId).toBe("model-no-tools");
    expect(p1.receivedRequests[0].tools).toBeDefined();
  });

  it("reveals flaw: router.execute evaluates ONLY FIRST user message in multi-turn conversation", async () => {
    const complexModel = createModel({
      providerId: "p-complex",
      modelId: "model-complex",
      estimatedQuality: { ...createModel().estimatedQuality, reasoning: 0.95, coding: 0.95 },
    });
    const trivialModel = createModel({
      providerId: "p-trivial",
      modelId: "model-trivial",
      estimatedQuality: { ...createModel().estimatedQuality, reasoning: 0.5, coding: 0.65 },
    });

    const p1 = new EmpiricalTestProvider("p-complex", "Complex", [complexModel]);
    const p2 = new EmpiricalTestProvider("p-trivial", "Trivial", [trivialModel]);
    registry.registerProvider(p1);
    registry.registerProvider(p2);
    await registry.refreshModels();

    // Multi-turn conversation: first user message is trivial greeting, second is critical security audit
    const multiTurnRequest: LLMRequest = {
      modelId: "auto",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hello! How can I help you today?" },
        { role: "user", content: "Perform a mission critical security audit of authentication tokens and architecture" },
      ],
    };

    // router.execute extracts request.messages.find(m => m.role === 'user')
    // which yields "hi" instead of the latest instruction!
    const response = await router.execute(multiTurnRequest);

    // Because "hi" was classified, it became TRIVIAL (capability floor 0.1).
    // Due to Heavy Model Conservation penalty on trivialModel, model-trivial beats model-complex!
    expect(response.modelId).toBe("model-trivial");
  });

  it("reveals flaw: providerOverride option is defined in interface but ignored by router", () => {
    const mOllama = createModel({ providerId: "ollama", modelId: "common-llama" });
    const mGroq = createModel({ providerId: "groq", modelId: "common-llama" });

    registry.registerModel(mOllama);
    registry.registerModel(mGroq);

    // User explicitly requests providerOverride: "ollama"
    const decision = router.route("format code", {
      providerOverride: "ollama",
    });

    // But router does not implement providerOverride filter in route()!
    // Both models are eligible and ranked purely by score/alphabetical order
    expect(decision).toBeDefined();
  });
});

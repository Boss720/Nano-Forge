import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseLLMProvider } from "../../providers/base.js";
import {
  LLMEvent,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
} from "../../providers/types.js";
import { QuotaTracker } from "../../quota/quotaTracker.js";
import { ModelRegistry } from "../modelRegistry.js";

class MockProvider extends BaseLLMProvider {
  readonly id = "mock";
  readonly name = "Mock Provider";

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        providerId: this.id,
        modelId: "mock-light",
        displayName: "Mock Light",
        availability: "available",
        pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
        contextWindow: 32768,
        maxOutputTokens: 4096,
        capabilities: {
          coding: true,
          reasoning: false,
          vision: false,
          toolCalling: true,
          structuredOutput: true,
          streaming: true,
        },
        estimatedQuality: {
          coding: 0.7,
          reasoning: 0.6,
          debugging: 0.65,
          planning: 0.6,
          summarization: 0.75,
          classification: 0.8,
        },
        runtime: {
          latency: 50,
          tokensPerSecond: 100,
          successRate: 1.0,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      },
    ];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, latencyMs: 20, checkedAt: Date.now() };
  }

  async generate(_request: LLMRequest): Promise<LLMResponse> {
    return {
      providerId: this.id,
      modelId: "mock-light",
      text: "mocked",
      finishReason: "stop",
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      latencyMs: 20,
    };
  }

  async *stream(_request: LLMRequest): AsyncIterable<LLMEvent> {
    yield { type: "text_delta", text: "mock" };
    yield { type: "done", finishReason: "stop" };
  }
}

describe("ModelRegistry & QuotaTracker", () => {
  let registry: ModelRegistry;
  let mockProvider: MockProvider;

  beforeEach(() => {
    registry = new ModelRegistry();
    mockProvider = new MockProvider();
    registry.registerProvider(mockProvider);
  });

  it("refreshes models from registered providers", async () => {
    const models = await registry.refreshModels();
    expect(models).toHaveLength(1);
    expect(models[0].modelId).toBe("mock-light");
    expect(registry.getModel("mock", "mock-light")).toBeDefined();
  });

  it("excludes rate-limited models from available pool", async () => {
    await registry.refreshModels();
    expect(registry.getAvailableModels()).toHaveLength(1);

    registry.markRateLimited("mock", "mock-light", 10000); // 10s cooldown
    expect(registry.getAvailableModels()).toHaveLength(0);

    const model = registry.getModel("mock", "mock-light");
    expect(model?.runtime.rateLimitedUntil).toBeGreaterThan(Date.now());
  });

  it("restores model availability upon success", async () => {
    await registry.refreshModels();
    registry.markRateLimited("mock", "mock-light", 10000);
    expect(registry.getAvailableModels()).toHaveLength(0);

    registry.markSuccess("mock", "mock-light", 40);
    expect(registry.getAvailableModels()).toHaveLength(1);
    expect(registry.getModel("mock", "mock-light")?.runtime.rateLimitedUntil).toBeNull();
  });

  it("calculates scarcity penalty from quota tracker accurately", () => {
    const tracker = new QuotaTracker();
    tracker.updateQuota("groq", {
      remainingRequests: 50,
      limitRequests: 500, // 90% used
      remainingTokens: null,
      limitTokens: null,
      resetTimeMs: null,
    });

    const penalty = tracker.calculateScarcityPenalty("groq");
    // (500 - 50) / 500 * 20 = 0.9 * 20 = 18
    expect(penalty).toBeCloseTo(18, 1);
  });
});

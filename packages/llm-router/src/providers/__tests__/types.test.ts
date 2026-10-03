import { describe, expect, it } from "vitest";
import { BaseLLMProvider } from "../base.js";
import {
  AuthenticationError,
  ContextLengthExceededError,
  EstimatedQualitySchema,
  InvalidRequestError,
  InvalidToolCallError,
  LLMEventSchema,
  LLMMessageSchema,
  LLMProviderError,
  LLMRequestSchema,
  LLMResponseSchema,
  MalformedOutputError,
  mapHttpError,
  ModelCapabilitiesSchema,
  ModelDescriptor,
  ModelDescriptorSchema,
  NetworkError,
  PricingSchema,
  ProviderError,
  ProviderHealthSchema,
  ProviderUnavailableError,
  QuotaExhaustedError,
  QuotaStateSchema,
  RateLimitError,
  RuntimeMetricsSchema,
  TimeoutError,
  ToolCallSchema,
  ToolDefinitionSchema,
  ToolResultSchema,
  UsageMetricsSchema,
} from "../types.js";

class MockProvider extends BaseLLMProvider {
  readonly id = "mock-provider";
  readonly name = "Mock Provider";

  async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }

  async healthCheck() {
    return { healthy: true, latencyMs: 10, checkedAt: Date.now() };
  }

  async generate(): Promise<never> {
    throw new Error("not implemented");
  }

  async *stream() {
    yield { type: "done" as const, finishReason: "stop" as const };
  }
}

describe("LLM Provider Schemas", () => {
  it("validates a compliant ModelDescriptor schema", () => {
    const descriptor: ModelDescriptor = {
      providerId: "ollama",
      modelId: "qwen2.5-coder:7b",
      displayName: "Qwen 2.5 Coder 7B",
      availability: "available",
      pricing: {
        inputCostPer1k: 0,
        outputCostPer1k: 0,
        isFree: true,
        currency: "USD",
      },
      contextWindow: 32768,
      maxOutputTokens: 8192,
      capabilities: {
        coding: true,
        reasoning: true,
        vision: false,
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
      },
      estimatedQuality: {
        coding: 0.82,
        reasoning: 0.78,
        debugging: 0.8,
        planning: 0.72,
        summarization: 0.75,
        classification: 0.85,
      },
      runtime: {
        latency: 45,
        tokensPerSecond: 65,
        successRate: 0.99,
        recentFailures: 0,
        rateLimitedUntil: null,
        remainingQuota: null,
      },
    };

    const parsed = ModelDescriptorSchema.safeParse(descriptor);
    expect(parsed.success).toBe(true);
  });

  it("rejects negative costs in pricing schema", () => {
    const invalidPricing = {
      inputCostPer1k: -0.01,
      outputCostPer1k: 0,
      isFree: false,
      currency: "USD",
    };
    const parsed = PricingSchema.safeParse(invalidPricing);
    expect(parsed.success).toBe(false);
  });

  it("rejects quality scores outside [0.0, 1.0]", () => {
    const overScore = {
      coding: 1.2,
      reasoning: 0.8,
      debugging: 0.8,
      planning: 0.7,
      summarization: 0.7,
      classification: 0.8,
    };
    expect(EstimatedQualitySchema.safeParse(overScore).success).toBe(false);

    const negativeScore = {
      coding: -0.1,
      reasoning: 0.8,
      debugging: 0.8,
      planning: 0.7,
      summarization: 0.7,
      classification: 0.8,
    };
    expect(EstimatedQualitySchema.safeParse(negativeScore).success).toBe(false);
  });

  it("validates runtime metrics boundaries and nullable quotas", () => {
    const valid = {
      latency: 120,
      tokensPerSecond: 45,
      successRate: 0.95,
      recentFailures: 1,
      rateLimitedUntil: Date.now() + 10000,
      remainingQuota: null,
    };
    expect(RuntimeMetricsSchema.safeParse(valid).success).toBe(true);

    const invalidSuccessRate = { ...valid, successRate: 1.5 };
    expect(RuntimeMetricsSchema.safeParse(invalidSuccessRate).success).toBe(false);
  });

  it("validates ModelCapabilities schema boolean fields", () => {
    const validCaps = {
      coding: true,
      reasoning: false,
      vision: true,
      toolCalling: true,
      structuredOutput: false,
      streaming: true,
    };
    expect(ModelCapabilitiesSchema.safeParse(validCaps).success).toBe(true);

    const invalidCaps = { ...validCaps, coding: "yes" };
    expect(ModelCapabilitiesSchema.safeParse(invalidCaps).success).toBe(false);
  });

  it("validates ToolCall and ToolResult schemas", () => {
    const toolCall = {
      id: "call_123",
      name: "read_file",
      arguments: { path: "src/index.ts" },
    };
    expect(ToolCallSchema.safeParse(toolCall).success).toBe(true);

    const toolResult = {
      toolCallId: "call_123",
      output: "file contents",
      isError: false,
    };
    expect(ToolResultSchema.safeParse(toolResult).success).toBe(true);
  });

  it("validates LLMMessage schema across all roles", () => {
    expect(LLMMessageSchema.safeParse({ role: "system", content: "You are an assistant." }).success).toBe(true);
    expect(
      LLMMessageSchema.safeParse({
        role: "user",
        content: "Hello",
        images: ["data:image/png;base64,..."],
      }).success,
    ).toBe(true);
    expect(
      LLMMessageSchema.safeParse({
        role: "assistant",
        content: "I will call a tool.",
        toolCalls: [{ id: "c1", name: "search", arguments: "{}" }],
      }).success,
    ).toBe(true);
    expect(
      LLMMessageSchema.safeParse({
        role: "tool",
        toolResults: [{ toolCallId: "c1", output: "result" }],
      }).success,
    ).toBe(true);
  });

  it("validates ToolDefinition schema", () => {
    const def = {
      name: "execute_command",
      description: "Runs a shell command",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
      },
    };
    expect(ToolDefinitionSchema.safeParse(def).success).toBe(true);
  });

  it("validates LLMRequest and LLMResponse schemas", () => {
    const req = {
      modelId: "gpt-4o",
      messages: [{ role: "user" as const, content: "hi" }],
      temperature: 0.7,
      maxTokens: 1024,
    };
    expect(LLMRequestSchema.safeParse(req).success).toBe(true);

    const res = {
      providerId: "openai",
      modelId: "gpt-4o",
      text: "hello there",
      finishReason: "stop" as const,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      latencyMs: 320,
    };
    expect(LLMResponseSchema.safeParse(res).success).toBe(true);
  });

  it("validates UsageMetrics and rejects negative token values", () => {
    expect(UsageMetricsSchema.safeParse({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }).success).toBe(
      true,
    );
    expect(UsageMetricsSchema.safeParse({ promptTokens: -1, completionTokens: 20, totalTokens: 19 }).success).toBe(
      false,
    );
  });

  it("validates LLMEvent streaming variants", () => {
    expect(LLMEventSchema.safeParse({ type: "text_delta", text: "hello" }).success).toBe(true);
    expect(LLMEventSchema.safeParse({ type: "tool_call_delta", index: 0, name: "test", argumentsDelta: "{}" }).success).toBe(true);
    expect(LLMEventSchema.safeParse({ type: "usage", promptTokens: 5, completionTokens: 10, totalTokens: 15 }).success).toBe(true);
    expect(LLMEventSchema.safeParse({ type: "error", code: "RATE_LIMIT", message: "Exceeded", retryable: true }).success).toBe(true);
    expect(LLMEventSchema.safeParse({ type: "done", finishReason: "stop" }).success).toBe(true);
  });

  it("validates QuotaState and ProviderHealth schemas", () => {
    const quota = {
      remainingRequests: 100,
      remainingTokens: null,
      resetTimeMs: 1700000000000,
      limitRequests: 500,
      limitTokens: null,
    };
    expect(QuotaStateSchema.safeParse(quota).success).toBe(true);

    const health = {
      healthy: true,
      latencyMs: 12,
      message: "all systems normal",
      checkedAt: Date.now(),
    };
    expect(ProviderHealthSchema.safeParse(health).success).toBe(true);
  });
});

describe("Standardized Error Hierarchy", () => {
  it("creates ProviderError base class with correct properties", () => {
    const err = new ProviderError(
      "Test provider failure",
      "INVALID_REQUEST",
      false,
      undefined,
      "test-prov",
      "test-model",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe("ProviderError");
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.retryable).toBe(false);
    expect(err.providerId).toBe("test-prov");
    expect(err.modelId).toBe("test-model");
  });

  it("creates RateLimitError with correct default and custom retryAfterMs", () => {
    const defaultErr = new RateLimitError("Rate limit exceeded");
    expect(defaultErr).toBeInstanceOf(ProviderError);
    expect(defaultErr).toBeInstanceOf(RateLimitError);
    expect(defaultErr.name).toBe("RateLimitError");
    expect(defaultErr.code).toBe("RATE_LIMIT");
    expect(defaultErr.retryable).toBe(true);
    expect(defaultErr.retryAfterMs).toBe(15000);

    const customErr = new RateLimitError("Wait 30s", 30000);
    expect(customErr.retryAfterMs).toBe(30000);
  });

  it("creates QuotaExhaustedError with retryable=false", () => {
    const err = new QuotaExhaustedError("Monthly token budget exhausted");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(QuotaExhaustedError);
    expect(err.name).toBe("QuotaExhaustedError");
    expect(err.code).toBe("QUOTA_EXHAUSTED");
    expect(err.retryable).toBe(false);
  });

  it("creates ContextLengthExceededError with retryable=false", () => {
    const err = new ContextLengthExceededError("Prompt is 40000 tokens, window is 32768");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(ContextLengthExceededError);
    expect(err.name).toBe("ContextLengthExceededError");
    expect(err.code).toBe("CONTEXT_TOO_LARGE");
    expect(err.retryable).toBe(false);
  });

  it("creates AuthenticationError with retryable=false", () => {
    const err = new AuthenticationError("Invalid API key supplied");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.name).toBe("AuthenticationError");
    expect(err.code).toBe("AUTHENTICATION_ERROR");
    expect(err.retryable).toBe(false);
  });

  it("creates NetworkError with retryable=true and default retryAfterMs=5000", () => {
    const err = new NetworkError("DNS resolution failed");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.name).toBe("NetworkError");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it("creates InvalidRequestError with retryable=false", () => {
    const err = new InvalidRequestError("Malformed temperature parameter");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.name).toBe("InvalidRequestError");
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.retryable).toBe(false);
  });

  it("creates ProviderUnavailableError with retryable=true and default retryAfterMs=5000", () => {
    const err = new ProviderUnavailableError("Daemon offline");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(err.name).toBe("ProviderUnavailableError");
    expect(err.code).toBe("PROVIDER_OFFLINE");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it("creates TimeoutError, InvalidToolCallError, and MalformedOutputError", () => {
    const timeout = new TimeoutError("Timed out");
    expect(timeout.code).toBe("TIMEOUT");
    expect(timeout.retryable).toBe(true);
    expect(timeout.retryAfterMs).toBe(1000);

    const badTool = new InvalidToolCallError("Unknown function declaration");
    expect(badTool.code).toBe("INVALID_TOOL_CALL");
    expect(badTool.retryable).toBe(false);

    const malformed = new MalformedOutputError("Incomplete JSON");
    expect(malformed.code).toBe("MALFORMED_OUTPUT");
    expect(malformed.retryable).toBe(false);
  });

  it("preserves backward compatibility with LLMProviderError", () => {
    const legacyErr = new LLMProviderError("RATE_LIMIT", "Quota exceeded", true, 5000);
    expect(legacyErr).toBeInstanceOf(Error);
    expect(legacyErr).toBeInstanceOf(ProviderError);
    expect(legacyErr).toBeInstanceOf(LLMProviderError);
    expect(legacyErr.code).toBe("RATE_LIMIT");
    expect(legacyErr.retryable).toBe(true);
    expect(legacyErr.retryAfterMs).toBe(5000);
    expect(legacyErr.name).toBe("LLMProviderError");

    // Any ProviderError subclass satisfies instanceof LLMProviderError
    const rateLimit = new RateLimitError("429 Too Many Requests");
    expect(rateLimit).toBeInstanceOf(LLMProviderError);
    expect(rateLimit).toBeInstanceOf(ProviderError);
  });
});

describe("mapHttpError", () => {
  it("maps 429 without retry-after header to default 15000ms RateLimitError", () => {
    const err = mapHttpError(429, "Too Many Requests");
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(15000);
  });

  it("maps 429 with integer retry-after header", () => {
    const err = mapHttpError(429, "Rate limited", { "retry-after": "25" });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(25000);
  });

  it("maps 429 with Headers instance", () => {
    const headers = new Headers();
    headers.set("Retry-After", "40");
    const err = mapHttpError(429, "Rate limited", headers);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(40000);
  });

  it("maps 429 with HTTP date in retry-after", () => {
    const futureDate = new Date(Date.now() + 60000).toUTCString();
    const err = mapHttpError(429, "Rate limited", { "retry-after": futureDate });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBeGreaterThan(50000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(61000);
  });

  it("maps 401 and 403 to AuthenticationError", () => {
    const err401 = mapHttpError(401, "Unauthorized");
    expect(err401).toBeInstanceOf(AuthenticationError);
    expect(err401.retryable).toBe(false);

    const err403 = mapHttpError(403, "Forbidden");
    expect(err403).toBeInstanceOf(AuthenticationError);
    expect(err403.retryable).toBe(false);
  });

  it("maps 408 and 504 to NetworkError", () => {
    const err408 = mapHttpError(408, "Request Timeout");
    expect(err408).toBeInstanceOf(NetworkError);
    expect(err408.retryable).toBe(true);

    const err504 = mapHttpError(504, "Gateway Timeout");
    expect(err504).toBeInstanceOf(NetworkError);
    expect(err504.retryable).toBe(true);
  });

  it("maps 500, 502, 503 to ProviderUnavailableError", () => {
    for (const status of [500, 502, 503]) {
      const err = mapHttpError(status, `Error ${status}`);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect(err.retryable).toBe(true);
      expect(err.code).toBe("PROVIDER_OFFLINE");
    }
  });

  it("maps 400 with context length keywords to ContextLengthExceededError", () => {
    const errContext = mapHttpError(400, "Maximum context length exceeded");
    expect(errContext).toBeInstanceOf(ContextLengthExceededError);
    expect(errContext.retryable).toBe(false);
    expect(errContext.code).toBe("CONTEXT_TOO_LARGE");

    const errTokenLimit = mapHttpError(400, "Request exceeds token limit of 32k");
    expect(errTokenLimit).toBeInstanceOf(ContextLengthExceededError);

    const errTooLong = mapHttpError(400, "Prompt is too long for model");
    expect(errTooLong).toBeInstanceOf(ContextLengthExceededError);
  });

  it("maps 400 without context keywords to InvalidRequestError", () => {
    const errInvalid = mapHttpError(400, "Missing required field: messages");
    expect(errInvalid).toBeInstanceOf(InvalidRequestError);
    expect(errInvalid.retryable).toBe(false);
    expect(errInvalid.code).toBe("INVALID_REQUEST");
  });
});

describe("BaseLLMProvider.handleError", () => {
  const provider = new MockProvider();

  it("returns original ProviderError untouched", () => {
    const original = new RateLimitError("Already normalized", 12000);
    const result = provider.handleError(original);
    expect(result).toBe(original);
  });

  it("normalizes HTTP status error objects via mapHttpError", () => {
    const httpErr = {
      status: 429,
      message: "Resource exhausted",
      headers: { "retry-after": "18" },
    };
    const result = provider.handleError(httpErr);
    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfterMs).toBe(18000);
  });

  it("normalizes TimeoutError or timeout messages", () => {
    const timeoutErr = new Error("Connection timeout after 30000ms");
    const result = provider.handleError(timeoutErr);
    expect(result).toBeInstanceOf(TimeoutError);
    expect(result.retryable).toBe(true);
  });

  it("normalizes AbortError into non-retryable error", () => {
    const abortErr = new DOMException("Request was aborted", "AbortError");
    const result = provider.handleError(abortErr);
    expect(result).toBeInstanceOf(ProviderError);
    expect(result.retryable).toBe(false);
  });

  it("normalizes fetch failures and ECONNREFUSED into ProviderUnavailableError", () => {
    const fetchErr = new TypeError("Failed to fetch");
    const res1 = provider.handleError(fetchErr);
    expect(res1).toBeInstanceOf(ProviderUnavailableError);
    expect(res1.retryable).toBe(true);

    const connErr = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    const res2 = provider.handleError(connErr);
    expect(res2).toBeInstanceOf(ProviderUnavailableError);
    expect(res2.retryable).toBe(true);
  });
});

/**
 * @file packages/llm-router/tests/adversarial-types.test.ts
 * Empirical adversarial stress testing suite for LLM router Zod schemas.
 */

import { describe, expect, it } from "vitest";
import {
  EstimatedQualitySchema,
  LLMEventSchema,
  LLMMessageSchema,
  LLMRequestSchema,
  LLMResponseSchema,
  ModelDescriptorSchema,
  PricingSchema,
  RuntimeMetricsSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
  UsageMetricsSchema,
} from "../src/types.js";

describe("Adversarial Challenge: PricingSchema", () => {
  const validBase = {
    inputCostPer1k: 0.0015,
    outputCostPer1k: 0.002,
    isFree: false,
    currency: "USD" as const,
  };

  it("rejects negative numbers in inputCostPer1k and outputCostPer1k", () => {
    expect(PricingSchema.safeParse({ ...validBase, inputCostPer1k: -0.0001 }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, outputCostPer1k: -1 }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, inputCostPer1k: -Infinity }).success).toBe(false);
  });

  it("rejects non-numeric strings for costs", () => {
    expect(PricingSchema.safeParse({ ...validBase, inputCostPer1k: "0.0015" }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, outputCostPer1k: "free" }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, inputCostPer1k: "" }).success).toBe(false);
  });

  it("rejects missing currency or non-USD currency", () => {
    const { currency, ...noCurrency } = validBase;
    expect(PricingSchema.safeParse(noCurrency).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, currency: "EUR" }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, currency: "USD " }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...validBase, currency: "usd" }).success).toBe(false);
  });

  it("handles excessive precision floating point values", () => {
    const ultraHighPrecision = {
      ...validBase,
      inputCostPer1k: 0.000000000000000000123456789,
      outputCostPer1k: 0.000000000000000000987654321,
    };
    const res = PricingSchema.safeParse(ultraHighPrecision);
    // Observe whether excessive precision is accepted by z.number().nonnegative()
    expect(res.success).toBe(true);
  });

  it("evaluates NaN and Infinity in PricingSchema", () => {
    const nanRes = PricingSchema.safeParse({ ...validBase, inputCostPer1k: NaN });
    expect(nanRes.success).toBe(false);

    // Zod number validation rejects Infinity
    const infRes = PricingSchema.safeParse({ ...validBase, inputCostPer1k: Infinity });
    expect(infRes.success).toBe(false);
  });

  it("evaluates negative zero (-0) in PricingSchema", () => {
    const negZeroRes = PricingSchema.safeParse({ ...validBase, inputCostPer1k: -0 });
    expect(negZeroRes.success).toBe(true);
  });

  it("strips unexpected extra properties by default", () => {
    const withExtra = { ...validBase, extraProp: "injectedValue", adminBypass: true };
    const parsed = PricingSchema.safeParse(withExtra);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("extraProp" in parsed.data).toBe(false);
      expect("adminBypass" in parsed.data).toBe(false);
    }
  });

  it("observes logical inconsistency between isFree and non-zero costs", () => {
    // Schema allows isFree: true with non-zero costs because there is no cross-field refinement
    const inconsistent = {
      inputCostPer1k: 100.0,
      outputCostPer1k: 200.0,
      isFree: true,
      currency: "USD" as const,
    };
    const res = PricingSchema.safeParse(inconsistent);
    expect(res.success).toBe(true); // Observation: No cross-field validation
  });
});

describe("Adversarial Challenge: EstimatedQualitySchema", () => {
  const validQuality = {
    coding: 0.9,
    reasoning: 0.85,
    debugging: 0.8,
    planning: 0.75,
    summarization: 0.7,
    classification: 0.65,
  };

  it("rejects values < 0.0", () => {
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, coding: -0.0001 }).success).toBe(false);
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, reasoning: -1 }).success).toBe(false);
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, debugging: -Infinity }).success).toBe(false);
  });

  it("rejects values > 1.0", () => {
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, coding: 1.0001 }).success).toBe(false);
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, planning: 2.0 }).success).toBe(false);
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, summarization: Infinity }).success).toBe(false);
  });

  it("accepts exact boundary values 0.0 and 1.0", () => {
    const allZero = {
      coding: 0,
      reasoning: 0,
      debugging: 0,
      planning: 0,
      summarization: 0,
      classification: 0,
    };
    expect(EstimatedQualitySchema.safeParse(allZero).success).toBe(true);

    const allOne = {
      coding: 1,
      reasoning: 1,
      debugging: 1,
      planning: 1,
      summarization: 1,
      classification: 1,
    };
    expect(EstimatedQualitySchema.safeParse(allOne).success).toBe(true);
  });

  it("rejects NaN", () => {
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, coding: NaN }).success).toBe(false);
    expect(EstimatedQualitySchema.safeParse({ ...validQuality, reasoning: NaN }).success).toBe(false);
  });

  it("rejects missing domains", () => {
    const { coding, ...missingCoding } = validQuality;
    expect(EstimatedQualitySchema.safeParse(missingCoding).success).toBe(false);

    const { classification, ...missingClassification } = validQuality;
    expect(EstimatedQualitySchema.safeParse(missingClassification).success).toBe(false);
  });

  it("strips unexpected extra domains", () => {
    const withExtra = { ...validQuality, math: 0.95, creativeWriting: 0.8 };
    const res = EstimatedQualitySchema.safeParse(withExtra);
    expect(res.success).toBe(true);
    if (res.success) {
      expect("math" in res.data).toBe(false);
      expect("creativeWriting" in res.data).toBe(false);
    }
  });
});

describe("Adversarial Challenge: RuntimeMetricsSchema", () => {
  const validMetrics = {
    latency: 120,
    tokensPerSecond: 45,
    successRate: 0.98,
    recentFailures: 0,
    rateLimitedUntil: null,
    remainingQuota: null,
  };

  it("rejects negative latencies", () => {
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, latency: -1 }).success).toBe(false);
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, latency: -0.001 }).success).toBe(false);
  });

  it("rejects negative tokensPerSecond", () => {
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, tokensPerSecond: -5 }).success).toBe(false);
  });

  it("rejects successRate > 1.0 and < 0.0", () => {
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, successRate: 1.0001 }).success).toBe(false);
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, successRate: -0.0001 }).success).toBe(false);
  });

  it("evaluates non-integer recentFailures (BUG / GAP ANALYSIS)", () => {
    // recentFailures is hardened with .int().nonnegative()
    const fractionalFailures = { ...validMetrics, recentFailures: 2.5 };
    const res = RuntimeMetricsSchema.safeParse(fractionalFailures);
    expect(res.success).toBe(false); // Rejected because .int() is enforced
  });

  it("evaluates negative rateLimitedUntil and remainingQuota", () => {
    // rateLimitedUntil is defined as z.number().nullable() WITHOUT .nonnegative()!
    const negativeRateLimit = { ...validMetrics, rateLimitedUntil: -1000 };
    const res1 = RuntimeMetricsSchema.safeParse(negativeRateLimit);
    expect(res1.success).toBe(true); // Observation: negative timestamp allowed

    // remainingQuota is defined as z.number().nullable() WITHOUT .nonnegative()!
    const negativeQuota = { ...validMetrics, remainingQuota: -50 };
    const res2 = RuntimeMetricsSchema.safeParse(negativeQuota);
    expect(res2.success).toBe(true); // Observation: negative quota allowed
  });

  it("evaluates Infinity in latency and tokensPerSecond", () => {
    // Zod number validation rejects Infinity
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, latency: Infinity }).success).toBe(false);
    expect(RuntimeMetricsSchema.safeParse({ ...validMetrics, tokensPerSecond: Infinity }).success).toBe(false);
  });

  it("rejects undefined for nullable fields", () => {
    // .nullable() requires explicit null or number; undefined is rejected
    const { rateLimitedUntil, ...missingRateLimit } = validMetrics;
    expect(RuntimeMetricsSchema.safeParse(missingRateLimit).success).toBe(false);
  });
});

describe("Adversarial Challenge: ModelDescriptorSchema", () => {
  const validDescriptor = {
    providerId: "ollama",
    modelId: "llama3:8b",
    displayName: "Llama 3 8B",
    availability: "available" as const,
    pricing: {
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      isFree: true,
      currency: "USD" as const,
    },
    contextWindow: 8192,
    maxOutputTokens: 2048,
    capabilities: {
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    estimatedQuality: {
      coding: 0.75,
      reasoning: 0.7,
      debugging: 0.7,
      planning: 0.65,
      summarization: 0.8,
      classification: 0.75,
    },
    runtime: {
      latency: 50,
      tokensPerSecond: 60,
      successRate: 1.0,
      recentFailures: 0,
      rateLimitedUntil: null,
      remainingQuota: null,
    },
  };

  it("strips unexpected extra properties", () => {
    const withExtra = { ...validDescriptor, injectedAdmin: true, secretServerToken: "leak" };
    const res = ModelDescriptorSchema.safeParse(withExtra);
    expect(res.success).toBe(true);
    if (res.success) {
      expect("injectedAdmin" in res.data).toBe(false);
      expect("secretServerToken" in res.data).toBe(false);
    }
  });

  it("rejects empty strings for providerId, modelId, displayName", () => {
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, providerId: "" }).success).toBe(false);
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, modelId: "" }).success).toBe(false);
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, displayName: "" }).success).toBe(false);
  });

  it("rejects zero or negative contextWindow and maxOutputTokens", () => {
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, contextWindow: 0 }).success).toBe(false);
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, contextWindow: -8192 }).success).toBe(false);
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, maxOutputTokens: 0 }).success).toBe(false);
    expect(ModelDescriptorSchema.safeParse({ ...validDescriptor, maxOutputTokens: -100 }).success).toBe(false);
  });

  it("evaluates non-integer contextWindow (BUG / GAP ANALYSIS)", () => {
    // contextWindow is z.number().positive(), missing .int()
    const floatContext = { ...validDescriptor, contextWindow: 8192.5 };
    const res = ModelDescriptorSchema.safeParse(floatContext);
    expect(res.success).toBe(true); // Observation: accepts fractional context window
  });

  it("rejects missing required sub-objects", () => {
    const { capabilities, ...noCaps } = validDescriptor;
    expect(ModelDescriptorSchema.safeParse(noCaps).success).toBe(false);

    const { runtime, ...noRuntime } = validDescriptor;
    expect(ModelDescriptorSchema.safeParse(noRuntime).success).toBe(false);
  });
});

describe("Adversarial Challenge: LLMRequestSchema", () => {
  const validRequest = {
    modelId: "gpt-4o",
    messages: [{ role: "user" as const, content: "Hello" }],
    temperature: 0.7,
    maxTokens: 2048,
  };

  it("strips unexpected extra properties", () => {
    const withExtra = { ...validRequest, extraField: "should_strip", maliciousPayload: "<script>" };
    const res = LLMRequestSchema.safeParse(withExtra);
    expect(res.success).toBe(true);
    if (res.success) {
      expect("extraField" in res.data).toBe(false);
      expect("maliciousPayload" in res.data).toBe(false);
    }
  });

  it("rejects empty string modelId", () => {
    expect(LLMRequestSchema.safeParse({ ...validRequest, modelId: "" }).success).toBe(false);
  });

  it("accepts empty messages array (GAP / OBSERVATION)", () => {
    // messages: z.array(LLMMessageSchema) does NOT have .min(1)
    const emptyMessages = { ...validRequest, messages: [] };
    const res = LLMRequestSchema.safeParse(emptyMessages);
    expect(res.success).toBe(true); // Observation: Empty messages array is accepted
  });

  it("rejects temperature outside [0, 2]", () => {
    expect(LLMRequestSchema.safeParse({ ...validRequest, temperature: -0.1 }).success).toBe(false);
    expect(LLMRequestSchema.safeParse({ ...validRequest, temperature: 2.1 }).success).toBe(false);
    expect(LLMRequestSchema.safeParse({ ...validRequest, temperature: NaN }).success).toBe(false);
  });

  it("evaluates maxTokens boundaries", () => {
    expect(LLMRequestSchema.safeParse({ ...validRequest, maxTokens: 0 }).success).toBe(false);
    expect(LLMRequestSchema.safeParse({ ...validRequest, maxTokens: -1 }).success).toBe(false);
    // maxTokens has positive() but not int()
    expect(LLMRequestSchema.safeParse({ ...validRequest, maxTokens: 100.5 }).success).toBe(true);
  });

  it("evaluates signal validation weakness", () => {
    // signal is validated with custom validator: (val) => val === undefined || (typeof val === "object" && val !== null)
    // Any object satisfies this, even non-AbortSignal!
    const fakeSignal = { foo: "bar" };
    const res = LLMRequestSchema.safeParse({ ...validRequest, signal: fakeSignal });
    expect(res.success).toBe(true); // Observation: weak AbortSignal type check allows arbitrary plain objects
  });
});

describe("Adversarial Challenge: LLMResponseSchema", () => {
  const validResponse = {
    providerId: "openai",
    modelId: "gpt-4o",
    text: "Generated response",
    finishReason: "stop" as const,
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
    latencyMs: 450,
  };

  it("strips unexpected extra properties", () => {
    const withExtra = { ...validResponse, rawProviderTelemetry: { unparsed: true } };
    const res = LLMResponseSchema.safeParse(withExtra);
    expect(res.success).toBe(true);
    if (res.success) {
      expect("rawProviderTelemetry" in res.data).toBe(false);
    }
  });

  it("rejects invalid finishReason", () => {
    expect(LLMResponseSchema.safeParse({ ...validResponse, finishReason: "completed" }).success).toBe(false);
    expect(LLMResponseSchema.safeParse({ ...validResponse, finishReason: "cancelled" }).success).toBe(false);
    expect(LLMResponseSchema.safeParse({ ...validResponse, finishReason: "" }).success).toBe(false);
  });

  it("rejects negative latencyMs", () => {
    expect(LLMResponseSchema.safeParse({ ...validResponse, latencyMs: -1 }).success).toBe(false);
  });

  it("rejects negative or fractional tokens in usage", () => {
    expect(
      LLMResponseSchema.safeParse({
        ...validResponse,
        usage: { promptTokens: -1, completionTokens: 5, totalTokens: 4 },
      }).success,
    ).toBe(false);

    expect(
      LLMResponseSchema.safeParse({
        ...validResponse,
        usage: { promptTokens: 10.5, completionTokens: 5, totalTokens: 15.5 },
      }).success,
    ).toBe(false);
  });

  it("allows totalTokens to disagree with sum of prompt and completion (OBSERVATION)", () => {
    // UsageMetricsSchema does not validate that totalTokens === promptTokens + completionTokens
    const mismatchedUsage = {
      ...validResponse,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 999999 },
    };
    const res = LLMResponseSchema.safeParse(mismatchedUsage);
    expect(res.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { providerId, ...noProvider } = validResponse;
    expect(LLMResponseSchema.safeParse(noProvider).success).toBe(false);

    const { finishReason, ...noFinish } = validResponse;
    expect(LLMResponseSchema.safeParse(noFinish).success).toBe(false);

    const { usage, ...noUsage } = validResponse;
    expect(LLMResponseSchema.safeParse(noUsage).success).toBe(false);
  });
});

describe("Adversarial Challenge: LLMMessageSchema & Roles", () => {
  it("rejects unauthorized roles", () => {
    expect(LLMMessageSchema.safeParse({ role: "developer", content: "hi" }).success).toBe(false);
    expect(LLMMessageSchema.safeParse({ role: "admin", content: "hi" }).success).toBe(false);
    expect(LLMMessageSchema.safeParse({ role: "function", content: "hi" }).success).toBe(false);
    expect(LLMMessageSchema.safeParse({ role: "", content: "hi" }).success).toBe(false);
    expect(LLMMessageSchema.safeParse({ content: "no role" }).success).toBe(false);
  });

  it("rejects tool message with content instead of toolResults", () => {
    // OpenAI format has role: 'tool' and content: 'result', but NanoForge requires toolResults array!
    const openAIStyleTool = {
      role: "tool",
      content: "Executed successfully",
    };
    expect(LLMMessageSchema.safeParse(openAIStyleTool).success).toBe(false);
  });

  it("validates tool message with toolResults array", () => {
    const validToolMsg = {
      role: "tool" as const,
      toolResults: [
        { toolCallId: "call_1", output: "Result output", isError: false },
      ],
    };
    expect(LLMMessageSchema.safeParse(validToolMsg).success).toBe(true);
  });

  it("rejects assistant message with missing content when toolCalls present", () => {
    // In some provider APIs, assistant messages with tool calls have content: null or omit content
    const nullContentAssistant = {
      role: "assistant",
      content: null,
      toolCalls: [{ id: "c1", name: "test", arguments: "{}" }],
    };
    expect(LLMMessageSchema.safeParse(nullContentAssistant).success).toBe(false);

    const missingContentAssistant = {
      role: "assistant",
      toolCalls: [{ id: "c1", name: "test", arguments: "{}" }],
    };
    expect(LLMMessageSchema.safeParse(missingContentAssistant).success).toBe(false);
  });

  it("accepts assistant message with empty string content and toolCalls", () => {
    const emptyContentAssistant = {
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: "c1", name: "test", arguments: "{}" }],
    };
    expect(LLMMessageSchema.safeParse(emptyContentAssistant).success).toBe(true);
  });

  it("evaluates ToolCall arguments formats", () => {
    // arguments can be record or string
    expect(ToolCallSchema.safeParse({ id: "1", name: "cmd", arguments: { cmd: "ls" } }).success).toBe(true);
    expect(ToolCallSchema.safeParse({ id: "1", name: "cmd", arguments: '{"cmd":"ls"}' }).success).toBe(true);
    expect(ToolCallSchema.safeParse({ id: "1", name: "cmd", arguments: 12345 }).success).toBe(false);
    expect(ToolCallSchema.safeParse({ id: "1", name: "cmd", arguments: null }).success).toBe(false);
  });
});

describe("Adversarial Challenge: LLMEventSchema Streaming Variants", () => {
  it("rejects unknown event types", () => {
    expect(LLMEventSchema.safeParse({ type: "ping" }).success).toBe(false);
    expect(LLMEventSchema.safeParse({ type: "stream_start" }).success).toBe(false);
    expect(LLMEventSchema.safeParse({ type: "status", status: "running" }).success).toBe(false);
  });

  it("strips unexpected extra properties on events", () => {
    const withExtra = { type: "text_delta" as const, text: "chunk", secretData: 12345 };
    const res = LLMEventSchema.safeParse(withExtra);
    expect(res.success).toBe(true);
    if (res.success) {
      expect("secretData" in res.data).toBe(false);
    }
  });

  it("rejects negative index in tool_call_delta", () => {
    expect(
      LLMEventSchema.safeParse({
        type: "tool_call_delta",
        index: -1,
        argumentsDelta: "{}",
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer index in tool_call_delta", () => {
    expect(
      LLMEventSchema.safeParse({
        type: "tool_call_delta",
        index: 1.5,
        argumentsDelta: "{}",
      }).success,
    ).toBe(false);
  });

  it("rejects missing code or message in error event", () => {
    expect(LLMEventSchema.safeParse({ type: "error", code: "RATE_LIMIT" }).success).toBe(false);
    expect(LLMEventSchema.safeParse({ type: "error", message: "Failed" }).success).toBe(false);
    expect(LLMEventSchema.safeParse({ type: "error", code: "ERR", message: "m", retryable: "yes" }).success).toBe(
      false,
    );
  });

  it("rejects invalid finishReason in done event", () => {
    expect(LLMEventSchema.safeParse({ type: "done", finishReason: "finished" }).success).toBe(false);
    expect(LLMEventSchema.safeParse({ type: "done" }).success).toBe(false);
  });
});

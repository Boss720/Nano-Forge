/**
 * @file packages/llm-router/src/types.ts
 * Canonical domain types and Zod validation schemas for LLM router and providers.
 */

import { z } from "zod";

// ============================================================================
// Model Availability & Pricing
// ============================================================================

export type Availability = "available" | "degraded" | "unavailable" | "unknown";
export const AvailabilitySchema = z.enum(["available", "degraded", "unavailable", "unknown"]);

export interface Pricing {
  inputCostPer1k: number;
  outputCostPer1k: number;
  isFree: boolean;
  currency: "USD";
}

export const PricingSchema = z.object({
  inputCostPer1k: z.number().nonnegative(),
  outputCostPer1k: z.number().nonnegative(),
  isFree: z.boolean(),
  currency: z.literal("USD"),
});

// ============================================================================
// Model Capabilities & Quality
// ============================================================================

export interface ModelCapabilities {
  coding: boolean;
  reasoning: boolean;
  vision: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
}

export const ModelCapabilitiesSchema = z.object({
  coding: z.boolean(),
  reasoning: z.boolean(),
  vision: z.boolean(),
  toolCalling: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
});

export interface EstimatedQuality {
  coding: number;         // 0.0 - 1.0
  reasoning: number;      // 0.0 - 1.0
  debugging: number;      // 0.0 - 1.0
  planning: number;       // 0.0 - 1.0
  summarization: number;  // 0.0 - 1.0
  classification: number; // 0.0 - 1.0
}

export const EstimatedQualitySchema = z.object({
  coding: z.number().min(0).max(1),
  reasoning: z.number().min(0).max(1),
  debugging: z.number().min(0).max(1),
  planning: z.number().min(0).max(1),
  summarization: z.number().min(0).max(1),
  classification: z.number().min(0).max(1),
});

export interface RuntimeMetrics {
  latency: number;
  tokensPerSecond: number;
  successRate: number;
  recentFailures: number;
  rateLimitedUntil: number | null;
  remainingQuota: number | null; // null if unknown; NEVER fabricate
}

export const RuntimeMetricsSchema = z.object({
  latency: z.number().nonnegative(),
  tokensPerSecond: z.number().nonnegative(),
  successRate: z.number().min(0).max(1),
  recentFailures: z.number().int().nonnegative(),
  rateLimitedUntil: z.number().nullable(),
  remainingQuota: z.number().nullable(),
});

// ============================================================================
// Model Descriptor
// ============================================================================

export interface ModelDescriptor {
  providerId: string;
  modelId: string;
  displayName: string;
  availability: Availability;
  pricing: Pricing;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  estimatedQuality: EstimatedQuality;
  runtime: RuntimeMetrics;
}

export const ModelDescriptorSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  availability: AvailabilitySchema,
  pricing: PricingSchema,
  contextWindow: z.number().positive(),
  maxOutputTokens: z.number().positive(),
  capabilities: ModelCapabilitiesSchema,
  estimatedQuality: EstimatedQualitySchema,
  runtime: RuntimeMetricsSchema,
});

// ============================================================================
// Messages & Tool Contracts
// ============================================================================

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.union([z.record(z.string(), z.unknown()), z.string()]),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  output: z.string(),
  isError: z.boolean().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const LLMMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("system"),
    content: z.string(),
  }),
  z.object({
    role: z.literal("user"),
    content: z.string(),
    images: z.array(z.string()).optional(),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    toolCalls: z.array(ToolCallSchema).optional(),
  }),
  z.object({
    role: z.literal("tool"),
    toolResults: z.array(ToolResultSchema),
  }),
]);
export type LLMMessage = z.infer<typeof LLMMessageSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolFunctionDeclaration = ToolDefinition;
export const ToolFunctionDeclarationSchema = ToolDefinitionSchema;

export const LLMRequestSchema = z.object({
  modelId: z.string().min(1),
  messages: z.array(LLMMessageSchema),
  tools: z.array(ToolDefinitionSchema).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  stopSequences: z.array(z.string()).optional(),
  systemInstruction: z.string().optional(),
  signal: z.custom<AbortSignal>(
    (val) => val === undefined || (typeof val === "object" && val !== null),
    { message: "Must be an AbortSignal" },
  ).optional(),
});
export type LLMRequest = z.infer<typeof LLMRequestSchema>;

export const UsageMetricsSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;
export type TokenUsage = UsageMetrics;
export const TokenUsageSchema = UsageMetricsSchema;

export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error" | "abort" | "timeout";
export const FinishReasonSchema = z.enum([
  "stop",
  "tool_calls",
  "length",
  "content_filter",
  "error",
  "abort",
  "timeout",
]);

export const LLMResponseSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  text: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  finishReason: FinishReasonSchema,
  usage: UsageMetricsSchema,
  latencyMs: z.number().nonnegative(),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ============================================================================
// Streaming Events
// ============================================================================

export const LLMEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text_delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_delta"),
    index: z.number().int().nonnegative(),
    id: z.string().optional(),
    name: z.string().optional(),
    argumentsDelta: z.string().optional(),
  }),
  z.object({
    type: z.literal("usage"),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    finishReason: FinishReasonSchema,
  }),
]);
export type LLMEvent = z.infer<typeof LLMEventSchema>;

// ============================================================================
// Quota & Health
// ============================================================================

export const QuotaStateSchema = z.object({
  remainingRequests: z.number().nullable(),
  remainingTokens: z.number().nullable(),
  resetTimeMs: z.number().nullable(),
  limitRequests: z.number().nullable(),
  limitTokens: z.number().nullable(),
});
export type QuotaState = z.infer<typeof QuotaStateSchema>;

export const ProviderHealthSchema = z.object({
  healthy: z.boolean(),
  latencyMs: z.number().nonnegative(),
  message: z.string().optional(),
  checkedAt: z.number().nonnegative(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

// ============================================================================
// Provider Contract & Error Hierarchy Re-exports
// ============================================================================

export type { LLMProvider } from "./providers/base.js";
export * from "./errors.js";

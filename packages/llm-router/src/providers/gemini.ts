import { BaseLLMProvider } from "./base.js";
import {
  LLMEvent,
  LLMMessage,
  LLMProviderError,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
  ToolCall,
} from "./types.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class GeminiProvider extends BaseLLMProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly baseUrl: string;
  readonly apiKey?: string;

  constructor(options: GeminiProviderOptions = {}) {
    super();
    this.baseUrl = (
      options.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!this.apiKey) {
      return {
        healthy: false,
        latencyMs: 0,
        message: "GEMINI_API_KEY missing",
        checkedAt: Date.now(),
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);
      return {
        healthy: res.ok,
        latencyMs: Date.now() - start,
        message: res.ok ? "Healthy" : `HTTP ${res.status}: ${res.statusText}`,
        checkedAt: Date.now(),
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : "Network error",
        checkedAt: Date.now(),
      };
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        providerId: this.id,
        modelId: "gemini-2.0-flash",
        displayName: "Google: Gemini 2.0 Flash",
        availability: "available",
        pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
        contextWindow: 1048576, // 1M tokens
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
          coding: 0.88,
          reasoning: 0.88,
          debugging: 0.85,
          planning: 0.86,
          summarization: 0.9,
          classification: 0.92,
        },
        runtime: {
          latency: 40,
          tokensPerSecond: 120,
          successRate: 0.99,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      },
      {
        providerId: this.id,
        modelId: "gemini-2.0-flash-lite",
        displayName: "Google: Gemini 2.0 Flash Lite",
        availability: "available",
        pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        capabilities: {
          coding: true,
          reasoning: false,
          vision: true,
          toolCalling: true,
          structuredOutput: true,
          streaming: true,
        },
        estimatedQuality: {
          coding: 0.78,
          reasoning: 0.72,
          debugging: 0.72,
          planning: 0.7,
          summarization: 0.86,
          classification: 0.88,
        },
        runtime: {
          latency: 25,
          tokensPerSecond: 180,
          successRate: 1.0,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      },
      {
        providerId: this.id,
        modelId: "gemini-1.5-pro",
        displayName: "Google: Gemini 1.5 Pro",
        availability: "available",
        pricing: { inputCostPer1k: 0.00125, outputCostPer1k: 0.005, isFree: false, currency: "USD" },
        contextWindow: 2097152, // 2M tokens
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
          coding: 0.94,
          reasoning: 0.95,
          debugging: 0.92,
          planning: 0.93,
          summarization: 0.95,
          classification: 0.95,
        },
        runtime: {
          latency: 90,
          tokensPerSecond: 60,
          successRate: 0.99,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      },
    ];
  }

  private formatGeminiPayload(request: LLMRequest): Record<string, unknown> {
    let systemInstruction: Record<string, unknown> | undefined;
    const contents: Array<Record<string, unknown>> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemInstruction = {
          parts: [{ text: msg.content }],
        };
      } else if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments,
              },
            });
          }
        }
        contents.push({ role: "model", parts });
      } else if (msg.role === "tool") {
        for (const res of msg.toolResults) {
          contents.push({
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: res.toolCallId,
                  response: { output: res.output },
                },
              },
            ],
          });
        }
      }
    }

    const payload: Record<string, unknown> = { contents };
    if (systemInstruction) payload.systemInstruction = systemInstruction;

    if (request.tools && request.tools.length > 0) {
      payload.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.stopSequences) generationConfig.stopSequences = request.stopSequences;
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    return payload;
  }

  async generate(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const start = Date.now();
    if (!this.apiKey) {
      throw new LLMProviderError("AUTHENTICATION_ERROR", "GEMINI_API_KEY is not configured", false);
    }

    const url = `${this.baseUrl}/models/${request.modelId}:generateContent?key=${this.apiKey}`;
    const payload = this.formatGeminiPayload(request);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        if (res.status === 429) {
          throw new LLMProviderError(
            "RATE_LIMIT",
            `Gemini rate limit (429 RESOURCE_EXHAUSTED): ${errorText}`,
            true,
            15000
          );
        }
        if (res.status === 400 && errorText.includes("API key not valid")) {
          throw new LLMProviderError("AUTHENTICATION_ERROR", `Invalid Gemini API key: ${errorText}`, false);
        }
        throw new LLMProviderError("MALFORMED_OUTPUT", `Gemini API error (${res.status}): ${errorText}`, res.status >= 500);
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: { name: string; args: Record<string, unknown> };
            }>;
          };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      let text = "";
      const toolCalls: ToolCall[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.text) text += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${i}_${Date.now()}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          });
        }
      }

      const promptTokens = data.usageMetadata?.promptTokenCount || 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;

      return {
        providerId: this.id,
        modelId: request.modelId,
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.handleError(err);
    }
  }

  async *stream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMEvent> {
    if (!this.apiKey) {
      yield {
        type: "error",
        code: "AUTHENTICATION_ERROR",
        message: "GEMINI_API_KEY is not configured",
        retryable: false,
      };
      return;
    }

    const url = `${this.baseUrl}/models/${request.modelId}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const payload = this.formatGeminiPayload(request);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      const norm = this.handleError(err);
      yield { type: "error", code: norm.code, message: norm.message, retryable: norm.retryable };
      return;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const is429 = res.status === 429;
      yield {
        type: "error",
        code: is429 ? "RATE_LIMIT" : "MALFORMED_OUTPUT",
        message: `Gemini stream failed (${res.status}): ${errText}`,
        retryable: is429 || res.status >= 500,
      };
      return;
    }

    if (!res.body) {
      yield { type: "error", code: "MALFORMED_OUTPUT", message: "Missing response body", retryable: false };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          try {
            const chunk = JSON.parse(jsonStr) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<{
                    text?: string;
                    functionCall?: { name: string; args: Record<string, unknown> };
                  }>;
                };
              }>;
              usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                totalTokenCount?: number;
              };
            };

            const candidate = chunk.candidates?.[0];
            if (candidate?.content?.parts) {
              for (let i = 0; i < candidate.content.parts.length; i++) {
                const part = candidate.content.parts[i];
                if (part.text) {
                  yield { type: "text_delta", text: part.text };
                }
                if (part.functionCall) {
                  yield {
                    type: "tool_call_delta",
                    index: i,
                    name: part.functionCall.name,
                    argumentsDelta: JSON.stringify(part.functionCall.args),
                  };
                }
              }
            }

            if (chunk.usageMetadata) {
              const p = chunk.usageMetadata.promptTokenCount || 0;
              const c = chunk.usageMetadata.candidatesTokenCount || 0;
              yield {
                type: "usage",
                promptTokens: p,
                completionTokens: c,
                totalTokens: p + c,
              };
            }
          } catch {
            // Ignore malformed SSE chunk
          }
        }
      }
      yield { type: "done", finishReason: "stop" };
    } catch (err) {
      const norm = this.handleError(err);
      yield { type: "error", code: norm.code, message: norm.message, retryable: norm.retryable };
    } finally {
      reader.releaseLock();
    }
  }
}

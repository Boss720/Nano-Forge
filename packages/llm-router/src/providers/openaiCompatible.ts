import { BaseLLMProvider } from "./base.js";
import {
  LLMEvent,
  LLMMessage,
  LLMProviderError,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
  QuotaState,
  ToolCall,
} from "./types.js";

export interface OpenAICompatibleOptions {
  providerId?: string;
  name?: string;
  baseUrl: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  models?: ModelDescriptor[];
}

export class OpenAICompatibleProvider extends BaseLLMProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  protected readonly apiKey?: string;
  protected readonly defaultHeaders: Record<string, string>;
  protected customModels: ModelDescriptor[];
  protected lastQuotaState: QuotaState | null = null;

  constructor(options: OpenAICompatibleOptions) {
    super();
    this.id = options.providerId || "openai-compatible";
    this.name = options.name || "OpenAI Compatible API";
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultHeaders = options.defaultHeaders || {};
    this.customModels = options.models || [];
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });
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
        message: err instanceof Error ? err.message : "Provider offline",
        checkedAt: Date.now(),
      };
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    if (this.customModels.length > 0) {
      return this.customModels;
    }

    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        throw new LLMProviderError("PROVIDER_OFFLINE", `Failed to list models: HTTP ${res.status}`, true);
      }

      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const raw = data.data || [];

      return raw.map((m) => ({
        providerId: this.id,
        modelId: m.id,
        displayName: `${this.name}: ${m.id}`,
        availability: "available",
        pricing: {
          inputCostPer1k: 0,
          outputCostPer1k: 0,
          isFree: true,
          currency: "USD",
        },
        contextWindow: 128000,
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
          coding: 0.8,
          reasoning: 0.8,
          debugging: 0.75,
          planning: 0.75,
          summarization: 0.8,
          classification: 0.85,
        },
        runtime: {
          latency: 120,
          tokensPerSecond: 50,
          successRate: 1.0,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      }));
    } catch (err) {
      throw this.handleError(err);
    }
  }

  async getQuota(): Promise<QuotaState> {
    return (
      this.lastQuotaState || {
        remainingRequests: null,
        remainingTokens: null,
        resetTimeMs: null,
        limitRequests: null,
        limitTokens: null,
      }
    );
  }

  protected updateQuotaFromHeaders(headers: Headers): void {
    const remReq = headers.get("x-ratelimit-remaining-requests");
    const remTok = headers.get("x-ratelimit-remaining-tokens");
    const limitReq = headers.get("x-ratelimit-limit-requests");
    const limitTok = headers.get("x-ratelimit-limit-tokens");
    const resetSec = headers.get("retry-after") || headers.get("x-ratelimit-reset-requests");

    if (remReq || remTok) {
      this.lastQuotaState = {
        remainingRequests: remReq ? parseInt(remReq, 10) : null,
        remainingTokens: remTok ? parseInt(remTok, 10) : null,
        limitRequests: limitReq ? parseInt(limitReq, 10) : null,
        limitTokens: limitTok ? parseInt(limitTok, 10) : null,
        resetTimeMs: resetSec ? Date.now() + parseFloat(resetSec) * 1000 : null,
      };
    }
  }

  protected formatMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      if (msg.role === "system") {
        return { role: "system", content: msg.content };
      }
      if (msg.role === "user") {
        return { role: "user", content: msg.content };
      }
      if (msg.role === "assistant") {
        return {
          role: "assistant",
          content: msg.content,
          tool_calls: msg.toolCalls?.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === "string"
                  ? tc.arguments
                  : JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      if (msg.role === "tool") {
        // Return first tool result or combined
        const first = msg.toolResults[0];
        return {
          role: "tool",
          tool_call_id: first?.toolCallId || "call_0",
          content: first?.output || "",
        };
      }
      return { role: "user", content: "" };
    });
  }

  async generate(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      model: request.modelId,
      messages: this.formatMessages(request.messages),
      stream: false,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.stopSequences) body.stop = request.stopSequences;

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });

      this.updateQuotaFromHeaders(res.headers);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after");
          const retryMs = retryAfter ? parseFloat(retryAfter) * 1000 : 15000;
          throw new LLMProviderError("RATE_LIMIT", `Rate limit reached: ${errorText}`, true, retryMs);
        }
        if (res.status === 401 || res.status === 403) {
          throw new LLMProviderError("AUTHENTICATION_ERROR", `Auth failed (${res.status}): ${errorText}`, false);
        }
        throw new LLMProviderError("MALFORMED_OUTPUT", `API error (${res.status}): ${errorText}`, res.status >= 500);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = data.choices?.[0];
      const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;

      return {
        providerId: this.id,
        modelId: request.modelId,
        text: choice?.message?.content || "",
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        finishReason:
          choice?.finish_reason === "tool_calls"
            ? "tool_calls"
            : choice?.finish_reason === "length"
              ? "length"
              : "stop",
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
    const body: Record<string, unknown> = {
      model: request.modelId,
      messages: this.formatMessages(request.messages),
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.stopSequences) body.stop = request.stopSequences;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
      this.updateQuotaFromHeaders(res.headers);
    } catch (err) {
      const normalized = this.handleError(err);
      yield {
        type: "error",
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      };
      return;
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      const is429 = res.status === 429;
      yield {
        type: "error",
        code: is429 ? "RATE_LIMIT" : res.status === 401 ? "AUTHENTICATION_ERROR" : "MALFORMED_OUTPUT",
        message: `Stream failed (${res.status}): ${errorText}`,
        retryable: is429 || res.status >= 500,
      };
      return;
    }

    if (!res.body) {
      yield {
        type: "error",
        code: "MALFORMED_OUTPUT",
        message: "Stream response missing body",
        retryable: false,
      };
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

          const dataPayload = trimmed.slice(5).trim();
          if (dataPayload === "[DONE]") {
            yield { type: "done", finishReason: "stop" };
            return;
          }

          try {
            const parsed = JSON.parse(dataPayload) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };

            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              yield { type: "text_delta", text: delta.content };
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: "tool_call_delta",
                  index: tc.index,
                  id: tc.id,
                  name: tc.function?.name,
                  argumentsDelta: tc.function?.arguments,
                };
              }
            }
            if (parsed.usage) {
              yield {
                type: "usage",
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              };
            }
            if (parsed.choices?.[0]?.finish_reason) {
              yield {
                type: "done",
                finishReason:
                  parsed.choices[0].finish_reason === "tool_calls"
                    ? "tool_calls"
                    : "stop",
              };
            }
          } catch {
            // Ignore partial SSE lines
          }
        }
      }
    } catch (err) {
      const normalized = this.handleError(err);
      yield {
        type: "error",
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      };
    } finally {
      reader.releaseLock();
    }
  }
}

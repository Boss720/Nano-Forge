import { BaseLLMProvider } from "./base.js";
import {
  LLMEvent,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
  QuotaState,
  ToolCall,
  mapHttpError,
} from "./types.js";

export interface OllamaProviderOptions {
  baseUrl?: string;
  healthTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface OllamaTagModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export class OllamaProvider extends BaseLLMProvider {
  readonly id = "ollama";
  readonly name = "Ollama Local Inference";
  readonly baseUrl: string;
  private readonly healthTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: OllamaProviderOptions = {}) {
    super();
    this.baseUrl = (options.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.healthTimeoutMs = options.healthTimeoutMs ?? 1500;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60000;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.healthTimeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          message: `HTTP ${res.status}: ${res.statusText}`,
          checkedAt: Date.now(),
        };
      }

      const data = (await res.json()) as { version?: string };
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        message: data.version ? `Ollama v${data.version}` : "Ollama online",
        checkedAt: Date.now(),
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort =
        (err as { name?: string })?.name === "AbortError" ||
        (err as { name?: string })?.name === "TimeoutError" ||
        ((err as Error)?.message?.toLowerCase()?.includes("abort") ?? false) ||
        ((err as Error)?.message?.toLowerCase()?.includes("timeout") ?? false);
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: isAbort ? "Health check timed out" : "Ollama service offline",
        checkedAt: Date.now(),
      };
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw mapHttpError(
          res.status,
          `Failed to list Ollama models: HTTP ${res.status} ${errorText}`,
          res.headers
        );
      }

      const data = (await res.json()) as { models?: OllamaTagModel[] };
      const rawModels = data.models || [];

      return rawModels.map((m) => this.mapToDescriptor(m));
    } catch (err) {
      throw this.handleError(err);
    }
  }

  async getQuota(): Promise<QuotaState> {
    return {
      remainingRequests: null,
      remainingTokens: null,
      resetTimeMs: null,
      limitRequests: null,
      limitTokens: null,
    };
  }

  private mapToDescriptor(raw: OllamaTagModel): ModelDescriptor {
    const nameLower = raw.name.toLowerCase();
    const familyLower = (raw.details?.family || "").toLowerCase();
    const familiesLower = (raw.details?.families || []).map((f) => f.toLowerCase());
    const allDescriptors = [nameLower, familyLower, ...familiesLower];

    const matchAny = (keywords: string[]): boolean =>
      keywords.some((kw) => allDescriptors.some((d) => d.includes(kw)));

    // Coding models: 'coder', 'code', 'deepseek', 'qwen', 'starcoder', 'codellama', 'devstral'
    const isCoding = matchAny([
      "coder",
      "code",
      "deepseek",
      "qwen",
      "starcoder",
      "codellama",
      "devstral",
    ]);

    // Reasoning models: 'r1', 'reason', 'qwen', 'llama3', 'mistral', 'mixtral', 'command-r', 'phi3'
    const isReasoning = matchAny([
      "r1",
      "reason",
      "qwen",
      "llama3",
      "mistral",
      "mixtral",
      "command-r",
      "phi3",
    ]);

    // Dynamic context windows:
    // 128k (131072) for llama3.1, llama3.2, llama3.3, qwen2.5
    // 32k (32768) for mistral, mixtral, qwen2
    // 8k (8192) for llama3, gemma2
    // Default: 32768
    let contextWindow = 32768;
    if (matchAny(["llama3.1", "llama3.2", "llama3.3", "qwen2.5"])) {
      contextWindow = 131072;
    } else if (matchAny(["mistral", "mixtral", "qwen2"])) {
      contextWindow = 32768;
    } else if (matchAny(["llama3", "gemma2"])) {
      contextWindow = 8192;
    } else {
      contextWindow = 32768;
    }

    // Tool calling capability flag:
    // Enable for models supporting tools: llama3.1, llama3.2, llama3.3, qwen2.5, mistral, mixtral, command-r, hermes, firefunction
    // Disable for base / older / un-supported models (gemma, llama2, phi, etc.)
    const toolCalling = matchAny([
      "llama3.1",
      "llama3.2",
      "llama3.3",
      "qwen2.5",
      "mistral",
      "mixtral",
      "command-r",
      "hermes",
      "firefunction",
    ]);

    return {
      providerId: this.id,
      modelId: raw.name,
      displayName: `Ollama: ${raw.name}`,
      availability: "available",
      pricing: {
        inputCostPer1k: 0,
        outputCostPer1k: 0,
        isFree: true,
        currency: "USD",
      },
      contextWindow,
      maxOutputTokens: Math.min(contextWindow, 8192),
      capabilities: {
        coding: isCoding,
        reasoning: isReasoning,
        vision: nameLower.includes("vision") || nameLower.includes("llava"),
        toolCalling,
        structuredOutput: true,
        streaming: true,
      },
      estimatedQuality: {
        coding: isCoding ? 0.8 : 0.65,
        reasoning: isReasoning ? 0.8 : 0.65,
        debugging: isCoding ? 0.78 : 0.6,
        planning: 0.7,
        summarization: 0.75,
        classification: 0.8,
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
  }

  private formatMessages(messages: LLMMessage[]): OllamaChatMessage[] {
    const formatted: OllamaChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        formatted.push({ role: "system", content: msg.content });
      } else if (msg.role === "user") {
        formatted.push({
          role: "user",
          content: msg.content,
          images: msg.images,
        });
      } else if (msg.role === "assistant") {
        formatted.push({
          role: "assistant",
          content: msg.content,
          tool_calls: msg.toolCalls?.map((tc) => {
            let parsedArgs: Record<string, unknown> = {};
            if (typeof tc.arguments === "string") {
              try {
                parsedArgs = JSON.parse(tc.arguments);
              } catch {
                parsedArgs = { raw: tc.arguments };
              }
            } else if (tc.arguments && typeof tc.arguments === "object") {
              parsedArgs = tc.arguments as Record<string, unknown>;
            }
            return {
              function: {
                name: tc.name,
                arguments: parsedArgs,
              },
            };
          }),
        });
      } else if (msg.role === "tool") {
        for (const res of msg.toolResults) {
          formatted.push({
            role: "tool",
            content: res.output,
          });
        }
      }
    }

    return formatted;
  }

  async generate(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const start = Date.now();
    const effectiveSignal = signal ?? request.signal;

    const messages = this.formatMessages(request.messages);
    if (request.systemInstruction) {
      messages.unshift({ role: "system", content: request.systemInstruction });
    }

    const body = {
      model: request.modelId,
      messages,
      stream: false,
      tools: request.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      options: {
        temperature: request.temperature,
        num_predict: request.maxTokens,
        stop: request.stopSequences,
      },
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: effectiveSignal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw mapHttpError(
          res.status,
          `Ollama generate failed (${res.status}): ${errorText}`,
          res.headers
        );
      }

      const data = (await res.json()) as {
        message?: {
          content?: string;
          tool_calls?: Array<{
            function: { name: string; arguments: Record<string, unknown> };
          }>;
        };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const toolCalls: ToolCall[] | undefined = data.message?.tool_calls?.map(
        (tc, idx) => ({
          id: `call_${idx}_${Date.now()}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })
      );

      const promptTokens = data.prompt_eval_count || 0;
      const completionTokens = data.eval_count || 0;

      return {
        providerId: this.id,
        modelId: request.modelId,
        text: data.message?.content || "",
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
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
    const effectiveSignal = signal ?? request.signal;

    const messages = this.formatMessages(request.messages);
    if (request.systemInstruction) {
      messages.unshift({ role: "system", content: request.systemInstruction });
    }

    const body = {
      model: request.modelId,
      messages,
      stream: true,
      tools: request.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      options: {
        temperature: request.temperature,
        num_predict: request.maxTokens,
        stop: request.stopSequences,
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: effectiveSignal,
      });
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
      const mapped = mapHttpError(
        res.status,
        `Ollama stream failed (${res.status}): ${errorText}`,
        res.headers
      );
      yield {
        type: "error",
        code: mapped.code,
        message: mapped.message,
        retryable: mapped.retryable,
      };
      return;
    }

    if (!res.body) {
      yield {
        type: "error",
        code: "MALFORMED_OUTPUT",
        message: "Ollama stream missing response body",
        retryable: false,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasToolCalls = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const chunk = JSON.parse(trimmed) as {
              message?: {
                content?: string;
                tool_calls?: Array<{
                  function: { name: string; arguments: Record<string, unknown> };
                }>;
              };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };

            if (chunk.message?.content) {
              yield { type: "text_delta", text: chunk.message.content };
            }

            if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
              hasToolCalls = true;
              for (let i = 0; i < chunk.message.tool_calls.length; i++) {
                const tc = chunk.message.tool_calls[i];
                yield {
                  type: "tool_call_delta",
                  index: i,
                  name: tc.function.name,
                  argumentsDelta:
                    typeof tc.function.arguments === "string"
                      ? tc.function.arguments
                      : JSON.stringify(tc.function.arguments),
                };
              }
            }

            if (chunk.done) {
              const pTokens = chunk.prompt_eval_count || 0;
              const cTokens = chunk.eval_count || 0;
              yield {
                type: "usage",
                promptTokens: pTokens,
                completionTokens: cTokens,
                totalTokens: pTokens + cTokens,
              };
              yield {
                type: "done",
                finishReason: hasToolCalls ? "tool_calls" : "stop",
              };
            }
          } catch {
            // Ignore corrupted lines
          }
        }
      }

      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim()) as {
            message?: {
              content?: string;
              tool_calls?: Array<{
                function: { name: string; arguments: Record<string, unknown> };
              }>;
            };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };

          if (chunk.message?.content) {
            yield { type: "text_delta", text: chunk.message.content };
          }

          if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
            hasToolCalls = true;
            for (let i = 0; i < chunk.message.tool_calls.length; i++) {
              const tc = chunk.message.tool_calls[i];
              yield {
                type: "tool_call_delta",
                index: i,
                name: tc.function.name,
                argumentsDelta:
                  typeof tc.function.arguments === "string"
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments),
              };
            }
          }

          if (chunk.done) {
            const pTokens = chunk.prompt_eval_count || 0;
            const cTokens = chunk.eval_count || 0;
            yield {
              type: "usage",
              promptTokens: pTokens,
              completionTokens: cTokens,
              totalTokens: pTokens + cTokens,
            };
            yield {
              type: "done",
              finishReason: hasToolCalls ? "tool_calls" : "stop",
            };
          }
        } catch {
          // Ignore
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


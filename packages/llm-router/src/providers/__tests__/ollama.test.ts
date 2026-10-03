import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "../ollama.js";
import {
  LLMEvent,
  ProviderUnavailableError,
  RateLimitError,
} from "../types.js";

function createNDJSONStream(lines: string[]): Response {
  const encoder = new TextEncoder();
  let idx = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => {
          if (idx < lines.length) {
            return { done: false, value: encoder.encode(lines[idx++]) };
          }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn(),
      }),
    },
  } as unknown as Response;
}

describe("OllamaProvider", () => {
  let provider: OllamaProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("healthCheck", () => {
    it("returns healthy: true with version on 200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ version: "0.5.7" }),
      } as unknown as Response);

      const health = await provider.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.message).toBe("Ollama v0.5.7");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.checkedAt).toBeGreaterThan(0);
    });

    it("returns healthy: false on non-200 (500) response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as unknown as Response);

      const health = await provider.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("HTTP 500");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("handles ECONNREFUSED offline daemon gracefully without throwing", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434"));

      const health = await provider.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("Ollama service offline");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns healthy: false with timeout message on aborted request / timeout", async () => {
      const abortErr = new DOMException("The operation was aborted", "AbortError");
      global.fetch = vi.fn().mockRejectedValue(abortErr);

      const health = await provider.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toBe("Health check timed out");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("listModels", () => {
    it("classifies model families with dynamic context windows (128k for llama3.1, 32k for mistral, 8k for llama3)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: "llama3.1:8b",
              model: "llama3.1:8b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 4700000000,
              digest: "abc1",
              details: { family: "llama" },
            },
            {
              name: "qwen2.5-coder:7b",
              model: "qwen2.5-coder:7b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 4700000000,
              digest: "abc2",
              details: { family: "qwen2" },
            },
            {
              name: "mistral:7b",
              model: "mistral:7b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 4100000000,
              digest: "abc3",
              details: { family: "mistral" },
            },
            {
              name: "llama3:8b",
              model: "llama3:8b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 4700000000,
              digest: "abc4",
              details: { family: "llama" },
            },
            {
              name: "gemma2:9b",
              model: "gemma2:9b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 5400000000,
              digest: "abc5",
              details: { family: "gemma2" },
            },
            {
              name: "custom-instruct:latest",
              model: "custom-instruct:latest",
              modified_at: "2026-09-01T00:00:00Z",
              size: 4000000000,
              digest: "abc6",
              details: { family: "mistral" },
            },
          ],
        }),
      } as unknown as Response);

      const models = await provider.listModels();
      expect(models).toHaveLength(6);

      const llama31 = models.find((m) => m.modelId === "llama3.1:8b");
      expect(llama31?.contextWindow).toBe(131072);
      expect(llama31?.capabilities.reasoning).toBe(true);

      const qwen25 = models.find((m) => m.modelId === "qwen2.5-coder:7b");
      expect(qwen25?.contextWindow).toBe(131072);
      expect(qwen25?.capabilities.coding).toBe(true);
      expect(qwen25?.capabilities.reasoning).toBe(true);

      const mistral = models.find((m) => m.modelId === "mistral:7b");
      expect(mistral?.contextWindow).toBe(32768);
      expect(mistral?.capabilities.reasoning).toBe(true);

      const llama3 = models.find((m) => m.modelId === "llama3:8b");
      expect(llama3?.contextWindow).toBe(8192);
      expect(llama3?.capabilities.reasoning).toBe(true);

      const gemma2 = models.find((m) => m.modelId === "gemma2:9b");
      expect(gemma2?.contextWindow).toBe(8192);

      const customFromFamily = models.find((m) => m.modelId === "custom-instruct:latest");
      expect(customFromFamily?.contextWindow).toBe(32768);
      expect(customFromFamily?.capabilities.reasoning).toBe(true);
    });

    it("evaluates model tool calling capabilities (llama3.1 has toolCalling: true, gemma has toolCalling: false)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: "llama3.1:8b",
              model: "llama3.1:8b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 4700000000,
              digest: "abc1",
            },
            {
              name: "gemma:2b",
              model: "gemma:2b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 1600000000,
              digest: "abc2",
            },
            {
              name: "llama2:7b",
              model: "llama2:7b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 3800000000,
              digest: "abc3",
            },
          ],
        }),
      } as unknown as Response);

      const models = await provider.listModels();
      const llama31 = models.find((m) => m.modelId === "llama3.1:8b");
      const gemma = models.find((m) => m.modelId === "gemma:2b");
      const llama2 = models.find((m) => m.modelId === "llama2:7b");

      expect(llama31?.capabilities.toolCalling).toBe(true);
      expect(gemma?.capabilities.toolCalling).toBe(false);
      expect(llama2?.capabilities.toolCalling).toBe(false);
    });

    it("verifies zero-cost pricing for all local models (isFree: true, cost 0)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: "deepseek-coder:6.7b",
              model: "deepseek-coder:6.7b",
              modified_at: "2026-09-01T00:00:00Z",
              size: 3800000000,
              digest: "def1",
            },
          ],
        }),
      } as unknown as Response);

      const models = await provider.listModels();
      expect(models).toHaveLength(1);
      const model = models[0];

      expect(model.pricing.isFree).toBe(true);
      expect(model.pricing.inputCostPer1k).toBe(0);
      expect(model.pricing.outputCostPer1k).toBe(0);
      expect(model.pricing.currency).toBe("USD");
    });

    it("throws ProviderUnavailableError with retryable: true on network failure", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434"));

      await expect(provider.listModels()).rejects.toThrow(ProviderUnavailableError);

      try {
        await provider.listModels();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const provErr = err as ProviderUnavailableError;
        expect(provErr.code).toBe("PROVIDER_OFFLINE");
        expect(provErr.retryable).toBe(true);
      }
    });
  });

  describe("generate", () => {
    it("basic completion with prompt/completion token usage and finishReason 'stop'", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Hello from Ollama local model!",
          },
          prompt_eval_count: 14,
          eval_count: 9,
        }),
      } as unknown as Response);

      const response = await provider.generate({
        modelId: "llama3.1:8b",
        messages: [{ role: "user", content: "Say hello" }],
      });

      expect(response.providerId).toBe("ollama");
      expect(response.modelId).toBe("llama3.1:8b");
      expect(response.text).toBe("Hello from Ollama local model!");
      expect(response.usage.promptTokens).toBe(14);
      expect(response.usage.completionTokens).toBe(9);
      expect(response.usage.totalTokens).toBe(23);
      expect(response.finishReason).toBe("stop");
      expect(response.toolCalls).toBeUndefined();
    });

    it("request with systemInstruction verifies system message included in payload", async () => {
      let capturedBody: { messages?: Array<{ role: string; content: string }> } | null = null;
      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse((init?.body as string) || "{}");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { role: "assistant", content: "Understood." },
            prompt_eval_count: 10,
            eval_count: 2,
          }),
        };
      });

      await provider.generate({
        modelId: "llama3.1:8b",
        systemInstruction: "You are an expert TypeScript engineer.",
        messages: [{ role: "user", content: "Refactor this function." }],
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.messages?.[0]).toEqual({
        role: "system",
        content: "You are an expert TypeScript engineer.",
      });
      expect(capturedBody!.messages?.[1]).toEqual({
        role: "user",
        content: "Refactor this function.",
      });
    });

    it("request with tools and response with tool_calls parses ToolCall array", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "searchFiles",
                  arguments: { query: "vitest.config.ts" },
                },
              },
            ],
          },
          prompt_eval_count: 20,
          eval_count: 12,
        }),
      } as unknown as Response);

      const response = await provider.generate({
        modelId: "llama3.1:8b",
        tools: [
          {
            name: "searchFiles",
            description: "Search local files",
            parameters: { type: "object" },
          },
        ],
        messages: [{ role: "user", content: "Find the vitest config" }],
      });

      expect(response.finishReason).toBe("tool_calls");
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe("searchFiles");
      expect(response.toolCalls?.[0].arguments).toEqual({
        query: "vitest.config.ts",
      });
    });

    it("HTTP 429 maps to RateLimitError with retryable: true", async () => {
      const headers = new Headers();
      headers.set("retry-after", "20");

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers,
        text: async () => "Concurrency limit reached",
      } as unknown as Response);

      await expect(
        provider.generate({ modelId: "llama3.1:8b", messages: [] })
      ).rejects.toThrow(RateLimitError);

      try {
        await provider.generate({ modelId: "llama3.1:8b", messages: [] });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RateLimitError);
        const rateErr = err as RateLimitError;
        expect(rateErr.code).toBe("RATE_LIMIT");
        expect(rateErr.retryable).toBe(true);
        expect(rateErr.retryAfterMs).toBe(20000);
      }
    });

    it("HTTP 500 maps to ProviderUnavailableError with retryable: true", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => "Model failed to load into VRAM",
      } as unknown as Response);

      await expect(
        provider.generate({ modelId: "llama3.1:8b", messages: [] })
      ).rejects.toThrow(ProviderUnavailableError);

      try {
        await provider.generate({ modelId: "llama3.1:8b", messages: [] });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const provErr = err as ProviderUnavailableError;
        expect(provErr.code).toBe("PROVIDER_OFFLINE");
        expect(provErr.retryable).toBe(true);
      }
    });

    it("network error (ECONNREFUSED) throws ProviderUnavailableError", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434"));

      await expect(
        provider.generate({ modelId: "llama3.1:8b", messages: [] })
      ).rejects.toThrow(ProviderUnavailableError);
    });

    it("resolves effectiveSignal from request.signal when signal argument is omitted", async () => {
      const controller = new AbortController();
      let passedSignal: AbortSignal | undefined;

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        passedSignal = init?.signal;
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: "Done" } }),
        };
      });

      await provider.generate({
        modelId: "llama3.1:8b",
        messages: [{ role: "user", content: "Hi" }],
        signal: controller.signal,
      });

      expect(passedSignal).toBe(controller.signal);
    });
  });

  describe("stream", () => {
    it("multi-chunk text deltas with usage and terminal done event with finishReason 'stop'", async () => {
      const lines = [
        JSON.stringify({
          message: { role: "assistant", content: "Hello " },
          done: false,
        }) + "\n",
        JSON.stringify({
          message: { role: "assistant", content: "world from stream!" },
          done: false,
        }) + "\n",
        JSON.stringify({
          done: true,
          prompt_eval_count: 18,
          eval_count: 11,
        }) + "\n",
      ];

      global.fetch = vi.fn().mockResolvedValue(createNDJSONStream(lines));

      const events: LLMEvent[] = [];
      for await (const event of provider.stream({
        modelId: "llama3.1:8b",
        messages: [{ role: "user", content: "Stream test" }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(4);
      expect(events[0]).toEqual({ type: "text_delta", text: "Hello " });
      expect(events[1]).toEqual({
        type: "text_delta",
        text: "world from stream!",
      });
      expect(events[2]).toEqual({
        type: "usage",
        promptTokens: 18,
        completionTokens: 11,
        totalTokens: 29,
      });
      expect(events[3]).toEqual({ type: "done", finishReason: "stop" });
    });

    it("multi-chunk tool call deltas with terminal done event with finishReason 'tool_calls'", async () => {
      const lines = [
        JSON.stringify({
          message: {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  name: "readFile",
                  arguments: { path: "src/index.ts" },
                },
              },
            ],
          },
          done: false,
        }) + "\n",
        JSON.stringify({
          done: true,
          prompt_eval_count: 22,
          eval_count: 8,
        }) + "\n",
      ];

      global.fetch = vi.fn().mockResolvedValue(createNDJSONStream(lines));

      const events: LLMEvent[] = [];
      for await (const event of provider.stream({
        modelId: "llama3.1:8b",
        messages: [{ role: "user", content: "Read index file" }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({
        type: "tool_call_delta",
        index: 0,
        name: "readFile",
        argumentsDelta: JSON.stringify({ path: "src/index.ts" }),
      });
      expect(events[1]).toEqual({
        type: "usage",
        promptTokens: 22,
        completionTokens: 8,
        totalTokens: 30,
      });
      expect(events[2]).toEqual({ type: "done", finishReason: "tool_calls" });
    });

    it("stream with AbortSignal aborts cleanly", async () => {
      const controller = new AbortController();
      controller.abort();

      const events: LLMEvent[] = [];
      for await (const event of provider.stream(
        { modelId: "llama3.1:8b", messages: [] },
        controller.signal
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      if (events[0].type === "error") {
        expect(events[0].retryable).toBe(false);
      }
    });

    it("offline daemon emits error event with code PROVIDER_OFFLINE", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434"));

      const events: LLMEvent[] = [];
      for await (const event of provider.stream({
        modelId: "llama3.1:8b",
        messages: [{ role: "user", content: "Test" }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      if (events[0].type === "error") {
        expect(events[0].code).toBe("PROVIDER_OFFLINE");
        expect(events[0].retryable).toBe(true);
      }
    });

    it("HTTP 500 error emits error event with code PROVIDER_OFFLINE", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => "Internal server crash",
      } as unknown as Response);

      const events: LLMEvent[] = [];
      for await (const event of provider.stream({
        modelId: "llama3.1:8b",
        messages: [{ role: "user", content: "Test" }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      if (events[0].type === "error") {
        expect(events[0].code).toBe("PROVIDER_OFFLINE");
        expect(events[0].retryable).toBe(true);
      }
    });
  });

  describe("getQuota", () => {
    it("returns null quota object cleanly", async () => {
      const quota = await provider.getQuota();
      expect(quota).toEqual({
        remainingRequests: null,
        remainingTokens: null,
        resetTimeMs: null,
        limitRequests: null,
        limitTokens: null,
      });
    });
  });
});

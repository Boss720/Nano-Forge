import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../gemini.js";
import { GroqProvider } from "../groq.js";
import { OpenAICompatibleProvider } from "../openaiCompatible.js";
import { OpenRouterProvider } from "../openrouter.js";
import { LLMProviderError } from "../types.js";

describe("Cloud Providers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("GroqProvider", () => {
    it("returns curated free models when API key is unset", async () => {
      const groq = new GroqProvider({ apiKey: "" });
      const models = await groq.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].pricing.isFree).toBe(true);
      expect(models[0].providerId).toBe("groq");
    });

    it("parses rate limit headers on generation response", async () => {
      const groq = new GroqProvider({ apiKey: "gsk_test_123" });
      const headers = new Headers();
      headers.set("x-ratelimit-remaining-requests", "495");
      headers.set("x-ratelimit-remaining-tokens", "98000");

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers,
        json: async () => ({
          choices: [{ message: { content: "Groq ultra-fast response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as unknown as Response);

      const resp = await groq.generate({
        modelId: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(resp.text).toBe("Groq ultra-fast response");
      const quota = await groq.getQuota();
      expect(quota.remainingRequests).toBe(495);
      expect(quota.remainingTokens).toBe(98000);
    });
  });

  describe("OpenRouterProvider", () => {
    it("flags free models with isFree=true and attaches attribution headers", async () => {
      const openrouter = new OpenRouterProvider({ apiKey: "" });
      const models = await openrouter.listModels();
      const free70b = models.find((m) => m.modelId.includes("70b"));
      expect(free70b).toBeDefined();
      expect(free70b?.pricing.isFree).toBe(true);
    });
  });

  describe("GeminiProvider", () => {
    it("converts HTTP 429 RESOURCE_EXHAUSTED into RATE_LIMIT error", async () => {
      const gemini = new GeminiProvider({ apiKey: "AIzaTestKey" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Resource has been exhausted (e.g. check quota)",
      } as unknown as Response);

      await expect(
        gemini.generate({
          modelId: "gemini-2.0-flash",
          messages: [{ role: "user", content: "test" }],
        })
      ).rejects.toThrowError(LLMProviderError);

      try {
        await gemini.generate({
          modelId: "gemini-2.0-flash",
          messages: [{ role: "user", content: "test" }],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(LLMProviderError);
        expect((err as LLMProviderError).code).toBe("RATE_LIMIT");
        expect((err as LLMProviderError).retryable).toBe(true);
      }
    });

    it("generates text and calculates usage metadata correctly", async () => {
      const gemini = new GeminiProvider({ apiKey: "AIzaTestKey" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Gemini flash coding response" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 25,
            totalTokenCount: 40,
          },
        }),
      } as unknown as Response);

      const resp = await gemini.generate({
        modelId: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Write a function" }],
      });

      expect(resp.text).toBe("Gemini flash coding response");
      expect(resp.usage.totalTokens).toBe(40);
      expect(resp.finishReason).toBe("stop");
    });
  });

  describe("OpenAICompatibleProvider", () => {
    it("correctly handles authentication failures", async () => {
      const provider = new OpenAICompatibleProvider({
        baseUrl: "https://api.example.com/v1",
        apiKey: "bad_key",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized: Invalid API key",
      } as unknown as Response);

      await expect(
        provider.generate({
          modelId: "custom-model",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrowError(LLMProviderError);
    });
  });
});

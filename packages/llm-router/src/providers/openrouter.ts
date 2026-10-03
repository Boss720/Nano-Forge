import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { ModelDescriptor } from "./types.js";

export interface OpenRouterOptions {
  apiKey?: string;
  baseUrl?: string;
  referer?: string;
  appTitle?: string;
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterOptions = {}) {
    super({
      providerId: "openrouter",
      name: "OpenRouter",
      baseUrl: options.baseUrl || "https://openrouter.ai/api/v1",
      apiKey: options.apiKey || process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": options.referer || "https://nanoforge.dev",
        "X-Title": options.appTitle || "NanoForge",
      },
    });
  }

  override async listModels(): Promise<ModelDescriptor[]> {
    if (!this.apiKey) {
      return this.getCuratedFreeModels();
    }

    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        return this.getCuratedFreeModels();
      }

      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
        }>;
      };

      const raw = data.data || [];
      return raw.map((m) => {
        const isFree =
          m.id.endsWith(":free") ||
          (parseFloat(m.pricing?.prompt || "0") === 0 &&
            parseFloat(m.pricing?.completion || "0") === 0);
        const nameLower = m.id.toLowerCase();
        const isCoding = nameLower.includes("code") || nameLower.includes("coder") || nameLower.includes("deepseek");
        const isReasoning = nameLower.includes("r1") || nameLower.includes("reason") || nameLower.includes("70b");

        return {
          providerId: this.id,
          modelId: m.id,
          displayName: m.name || m.id,
          availability: "available",
          pricing: {
            inputCostPer1k: parseFloat(m.pricing?.prompt || "0") * 1000,
            outputCostPer1k: parseFloat(m.pricing?.completion || "0") * 1000,
            isFree,
            currency: "USD",
          },
          contextWindow: m.context_length || 65536,
          maxOutputTokens: 8192,
          capabilities: {
            coding: isCoding,
            reasoning: isReasoning,
            vision: nameLower.includes("vision"),
            toolCalling: true,
            structuredOutput: true,
            streaming: true,
          },
          estimatedQuality: {
            coding: isCoding ? 0.84 : 0.72,
            reasoning: isReasoning ? 0.85 : 0.7,
            debugging: isCoding ? 0.8 : 0.65,
            planning: isReasoning ? 0.8 : 0.68,
            summarization: 0.8,
            classification: 0.85,
          },
          runtime: {
            latency: 180,
            tokensPerSecond: 45,
            successRate: 0.98,
            recentFailures: 0,
            rateLimitedUntil: null,
            remainingQuota: null,
          },
        };
      });
    } catch {
      return this.getCuratedFreeModels();
    }
  }

  private getCuratedFreeModels(): ModelDescriptor[] {
    return [
      {
        providerId: this.id,
        modelId: "meta-llama/llama-3.3-70b-instruct:free",
        displayName: "OpenRouter: Llama 3.3 70B Instruct (Free)",
        availability: "available",
        pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
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
          coding: 0.86,
          reasoning: 0.88,
          debugging: 0.82,
          planning: 0.84,
          summarization: 0.86,
          classification: 0.89,
        },
        runtime: {
          latency: 150,
          tokensPerSecond: 40,
          successRate: 0.98,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      },
      {
        providerId: this.id,
        modelId: "deepseek/deepseek-r1:free",
        displayName: "OpenRouter: DeepSeek R1 (Free)",
        availability: "available",
        pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
        contextWindow: 65536,
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
          coding: 0.92,
          reasoning: 0.94,
          debugging: 0.9,
          planning: 0.9,
          summarization: 0.85,
          classification: 0.9,
        },
        runtime: {
          latency: 220,
          tokensPerSecond: 30,
          successRate: 0.95,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: null,
        },
      },
    ];
  }
}

import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { ModelDescriptor } from "./types.js";

export interface GroqProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(options: GroqProviderOptions = {}) {
    super({
      providerId: "groq",
      name: "Groq Fast Inference",
      baseUrl: options.baseUrl || "https://api.groq.com/openai/v1",
      apiKey: options.apiKey || process.env.GROQ_API_KEY,
    });
  }

  override async listModels(): Promise<ModelDescriptor[]> {
    // If API key is not provided or offline, return curated default models with metadata
    if (!this.apiKey) {
      return this.getCuratedModels();
    }

    try {
      const dynamicModels = await super.listModels();
      if (dynamicModels.length > 0) {
        return dynamicModels.map((m) => {
          const isLlama70b = m.modelId.includes("70b");
          return {
            ...m,
            providerId: this.id,
            displayName: `Groq: ${m.modelId}`,
            pricing: {
              inputCostPer1k: 0,
              outputCostPer1k: 0,
              isFree: true, // Groq offers a generous free tier
              currency: "USD",
            },
            contextWindow: 128000,
            maxOutputTokens: 8192,
            capabilities: {
              coding: true,
              reasoning: isLlama70b,
              vision: m.modelId.includes("vision"),
              toolCalling: true,
              structuredOutput: true,
              streaming: true,
            },
            estimatedQuality: {
              coding: isLlama70b ? 0.85 : 0.75,
              reasoning: isLlama70b ? 0.88 : 0.72,
              debugging: isLlama70b ? 0.82 : 0.7,
              planning: isLlama70b ? 0.84 : 0.68,
              summarization: 0.85,
              classification: 0.88,
            },
            runtime: {
              latency: 35,
              tokensPerSecond: 250, // Groq LPU speed
              successRate: 0.99,
              recentFailures: 0,
              rateLimitedUntil: null,
              remainingQuota: this.lastQuotaState?.remainingRequests ?? null,
            },
          };
        });
      }
    } catch {
      // Fallback to curated models if API list call fails
    }

    return this.getCuratedModels();
  }

  private getCuratedModels(): ModelDescriptor[] {
    return [
      {
        providerId: this.id,
        modelId: "llama-3.3-70b-versatile",
        displayName: "Groq: Llama 3.3 70B Versatile",
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
          debugging: 0.83,
          planning: 0.85,
          summarization: 0.87,
          classification: 0.9,
        },
        runtime: {
          latency: 30,
          tokensPerSecond: 280,
          successRate: 1.0,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: this.lastQuotaState?.remainingRequests ?? null,
        },
      },
      {
        providerId: this.id,
        modelId: "llama-3.1-8b-instant",
        displayName: "Groq: Llama 3.1 8B Instant",
        availability: "available",
        pricing: { inputCostPer1k: 0, outputCostPer1k: 0, isFree: true, currency: "USD" },
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: {
          coding: true,
          reasoning: false,
          vision: false,
          toolCalling: true,
          structuredOutput: true,
          streaming: true,
        },
        estimatedQuality: {
          coding: 0.74,
          reasoning: 0.7,
          debugging: 0.68,
          planning: 0.65,
          summarization: 0.8,
          classification: 0.85,
        },
        runtime: {
          latency: 20,
          tokensPerSecond: 450,
          successRate: 1.0,
          recentFailures: 0,
          rateLimitedUntil: null,
          remainingQuota: this.lastQuotaState?.remainingRequests ?? null,
        },
      },
    ];
  }
}

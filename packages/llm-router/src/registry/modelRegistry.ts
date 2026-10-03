import { LLMProvider } from "../providers/base.js";
import { ModelDescriptor } from "../providers/types.js";
import { QuotaTracker } from "../quota/quotaTracker.js";

export class ModelRegistry {
  private readonly providers = new Map<string, LLMProvider>();
  private readonly models = new Map<string, ModelDescriptor>();
  private readonly rateLimitCounters = new Map<string, number>();
  readonly quotaTracker: QuotaTracker;

  constructor(quotaTracker?: QuotaTracker) {
    this.quotaTracker = quotaTracker || new QuotaTracker();
  }

  private getKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId);
  }

  getAllProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  registerModel(descriptor: ModelDescriptor): void {
    const key = this.getKey(descriptor.providerId, descriptor.modelId);
    this.models.set(key, descriptor);
  }

  async refreshModels(): Promise<ModelDescriptor[]> {
    const refreshed: ModelDescriptor[] = [];
    const providerList = Array.from(this.providers.values());

    await Promise.allSettled(
      providerList.map(async (provider) => {
        try {
          const descriptors = await provider.listModels();
          for (const d of descriptors) {
            const key = this.getKey(d.providerId, d.modelId);
            const existing = this.models.get(key);

            // Preserve runtime telemetry & cooldowns if already tracked
            if (existing) {
              this.models.set(key, {
                ...d,
                runtime: {
                  ...d.runtime,
                  latency: existing.runtime.latency,
                  successRate: existing.runtime.successRate,
                  recentFailures: existing.runtime.recentFailures,
                  rateLimitedUntil: existing.runtime.rateLimitedUntil,
                },
              });
            } else {
              this.models.set(key, d);
            }
            refreshed.push(this.models.get(key)!);
          }

          // Also check quota if supported
          if (provider.getQuota) {
            const quota = await provider.getQuota();
            this.quotaTracker.updateQuota(provider.id, quota);
          }
        } catch {
          // Provider offline or list failed; preserve existing models or continue
        }
      })
    );

    return refreshed;
  }

  getAllModels(): ModelDescriptor[] {
    return Array.from(this.models.values());
  }

  getModel(providerId: string, modelId: string): ModelDescriptor | undefined {
    return this.models.get(this.getKey(providerId, modelId));
  }

  getAvailableModels(): ModelDescriptor[] {
    const now = Date.now();
    return Array.from(this.models.values()).filter((m) => {
      if (m.availability === "unavailable") return false;
      if (m.runtime.rateLimitedUntil !== null && m.runtime.rateLimitedUntil > now) {
        return false;
      }
      return true;
    });
  }

  markRateLimited(providerId: string, modelId: string, retryAfterMs?: number): void {
    const key = this.getKey(providerId, modelId);
    const model = this.models.get(key);
    if (!model) return;

    const hitCount = (this.rateLimitCounters.get(key) || 0) + 1;
    this.rateLimitCounters.set(key, hitCount);

    // Cooldown progression: 5s -> 15s -> 60s -> 300s
    let cooldownMs: number;
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      cooldownMs = retryAfterMs;
    } else {
      switch (hitCount) {
        case 1:
          cooldownMs = 5000;
          break;
        case 2:
          cooldownMs = 15000;
          break;
        case 3:
          cooldownMs = 60000;
          break;
        default:
          cooldownMs = 300000;
          break;
      }
    }

    model.runtime.rateLimitedUntil = Date.now() + cooldownMs;
    model.runtime.recentFailures += 1;
  }

  markFailure(providerId: string, modelId: string): void {
    const key = this.getKey(providerId, modelId);
    const model = this.models.get(key);
    if (!model) return;

    model.runtime.recentFailures += 1;
    model.runtime.successRate = Math.max(0, model.runtime.successRate - 0.1);
  }

  markSuccess(providerId: string, modelId: string, latencyMs: number): void {
    const key = this.getKey(providerId, modelId);
    const model = this.models.get(key);
    if (!model) return;

    model.runtime.recentFailures = 0;
    model.runtime.rateLimitedUntil = null;
    this.rateLimitCounters.delete(key);
    model.runtime.successRate = Math.min(1.0, model.runtime.successRate + 0.05);
    model.runtime.latency = Math.round((model.runtime.latency * 4 + latencyMs) / 5);
  }
}

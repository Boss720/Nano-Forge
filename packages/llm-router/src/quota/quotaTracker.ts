import { QuotaState } from "../providers/types.js";

export interface QuotaEntry {
  providerId: string;
  modelId?: string;
  remainingRequests: number | null;
  remainingTokens: number | null;
  limitRequests: number | null;
  limitTokens: number | null;
  resetTimeMs: number | null;
  updatedAt: number;
}

export class QuotaTracker {
  private readonly quotas = new Map<string, QuotaEntry>();

  private makeKey(providerId: string, modelId?: string): string {
    return modelId ? `${providerId}:${modelId}` : providerId;
  }

  updateQuota(providerId: string, quota: QuotaState, modelId?: string): void {
    const key = this.makeKey(providerId, modelId);
    this.quotas.set(key, {
      providerId,
      modelId,
      remainingRequests: quota.remainingRequests,
      remainingTokens: quota.remainingTokens,
      limitRequests: quota.limitRequests,
      limitTokens: quota.limitTokens,
      resetTimeMs: quota.resetTimeMs,
      updatedAt: Date.now(),
    });
  }

  getQuota(providerId: string, modelId?: string): QuotaEntry | undefined {
    return this.quotas.get(this.makeKey(providerId, modelId)) || this.quotas.get(providerId);
  }

  /**
   * Deterministic scarcity penalty calculation:
   * Returns 0 if abundant, local, or unknown.
   * If limit and remaining are known: ((limit - remaining) / limit) * 20.
   */
  calculateScarcityPenalty(providerId: string, modelId?: string): number {
    const entry = this.getQuota(providerId, modelId);
    if (!entry) return 0;

    // Check request-level limit
    if (entry.limitRequests && entry.remainingRequests !== null && entry.limitRequests > 0) {
      const usedFraction = (entry.limitRequests - entry.remainingRequests) / entry.limitRequests;
      return Math.max(0, Math.min(20, usedFraction * 20));
    }

    // Check token-level limit
    if (entry.limitTokens && entry.remainingTokens !== null && entry.limitTokens > 0) {
      const usedFraction = (entry.limitTokens - entry.remainingTokens) / entry.limitTokens;
      return Math.max(0, Math.min(20, usedFraction * 20));
    }

    return 0;
  }
}

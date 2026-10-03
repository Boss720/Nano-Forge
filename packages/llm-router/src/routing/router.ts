import { LLMEvent, LLMProviderError, LLMRequest, LLMResponse, ModelDescriptor } from "../providers/types.js";
import { ModelRegistry } from "../registry/modelRegistry.js";
import { CandidateFilter, FilterOptions } from "./candidateFilter.js";
import { ModelScorer, ScoredCandidate } from "./scorer.js";
import { TaskClassification, TaskClassifier, TaskComplexityClass } from "./taskClassifier.js";

export interface RouterOptions extends FilterOptions {
  modelOverride?: string;
  providerOverride?: string;
  capabilityFloor?: number;
  complexityClass?: TaskComplexityClass;
}

export interface RoutingDecision {
  selectedModel: ModelDescriptor;
  alternates: ModelDescriptor[];
  classification: TaskClassification;
  score: number;
  breakdown: ScoredCandidate["breakdown"];
  explanation: string;
}

export class LLMRouter {
  readonly classifier: TaskClassifier;
  readonly filter: CandidateFilter;
  readonly scorer: ModelScorer;

  constructor(readonly registry: ModelRegistry) {
    this.classifier = new TaskClassifier();
    this.filter = new CandidateFilter();
    this.scorer = new ModelScorer(registry.quotaTracker);
  }

  route(prompt: string, options: RouterOptions = {}): RoutingDecision {
    const classification = this.classifier.classify(prompt);
    if (options.capabilityFloor !== undefined) {
      classification.capabilityFloor = options.capabilityFloor;
    }
    if (options.complexityClass !== undefined) {
      classification.complexityClass = options.complexityClass;
    }
    const availableModels = this.registry.getAvailableModels();

    // Check manual override
    if (options.modelOverride) {
      const match = availableModels.find((m) => m.modelId === options.modelOverride);
      if (match) {
        return {
          selectedModel: match,
          alternates: [],
          classification,
          score: 100,
          breakdown: {
            qualityComponent: 40,
            reliabilityComponent: 15,
            speedComponent: 10,
            freeBonus: 25,
            conservationPenalty: 0,
            scarcityPenalty: 0,
            latencyPenalty: 0,
          },
          explanation: `Manually pinned to model: ${match.displayName}`,
        };
      }
    }

    const { eligible, excluded } = this.filter.filter(availableModels, classification, options);

    if (eligible.length === 0) {
      const reasons = excluded.map((e) => `${e.model.modelId}: ${e.reason}`).join("; ");
      throw new LLMProviderError(
        "QUOTA_EXHAUSTED",
        `No eligible models found for task (${classification.complexityClass}). Exclusions: [${reasons}]`,
        false
      );
    }

    const ranked = this.scorer.scoreAndRank(eligible, classification);
    const top = ranked[0];
    const alternates = ranked.slice(1).map((r) => r.model);

    const explanation = [
      `Selected ${top.model.displayName}`,
      `Complexity: ${classification.complexityClass} (Floor: ${classification.capabilityFloor})`,
      top.model.pricing.isFree ? "Free tier" : `Cost: $${top.model.pricing.inputCostPer1k}/1k`,
      `Score: ${top.score}`,
    ].join(" | ");

    return {
      selectedModel: top.model,
      alternates,
      classification,
      score: top.score,
      breakdown: top.breakdown,
      explanation,
    };
  }

  async execute(request: LLMRequest, options: RouterOptions = {}): Promise<LLMResponse & { failovers?: string[] }> {
    const userPrompt = request.messages.find((m) => m.role === "user")?.content || "";
    const decision = this.route(userPrompt, options);

    const candidatesToTry = [decision.selectedModel, ...decision.alternates];
    const failovers: string[] = [];

    for (let i = 0; i < candidatesToTry.length; i++) {
      const candidate = candidatesToTry[i];
      const provider = this.registry.getProvider(candidate.providerId);

      if (!provider) {
        failovers.push(`Provider ${candidate.providerId} not found in registry`);
        continue;
      }

      const reqWithModel: LLMRequest = {
        ...request,
        modelId: candidate.modelId,
      };

      try {
        const start = Date.now();
        const response = await provider.generate(reqWithModel, request.signal);
        this.registry.markSuccess(candidate.providerId, candidate.modelId, Date.now() - start);

        return {
          ...response,
          failovers: failovers.length > 0 ? failovers : undefined,
        };
      } catch (err) {
        const isRateLimit =
          err instanceof LLMProviderError && err.code === "RATE_LIMIT";
        const isOffline =
          err instanceof LLMProviderError && err.code === "PROVIDER_OFFLINE";

        if (isRateLimit) {
          const retryMs = (err as LLMProviderError).retryAfterMs;
          this.registry.markRateLimited(candidate.providerId, candidate.modelId, retryMs);
          failovers.push(
            `Rate limit (429) hit on ${candidate.modelId}; failed over to alternate`
          );
        } else if (isOffline) {
          this.registry.markFailure(candidate.providerId, candidate.modelId);
          failovers.push(`Provider offline for ${candidate.modelId}; failed over`);
        } else {
          // If not retryable or fatal, mark failure and try next alternate
          this.registry.markFailure(candidate.providerId, candidate.modelId);
          failovers.push(
            `Error (${(err as Error).message}) on ${candidate.modelId}; trying alternate`
          );
        }

        // If this was the last candidate, re-throw error
        if (i === candidatesToTry.length - 1) {
          throw err;
        }
      }
    }

    throw new LLMProviderError("PROVIDER_OFFLINE", "All model candidates exhausted", false);
  }

  async *stream(request: LLMRequest, options: RouterOptions = {}): AsyncIterable<LLMEvent> {
    const userPrompt = request.messages.find((m) => m.role === "user")?.content || "";
    const decision = this.route(userPrompt, options);

    const provider = this.registry.getProvider(decision.selectedModel.providerId);
    if (!provider) {
      yield {
        type: "error",
        code: "PROVIDER_OFFLINE",
        message: `Provider ${decision.selectedModel.providerId} not registered`,
        retryable: false,
      };
      return;
    }

    const reqWithModel: LLMRequest = {
      ...request,
      modelId: decision.selectedModel.modelId,
    };

    yield* provider.stream(reqWithModel, request.signal);
  }
}

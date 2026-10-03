import { ModelDescriptor } from "../providers/types.js";
import { QuotaTracker } from "../quota/quotaTracker.js";
import { TaskClassification } from "./taskClassifier.js";

export interface ScoredCandidate {
  model: ModelDescriptor;
  score: number;
  breakdown: {
    qualityComponent: number;
    reliabilityComponent: number;
    speedComponent: number;
    freeBonus: number;
    conservationPenalty: number;
    scarcityPenalty: number;
    latencyPenalty: number;
  };
}

export class ModelScorer {
  constructor(private readonly quotaTracker?: QuotaTracker) {}

  scoreCandidate(model: ModelDescriptor, task: TaskClassification): ScoredCandidate {
    // Quality metric based on task demands
    const rawQuality = task.needsReasoning
      ? model.estimatedQuality.reasoning
      : model.estimatedQuality.coding;

    // Capability floor economy rule:
    // On trivial and light tasks, excess quality has diminishing returns
    let effectiveQuality = rawQuality;
    if (task.complexityClass === "TRIVIAL" && rawQuality >= 0.5) {
      effectiveQuality = 0.5 + (rawQuality - 0.5) * 0.2;
    } else if (task.complexityClass === "LIGHT" && rawQuality >= 0.6) {
      effectiveQuality = 0.6 + (rawQuality - 0.6) * 0.3;
    }

    const qualityComponent = effectiveQuality * 40;
    const reliabilityComponent = model.runtime.successRate * 15;
    const speedFraction = Math.min(1.0, (model.runtime.tokensPerSecond || 50) / 200);
    const speedComponent = speedFraction * 10;
    const freeBonus = model.pricing.isFree ? 25 : 0;

    // Heavy Model Conservation Penalty:
    // Reserve heavy reasoning models (>= 0.85) for complex work; do not waste them on trivial tasks
    let conservationPenalty = 0;
    if (task.complexityClass === "TRIVIAL" && model.estimatedQuality.reasoning >= 0.85) {
      conservationPenalty = 15;
    } else if (task.complexityClass === "LIGHT" && model.estimatedQuality.reasoning >= 0.9) {
      conservationPenalty = 10;
    }

    const scarcityPenalty = this.quotaTracker
      ? this.quotaTracker.calculateScarcityPenalty(model.providerId, model.modelId)
      : 0;

    const latencySec = (model.runtime.latency || 50) / 1000;
    const latencyPenalty = Math.min(15, latencySec * 2);

    const totalScore =
      qualityComponent +
      reliabilityComponent +
      speedComponent +
      freeBonus -
      conservationPenalty -
      scarcityPenalty -
      latencyPenalty;

    return {
      model,
      score: Math.round(totalScore * 100) / 100,
      breakdown: {
        qualityComponent: Math.round(qualityComponent * 100) / 100,
        reliabilityComponent: Math.round(reliabilityComponent * 100) / 100,
        speedComponent: Math.round(speedComponent * 100) / 100,
        freeBonus,
        conservationPenalty,
        scarcityPenalty: Math.round(scarcityPenalty * 100) / 100,
        latencyPenalty: Math.round(latencyPenalty * 100) / 100,
      },
    };
  }

  scoreAndRank(models: ModelDescriptor[], task: TaskClassification): ScoredCandidate[] {
    const scored = models.map((m) => this.scoreCandidate(m, task));

    // Deterministic tie-breaking:
    // 1. Score descending
    // 2. Cost ascending
    // 3. Model ID alphabetical
    return scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.model.pricing.inputCostPer1k !== b.model.pricing.inputCostPer1k) {
        return a.model.pricing.inputCostPer1k - b.model.pricing.inputCostPer1k;
      }
      return a.model.modelId.localeCompare(b.model.modelId);
    });
  }
}

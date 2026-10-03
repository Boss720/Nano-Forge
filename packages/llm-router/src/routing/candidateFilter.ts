import { ModelDescriptor } from "../providers/types.js";
import { TaskClassification } from "./taskClassifier.js";

export interface FilterOptions {
  requireLocal?: boolean;
  allowPaidFallback?: boolean;
  maxCostPer1k?: number;
}

export class CandidateFilter {
  filter(
    models: ModelDescriptor[],
    task: TaskClassification,
    options: FilterOptions = {}
  ): { eligible: ModelDescriptor[]; excluded: Array<{ model: ModelDescriptor; reason: string }> } {
    const eligible: ModelDescriptor[] = [];
    const excluded: Array<{ model: ModelDescriptor; reason: string }> = [];
    const now = Date.now();

    for (const model of models) {
      if (model.availability === "unavailable") {
        excluded.push({ model, reason: "Provider is offline or unavailable" });
        continue;
      }

      if (model.runtime.rateLimitedUntil !== null && model.runtime.rateLimitedUntil > now) {
        excluded.push({
          model,
          reason: `Rate limited until ${new Date(model.runtime.rateLimitedUntil).toISOString()}`,
        });
        continue;
      }

      if (options.requireLocal && model.providerId !== "ollama") {
        excluded.push({ model, reason: "Task requires local offline model" });
        continue;
      }

      if (task.needsVision && !model.capabilities.vision) {
        excluded.push({ model, reason: "Model lacks vision capability" });
        continue;
      }

      if (task.needsTools && !model.capabilities.toolCalling) {
        excluded.push({ model, reason: "Model lacks tool-calling capability" });
        continue;
      }

      if (task.estimatedPromptTokens > model.contextWindow) {
        excluded.push({
          model,
          reason: `Context window too small (${model.contextWindow} < ${task.estimatedPromptTokens})`,
        });
        continue;
      }

      if (task.needsCoding && model.estimatedQuality.coding < task.capabilityFloor) {
        excluded.push({
          model,
          reason: `Coding quality ${model.estimatedQuality.coding} below floor ${task.capabilityFloor}`,
        });
        continue;
      }

      if (task.needsReasoning && model.estimatedQuality.reasoning < task.capabilityFloor) {
        excluded.push({
          model,
          reason: `Reasoning quality ${model.estimatedQuality.reasoning} below floor ${task.capabilityFloor}`,
        });
        continue;
      }

      if (!options.allowPaidFallback && !model.pricing.isFree) {
        excluded.push({ model, reason: "Paid model disallowed by policy (allowPaidFallback: false)" });
        continue;
      }

      if (options.maxCostPer1k !== undefined && model.pricing.inputCostPer1k > options.maxCostPer1k) {
        excluded.push({ model, reason: `Cost ${model.pricing.inputCostPer1k} exceeds max budget` });
        continue;
      }

      eligible.push(model);
    }

    return { eligible, excluded };
  }
}

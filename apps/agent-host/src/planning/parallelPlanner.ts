/**
 * Parallel DAG Execution Planner & Economical Model Assignment.
 *
 * Implements planner intelligence determining:
 * - Topological execution wave partitioning
 * - File ownership overlap & conflict detection
 * - Conflict resolution: serialization (sequential dependency) or Git worktree isolation ("branch")
 * - Economical model tier assignment (flash_lite / flash / pro) and token budgets
 * - Concurrency gating respecting MAX_CONCURRENT_PRO_SUBAGENTS = 2 and MAX_CONCURRENT_SUBAGENTS = 8
 */

import type { ExecutionPlan, PlanStep } from "@protocol/plan";
import {
  type SubagentModelTier,
  type WorkspaceIsolationMode,
  TIER_DEFAULT_TOKEN_BUDGETS,
  MAX_CONCURRENT_PRO_SUBAGENTS,
  MAX_CONCURRENT_SUBAGENTS,
} from "@protocol/subagents";
import { patternsOverlap, normalizePattern } from "../agents/ownership.js";

export interface ParallelPlannerOptions {
  /** Conflict resolution strategy when two steps touch overlapping scopes in the same wave */
  conflictResolutionStrategy?: "serialize" | "isolate_branch";
  /** Maximum concurrent subagents per wave (defaults to 8) */
  maxConcurrency?: number;
  /** Maximum concurrent pro subagents per wave (defaults to 2) */
  maxProConcurrency?: number;
}

export interface PlannedStepAllocation {
  stepId: string;
  title: string;
  waveIndex: number;
  modelTier: Exclude<SubagentModelTier, "inherit">;
  budgetTokens: number;
  workspaceIsolation: WorkspaceIsolationMode;
  fileOwnership: string[];
  dependsOn: string[];
  conflictResolved?: "serialized" | "isolated_branch";
}

export interface ParallelPlanResult {
  waves: Array<{ waveIndex: number; stepIds: string[] }>;
  allocations: Map<string, PlannedStepAllocation>;
  totalWaves: number;
  totalSteps: number;
  conflictsDetected: number;
}

/**
 * Classifies a plan step into an economical model tier based on complexity,
 * side-effecting status, and description heuristics.
 */
export function classifyStepModelTier(step: PlanStep): Exclude<SubagentModelTier, "inherit"> {
  const text = `${step.title} ${step.description ?? ""}`.toLowerCase();

  // Architecture / complex reasoning / security review -> pro
  if (
    text.includes("architecture") ||
    text.includes("decompose") ||
    text.includes("race condition") ||
    text.includes("security review") ||
    text.includes("formal verification")
  ) {
    return "pro";
  }

  // Read-only / discovery / inspection / summaries / trivial search -> flash_lite
  if (
    step.sideEffecting === false ||
    text.includes("inspect") ||
    text.includes("reconnaissance") ||
    text.includes("search") ||
    text.includes("summarize") ||
    text.includes("read-only") ||
    text.includes("audit")
  ) {
    return "flash_lite";
  }

  // Standard coding, test generation, refactoring -> flash
  return "flash";
}

/**
 * Plans parallel execution waves with conflict detection and economical model assignment.
 */
export function planParallelExecution(
  plan: ExecutionPlan,
  options: ParallelPlannerOptions = {}
): ParallelPlanResult {
  const strategy = options.conflictResolutionStrategy ?? "serialize";
  const maxConcurrency = options.maxConcurrency ?? MAX_CONCURRENT_SUBAGENTS;
  const maxProConcurrency = options.maxProConcurrency ?? MAX_CONCURRENT_PRO_SUBAGENTS;

  const originalSteps = plan.steps ?? [];
  if (originalSteps.length === 0) {
    return {
      waves: [],
      allocations: new Map(),
      totalWaves: 0,
      totalSteps: 0,
      conflictsDetected: 0,
    };
  }

  // Clone step dependencies so we can adjust dynamically
  const stepMap = new Map<string, { step: PlanStep; dependsOn: Set<string> }>();
  for (const s of originalSteps) {
    stepMap.set(s.id, { step: s, dependsOn: new Set(s.dependsOn ?? []) });
  }

  const completed = new Set<string>();
  const allocations = new Map<string, PlannedStepAllocation>();
  const waves: Array<{ waveIndex: number; stepIds: string[] }> = [];
  let conflictsDetected = 0;
  let waveIdx = 0;

  while (completed.size < stepMap.size) {
    // 1. Find all steps whose dependencies are fully completed
    const readyStepIds: string[] = [];
    for (const [id, data] of stepMap.entries()) {
      if (completed.has(id)) continue;
      const depsSatisfied = Array.from(data.dependsOn).every((dep) => completed.has(dep));
      if (depsSatisfied) {
        readyStepIds.push(id);
      }
    }

    if (readyStepIds.length === 0) {
      // Dependency cycle or unresolvable dependency
      break;
    }

    // 2. Detect file scope overlap among ready candidate steps in this wave
    const currentWaveStepIds: string[] = [];
    let currentWaveProCount = 0;

    for (let i = 0; i < readyStepIds.length; i++) {
      if (currentWaveStepIds.length >= maxConcurrency) {
        break;
      }

      const candId = readyStepIds[i];
      const candStep = stepMap.get(candId)!.step;
      const candScopes = (candStep.affectedScopes ?? []).map(normalizePattern).filter(Boolean);
      let candTier = classifyStepModelTier(candStep);

      // Check Pro tier concurrency boundary
      if (candTier === "pro") {
        if (currentWaveProCount >= maxProConcurrency) {
          candTier = "flash"; // Downgrade to competent flash if pro concurrency limit reached
        } else {
          currentWaveProCount += 1;
        }
      }

      // Check collision against already scheduled steps in this wave
      let hasConflictWithScheduled = false;
      let conflictingScheduledId: string | undefined;

      for (const scheduledId of currentWaveStepIds) {
        const scheduledAlloc = allocations.get(scheduledId)!;
        const scheduledScopes = scheduledAlloc.fileOwnership;

        // Check if any scope overlaps
        for (const cScope of candScopes) {
          for (const sScope of scheduledScopes) {
            if (patternsOverlap(cScope, sScope)) {
              hasConflictWithScheduled = true;
              conflictingScheduledId = scheduledId;
              break;
            }
          }
          if (hasConflictWithScheduled) break;
        }
        if (hasConflictWithScheduled) break;
      }

      if (hasConflictWithScheduled && conflictingScheduledId) {
        conflictsDetected += 1;

        if (strategy === "serialize") {
          // Serialize: make candId depend on conflictingScheduledId; defer to next wave
          stepMap.get(candId)!.dependsOn.add(conflictingScheduledId);
          continue;
        } else {
          // Isolate via dedicated Git worktree branch
          allocations.set(candId, {
            stepId: candId,
            title: candStep.title,
            waveIndex: waveIdx,
            modelTier: candTier,
            budgetTokens: TIER_DEFAULT_TOKEN_BUDGETS[candTier],
            workspaceIsolation: "branch",
            fileOwnership: candScopes,
            dependsOn: Array.from(stepMap.get(candId)!.dependsOn),
            conflictResolved: "isolated_branch",
          });
          currentWaveStepIds.push(candId);
          continue;
        }
      }

      // No conflict: default to inherit mode
      allocations.set(candId, {
        stepId: candId,
        title: candStep.title,
        waveIndex: waveIdx,
        modelTier: candTier,
        budgetTokens: TIER_DEFAULT_TOKEN_BUDGETS[candTier],
        workspaceIsolation: "inherit",
        fileOwnership: candScopes,
        dependsOn: Array.from(stepMap.get(candId)!.dependsOn),
      });
      currentWaveStepIds.push(candId);
    }

    if (currentWaveStepIds.length === 0) {
      break;
    }

    waves.push({ waveIndex: waveIdx, stepIds: currentWaveStepIds });
    for (const id of currentWaveStepIds) {
      completed.add(id);
    }
    waveIdx += 1;
  }

  return {
    waves,
    allocations,
    totalWaves: waves.length,
    totalSteps: allocations.size,
    conflictsDetected,
  };
}

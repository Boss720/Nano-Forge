/**
 * Task 2 (host half) — plan validation and plan UI state machine.
 *
 * Validates an `ExecutionPlan` (from `@protocol/plan`) before it can be
 * approved or executed, and exports the shared plan UI state union with a
 * pure transition helper used by both the host coordinator and the UI.
 */

import type { ExecutionPlan, PlanStep } from "@protocol/plan";

export type ValidationErrorCode =
  | "duplicate_step_id"
  | "unknown_dependency"
  | "dependency_cycle"
  | "missing_approval";

export interface ValidationError {
  /** JSON-path-ish location, e.g. "steps[2].dependsOn[0]". */
  path: string;
  code: ValidationErrorCode;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

export function validatePlan(plan: ExecutionPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const steps: readonly PlanStep[] = plan.steps ?? [];

  // Duplicate step IDs (first occurrence wins for later lookups).
  const byId = new Map<string, { step: PlanStep; index: number }>();
  steps.forEach((step, i) => {
    const existing = byId.get(step.id);
    if (existing) {
      errors.push({
        path: `steps[${i}].id`,
        code: "duplicate_step_id",
        message: `Duplicate step id "${step.id}" (first occurrence at steps[${existing.index}]).`,
      });
    } else {
      byId.set(step.id, { step, index: i });
    }
  });

  // Unknown dependency IDs.
  steps.forEach((step, i) => {
    (step.dependsOn ?? []).forEach((dep, j) => {
      if (!byId.has(dep)) {
        errors.push({
          path: `steps[${i}].dependsOn[${j}]`,
          code: "unknown_dependency",
          message: `Step "${step.id}" depends on unknown step id "${dep}".`,
        });
      }
    });
  });

  // Dependency cycles (DFS over known-id edges; each cycle reported once,
  // with the full cycle path in the message).
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    const entry = byId.get(id)!;
    for (const dep of entry.step.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep];
        const key = [...new Set(cycle)].sort().join("");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push({
            path: `steps[${byId.get(dep)!.index}].dependsOn`,
            code: "dependency_cycle",
            message: `Dependency cycle detected: ${cycle.join(" → ")}.`,
          });
        }
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const id of byId.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) dfs(id);
  }

  // Side-effecting steps must require explicit approval.
  steps.forEach((step, i) => {
    if (step.sideEffecting && step.approval !== "required") {
      errors.push({
        path: `steps[${i}].approval`,
        code: "missing_approval",
        message: `Step "${step.id}" is side-effecting and must declare approval: "required".`,
      });
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Shared plan lifecycle, reused by the UI plan inspector and the host. */
export type PlanUIState = "draft" | "awaiting_approval" | "executing" | "paused" | "completed";

export type PlanEvent = "approve" | "execute" | "pause" | "resume" | "complete" | "cancel";

/**
 * Pure plan-state transition.
 *
 * INVARIANT: natural language NEVER counts as approval. The ONLY transition
 * from `awaiting_approval` to `executing` is the explicit `approve` event,
 * which must originate from a deliberate user action (an approval button /
 * explicit consent affordance), never from chat text or model output.
 * "execute" merely requests a run: it moves `draft → awaiting_approval`.
 * Invalid (state, event) pairs return the state unchanged.
 */
export function nextPlanState(state: PlanUIState, event: PlanEvent): PlanUIState {
  switch (event) {
    case "execute":
      return state === "draft" ? "awaiting_approval" : state;
    case "approve":
      return state === "awaiting_approval" ? "executing" : state;
    case "pause":
      return state === "executing" ? "paused" : state;
    case "resume":
      return state === "paused" ? "executing" : state;
    case "complete":
      return state === "executing" ? "completed" : state;
    case "cancel":
      return state === "awaiting_approval" || state === "executing" || state === "paused"
        ? "draft"
        : state;
  }
}

/** A run may start or advance ONLY while the plan is `executing`. */
export function canRunPlan(state: PlanUIState): boolean {
  return state === "executing";
}

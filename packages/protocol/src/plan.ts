/**
 * Executable plan contracts — Module 1, Task 1.
 *
 * An {@link ExecutionPlan} is the unit of work the agent platform proposes,
 * the user approves, and the run coordinator executes. All arrays are
 * readonly: plans are immutable once created; status transitions produce new
 * plan objects rather than mutating in place (this keeps the `as const`
 * fixtures used in tests and UI snapshots type-correct).
 */

/** Lifecycle of a single plan step. */
export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

/** Rough resource estimate for a step, shown in the plan inspector and used by routing. */
export interface StepEstimate {
  /** Estimated total tokens (input + output) the step will consume. */
  tokens?: number;
  /** Estimated provider cost in USD. */
  costUsd?: number;
  /** Estimated wall-clock duration in seconds. */
  durationSec?: number;
}

/**
 * One unit of work inside an execution plan.
 *
 * Security-relevant optional fields:
 * - `sideEffecting` — the step mutates state (filesystem, network, money,
 *   external services). The validator (Task 2) requires
 *   `approval: "required"` on every side-effecting step.
 * - `approval` — `"required"` means the step cannot run until the user
 *   explicitly clicks approve; natural-language consent never counts.
 * - `affectedScopes` — exact paths/origins/tool namespaces the step touches;
 *   rendered verbatim in the plan inspector so the approval decision is
 *   informed.
 */
export interface PlanStep {
  /** Unique within the plan. */
  id: string;
  /** Human-readable summary shown in the plan inspector. */
  title: string;
  /** Ids of steps that must all reach `"succeeded"` before this step may run. */
  dependsOn: readonly string[];
  status: StepStatus;
  /** When `"required"`, execution halts until an explicit user approval. */
  approval?: "required";
  /** Exact scopes (paths, origins, MCP tool names) affected by this step. */
  affectedScopes?: readonly string[];
  /** Rough resource estimate for UI display and routing input. */
  estimate?: StepEstimate;
  /** True when the step mutates state; side-effecting steps require approval. */
  sideEffecting?: boolean;
  /** Relative paths of artifacts (screenshots, diffs, logs) the step produced. */
  artifacts?: readonly string[];
}

/** A user-approved (or approvable) unit of agent work. */
export interface ExecutionPlan {
  id: string;
  /** The user's goal in natural language. */
  goal: string;
  steps: readonly PlanStep[];
}

/**
 * Steps that may start executing right now: status `"pending"` with every
 * dependency at `"succeeded"`.
 *
 * Steps with failed, blocked, running, or unknown dependencies are NOT
 * released — a failed dependency means the dependent step stays pending until
 * the coordinator marks it (or the plan) blocked/cancelled.
 */
export const readySteps = (plan: ExecutionPlan): PlanStep[] =>
  plan.steps.filter(
    (step) =>
      step.status === "pending" &&
      step.dependsOn.every((id) =>
        plan.steps.some((d) => d.id === id && d.status === "succeeded"),
      ),
  );

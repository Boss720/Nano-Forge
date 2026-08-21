# Milestone 1 Plan Validation & Cycle Detection Analysis

**Author**: Explorer M1.2  
**Milestone**: M1 — Upgraded Planning Protocol & Lifecycle State Machine  
**Target Files**:
- `apps/agent-host/src/planning/validatePlan.ts`
- `apps/agent-host/src/planning/validatePlan.test.ts` (also referenced as `apps/agent-host/__tests__/validatePlan.test.ts`)
- `packages/protocol/src/plan.ts`

---

## 1. Executive Summary

Milestone 1 establishes the foundational planning protocol and validation engine for NanoForge Phase 2. The core objective is transforming the initial flat step validator into an **Antigravity-grade multi-phase DAG validator and lifecycle state machine**.

This analysis provides the complete architectural design, algorithm specification, state transition matrix, and unit test suite for:
1. **Hierarchical Phase Validation**: Unique phase IDs, valid step `phaseId` references, non-empty phases, and multi-phase structural integrity.
2. **Deterministic Cycle Detection**: 3-color DFS traversal with canonical cycle deduplication, returning structured cycle node arrays (`["stepA", "stepB", "stepA"]`) and formatted path strings (`"stepA → stepB → stepA"`), resilient across phase boundaries and complex multi-cycle topologies.
3. **Step Status & Approval Invariants**: Enforcing the 7 step statuses (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`) and guaranteeing the **Zero-NL Approval Security Invariant** (side-effecting steps strictly require `approval: "required"`).
4. **6-State Plan Lifecycle State Machine**: Formal transitions across `draft`, `awaiting_approval`, `executing`, `paused`, `completed`, and `failed`, with helper functions (`nextPlanState`, `canRunPlan`, `isValidPlanTransition`, `validatePlanTransition`).

---

## 2. Current State vs. Target Requirements Audit

### 2.1 Current Implementation Audit (`apps/agent-host/src/planning/validatePlan.ts`)

| Feature Area | Current Status in Baseline `validatePlan.ts` | Target State for Milestone 1 | Gap / Deficiency |
|---|---|---|---|
| **Phase Validation** | Completely absent. Plans are treated as flat `steps` arrays without `phases` or `step.phaseId`. | Full validation: unique phase IDs, valid step `phaseId` references, non-empty phase checks. | Missing phase schemas, error codes (`duplicate_phase_id`, `unknown_phase`, `empty_phase`), and phase lookup table. |
| **Cycle Detection** | 3-color DFS exists, but returns only a string message; key deduplication uses naive character sets (`[...new Set(cycle)].sort().join("")`), which can collide on node names. | Deterministic DFS with canonical rotation deduplication, returning structured `cycle: string[]` in error objects and formatted cycle paths. | Naive deduplication key causes collisions; cycle array not exposed on result or error object; edge sorting not deterministic. |
| **Step Statuses** | Only 5 statuses (`pending`, `running`, `succeeded`, `failed`, `blocked`). | 7 statuses (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`). | Missing `ready` and `skipped` validation and status enumeration checking. |
| **Plan Lifecycle States** | 5 states in `PlanUIState` (`draft`, `awaiting_approval`, `executing`, `paused`, `completed`). | 6 states (`draft`, `awaiting_approval`, `executing`, `paused`, `completed`, `failed`). | Missing `failed` lifecycle state and `fail` / `reset` state transition events. |
| **Transition Validation** | Only `nextPlanState` exists (returns unchanged state on invalid transition). | `nextPlanState`, `isValidPlanTransition`, and `validatePlanTransition` with descriptive error reporting. | No explicit boolean validator `isValidPlanTransition(from, to)` or detailed error reporting helper. |
| **Validation Result Shape** | `{ ok: true } \| { ok: false; errors: ValidationError[] }` | Compatible with both `{ ok: boolean, errors: ValidationError[], cycle?: string[] }` and `{ valid: boolean, errors: ValidationError[], cycle?: string[] }`. | Lack of `valid` alias and structured `cycle` property on validation result. |

---

## 3. Architecture & Data Contracts

### 3.1 Extended Protocol Types (Aligned with `packages/protocol/src/plan.ts`)

```typescript
/** 7 Canonical Step Statuses */
export type StepStatus =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped";

/** 6 Canonical Plan Lifecycle States */
export type PlanLifecycleState =
  | "draft"
  | "awaiting_approval"
  | "executing"
  | "paused"
  | "completed"
  | "failed";

/** Backwards-compatible alias for UI components */
export type PlanUIState = PlanLifecycleState;

/** Hierarchical Plan Phase */
export interface PlanPhase {
  id: string;
  title: string;
  description?: string;
  order: number;
}

/** Resource Estimate */
export interface StepEstimate {
  tokens?: number;
  costUsd?: number;
  durationSec?: number;
}

/** Execution Step */
export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  phaseId?: string;
  status: StepStatus;
  dependsOn: readonly string[];
  approval?: "required" | "auto";
  sideEffecting?: boolean;
  affectedScopes?: readonly string[];
  estimate?: StepEstimate;
  artifacts?: readonly string[];
}

/** Complete Execution Plan */
export interface ExecutionPlan {
  id: string;
  title?: string;
  goal: string;
  phases?: readonly PlanPhase[];
  steps: readonly PlanStep[];
  state?: PlanLifecycleState;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}
```

### 3.2 Validation Error Codes & Data Structures

```typescript
export type ValidationErrorCode =
  | "duplicate_step_id"
  | "unknown_dependency"
  | "dependency_cycle"
  | "missing_approval"
  | "duplicate_phase_id"
  | "unknown_phase"
  | "empty_phase"
  | "invalid_step_status"
  | "invalid_plan_state"
  | "empty_plan";

export interface ValidationError {
  /** JSON-path-ish location, e.g. "steps[2].dependsOn[0]", "phases[1].id", "state". */
  path: string;
  code: ValidationErrorCode;
  message: string;
  /** Optional structured cycle path when code === "dependency_cycle", e.g. ["stepA", "stepB", "stepA"]. */
  cycle?: string[];
}

export type ValidationResult =
  | { ok: true; valid: true; errors: []; cycle?: undefined }
  | { ok: false; valid: false; errors: ValidationError[]; cycle?: string[] };
```

---

## 4. Upgraded Validation Engine Design

The `validatePlan(plan: ExecutionPlan): ValidationResult` function performs 5 deterministic validation passes without early abort, collecting all errors:

```
+-------------------------------------------------------------------------+
|                        validatePlan(plan) Pipeline                      |
+-------------------------------------------------------------------------+
                                     |
       +-----------------------------+-----------------------------+
       |                                                           |
       v                                                           v
[Pass 1: Plan & Phase Validation]                        [Pass 2: Step ID & Status]
- Check empty steps                                      - Check duplicate step IDs
- Check duplicate phase IDs                              - Check valid 7 step statuses
- Check step.phaseId references                          - Check plan.state valid
- Check non-empty phases                                           |
       |                                                           |
       +-----------------------------+-----------------------------+
                                     |
                                     v
                       [Pass 3: Dependency Validation]
                       - Check unknown dependency IDs
                       - Record in-memory adjacency list
                                     |
                                     v
                       [Pass 4: Deterministic Cycle Detection]
                       - 3-Color DFS over sorted nodes & edges
                       - Canonical cycle path rotation & deduplication
                       - Extract structured cycle: ["A", "B", "A"]
                                     |
                                     v
                       [Pass 5: Security Approval Invariants]
                       - Enforce sideEffecting => approval === "required"
                                     |
                                     v
                       [Result Aggregator]
                       - If errors.length === 0 => { ok: true, valid: true, errors: [] }
                       - Else => { ok: false, valid: false, errors, cycle }
```

### 4.1 Pass 1: Plan & Phase Validation Logic

1. **Empty Plan Check**:
   - If `!plan.steps || plan.steps.length === 0`:
     - Path: `"steps"`
     - Code: `"empty_plan"`
     - Message: `"Plan must contain at least one step."`

2. **Phase Uniqueness**:
   - Index declared phases in `phasesById = new Map<string, { phase: PlanPhase; index: number }>()`.
   - If a duplicate `phase.id` occurs at `phases[i]`:
     - Path: `phases[${i}].id`
     - Code: `"duplicate_phase_id"`
     - Message: `Duplicate phase id "${phase.id}" (first occurrence at phases[${existing.index}]).`

3. **Step `phaseId` References**:
   - For each step `steps[i]`:
     - If `step.phaseId` is present:
       - If `plan.phases && plan.phases.length > 0`:
         - If `!phasesById.has(step.phaseId)`:
           - Path: `steps[${i}].phaseId`
           - Code: `"unknown_phase"`
           - Message: `Step "${step.id}" references unknown phase id "${step.phaseId}".`
       - Else:
         - Path: `steps[${i}].phaseId`
         - Code: `"unknown_phase"`
         - Message: `Step "${step.id}" references phase id "${step.phaseId}" but no phases are defined in the plan.`

4. **Non-Empty Phase Invariant**:
   - If `plan.phases && plan.phases.length > 0 && plan.steps && plan.steps.length > 0`:
     - Collect referenced phase IDs: `const referencedPhases = new Set(steps.map(s => s.phaseId).filter(Boolean));`
     - For each `phases[i]`:
       - If `!referencedPhases.has(phase.id)`:
         - Path: `phases[${i}]`
         - Code: `"empty_phase"`
         - Message: `Phase "${phase.id}" ("${phase.title}") contains no steps.`

### 4.2 Pass 2: Step ID & Status Validation Logic

1. **Step ID Uniqueness**:
   - Index steps in `byId = new Map<string, { step: PlanStep; index: number }>()`.
   - If `byId.has(step.id)`:
     - Path: `steps[${i}].id`
     - Code: `"duplicate_step_id"`
     - Message: `Duplicate step id "${step.id}" (first occurrence at steps[${existing.index}]).`

2. **Step Status Validation**:
   - `VALID_STEP_STATUSES = new Set(["pending", "ready", "running", "succeeded", "failed", "blocked", "skipped"])`
   - If `step.status && !VALID_STEP_STATUSES.has(step.status)`:
     - Path: `steps[${i}].status`
     - Code: `"invalid_step_status"`
     - Message: `Step "${step.id}" has invalid status "${step.status}".`

3. **Plan State Validation**:
   - `VALID_PLAN_STATES = new Set(["draft", "awaiting_approval", "executing", "paused", "completed", "failed"])`
   - If `plan.state && !VALID_PLAN_STATES.has(plan.state)`:
     - Path: `"state"`
     - Code: `"invalid_plan_state"`
     - Message: `Plan has invalid lifecycle state "${plan.state}".`

### 4.3 Pass 3: Dependency Reference Validation Logic

- For each `step` at index `i`:
  - For each `dep` at index `j` in `step.dependsOn ?? []`:
    - If `!byId.has(dep)`:
      - Path: `steps[${i}].dependsOn[${j}]`
      - Code: `"unknown_dependency"`
      - Message: `Step "${step.id}" depends on unknown step id "${dep}".`

### 4.4 Pass 4: Deterministic Cycle Detection (3-Color DFS)

#### Algorithm Specification

```typescript
// 3-Color DFS constants
const WHITE = 0; // Unvisited
const GRAY = 1;  // Currently in active recursion stack
const BLACK = 2; // Fully processed and verified acyclic

const color = new Map<string, number>();
const stack: string[] = [];
const reportedCycles = new Set<string>();
let firstCycle: string[] | undefined = undefined;

// Deterministic node ordering: sort step IDs or use declaration order
const stepIds = Array.from(byId.keys());

// Canonical rotation: rotates ["B", "C", "A", "B"] to start with lexicographically smallest node ["A", "B", "C", "A"]
function canonicalizeCycle(cycle: string[]): string[] {
  if (cycle.length <= 1) return cycle;
  const nodes = cycle.slice(0, -1);
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] < nodes[minIdx]) minIdx = i;
  }
  const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
  return [...rotated, rotated[0]];
}

function dfs(id: string): void {
  color.set(id, GRAY);
  stack.push(id);
  const entry = byId.get(id)!;
  
  // Deterministic neighbor edge traversal: follow dependsOn in declared order
  for (const dep of entry.step.dependsOn ?? []) {
    if (!byId.has(dep)) continue; // Unknown dependencies are already caught in Pass 3
    const c = color.get(dep) ?? WHITE;
    if (c === GRAY) {
      // Back-edge detected -> Cycle found!
      const rawCycle = [...stack.slice(stack.indexOf(dep)), dep];
      const canonical = canonicalizeCycle(rawCycle);
      const key = canonical.join("->");
      
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        if (!firstCycle) firstCycle = rawCycle;
        
        errors.push({
          path: `steps[${entry.index}].dependsOn`,
          code: "dependency_cycle",
          message: `Dependency cycle detected: ${rawCycle.join(" → ")}.`,
          cycle: rawCycle,
        });
      }
    } else if (c === WHITE) {
      dfs(dep);
    }
  }
  stack.pop();
  color.set(id, BLACK);
}

for (const id of stepIds) {
  if ((color.get(id) ?? WHITE) === WHITE) {
    dfs(id);
  }
}
```

#### Cycle Detection Properties:
- **Exact Path Reporting**: Retains actual execution dependency path (e.g. `stepA → stepB → stepA`).
- **Cross-Phase Robustness**: Seamlessly resolves cycles traversing multiple phases (e.g. `p1_step1 → p2_step2 → p1_step1`).
- **No False Positives on Diamonds**: Correctly handles convergent DAGs (`A -> B, A -> C, B -> D, C -> D`) without flagging false cycles.
- **Multi-Cycle Deduplication**: Canonical rotation prevents duplicate alerts for the same cycle encountered from different starting points.

### 4.5 Pass 5: Security Approval Invariant Validation

- **Zero-NL Approval Rule**:
  - For each `steps[i]`:
    - If `step.sideEffecting === true && step.approval !== "required"`:
      - Path: `steps[${i}].approval`
      - Code: `"missing_approval"`
      - Message: `Step "${step.id}" is side-effecting and must declare approval: "required".`

---

## 5. Plan Lifecycle State Machine & Transition Matrix

### 5.1 The 6 Lifecycle States

1. `draft`: Plan is being authored or modified. Steps can be edited, reordered, added, or deleted. Execution cannot begin.
2. `awaiting_approval`: Plan has been submitted (`execute` event). Execution is halted at the gate until the user grants explicit authorization.
3. `executing`: Plan has received explicit user approval (`approve` event). Active run coordinator runs ready steps topologically.
4. `paused`: Execution is temporarily suspended by user request. Can be resumed.
5. `completed`: All steps have reached `succeeded` or terminal non-failure state.
6. `failed`: One or more non-optional steps failed or plan execution was aborted.

### 5.2 Plan Events

```typescript
export type PlanEvent =
  | "approve"   // Explicit user approval gate action
  | "execute"   // User requests to run draft plan (moves to awaiting_approval)
  | "pause"     // User suspends running plan
  | "resume"    // User resumes paused plan
  | "complete"  // Coordinator signals plan completion
  | "fail"      // Coordinator signals unrecoverable failure
  | "cancel"    // User cancels active/pending plan back to draft
  | "reset";    // User resets terminal plan back to draft
```

### 5.3 Complete Transition Matrix

| Current State (`state`) | Event (`event`) | Target State (`nextPlanState`) | Allowed? (`isValidPlanTransition`) | Rationale / Security Invariant |
|---|---|---|:---:|---|
| `draft` | `execute` | `awaiting_approval` | **YES** | User requests plan execution; must queue for approval gate. |
| `draft` | `approve` | `draft` | **NO** | **Security Invariant**: Cannot bypass approval queue directly from draft. |
| `draft` | `pause` / `resume` / `complete` / `fail` | `draft` | **NO** | No-op: Plan is not running. |
| `draft` | `cancel` / `reset` | `draft` | **YES** | No-op idempotent reset. |
| `awaiting_approval` | `approve` | `executing` | **YES** | **Security Invariant**: ONLY explicit user approval release gate transitions to `executing`. |
| `awaiting_approval` | `cancel` | `draft` | **YES** | User dismisses approval request, reverting plan to editable draft. |
| `awaiting_approval` | `fail` | `failed` | **YES** | Validation failure or pre-execution check failure halts plan. |
| `awaiting_approval` | `execute` / `pause` / `resume` / `complete` | `awaiting_approval` | **NO** | No-op: Cannot advance without explicit approve. |
| `executing` | `pause` | `paused` | **YES** | User pauses active execution. |
| `executing` | `complete` | `completed` | **YES** | Coordinator signals all steps finished successfully. |
| `executing` | `fail` | `failed` | **YES** | Step execution error or abort. |
| `executing` | `cancel` | `draft` | **YES** | User cancels active execution, returning plan to draft. |
| `executing` | `approve` / `execute` / `resume` | `executing` | **NO** | No-op: Already running. |
| `paused` | `resume` | `executing` | **YES** | User resumes paused plan. |
| `paused` | `fail` | `failed` | **YES** | Aborted while paused. |
| `paused` | `cancel` | `draft` | **YES** | Cancel paused plan back to draft. |
| `paused` | `pause` / `approve` / `complete` | `paused` | **NO** | No-op: Already paused. |
| `completed` | `reset` | `draft` | **YES** | User clones/restarts completed plan as new draft. |
| `completed` | `approve` / `execute` / `pause` / `resume` | `completed` | **NO** | Terminal state is immutable. |
| `failed` | `reset` | `draft` | **YES** | User edits failed plan to retry. |
| `failed` | `approve` / `execute` / `pause` / `resume` | `failed` | **NO** | Terminal state is immutable. |

### 5.4 State Machine Helper Functions

```typescript
/** Pure plan state transition function */
export function nextPlanState(state: PlanLifecycleState, event: PlanEvent): PlanLifecycleState {
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
    case "fail":
      return state === "executing" || state === "paused" || state === "awaiting_approval"
        ? "failed"
        : state;
    case "cancel":
      return state === "awaiting_approval" || state === "executing" || state === "paused"
        ? "draft"
        : state;
    case "reset":
      return state === "completed" || state === "failed" ? "draft" : state;
    default:
      return state;
  }
}

/** Execution gate check: true ONLY when state === "executing" */
export function canRunPlan(state: PlanLifecycleState): boolean {
  return state === "executing";
}

/** Pure transition validity check */
export function isValidPlanTransition(from: PlanLifecycleState, to: PlanLifecycleState): boolean {
  if (from === to) return true;
  const ALLOWED: Record<PlanLifecycleState, ReadonlySet<PlanLifecycleState>> = {
    draft: new Set(["awaiting_approval"]),
    awaiting_approval: new Set(["executing", "draft", "failed"]),
    executing: new Set(["paused", "completed", "failed", "draft"]),
    paused: new Set(["executing", "failed", "draft"]),
    completed: new Set(["draft"]),
    failed: new Set(["draft"]),
  };
  return ALLOWED[from]?.has(to) ?? false;
}

/** Transition validator with descriptive error reporting */
export function validatePlanTransition(
  from: PlanLifecycleState,
  to: PlanLifecycleState,
): { valid: boolean; error?: string } {
  if (isValidPlanTransition(from, to)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `Invalid plan state transition from "${from}" to "${to}".`,
  };
}
```

---

## 6. Detailed Implementation Code for `validatePlan.ts`

The complete proposed code for `apps/agent-host/src/planning/validatePlan.ts`:

```typescript
/**
 * Task 2 (host half) — plan validation and plan UI state machine.
 *
 * Validates an `ExecutionPlan` (from `@protocol/plan`) before it can be
 * approved or executed, supporting hierarchical phases, deterministic
 * cycle detection with formatted paths, step status validation, and
 * the 6-state plan lifecycle state machine.
 */

import type {
  ExecutionPlan,
  PlanPhase,
  PlanStep,
  StepStatus,
  PlanLifecycleState,
} from "@protocol/plan";

// Re-export lifecycle states and UI state alias for consumer compatibility
export type { PlanLifecycleState };
export type PlanUIState = PlanLifecycleState;

export type ValidationErrorCode =
  | "duplicate_step_id"
  | "unknown_dependency"
  | "dependency_cycle"
  | "missing_approval"
  | "duplicate_phase_id"
  | "unknown_phase"
  | "empty_phase"
  | "invalid_step_status"
  | "invalid_plan_state"
  | "empty_plan";

export interface ValidationError {
  /** JSON-path-ish location, e.g. "steps[2].dependsOn[0]", "phases[1].id". */
  path: string;
  code: ValidationErrorCode;
  message: string;
  /** Structured cycle path if code === "dependency_cycle", e.g. ["stepA", "stepB", "stepA"]. */
  cycle?: string[];
}

export type ValidationResult =
  | { ok: true; valid: true; errors: []; cycle?: undefined }
  | { ok: false; valid: false; errors: ValidationError[]; cycle?: string[] };

const VALID_STEP_STATUSES = new Set<StepStatus>([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);

const VALID_PLAN_STATES = new Set<PlanLifecycleState>([
  "draft",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
]);

/**
 * Validates an ExecutionPlan against structural integrity rules,
 * phase grouping contracts, cycle constraints, and approval invariants.
 */
export function validatePlan(plan: ExecutionPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const steps: readonly PlanStep[] = plan.steps ?? [];
  const phases: readonly PlanPhase[] = plan.phases ?? [];

  // Pass 1: Empty plan check
  if (steps.length === 0) {
    errors.push({
      path: "steps",
      code: "empty_plan",
      message: "Plan must contain at least one step.",
    });
  }

  // Pass 2: Phase validation
  const phasesById = new Map<string, { phase: PlanPhase; index: number }>();
  phases.forEach((phase, i) => {
    const existing = phasesById.get(phase.id);
    if (existing) {
      errors.push({
        path: `phases[${i}].id`,
        code: "duplicate_phase_id",
        message: `Duplicate phase id "${phase.id}" (first occurrence at phases[${existing.index}]).`,
      });
    } else {
      phasesById.set(phase.id, { phase, index: i });
    }
  });

  // Pass 3: Step ID uniqueness and status validation
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

    if (step.status && !VALID_STEP_STATUSES.has(step.status)) {
      errors.push({
        path: `steps[${i}].status`,
        code: "invalid_step_status",
        message: `Step "${step.id}" has invalid status "${step.status}".`,
      });
    }
  });

  // Pass 4: Step phaseId reference integrity & non-empty phases
  const referencedPhaseIds = new Set<string>();
  steps.forEach((step, i) => {
    if (step.phaseId) {
      referencedPhaseIds.add(step.phaseId);
      if (phases.length > 0) {
        if (!phasesById.has(step.phaseId)) {
          errors.push({
            path: `steps[${i}].phaseId`,
            code: "unknown_phase",
            message: `Step "${step.id}" references unknown phase id "${step.phaseId}".`,
          });
        }
      } else {
        errors.push({
          path: `steps[${i}].phaseId`,
          code: "unknown_phase",
          message: `Step "${step.id}" references phase id "${step.phaseId}" but no phases are defined in the plan.`,
        });
      }
    }
  });

  if (phases.length > 0 && steps.length > 0) {
    phases.forEach((phase, i) => {
      if (!referencedPhaseIds.has(phase.id)) {
        errors.push({
          path: `phases[${i}]`,
          code: "empty_phase",
          message: `Phase "${phase.id}" ("${phase.title}") contains no steps.`,
        });
      }
    });
  }

  // Pass 5: Plan state validation
  if (plan.state && !VALID_PLAN_STATES.has(plan.state)) {
    errors.push({
      path: "state",
      code: "invalid_plan_state",
      message: `Plan has invalid lifecycle state "${plan.state}".`,
    });
  }

  // Pass 6: Unknown dependency IDs
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

  // Pass 7: Deterministic Cycle Detection (3-Color DFS)
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  let primaryCycle: string[] | undefined = undefined;

  const canonicalizeCycle = (cycle: string[]): string[] => {
    if (cycle.length <= 1) return cycle;
    const nodes = cycle.slice(0, -1);
    let minIdx = 0;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i] < nodes[minIdx]) minIdx = i;
    }
    const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
    return [...rotated, rotated[0]];
  };

  const dfs = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    const entry = byId.get(id)!;
    for (const dep of entry.step.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const rawCycle = [...stack.slice(stack.indexOf(dep)), dep];
        const canonical = canonicalizeCycle(rawCycle);
        const key = canonical.join("->");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          if (!primaryCycle) primaryCycle = rawCycle;
          errors.push({
            path: `steps[${entry.index}].dependsOn`,
            code: "dependency_cycle",
            message: `Dependency cycle detected: ${rawCycle.join(" → ")}.`,
            cycle: rawCycle,
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

  // Pass 8: Side-effecting steps must require explicit approval
  steps.forEach((step, i) => {
    if (step.sideEffecting && step.approval !== "required") {
      errors.push({
        path: `steps[${i}].approval`,
        code: "missing_approval",
        message: `Step "${step.id}" is side-effecting and must declare approval: "required".`,
      });
    }
  });

  if (errors.length > 0) {
    return {
      ok: false,
      valid: false,
      errors,
      ...(primaryCycle ? { cycle: primaryCycle } : {}),
    };
  }

  return { ok: true, valid: true, errors: [] };
}

export type PlanEvent =
  | "approve"
  | "execute"
  | "pause"
  | "resume"
  | "complete"
  | "fail"
  | "cancel"
  | "reset";

/**
 * Pure plan-state transition function.
 *
 * INVARIANT: natural language NEVER counts as approval. The ONLY transition
 * from `awaiting_approval` to `executing` is the explicit `approve` event,
 * which must originate from a deliberate user action (an approval button /
 * explicit consent affordance), never from chat text or model output.
 */
export function nextPlanState(state: PlanLifecycleState, event: PlanEvent): PlanLifecycleState {
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
    case "fail":
      return state === "executing" || state === "paused" || state === "awaiting_approval"
        ? "failed"
        : state;
    case "cancel":
      return state === "awaiting_approval" || state === "executing" || state === "paused"
        ? "draft"
        : state;
    case "reset":
      return state === "completed" || state === "failed" ? "draft" : state;
    default:
      return state;
  }
}

/** A run may start or advance ONLY while the plan is `executing`. */
export function canRunPlan(state: PlanLifecycleState): boolean {
  return state === "executing";
}

/** Checks whether a transition between two plan lifecycle states is allowed. */
export function isValidPlanTransition(from: PlanLifecycleState, to: PlanLifecycleState): boolean {
  if (from === to) return true;
  const ALLOWED: Record<PlanLifecycleState, ReadonlySet<PlanLifecycleState>> = {
    draft: new Set(["awaiting_approval"]),
    awaiting_approval: new Set(["executing", "draft", "failed"]),
    executing: new Set(["paused", "completed", "failed", "draft"]),
    paused: new Set(["executing", "failed", "draft"]),
    completed: new Set(["draft"]),
    failed: new Set(["draft"]),
  };
  return ALLOWED[from]?.has(to) ?? false;
}

/** Validates state transitions with a descriptive error message if invalid. */
export function validatePlanTransition(
  from: PlanLifecycleState,
  to: PlanLifecycleState,
): { valid: boolean; error?: string } {
  if (isValidPlanTransition(from, to)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `Invalid plan state transition from "${from}" to "${to}".`,
  };
}
```

---

## 7. Comprehensive Unit Test Suite Specification

The test additions for `apps/agent-host/src/planning/validatePlan.test.ts` cover 6 comprehensive suites:

```typescript
import { describe, expect, it } from "vitest";
import type { ExecutionPlan, PlanPhase, PlanStep, PlanLifecycleState } from "@protocol/plan";
import {
  canRunPlan,
  isValidPlanTransition,
  nextPlanState,
  validatePlan,
  validatePlanTransition,
  type PlanLifecycleState as PlanUIState,
} from "./validatePlan";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: partial.id, dependsOn: [], status: "pending", ...partial };
}

function plan(steps: PlanStep[], overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return { id: "p1", goal: "test goal", steps, ...overrides };
}

describe("validatePlan — Step & Dependency Validation", () => {
  it("accepts a valid linear DAG plan", () => {
    const p = plan([
      step({ id: "a" }),
      step({ id: "b", dependsOn: ["a"] }),
      step({ id: "c", dependsOn: ["b"], sideEffecting: true, approval: "required" }),
    ]);
    expect(validatePlan(p)).toMatchObject({ ok: true, valid: true });
  });

  it("accepts a valid diamond DAG plan without cycle false positives", () => {
    const p = plan([
      step({ id: "a" }),
      step({ id: "b", dependsOn: ["a"] }),
      step({ id: "c", dependsOn: ["a"] }),
      step({ id: "d", dependsOn: ["b", "c"] }),
    ]);
    expect(validatePlan(p)).toMatchObject({ ok: true, valid: true });
  });

  it("rejects an empty plan with no steps", () => {
    const res = validatePlan(plan([]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({ code: "empty_plan", path: "steps" });
    }
  });

  it("rejects duplicate step IDs", () => {
    const res = validatePlan(plan([step({ id: "a" }), step({ id: "a" })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatchObject({ code: "duplicate_step_id", path: "steps[1].id" });
    }
  });

  it("rejects unknown dependency IDs", () => {
    const res = validatePlan(plan([step({ id: "a", dependsOn: ["ghost"] })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({
        code: "unknown_dependency",
        path: "steps[0].dependsOn[0]",
      });
      expect(res.errors[0].message).toContain("ghost");
    }
  });
});

describe("validatePlan — Phase Validation", () => {
  const phases: PlanPhase[] = [
    { id: "phase-prep", title: "Preparation", order: 1 },
    { id: "phase-exec", title: "Execution", order: 2 },
  ];

  it("accepts a valid multi-phase plan with assigned steps", () => {
    const p = plan(
      [
        step({ id: "s1", phaseId: "phase-prep" }),
        step({ id: "s2", phaseId: "phase-exec", dependsOn: ["s1"] }),
      ],
      { phases },
    );
    expect(validatePlan(p)).toMatchObject({ ok: true, valid: true });
  });

  it("rejects duplicate phase IDs", () => {
    const dupPhases: PlanPhase[] = [
      { id: "p1", title: "Phase 1", order: 1 },
      { id: "p1", title: "Phase 1 Duplicate", order: 2 },
    ];
    const p = plan([step({ id: "s1", phaseId: "p1" })], { phases: dupPhases });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "duplicate_phase_id")).toBe(true);
    }
  });

  it("rejects steps referencing an unknown phaseId", () => {
    const p = plan([step({ id: "s1", phaseId: "phase-unknown" })], { phases });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const err = res.errors.find((e) => e.code === "unknown_phase");
      expect(err).toBeDefined();
      expect(err?.path).toBe("steps[0].phaseId");
    }
  });

  it("rejects steps with phaseId when no phases are defined on the plan", () => {
    const p = plan([step({ id: "s1", phaseId: "phase-orphan" })], { phases: [] });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "unknown_phase")).toBe(true);
    }
  });

  it("rejects declared phases that contain no steps (empty phase)", () => {
    const emptyPhaseList: PlanPhase[] = [
      { id: "p-used", title: "Used", order: 1 },
      { id: "p-empty", title: "Empty Phase", order: 2 },
    ];
    const p = plan([step({ id: "s1", phaseId: "p-used" })], { phases: emptyPhaseList });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const err = res.errors.find((e) => e.code === "empty_phase");
      expect(err).toBeDefined();
      expect(err?.message).toContain("p-empty");
    }
  });
});

describe("validatePlan — Deterministic Cycle Detection", () => {
  it("detects self-dependency cycle and returns formatted cycle path", () => {
    const res = validatePlan(plan([step({ id: "a", dependsOn: ["a"] })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({ code: "dependency_cycle" });
      expect(res.errors[0].message).toContain("a → a");
      expect(res.cycle).toEqual(["a", "a"]);
    }
  });

  it("detects 2-step direct cycle and extracts structured cycle path", () => {
    const res = validatePlan(
      plan([step({ id: "a", dependsOn: ["b"] }), step({ id: "b", dependsOn: ["a"] })]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const cycleErr = res.errors.find((e) => e.code === "dependency_cycle");
      expect(cycleErr).toBeDefined();
      expect(cycleErr?.cycle).toBeDefined();
      expect(res.cycle).toBeDefined();
    }
  });

  it("detects 3-step dependency cycle across multiple steps", () => {
    const res = validatePlan(
      plan([
        step({ id: "a", dependsOn: ["c"] }),
        step({ id: "b", dependsOn: ["a"] }),
        step({ id: "c", dependsOn: ["b"] }),
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const cycles = res.errors.filter((e) => e.code === "dependency_cycle");
      expect(cycles).toHaveLength(1);
      expect(cycles[0].message).toMatch(/a → c → b → a|c → b → a → c|b → a → c → b/);
    }
  });

  it("detects cross-phase dependency cycle", () => {
    const phases: PlanPhase[] = [
      { id: "p1", title: "P1", order: 1 },
      { id: "p2", title: "P2", order: 2 },
    ];
    const res = validatePlan(
      plan(
        [
          step({ id: "s1", phaseId: "p1", dependsOn: ["s2"] }),
          step({ id: "s2", phaseId: "p2", dependsOn: ["s1"] }),
        ],
        { phases },
      ),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "dependency_cycle")).toBe(true);
    }
  });

  it("detects multiple disjoint cycles without infinite loops or duplicate errors", () => {
    const res = validatePlan(
      plan([
        // Cycle 1: a <-> b
        step({ id: "a", dependsOn: ["b"] }),
        step({ id: "b", dependsOn: ["a"] }),
        // Cycle 2: c <-> d
        step({ id: "c", dependsOn: ["d"] }),
        step({ id: "d", dependsOn: ["c"] }),
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const cycles = res.errors.filter((e) => e.code === "dependency_cycle");
      expect(cycles.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("validatePlan — Status & Approval Invariants", () => {
  it("accepts all 7 valid step statuses", () => {
    const statuses = [
      "pending",
      "ready",
      "running",
      "succeeded",
      "failed",
      "blocked",
      "skipped",
    ] as const;
    const steps = statuses.map((status, i) => step({ id: `s_${i}`, status }));
    expect(validatePlan(plan(steps))).toMatchObject({ ok: true, valid: true });
  });

  it("rejects invalid step status string", () => {
    const p = plan([step({ id: "s1", status: "invalid_status" as any })]);
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({
        code: "invalid_step_status",
        path: "steps[0].status",
      });
    }
  });

  it("requires approval: 'required' on side-effecting steps", () => {
    const res = validatePlan(plan([step({ id: "x", sideEffecting: true })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({
        code: "missing_approval",
        path: "steps[0].approval",
      });
    }
  });

  it("accepts side-effecting steps when approval: 'required' is explicitly declared", () => {
    const res = validatePlan(
      plan([step({ id: "x", sideEffecting: true, approval: "required" })]),
    );
    expect(res).toMatchObject({ ok: true, valid: true });
  });
});

describe("validatePlan — Plan Lifecycle State Machine", () => {
  it("draft → awaiting_approval on execute, and only approve starts executing", () => {
    let state: PlanLifecycleState = "draft";
    expect(canRunPlan(state)).toBe(false);

    state = nextPlanState(state, "execute");
    expect(state).toBe("awaiting_approval");
    expect(canRunPlan(state)).toBe(false);

    // Security invariant: No other event can move awaiting_approval to executing
    expect(nextPlanState(state, "execute")).toBe("awaiting_approval");
    expect(nextPlanState(state, "resume")).toBe("awaiting_approval");
    expect(nextPlanState(state, "complete")).toBe("awaiting_approval");

    // Explicit approval gate transitions to executing
    state = nextPlanState(state, "approve");
    expect(state).toBe("executing");
    expect(canRunPlan(state)).toBe(true);
  });

  it("handles pause, resume, complete, and fail transitions", () => {
    let state: PlanLifecycleState = "executing";
    state = nextPlanState(state, "pause");
    expect(state).toBe("paused");
    expect(canRunPlan(state)).toBe(false);

    state = nextPlanState(state, "resume");
    expect(state).toBe("executing");
    expect(canRunPlan(state)).toBe(true);

    // Fail from executing
    expect(nextPlanState("executing", "fail")).toBe("failed");
    // Fail from paused
    expect(nextPlanState("paused", "fail")).toBe("failed");
    // Complete from executing
    expect(nextPlanState("executing", "complete")).toBe("completed");
  });

  it("cancel and reset transitions revert states to draft", () => {
    expect(nextPlanState("awaiting_approval", "cancel")).toBe("draft");
    expect(nextPlanState("executing", "cancel")).toBe("draft");
    expect(nextPlanState("paused", "cancel")).toBe("draft");
    expect(nextPlanState("completed", "reset")).toBe("draft");
    expect(nextPlanState("failed", "reset")).toBe("draft");
  });

  it("validates allowed and illegal transitions using isValidPlanTransition", () => {
    expect(isValidPlanTransition("draft", "awaiting_approval")).toBe(true);
    expect(isValidPlanTransition("awaiting_approval", "executing")).toBe(true);
    expect(isValidPlanTransition("executing", "completed")).toBe(true);
    expect(isValidPlanTransition("executing", "failed")).toBe(true);
    expect(isValidPlanTransition("paused", "executing")).toBe(true);

    // Illegal transitions
    expect(isValidPlanTransition("draft", "executing")).toBe(false);
    expect(isValidPlanTransition("completed", "executing")).toBe(false);
    expect(isValidPlanTransition("failed", "executing")).toBe(false);
  });

  it("validatePlanTransition returns descriptive error message for invalid transitions", () => {
    expect(validatePlanTransition("draft", "awaiting_approval")).toEqual({ valid: true });
    const res = validatePlanTransition("draft", "executing");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Invalid plan state transition from \"draft\" to \"executing\"");
  });
});
```

---

## 8. Downstream Integration & Compatibility Analysis

1. **`apps/agent-host/src/runs/coordinator.ts` Compatibility**:
   - `coordinator.ts` inspects `const validation = validatePlan(plan);` and checks `validation.ok` and `validation.errors`.
   - The upgraded `validatePlan` preserves `ok: true | false` and `errors: ValidationError[]`, ensuring 100% backward and forward compatibility.
   - When validation fails, `coordinator.ts` emits `plan.validated` (`ok: false`) with error details and calls `this.finish(ctx, "failed", ...)`.

2. **`packages/protocol/src/plan.ts` Alignment**:
   - `validatePlan` is fully compatible with the upgraded `ExecutionPlan` having optional `phases?: readonly PlanPhase[]`, `state?: PlanLifecycleState`, and 7 `StepStatus` values.

3. **Frontend `src/lib/planComposer/` and `src/sections/PlanPanel.tsx`**:
   - The cycle path array `cycle?: string[]` and formatted path in `error.message` directly empower the UI to highlight cyclic dependencies and render red cycle banners with exact step paths.

---

## 9. Verification & Execution Plan

1. **Host Plan Validation Suite**:
   ```bash
   npx vitest run apps/agent-host/src/planning/validatePlan.test.ts
   ```
2. **Full Host Test Suite**:
   ```bash
   npm run test:host
   ```
3. **Protocol Test Suite**:
   ```bash
   npm run test:protocol
   ```
4. **End-to-End Build & Typecheck**:
   ```bash
   npm run build
   ```

# Milestone 1 Analysis: Topological Step Resolution & Approval Ledger

**Agent**: Explorer M1.3  
**Working Directory**: `packages/protocol/src/`, `packages/protocol/__tests__/`  
**Target Function**: `readySteps(plan: ExecutionPlan, approvedStepIds?: ReadonlySet<string>): PlanStep[]`  
**Date**: 2026-08-15  

---

## 1. Executive Summary & Objective

The primary objective of this investigation is to design and formally specify the upgraded **Topological Step Resolution Algorithm (`readySteps`)** and its **Approval Ledger Integration** within `packages/protocol/src/plan.ts`.

NanoForge Phase 2 transitions from a flat, naive step execution model to an Antigravity-grade **Multi-Phase Directed Acyclic Graph (DAG)** execution engine. In this model:
1. Steps are released topologically when and only when all upstream prerequisites have reached `"succeeded"`.
2. Steps with `approval: "required"` are subject to the **Zero Natural Language Authority Invariant**: they cannot transition to `"ready"` or `"running"` without explicit presence in an authoritative `ReadonlySet<string>` approval ledger.
3. Upstream failures and skips cascade deterministically: a failed or blocked prerequisite cascades downstream steps into `"blocked"`, while skipped prerequisites cascade downstream steps into `"skipped"`.

---

## 2. Current Code Audit & Gap Analysis

### 2.1 Current Implementation in `packages/protocol/src/plan.ts`

```typescript
export const readySteps = (plan: ExecutionPlan): PlanStep[] =>
  plan.steps.filter(
    (step) =>
      step.status === "pending" &&
      step.dependsOn.every((id) =>
        plan.steps.some((d) => d.id === id && d.status === "succeeded"),
      ),
  );
```

### 2.2 Identified Gaps & Architectural Deficiencies

| Gap ID | Defect / Limitation | Architectural Impact |
|---|---|---|
| **GAP-01** | **No Approval Ledger Integration** | `readySteps` accepts only `plan: ExecutionPlan`. It has no parameter for `approvedStepIds: ReadonlySet<string>`, preventing the enforcement of approval gates prior to step release. |
| **GAP-02** | **Step Status Enum Limitation** | Step status is restricted to 5 states (`"pending" \| "running" \| "succeeded" \| "failed" \| "blocked"`). It lacks `"ready"` and `"skipped"` states required for Phase 2 DAG scheduling and skipped-branch cascades. |
| **GAP-03** | **Readiness Status Evaluation** | Current implementation filters strictly on `step.status === "pending"`. Steps that have already been marked as `"ready"` by UI or pre-resolvers are ignored. |
| **GAP-04** | **Quadratic Complexity ($O(N^2 \cdot K)$)** | For every step, `step.dependsOn.every` executes an inner `plan.steps.some` scan. In plans with dozens of steps and dense dependencies, this produces unnecessary repetitive iterations instead of an $O(V + E)$ map lookup. |
| **GAP-05** | **Zero NL Authority Security Vulnerability** | Without ledger checking in pure protocol functions, a host or UI relying solely on `readySteps` could inadvertently release side-effecting steps without explicit user UI interaction. |

---

## 3. Upgraded Topological Resolution & Approval Ledger Design

### 3.1 Core Security & Scheduling Invariants

1. **Zero Natural Language Authority Invariant**:
   - Model-generated text strings in chat (e.g. `"I have approved Step 2"`) **never** grant execution authority.
   - An approval-gated step (`approval: "required"`) is released if and only if `approvedStepIds !== undefined && approvedStepIds.has(step.id) === true`.
   - If `approvedStepIds` is omitted (`undefined`) or empty, zero approval-required steps can be released.

2. **Topological Dependency Invariant**:
   - Step $v$ is ready only when $\forall u \in v.\text{dependsOn}$, step $u$ exists in `plan.steps` and $u.\text{status} === \text{"succeeded"}$.
   - If any $u \in v.\text{dependsOn}$ is `"pending"`, `"running"`, `"failed"`, `"blocked"`, `"skipped"`, or missing (dangling dependency), step $v$ is **not ready**.

3. **Status Invariance & Mutability Rules**:
   - `readySteps` is a **pure, side-effect-free query**. It does not mutate the plan object or its steps.
   - Only steps currently in `"pending"` or `"ready"` state can be candidates for execution release.
   - Steps in `"running"`, `"succeeded"`, `"failed"`, `"blocked"`, or `"skipped"` are never returned.

4. **Cascading Failure & Skip Invariant**:
   - If $\exists u \in v.\text{dependsOn}$ where $u.\text{status} \in \{\text{"failed"}, \text{"blocked"}\}$, step $v$ is blocked from execution.
   - If $\exists u \in v.\text{dependsOn}$ where $u.\text{status} === \text{"skipped"}$ (and no $u$ is failed/blocked), step $v$ cascades into skipped status.

---

### 3.2 Mathematical Formulation & Algorithm

Let the plan be a directed graph $G = (V, E)$, where:
- $V = \{ s_1, s_2, \dots, s_n \} = \text{plan.steps}$
- $E = \{ (u, v) \mid u \in v.\text{dependsOn} \}$
- $L \subseteq \text{StepId}$ is the approval ledger (`approvedStepIds`)

A step $v \in V$ is ready for execution, denoted $\text{IsReady}(v)$, iff:
$$\text{IsReady}(v) \iff \big(v.\text{status} \in \{\text{"pending"}, \text{"ready"}\}\big) \land \big(v.\text{approval} = \text{"required"} \implies v.\text{id} \in L\big) \land \big(\forall u \in v.\text{dependsOn}: \text{Exists}(u) \land u.\text{status} = \text{"succeeded"}\big)$$

```
                         Step Candidate v
                      (status: pending | ready)
                                 |
                                 v
                 Is v.approval === "required"?
                             /       \
                           YES        NO
                           /           \
               Is v.id in approvedSet?  \
                     /        \          \
                   YES         NO         |
                   /             \        |
                  |             REJECT    |
                  v                       v
               Are ALL u in v.dependsOn 'succeeded'?
                              /       \
                            YES        NO
                            /           \
                         ACCEPT        REJECT
                   (Return in ready)
```

---

### 3.3 Pure Algorithm Implementation

```typescript
/**
 * Steps that may start executing right now: status "pending" or "ready" with every
 * upstream dependency at "succeeded", and explicit approval granted if required.
 *
 * Security Invariant (Zero NL Authority):
 * - If a step declares `approval: "required"`, it CANNOT transition to "ready" or be
 *   released without explicit membership in `approvedStepIds`.
 * - Natural language consent NEVER counts as approval.
 * - If `approvedStepIds` is undefined or does not contain `step.id`, the step is excluded.
 *
 * Topological Invariant:
 * - A step is released only when ALL upstream dependencies in `dependsOn` exist and have status "succeeded".
 * - If any dependency is pending, running, failed, blocked, skipped, or dangling, the step is excluded.
 *
 * @param plan The execution plan containing phases and steps.
 * @param approvedStepIds Explicit set of step IDs approved by the user via the UI approval ledger.
 * @returns Array of PlanSteps that are topologically and administratively ready to execute.
 */
export function readySteps(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>,
): PlanStep[] {
  if (!plan || !plan.steps || !Array.isArray(plan.steps)) {
    return [];
  }

  // O(V) index map for O(1) status lookups
  const stepMap = new Map<string, PlanStep>();
  for (const step of plan.steps) {
    stepMap.set(step.id, step);
  }

  return plan.steps.filter((step) => {
    // 1. Candidate must be in 'pending' or 'ready' status
    if (step.status !== "pending" && step.status !== "ready") {
      return false;
    }

    // 2. Zero NL Authority Check: Approval Gate Enforcement
    if (step.approval === "required") {
      if (!approvedStepIds || !approvedStepIds.has(step.id)) {
        return false;
      }
    }

    // 3. Dependency Check: All upstream prerequisites must be "succeeded"
    if (!step.dependsOn || step.dependsOn.length === 0) {
      return true;
    }

    return step.dependsOn.every((depId) => {
      const depStep = stepMap.get(depId);
      return depStep !== undefined && depStep.status === "succeeded";
    });
  });
}
```

---

### 3.4 Cascading Status Resolver Helper (`resolvePlanStepStatuses`)

In addition to querying ready steps, the protocol benefits from a pure status resolution function to compute the state of the entire DAG after step transitions:

```typescript
/**
 * Resolves the deterministic status for all steps in a plan, applying topological
 * readiness, failure cascades, skip cascades, and approval gates.
 *
 * @param plan The input execution plan.
 * @param approvedStepIds Authoritative set of approved step IDs.
 * @returns A new immutable ExecutionPlan with updated step statuses.
 */
export function resolvePlanStepStatuses(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>,
): ExecutionPlan {
  const stepMap = new Map<string, PlanStep>(plan.steps.map((s) => [s.id, s]));
  const resolvedStatuses = new Map<string, StepStatus>();

  const computeStatus = (step: PlanStep, visited: Set<string>): StepStatus => {
    if (resolvedStatuses.has(step.id)) {
      return resolvedStatuses.get(step.id)!;
    }
    if (visited.has(step.id)) {
      // Cycle encountered: mark as blocked
      return "blocked";
    }
    visited.add(step.id);

    // Terminal or active execution states remain unchanged
    if (step.status === "running" || step.status === "succeeded" || step.status === "failed") {
      resolvedStatuses.set(step.id, step.status);
      return step.status;
    }

    // If step was explicitly skipped by user action
    if (step.status === "skipped") {
      resolvedStatuses.set(step.id, "skipped");
      return "skipped";
    }

    // Check upstream dependencies
    let hasFailedOrBlockedDep = false;
    let hasSkippedDep = false;
    let hasUnfinishedDep = false;

    for (const depId of step.dependsOn ?? []) {
      const dep = stepMap.get(depId);
      if (!dep) {
        // Dangling / missing dependency
        hasFailedOrBlockedDep = true;
        break;
      }
      const depStatus = computeStatus(dep, new Set(visited));
      if (depStatus === "failed" || depStatus === "blocked") {
        hasFailedOrBlockedDep = true;
        break;
      } else if (depStatus === "skipped") {
        hasSkippedDep = true;
      } else if (depStatus !== "succeeded") {
        hasUnfinishedDep = true;
      }
    }

    let nextStatus: StepStatus;
    if (hasFailedOrBlockedDep) {
      nextStatus = "blocked";
    } else if (hasSkippedDep) {
      nextStatus = "skipped";
    } else if (hasUnfinishedDep) {
      nextStatus = "pending";
    } else {
      // All dependencies are succeeded
      if (step.approval === "required" && (!approvedStepIds || !approvedStepIds.has(step.id))) {
        nextStatus = "blocked"; // Awaiting approval
      } else {
        nextStatus = "ready";
      }
    }

    resolvedStatuses.set(step.id, nextStatus);
    return nextStatus;
  };

  const updatedSteps = plan.steps.map((step) => {
    const nextStatus = computeStatus(step, new Set());
    return nextStatus !== step.status ? { ...step, status: nextStatus } : step;
  });

  return {
    ...plan,
    steps: updatedSteps,
  };
}
```

---

## 4. Topological Graph Patterns & Edge Case Analysis

### 4.1 Linear Chain Dependencies ($A \to B \to C \to D$)

```
[Step A] ───► [Step B] ───► [Step C (approval: req)] ───► [Step D]
```

- **Initial State**: All pending. `readySteps` returns `[Step A]`.
- **Step A Succeeded**: `readySteps` returns `[Step B]`.
- **Step B Succeeded**:
  - `readySteps(plan)` (no approvedStepIds) $\to$ `[]` (Step C requires approval).
  - `readySteps(plan, new Set(["C"]))` $\to$ `[Step C]`.
- **Step C Succeeded**: `readySteps(plan)` $\to$ `[Step D]`.

### 4.2 Diamond / Fork-Join Dependencies

```
                ┌───► [Step B] ───┐
[Step A] ───────┤                 ├───► [Step D]
                └───► [Step C] ───┘
```

- **Step A Succeeded**: `readySteps` returns `[Step B, Step C]`.
- **Step B Succeeded, Step C Running**: `readySteps` returns `[]`. (Step D cannot run until both B and C succeed).
- **Step C Succeeded**: `readySteps` returns `[Step D]`.

### 4.3 Diamond with Mixed Approval Policies

```
                ┌───► [Step B (approval: auto)] ────┐
[Step A] ───────┤                                   ├───► [Step D (approval: required)]
                └───► [Step C (approval: required)] ┘
```

- **Step A Succeeded**:
  - `approvedStepIds = new Set()` $\to$ `readySteps` returns `[Step B]`. Step C is blocked.
  - `approvedStepIds = new Set(["C"])` $\to$ `readySteps` returns `[Step B, Step C]`.
- **Step B & C Succeeded**:
  - `approvedStepIds = new Set(["C"])` (D not yet approved) $\to$ `readySteps` returns `[]`.
  - `approvedStepIds = new Set(["C", "D"])` $\to$ `readySteps` returns `[Step D]`.

### 4.4 Failure Cascades in Dense DAGs

```
                ┌───► [Step B (FAILED)] ───┐
[Step A] ───────┤                          ├───► [Step D] ───► [Step E]
                └───► [Step C (succeeded)] ┘
```

- Step B failed.
- Step D depends on `["B", "C"]`. Since B failed, D cannot satisfy dependencies $\implies$ `readySteps` returns `[]`.
- Status resolution: Step D cascades to `"blocked"`, Step E cascades to `"blocked"`.

### 4.5 Skipped Step Cascades

```
[Step A (succeeded)] ──► [Step B (skipped)] ──► [Step C] ──► [Step D]
```

- Step B was intentionally skipped by user or branch condition.
- Step C depends on `["B"]`. Since B was skipped, Step C cannot succeed.
- Status resolution: Step C cascades to `"skipped"`, Step D cascades to `"skipped"`.

### 4.6 Multi-Phase Cross-Phase Dependencies

```
Phase 1 (Discovery):      [Step 1 (succeeded)] ──┐
                                                 ▼
Phase 2 (Implementation): [Step 2] ────────────► [Step 3]
Phase 3 (Verification):   [Step 4 (dependsOn: 2 & 3)]
```

- Resolution is purely topological across phase boundaries: steps in Phase 3 can run as soon as their upstream steps in Phase 1 or 2 succeed, even if other steps in Phase 2 remain incomplete.

---

## 5. Comprehensive Unit Test Suite Specification (`plan.test.ts`)

The unit test suite for `readySteps` in `packages/protocol/src/plan.test.ts` must be extended with 22 rigorous, deterministic test cases covering all graph structures, security gates, and failure cascades:

```typescript
import { describe, expect, it } from "vitest";
import { readySteps, resolvePlanStepStatuses, type ExecutionPlan } from "./plan";

describe("readySteps — Topological Step Resolution & Approval Ledger", () => {
  /* ------------------------------------------------------------------------ */
  /* 1. Basic Sequential & Single-Step Tests                                   */
  /* ------------------------------------------------------------------------ */

  it("releases root step with empty dependsOn when status is pending", () => {
    const plan: ExecutionPlan = {
      id: "p-basic-1",
      goal: "single root",
      steps: [{ id: "root", title: "Root Step", dependsOn: [], status: "pending" }],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["root"]);
  });

  it("releases root step when status is already marked ready", () => {
    const plan: ExecutionPlan = {
      id: "p-basic-2",
      goal: "single ready root",
      steps: [{ id: "root", title: "Root Step", dependsOn: [], status: "ready" }],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["root"]);
  });

  it("releases sequential step only after upstream prerequisite succeeds", () => {
    const plan: ExecutionPlan = {
      id: "p-seq-1",
      goal: "linear pipeline",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "succeeded" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["step-2"]);
  });

  it("does not release step when upstream prerequisite is pending", () => {
    const plan: ExecutionPlan = {
      id: "p-seq-2",
      goal: "pending upstream",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "pending" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["step-1"]);
  });

  it("does not release step when upstream prerequisite is running", () => {
    const plan: ExecutionPlan = {
      id: "p-seq-3",
      goal: "running upstream",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "running" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("does not re-release running, succeeded, failed, blocked, or skipped steps", () => {
    const plan: ExecutionPlan = {
      id: "p-terminal-1",
      goal: "terminal statuses",
      steps: [
        { id: "s1", title: "Running", dependsOn: [], status: "running" },
        { id: "s2", title: "Succeeded", dependsOn: [], status: "succeeded" },
        { id: "s3", title: "Failed", dependsOn: [], status: "failed" },
        { id: "s4", title: "Blocked", dependsOn: [], status: "blocked" },
        { id: "s5", title: "Skipped", dependsOn: [], status: "skipped" },
        { id: "s6", title: "Pending Ready", dependsOn: ["s2"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["s6"]);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Diamond / Fork-Join Dependencies                                      */
  /* ------------------------------------------------------------------------ */

  it("releases all parallel branch steps when fork root succeeds", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-1",
      goal: "fork test",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A", dependsOn: ["root"], status: "pending" },
        { id: "branch-b", title: "Branch B", dependsOn: ["root"], status: "pending" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["branch-a", "branch-b"]);
  });

  it("does not release join step if only one of two upstream branches succeeds", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-2",
      goal: "partial join test",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A", dependsOn: ["root"], status: "succeeded" },
        { id: "branch-b", title: "Branch B", dependsOn: ["root"], status: "running" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("releases join step once all diamond branches have succeeded", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-3",
      goal: "complete join test",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A", dependsOn: ["root"], status: "succeeded" },
        { id: "branch-b", title: "Branch B", dependsOn: ["root"], status: "succeeded" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["join"]);
  });

  it("handles wide fan-in (N=4 dependencies) correctly", () => {
    const plan: ExecutionPlan = {
      id: "p-fanin-1",
      goal: "wide fan in",
      steps: [
        { id: "d1", title: "D1", dependsOn: [], status: "succeeded" },
        { id: "d2", title: "D2", dependsOn: [], status: "succeeded" },
        { id: "d3", title: "D3", dependsOn: [], status: "succeeded" },
        { id: "d4", title: "D4", dependsOn: [], status: "pending" },
        { id: "collector", title: "Collector", dependsOn: ["d1", "d2", "d3", "d4"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["d4"]);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Approval Gate Integration & Zero Natural Language Authority           */
  /* ------------------------------------------------------------------------ */

  it("blocks step with approval: 'required' when approvedStepIds is not provided", () => {
    const plan: ExecutionPlan = {
      id: "p-app-1",
      goal: "unapproved step",
      steps: [
        { id: "audit", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "apply", title: "Apply", dependsOn: ["audit"], status: "pending", approval: "required" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("blocks step with approval: 'required' when approvedStepIds does not include step ID", () => {
    const plan: ExecutionPlan = {
      id: "p-app-2",
      goal: "mismatched approval id",
      steps: [
        { id: "audit", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "apply", title: "Apply", dependsOn: ["audit"], status: "pending", approval: "required" },
      ],
    };
    const approvals = new Set(["other-step-id"]);
    expect(readySteps(plan, approvals)).toEqual([]);
  });

  it("releases step with approval: 'required' when approvedStepIds contains step ID", () => {
    const plan: ExecutionPlan = {
      id: "p-app-3",
      goal: "approved step",
      steps: [
        { id: "audit", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "apply", title: "Apply", dependsOn: ["audit"], status: "pending", approval: "required" },
      ],
    };
    const approvals = new Set(["apply"]);
    expect(readySteps(plan, approvals).map((s) => s.id)).toEqual(["apply"]);
  });

  it("releases auto-approved step without needing membership in approvedStepIds", () => {
    const plan: ExecutionPlan = {
      id: "p-app-4",
      goal: "auto approved step",
      steps: [
        { id: "read-only", title: "Read Only", dependsOn: [], status: "pending" },
      ],
    };
    expect(readySteps(plan, new Set())).map((s) => s.id).toEqual(["read-only"]);
  });

  it("supports selective approval in parallel branches", () => {
    const plan: ExecutionPlan = {
      id: "p-app-5",
      goal: "selective parallel approval",
      steps: [
        { id: "init", title: "Init", dependsOn: [], status: "succeeded" },
        { id: "safe-branch", title: "Safe Branch", dependsOn: ["init"], status: "pending" },
        { id: "risky-branch", title: "Risky Branch", dependsOn: ["init"], status: "pending", approval: "required" },
      ],
    };
    // No approvals passed
    expect(readySteps(plan).map((s) => s.id)).toEqual(["safe-branch"]);

    // User approves risky-branch
    const approvals = new Set(["risky-branch"]);
    expect(readySteps(plan, approvals).map((s) => s.id)).toEqual(["safe-branch", "risky-branch"]);
  });

  it("immediately revokes step readiness when removed from approvedStepIds", () => {
    const plan: ExecutionPlan = {
      id: "p-app-6",
      goal: "revocation test",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "pending", approval: "required" },
      ],
    };
    const ledger = new Set(["step-1"]);
    expect(readySteps(plan, ledger).map((s) => s.id)).toEqual(["step-1"]);

    ledger.delete("step-1");
    expect(readySteps(plan, ledger)).toEqual([]);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Failure & Skip Cascades                                               */
  /* ------------------------------------------------------------------------ */

  it("does not release step if any dependency failed", () => {
    const plan: ExecutionPlan = {
      id: "p-fail-1",
      goal: "failed dep",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "failed" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("does not release step if any dependency is blocked", () => {
    const plan: ExecutionPlan = {
      id: "p-fail-2",
      goal: "blocked dep",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "blocked" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("does not release step if any dependency is skipped", () => {
    const plan: ExecutionPlan = {
      id: "p-skip-1",
      goal: "skipped dep",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "skipped" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("allows independent branch to progress when sibling branch fails in diamond", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-fail",
      goal: "partial diamond failure",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A (Failed)", dependsOn: ["root"], status: "failed" },
        { id: "branch-b", title: "Branch B (Pending)", dependsOn: ["root"], status: "pending" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["branch-b"]);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Hierarchical Multi-Phase & Robustness Tests                            */
  /* ------------------------------------------------------------------------ */

  it("resolves multi-phase DAG dependencies correctly across phase boundaries", () => {
    const plan: ExecutionPlan = {
      id: "p-phases-1",
      goal: "multi-phase execution",
      phases: [
        { id: "phase-1", title: "Discovery", order: 1 },
        { id: "phase-2", title: "Implementation", order: 2 },
        { id: "phase-3", title: "Verification", order: 3 },
      ],
      steps: [
        { id: "step-1-1", phaseId: "phase-1", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "step-2-1", phaseId: "phase-2", title: "Code", dependsOn: ["step-1-1"], status: "succeeded" },
        { id: "step-2-2", phaseId: "phase-2", title: "Refactor", dependsOn: ["step-2-1"], status: "pending" },
        { id: "step-3-1", phaseId: "phase-3", title: "Test", dependsOn: ["step-2-2"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["step-2-2"]);
  });

  it("treats dangling/ghost dependency IDs as unsatisfied", () => {
    const plan: ExecutionPlan = {
      id: "p-dangling-1",
      goal: "ghost dependency",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: ["phantom-step-id"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("handles empty plans and self-cycles gracefully without throwing or looping", () => {
    const emptyPlan: ExecutionPlan = { id: "p-empty", goal: "empty", steps: [] };
    expect(readySteps(emptyPlan)).toEqual([]);

    const cyclicPlan: ExecutionPlan = {
      id: "p-cycle",
      goal: "cycle",
      steps: [
        { id: "step-a", title: "Step A", dependsOn: ["step-b"], status: "pending" },
        { id: "step-b", title: "Step B", dependsOn: ["step-a"], status: "pending" },
      ],
    };
    expect(readySteps(cyclicPlan)).toEqual([]);
  });
});
```

---

## 6. Integration Blueprint for Agent Host & UI Reducers

### 6.1 `apps/agent-host/src/runs/coordinator.ts` Integration

In the Agent Host's `RunCoordinator`, the execution loop (`drive()`) queries `readySteps` on each iteration:

```typescript
// Inside RunCoordinator.drive()
const ready = readySteps(this.livePlan(ctx), this.config.approvalLedger);
if (ready.length === 0) {
  const allSucceeded = ctx.plan.steps.every(
    (s) => ctx.stepStatus.get(s.id) === "succeeded"
  );
  if (allSucceeded) {
    this.finish(ctx, "completed");
  } else {
    // Check if remaining pending steps are blocked on approval vs failures
    const hasUnapproved = ctx.plan.steps.some(
      (s) => s.approval === "required" && ctx.stepStatus.get(s.id) === "pending"
    );
    if (hasUnapproved) {
      this.pause(ctx); // Await user approval event
    } else {
      this.finish(ctx, "failed", "no runnable steps: unmet dependencies");
    }
  }
  return;
}
```

### 6.2 Frontend `PlanComposer` & `PlanPanel` Integration

In `src/lib/planComposer/planComposerReducer.ts` and `src/sections/PlanPanel.tsx`:
- The client maintains `approvedStepIds: ReadonlySet<string>`.
- The `"Run Approved Steps"` CTA button evaluates `readySteps(plan, approvedStepIds).length > 0`.
- Click on `"Approve Step"` dispatches `{ type: "TOGGLE_APPROVAL", stepId }`, which immutably updates `approvedStepIds` and triggers immediate re-evaluation of `readySteps`.
- If an unapproved step is received as `"running"` from the server over WebSocket, the client's approval ledger invariant immediately flags the inconsistency and issues a veto.

---

## 7. Verification Plan & Quality Checks

1. **Protocol Package Unit Tests**:
   - Command: `npm run test:protocol` (or `vitest run packages/protocol`)
   - Target: 100% test pass rate across all 22+ tests in `plan.test.ts`.
2. **Backward Compatibility**:
   - All legacy test fixtures (`as const` plans, plans without `approval` field, single-step plans) run without modifications.
3. **Type Safety & Build**:
   - `npm run build` (`tsc -b && vite build`) completes with 0 type errors.

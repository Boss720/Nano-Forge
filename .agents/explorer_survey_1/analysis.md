# NanoForge Phase 2 Survey Report — Explorer 1
**Focus Area:** Protocol Upgrades (R1), Wire Synchronization (R4), and Agent-Host Architecture  
**Author:** Explorer Survey Agent 1  
**Date:** 2026-08-15  
**Target Modules:** `packages/protocol`, `apps/agent-host`, `src/types`, `src/lib/hostClient.ts`

---

## 1. Executive Summary & Monorepo Baseline

NanoForge is an agentic development workspace combining a reactive web UI (`src/`), a privileged local Fastify WebSocket daemon (`apps/agent-host`), and a shared single-source-of-truth protocol package (`packages/protocol`).

### 1.1 Current Phase 1 Monorepo Baseline
A comprehensive survey of the existing codebase was conducted. All test suites and builds currently pass with 100% success:
- **Protocol Tests (`npm run test:protocol`)**: 2 test files, 11 tests passing (`src/plan.test.ts`, `src/artifacts.test.ts`).
- **Host Tests (`npm run test:host`)**: 16 test files, 158 tests passing (including coordinator, audit, browser, policy, MCP client, terminal runner, and server suites).
- **Frontend Tests (`npm test`)**: 21 test files, 204 tests passing.
- **TypeScript & Build Verification**:
  - `npm run typecheck:protocol`: 0 errors.
  - `npm run typecheck:host`: 0 errors.
  - `npm run build` (`tsc -b && vite build`): 0 errors, clean production bundle generated.

### 1.2 Phase 2 Scope & Objectives (R1 & R4 Focus)
Phase 2 introduces **Antigravity-Style Planning Mode** and the **Extensible Slash Command Engine**. This survey establishes the complete technical foundation for:
1. **R1: Upgraded Planning Protocol & Lifecycle State Machine**: Hierarchical Phase-grouped execution plans (`PlanPhase`, `PlanStep`), complete lifecycle states (`draft`, `awaiting_approval`, `executing`, `paused`, `completed`, `failed`), step states (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`), and deterministic DFS/Tarjan cycle validation.
2. **R4: Host-Client Wire Protocol Synchronization**: Bi-directional WebSocket synchronization for `plan.propose`, `plan.update_step`, `plan.approve`, `plan.run_approved`, and `command.execute`, strictly enforcing the zero-natural-language approval security invariant.

---

## 2. Current State vs. Phase 2 Gaps

### 2.1 Protocol Package (`packages/protocol/src/plan.ts`)

| Feature / Contract | Phase 1 Current Implementation | Phase 2 Requirement (R1 / PRD) | Identified Gap |
|---|---|---|---|
| **Step Statuses** | `pending`, `running`, `succeeded`, `failed`, `blocked` (5 states) | `pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped` (7 states) | Missing `"ready"` and `"skipped"`. |
| **Plan Lifecycle States** | Not in `packages/protocol/src/plan.ts` (only in `validatePlan.ts` & `src/types/index.ts` with 5 states) | `draft`, `awaiting_approval`, `executing`, `paused`, `completed`, `failed` (6 canonical states + `cancelled`) | Missing `"failed"` in lifecycle enum; must be declared in protocol with Zod schema. |
| **Phase Grouping** | None (`PlanStep` flat array only; no `phases` or `phaseId`) | `PlanPhase` (`id`, `title`, `order`, `description?`), `PlanStep.phaseId`, `ExecutionPlan.phases` | Missing `PlanPhase` interface, Zod schemas, default phase assignment, and phase ordering. |
| **Step Schema & Model** | Plain TS interface only in protocol; no Zod validation | Zod schemas (`planStepSchema`, `planPhaseSchema`, `executionPlanSchema`, `stepStatusSchema`) | `plan.ts` lacks runtime Zod schemas for deserialization and validation. |
| **Topological Resolution (`readySteps`)** | Only checks `status === "pending"` and `dependsOn.every(succeeded)` | Must support optional approval ledger gating (`approvedStepIds`), skip handling, and step readiness tagging | Update `readySteps` pure function to handle all 7 step states and approval requirements. |
| **Plan Revisions** | None | `PlanRevision` (`revisionId`, `parentRevisionId`, `createdAt`, `author`, `diffSummary`) | Add optional revision tracking metadata. |

### 2.2 Slash Commands Protocol (`packages/protocol/src/commands.ts`)

Currently, `packages/protocol/src/commands.ts` does **not exist** in `packages/protocol/src/`.
- **Requirement**: Create `packages/protocol/src/commands.ts` exporting:
  - `slashCommandCategorySchema` (`"planning" | "system" | "workspace" | "context" | "custom"`)
  - `slashCommandWireSchema` / `SlashCommandWire`
  - `slashCommandSchema` / `SlashCommand`
  - Context mentions schema (`@file:<path>`, `@rule:<name>`, `#symbol:<name>`, `@agent:<id>`)
  - Argument typing (positional args, boolean/string/number flags, raw input).

### 2.3 WebSocket Wire Protocol (`packages/protocol/src/wire.ts` & `apps/agent-host/src/protocol.ts`)

Currently, `apps/agent-host/src/protocol.ts` supports:
`ping`, `plan.submit`, `approval.grant`, `approval.deny`, `run.pause`, `run.resume`, `run.cancel`, `tool.response`, `workspace.*`, `integration.toggle`.

- **Requirement for R4**: Expand both `packages/protocol/src/wire.ts` and `apps/agent-host/src/protocol.ts` with:
  1. `plan.propose` (Client -> Host): Propose a new draft plan or AI-generated plan.
  2. `plan.update_step` (Client -> Host): Mutate step title, description, phase, dependencies, sideEffecting, or approval status.
  3. `plan.approve` (Client -> Host): Single-click step approval, phase-level approval, or approve-all.
  4. `plan.run_approved` (Client -> Host): Trigger execution of approved steps.
  5. `command.execute` (Client -> Host): Execute slash commands (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`).
  6. Corresponding Host -> Client responses:
     - `plan.propose.result` / `plan.proposed`
     - `plan.update_step.result`
     - `plan.approve.result`
     - `plan.run_approved.result`
     - `command.execute.result`
     - `model.delta` (token streaming for slash command/reasoning output)

---

## 3. Data Contracts & Interfaces Specification

### 3.1 `packages/protocol/src/plan.ts`

```typescript
import { z } from "zod";

/** Lifecycle status of a single plan step (7 states). */
export const stepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/** Resource estimate for a step. */
export const stepEstimateSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationSec: z.number().nonnegative().optional(),
});
export type StepEstimate = z.infer<typeof stepEstimateSchema>;

/** Phase grouping unit. */
export const planPhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
});
export type PlanPhase = z.infer<typeof planPhaseSchema>;

/** Single unit of work in an execution plan. */
export const planStepSchema = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1).default("default"),
  title: z.string().min(1),
  description: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  status: stepStatusSchema.default("pending"),
  approval: z.literal("required").optional(),
  sideEffecting: z.boolean().default(false),
  affectedScopes: z.array(z.string()).default([]),
  estimate: stepEstimateSchema.optional(),
  artifacts: z.array(z.string()).default([]),
});
export type PlanStep = z.infer<typeof planStepSchema>;

/** Canonical plan lifecycle states (6 states + optional cancelled). */
export const planLifecycleStateSchema = z.enum([
  "draft",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type PlanLifecycleState = z.infer<typeof planLifecycleStateSchema>;
export type PlanUIState = PlanLifecycleState;

/** Plan revision metadata. */
export const planRevisionSchema = z.object({
  revisionId: z.number().int().positive().default(1),
  parentRevisionId: z.number().int().positive().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  author: z.enum(["user", "agent"]).default("user"),
  diffSummary: z.string().optional(),
});
export type PlanRevision = z.infer<typeof planRevisionSchema>;

/** Full Execution Plan schema. */
export const executionPlanSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  state: planLifecycleStateSchema.default("draft"),
  phases: z.array(planPhaseSchema).default([
    { id: "discovery", title: "Phase 1: Discovery & Audit", order: 1 },
    { id: "execution", title: "Phase 2: Implementation", order: 2 },
    { id: "verification", title: "Phase 3: Verification & Test", order: 3 },
  ]),
  steps: z.array(planStepSchema).min(1),
  currentRevision: planRevisionSchema.optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

/**
 * Pure topological step readiness selector.
 * Evaluates pending steps whose upstream dependencies all succeeded.
 * If an approvedStepIds set is provided, steps requiring approval must be present in the set.
 */
export function readySteps(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>,
): PlanStep[] {
  return plan.steps.filter((step) => {
    if (step.status !== "pending" && step.status !== "ready") return false;
    const depsSatisfied = step.dependsOn.every((depId) =>
      plan.steps.some((d) => d.id === depId && d.status === "succeeded"),
    );
    if (!depsSatisfied) return false;
    if (
      step.approval === "required" &&
      approvedStepIds &&
      !approvedStepIds.has(step.id)
    ) {
      return false;
    }
    return true;
  });
}
```

### 3.2 `packages/protocol/src/commands.ts`

```typescript
import { z } from "zod";

export const slashCommandCategorySchema = z.enum([
  "planning",
  "system",
  "workspace",
  "context",
  "custom",
]);
export type SlashCommandCategory = z.infer<typeof slashCommandCategorySchema>;

export const contextMentionsSchema = z.object({
  files: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
});
export type ContextMentions = z.infer<typeof contextMentionsSchema>;

export const slashCommandWireSchema = z.object({
  command: z.string().regex(/^\/[a-z0-9_-]+$/),
  positional: z.array(z.string()).default([]),
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  rawInput: z.string(),
  mentions: contextMentionsSchema.default({ files: [], symbols: [], agents: [], rules: [] }),
});
export type SlashCommandWire = z.infer<typeof slashCommandWireSchema>;
export type SlashCommand = SlashCommandWire;
```

### 3.3 Wire Synchronization Schemas (`packages/protocol/src/wire.ts` & `apps/agent-host/src/protocol.ts`)

#### Client -> Host Wire Schemas
```typescript
export const planProposeSchema = z.object({
  type: z.literal("plan.propose"),
  requestId: z.string().min(1),
  plan: executionPlanSchema,
});

export const planUpdateStepSchema = z.object({
  type: z.literal("plan.update_step"),
  requestId: z.string().min(1),
  planId: z.string().min(1),
  stepId: z.string().min(1),
  changes: planStepSchema.partial(),
});

export const planApproveSchema = z.object({
  type: z.literal("plan.approve"),
  requestId: z.string().min(1),
  planId: z.string().min(1),
  stepId: z.string().optional(),
  phaseId: z.string().optional(),
  all: z.boolean().optional(),
});

export const planRunApprovedSchema = z.object({
  type: z.literal("plan.run_approved"),
  requestId: z.string().min(1),
  planId: z.string().min(1),
});

export const commandExecuteSchema = z.object({
  type: z.literal("command.execute"),
  requestId: z.string().min(1),
  command: slashCommandWireSchema,
});
```

#### Host -> Client Wire Schemas
```typescript
export const planProposeResultSchema = z.object({
  type: z.literal("plan.propose.result"),
  requestId: z.string().min(1),
  plan: executionPlanSchema,
  ok: z.boolean(),
  errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
});

export const planUpdateStepResultSchema = z.object({
  type: z.literal("plan.update_step.result"),
  requestId: z.string().min(1),
  planId: z.string().min(1),
  stepId: z.string().min(1),
  step: planStepSchema.optional(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const planApproveResultSchema = z.object({
  type: z.literal("plan.approve.result"),
  requestId: z.string().min(1),
  planId: z.string().min(1),
  approvedStepIds: z.array(z.string()),
  success: z.boolean(),
});

export const planRunApprovedResultSchema = z.object({
  type: z.literal("plan.run_approved.result"),
  requestId: z.string().min(1),
  planId: z.string().min(1),
  runId: z.string().min(1),
  state: z.enum(["queued", "running", "error"]),
});

export const commandExecuteResultSchema = z.object({
  type: z.literal("command.execute.result"),
  requestId: z.string().min(1),
  command: z.string(),
  success: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
  data: z.unknown().optional(),
});
```

---

## 4. Validation & State Transition Algorithms

### 4.1 Enhanced DAG Validation (`validatePlan.ts`)

Validation checks must execute in $O(V + E)$ deterministic time, catching all error classes in a single pass:

```
+-----------------------------------------------------------------------------------+
|                            VALIDATE PLAN PIPELINE                                 |
+-----------------------------------------------------------------------------------+
| 1. Phase Validation: Unique phase IDs, order monotonicity, non-empty phases       |
| 2. Step ID Validation: Unique step IDs across entire plan                         |
| 3. Phase Ref Validation: Every step.phaseId references a valid plan.phases entry  |
| 4. Unknown Dependency: Every step.dependsOn ID exists in plan.steps              |
| 5. Deterministic Cycle Detection: Tarjan's SCC / 3-Color DFS with Cycle Path Trace|
| 6. Policy Approval Enforcement: Every sideEffecting=true step has approval="req"  |
+-----------------------------------------------------------------------------------+
```

#### Cycle Validation Algorithm (Deterministic DFS / Tarjan)
The cycle detector traverses step dependency edges ($u \to v$ where $u$ depends on $v$).
- Colors: `WHITE = 0` (unvisited), `GRAY = 1` (currently in recursion stack), `BLACK = 2` (completed).
- On encountering a `GRAY` node, back-trace the call stack to extract the verbatim cycle path: e.g. `stepA → stepB → stepC → stepA`.
- Deduplicate reported cycles using canonical sorted node-set keys so each cycle is reported exactly once.

#### Validation Error Codes
- `duplicate_phase_id`: A phase ID is declared more than once.
- `duplicate_step_id`: A step ID is declared more than once.
- `unknown_phase`: A step references a `phaseId` not defined in `plan.phases`.
- `unknown_dependency`: A step depends on a non-existent step ID.
- `dependency_cycle`: A directed cycle was detected (includes formatted path `A → B → A`).
- `missing_approval`: A step marked `sideEffecting: true` lacks `approval: "required"`.

### 4.2 Plan Lifecycle State Transition Matrix

```typescript
export function nextPlanState(
  state: PlanLifecycleState,
  event: "propose" | "execute" | "approve" | "pause" | "resume" | "complete" | "fail" | "cancel",
): PlanLifecycleState {
  switch (event) {
    case "propose":
      return "draft";
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
      return state === "executing" || state === "awaiting_approval" ? "failed" : state;
    case "cancel":
      return state !== "completed" ? "draft" : state;
  }
}
```

### 4.3 Step Lifecycle Transition Matrix

```
       +------------+
       |  PENDING   |
       +------------+
         |        |
All deps |        | Any dep failed
succeed  |        | or blocked
         v        v
    +---------+ +---------+
    |  READY  | | BLOCKED |
    +---------+ +---------+
         |
Coordinator
dispatches
         v
    +---------+
    | RUNNING |
    +---------+
      |     |
 Pass |     | Fail
      v     v
+-----------+ +--------+
| SUCCEEDED | | FAILED |
+-----------+ +--------+
```

---

## 5. Slash Command Engine Architecture (R4 / Host-Side)

### 5.1 Slash Command Parser Grammar
Input syntax: `/<command> [positional...] [--flag=val] [-f] [@file:path] [#symbol:name] [@rule:name]`

1. **Tokenizer**: Regex `/([^\s"']+|"([^"]*)"|'([^']*)')/g` extracts tokens respecting quotes.
2. **Command Token**: First token starting with `/`.
3. **Flags**:
   - `--key=value` -> `flags.key = parsedValue`
   - `--key` -> `flags.key = true`
   - `-k` -> `flags.k = true`
4. **Mentions**:
   - `@file:<path>` -> `mentions.files.push(path)`
   - `@rule:<name>` -> `mentions.rules.push(name)`
   - `#symbol:<name>` -> `mentions.symbols.push(name)`
   - `@agent:<id>` -> `mentions.agents.push(id)`

### 5.2 Built-in Commands Dispatch Table

| Command | Arguments | Host Handler / Action |
|---|---|---|
| `/plan` | `[goal: string]` | Initializes `draft` plan with hierarchical phases (Discovery, Execution, Verification) and returns `ExecutionPlan`. |
| `/goal` | `<text: string>` | Sets active mission goal banner and broadcasts context update. |
| `/schedule` | `<interval\|cron> <prompt>` | Registers background daemon timer via Task Supervisor. |
| `/browse` | `<url: string>` | Triggers Playwright browser manager with origin validation. |
| `/learn` | `[topic\|path]` | Generates YAML skill definition or workspace rule. |
| `/cost` | `[--by-model]` | Aggregates token usage from audit store and returns breakdown. |
| `/compact` | `[--keep=N]` | Summarizes intermediate history, pruning tokens while preserving critical context. |
| `/clear` | None | Resets active conversation session messages. |

---

## 6. Testing Requirements & Coverage Plan

### 6.1 `packages/protocol` Test Suite
- `src/plan.test.ts`:
  - Hierarchical phase grouping serialization & validation.
  - Step status transitions across all 7 statuses (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`).
  - `readySteps` pure helper verifying topological release only when upstream dependencies succeed.
  - `readySteps` blocking steps with unapproved required gates.
- `src/commands.test.ts`:
  - Slash command wire schema validation.
  - Mention parsing (`@file`, `@rule`, `#symbol`, `@agent`).
  - Flag parsing (`--flag=value`, `-f`, boolean coercion).
- `src/wire.test.ts`:
  - Validation of `plan.propose`, `plan.update_step`, `plan.approve`, `plan.run_approved`, `command.execute`.

### 6.2 `apps/agent-host` Test Suite
- `src/planning/validatePlan.test.ts`:
  - Acceptance of valid multi-phase plans.
  - Rejection of duplicate phase IDs, missing phase references.
  - Detection of single-node self loops (`A → A`), 2-node cycles (`A → B → A`), 3+ node cycles (`A → B → C → A`), and disconnected component cycles.
  - Verbatim cycle path reporting (`A → B → C → A`).
  - Enforcement of `approval: "required"` on all `sideEffecting: true` steps.
  - Full plan lifecycle state machine transitions (`draft` -> `awaiting_approval` -> `executing` -> `paused` -> `completed` / `failed`).
- `src/runs/coordinator.test.ts`:
  - Execution of phase-grouped plans in topological order.
  - Cascade blocking: when step 1 fails, step 2 (`dependsOn: ["step1"]`) is marked `blocked`.
  - Zero-text security invariant: simulated model chat text proposing approval is rejected; only explicit wire frames grant approvals.
- `src/session.test.ts` & `src/server.test.ts`:
  - Full WebSocket roundtrip for `plan.propose`, `plan.update_step`, `plan.approve`, `plan.run_approved`, `command.execute`.
  - Rejection of malformed frames with 4400 code.

### 6.3 Frontend Test Suite (`src/sections/__tests__/` & `src/lib/__tests__/`)
- `PlanPanel.test.tsx`:
  - Accordion rendering for phases (Discovery, Execution, Verification).
  - Step dependency badges and affected scopes rendering.
  - Single-click step approvals, phase-level approvals, approve-all.
  - Run execution gate enabled ONLY when all approvals are satisfied.
  - Immediate UI downgrade to `blocked` if host attempts rogue `running` transition on unapproved step.
- `ChatPanel.slash.test.tsx`:
  - Typing `/` triggers floating autocomplete palette.
  - Keyboard navigation (Up/Down/Enter/Escape).
  - Executing `/plan <goal>` switches UI to Planning Mode.
  - Executing `/goal <text>` pins mission objective.
  - `@file` fuzzy matching workspace files and inserting mention chip.
- `hostClient.test.ts`:
  - `proposePlan`, `updateStep`, `approvePlan`, `runApproved`, `executeCommand` wire transmission and correlation.

---

## 7. Implementation Roadmap for Phase 2

```
+-------------------------------------------------------------------------------------------------------------+
| STEP 1: packages/protocol Schema Upgrades (R1 & R4)                                                         |
| - Upgrade packages/protocol/src/plan.ts with PlanPhase, 7 step states, PlanLifecycleState, Zod schemas     |
| - Create packages/protocol/src/commands.ts with slash command & mention schemas                             |
| - Export from packages/protocol/src/index.ts                                                                |
| - Add unit tests in packages/protocol/src/plan.test.ts & commands.test.ts                                   |
+-------------------------------------------------------------------------------------------------------------+
                                                       │
                                                       ▼
+-------------------------------------------------------------------------------------------------------------+
| STEP 2: apps/agent-host Planning & Validation Engine (R1 & R4)                                               |
| - Upgrade apps/agent-host/src/planning/validatePlan.ts (Phase validation, DFS/Tarjan cycle path extraction)  |
| - Upgrade apps/agent-host/src/protocol.ts (Zod wire schemas for plan & command frames)                      |
| - Upgrade apps/agent-host/src/session.ts (Frame dispatchers for plan.propose, plan.approve, command.execute)|
| - Upgrade apps/agent-host/src/runs/coordinator.ts (Topological multi-phase release & cascade blocking)      |
| - Add test suites in apps/agent-host/src/planning/validatePlan.test.ts, coordinator.test.ts, server.test.ts |
+-------------------------------------------------------------------------------------------------------------+
                                                       │
                                                       ▼
+-------------------------------------------------------------------------------------------------------------+
| STEP 3: Frontend Client & Planning Visual Surface (R2, R3, R4)                                              |
| - Upgrade src/types/index.ts to match upgraded protocol contracts                                          |
| - Upgrade src/lib/hostClient.ts to support plan & command wire RPCs                                         |
| - Upgrade src/sections/PlanPanel.tsx (Phase accordions, DAG visualizer, approval ledger, execution gates)  |
| - Implement Slash Command Engine & Caret Popover in src/sections/ChatPanel.tsx (with fuzzy @file mentions)  |
| - Add full Vitest UI test coverage in src/sections/__tests__/PlanPanel.test.tsx and ChatPanel.test.tsx      |
+-------------------------------------------------------------------------------------------------------------+
                                                       │
                                                       ▼
+-------------------------------------------------------------------------------------------------------------+
| STEP 4: Full Quality Gate & Monorepo Verification (R5)                                                      |
| - Run npm run test:protocol (100% pass)                                                                     |
| - Run npm run test:host (100% pass)                                                                         |
| - Run npm test (100% pass across all frontend suites)                                                       |
| - Run npm run typecheck:protocol && npm run typecheck:host                                                  |
| - Run npm run build (0 errors)                                                                              |
+-------------------------------------------------------------------------------------------------------------+
```

---
*End of Phase 2 Explorer Survey Report.*

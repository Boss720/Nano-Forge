# Handoff Report — Milestone 1: Planning Protocol & Command Contracts

**Agent:** Explorer M1.1 (`.agents/explorer_m1_1`)  
**Date:** 2026-08-15T03:23:00Z  
**Recipient:** Parent / Orchestrator (`2cd93070-fd9e-4267-b74b-1981bee34150`)  
**Type:** Hard Handoff (Investigation & Protocol Design Complete)  

---

## 1. Observation

1. **Protocol Package Status (`packages/protocol/src/plan.ts:1-86`)**:
   - `plan.ts` currently defines TypeScript types (`StepStatus`, `StepEstimate`, `PlanStep`, `ExecutionPlan`) and a basic `readySteps(plan: ExecutionPlan)` function, but lacks runtime Zod schemas.
   - `StepStatus` (lines 12–17) is currently restricted to `"pending" | "running" | "succeeded" | "failed" | "blocked"`, omitting `"ready"` and `"skipped"`.
   - `ExecutionPlan` (lines 63–68) defines `{ id: string; goal: string; steps: readonly PlanStep[]; }`, missing hierarchical `phases?: readonly PlanPhase[]`, `title?: string`, `state?: PlanLifecycleState`, `revision?: number`, and timestamps (`createdAt`, `updatedAt`).
2. **Slash Command Package Status (`packages/protocol/src/commands.ts`)**:
   - The file does not currently exist.
   - `packages/protocol/src/index.ts:1-8` re-exports `./plan`, `./routing`, `./artifacts`, but lacks `./commands`.
3. **Test Infrastructure & Existing Baselines (`package.json:11-13`)**:
   - `npm run test:protocol` executes `vitest run --config packages/protocol/vitest.config.ts`, passing all 11 existing tests across `src/plan.test.ts` (6 tests) and `src/artifacts.test.ts` (5 tests).
   - `npm run test:host` executes `vitest run --config apps/agent-host/vitest.config.ts`, passing all 158 tests across 16 test files.
4. **Downstream Dependency Observations (`apps/agent-host/src/runs/coordinator.ts:22-23`, `apps/agent-host/src/planning/validatePlan.ts:9`, `src/types/index.ts:128-155`)**:
   - Host and UI modules expect `ExecutionPlan` to accept `goal: string` and pass `step.status` values.
   - `validatePlan.ts` implements a DFS 3-color cycle detection algorithm and checks that `sideEffecting: true` steps declare `approval: "required"`.

---

## 2. Logic Chain

1. **Supporting Hierarchical Phases (R1 / Feature 1)**:
   - Observation 1 shows `ExecutionPlan` lacks phase grouping.
   - By defining `planPhaseSchema` (`{ id, title, description?, order }`) and adding `phases?: readonly PlanPhase[]` and `phaseId?: string` to `PlanStep`, multi-phase plans (e.g. Discovery → Implementation → Verification) can be represented hierarchically while retaining a flat `steps` array for topological scheduling.
2. **Extending Lifecycle States (R1 / Features 2 & 3)**:
   - Observation 1 shows `StepStatus` needs expansion to 7 states (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`).
   - Defining `stepStatusSchema` and `planLifecycleStateSchema` (`draft`, `awaiting_approval`, `executing`, `paused`, `completed`, `failed`) provides type-safe state transitions across host and client.
3. **Dual Approval Gate & Zero-NL Authority Invariant (R1, R4 / Feature 17)**:
   - In accordance with the security invariant that chat/model text cannot satisfy approval gates, `readySteps(plan, approvedStepIds?: ReadonlySet<string>)` enforces that if `step.approval === "required"` and an `approvedStepIds` ledger is provided, the step is only released if `approvedStepIds.has(step.id)` is true.
   - Making `approvedStepIds` optional preserves backward compatibility with existing callers.
4. **Slash Command & Mention Contracts (R3, R4 / Features 5 & 6)**:
   - Creating `packages/protocol/src/commands.ts` with `slashCommandWireSchema`, `commandExecuteFrameSchema` (`command.execute`), `commandResultFrameSchema` (`command.result`), context mentions (`@file`, `@rule`, `#symbol`, `@agent`), and a POSIX-compliant tokenizer (`parseSlashCommand`) provides the shared contract needed for Milestone 2 and Milestone 4.
5. **Guaranteeing 100% Backward Compatibility (R5 / Feature 19)**:
   - Making `title`, `phases`, `state`, `revision`, `createdAt`, and `updatedAt` optional on `ExecutionPlan`, while preserving `goal?: string`, ensures all existing test fixtures in `packages/protocol`, `apps/agent-host`, and `src/` continue to compile and pass without modification.

---

## 3. Caveats

1. **Frontend State Reducers**: While this blueprint specifies protocol types and schemas, the UI reducers (`src/lib/planComposer/` and `src/lib/commands/`) belong to Milestones 2 and 3 and will consume these protocol exports.
2. **WebSocket Server Handlers**: The server-side dispatchers for `command.execute` in `apps/agent-host/src/session.ts` belong to Milestone 4.
3. **Assumptions**: We assume TypeScript 5.9+ and Zod 4.x/3.x installed in root `package.json` (verified: Zod `^4.3.5` present).

---

## 4. Conclusion

The protocol contracts for Milestone 1 are fully analyzed and specified in `analysis.md`:
- `packages/protocol/src/plan.ts`: Zod schemas & TypeScript types for `PlanPhase`, `StepStatus` (7 states), `PlanLifecycleState` (6 states), `StepEstimate`, `PlanStep`, `ExecutionPlan`, `readySteps` with dual approval gates, and `validatePlanDAG`.
- `packages/protocol/src/commands.ts`: Zod schemas, wire frames (`command.execute`, `command.result`), `SlashCommandWire`, context mentions (`@file`, `@rule`), POSIX tokenizer/formatter, and 8 built-in commands.
- `packages/protocol/src/index.ts`: Public export surface.
- `packages/protocol/src/plan.test.ts` & `commands.test.ts`: Complete 23-case unit test matrix.

Implementation can proceed immediately.

---

## 5. Verification Method

1. **Protocol Test Suite**:
   ```powershell
   npm run test:protocol
   ```
   *Expected Outcome*: All test files in `packages/protocol` execute and pass with 100% success.
2. **Host Test Suite (Backward Compatibility Check)**:
   ```powershell
   npm run test:host
   ```
   *Expected Outcome*: All 158 host unit tests continue to pass with 0 regressions.
3. **Typecheck Verification**:
   ```powershell
   npm run typecheck:protocol
   npm run typecheck:host
   ```
   *Expected Outcome*: 0 TypeScript compilation errors.

# Phase 2 Survey Handoff Report — Explorer 1

## 1. Observation
- **Authoritative Request**: `ORIGINAL_REQUEST.md` lines 13-26 specify R1 (Upgraded Planning Protocol & Lifecycle State Machine with Phase-grouped plans, 6 lifecycle states `draft`, `awaiting_approval`, `executing`, `paused`, `completed`, `failed`, 7 step states `pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`, and deterministic DFS/Tarjan cycle validation) and R4 (WebSocket wire protocol synchronization for `plan.propose`, `plan.update_step`, `plan.approve`, `plan.run_approved`, `command.execute`).
- **Current `packages/protocol/src/plan.ts`**:
  - StepStatus (lines 12-17): `export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";` (missing `"ready"` and `"skipped"`).
  - No `PlanPhase` interface or phase grouping fields on `PlanStep` or `ExecutionPlan`.
  - No Zod schemas in `packages/protocol/src/plan.ts` (unlike `artifacts.ts` which uses Zod).
  - `PlanUIState` / `PlanLifecycleState` not declared in `packages/protocol/src/plan.ts`.
- **Current `apps/agent-host/src/planning/validatePlan.ts`**:
  - `PlanUIState` (line 111): `"draft" | "awaiting_approval" | "executing" | "paused" | "completed"` (missing `"failed"`).
  - `validatePlan` (lines 26-108): validates duplicate step IDs, unknown dependency IDs, cycles via 3-color DFS, and `missing_approval` for `sideEffecting: true`. Does not yet validate phase definitions, phase IDs, or multi-phase graph structure.
- **Current `apps/agent-host/src/protocol.ts` & `src/session.ts`**:
  - `clientMessageSchema` (lines 150-197): supports `ping`, `plan.submit`, `approval.grant`, `approval.deny`, `run.pause`, `run.resume`, `run.cancel`, `tool.response`, `workspace.*`, `integration.toggle`.
  - Does not yet include `plan.propose`, `plan.update_step`, `plan.approve`, `plan.run_approved`, `command.execute`.
- **Current Baseline Test & Build Status**:
  - `npm run test:protocol`: 2 files, 11 tests passed (100%).
  - `npm run test:host`: 16 files, 158 tests passed (100%).
  - `npm test`: 21 files, 204 tests passed (100%).
  - `npm run typecheck:protocol; npm run typecheck:host`: 0 errors.
  - `npm run build`: `tsc -b && vite build` built successfully in 17.15s with 0 errors.

## 2. Logic Chain
1. **Observation 1 & 2** show that `packages/protocol/src/plan.ts` is missing `PlanPhase`, 2 step statuses (`ready`, `skipped`), lifecycle state `failed`, and Zod schemas.
2. Therefore, to satisfy R1, `packages/protocol/src/plan.ts` must export `planPhaseSchema`, `planStepSchema`, `executionPlanSchema`, `stepStatusSchema`, `planLifecycleStateSchema`, along with inferred types and an upgraded `readySteps` function supporting topological readiness and approval ledgers.
3. **Observation 3** shows that `apps/agent-host/src/planning/validatePlan.ts` uses 3-color DFS for step dependencies, but lacks phase validation and the `"failed"` lifecycle state.
4. Therefore, `validatePlan.ts` must be extended with phase validation (checking duplicate phase IDs and invalid step `phaseId` references) and upgraded state machine transitions.
5. **Observation 4** shows that `apps/agent-host/src/protocol.ts` and `session.ts` do not yet handle `plan.propose`, `plan.update_step`, `plan.approve`, `plan.run_approved`, or `command.execute`.
6. Therefore, to satisfy R4, Zod schemas and session dispatch handlers must be added for these 5 wire messages and their corresponding result frames.
7. **Observation 5** demonstrates that all existing suites pass cleanly. Any changes made for Phase 2 must maintain 100% backward compatibility and test passage.

## 3. Caveats
- No code in `src/` or `packages/` or `apps/` was modified during this survey (read-only investigation per protocol).
- The detailed UI component implementation for `PlanPanel.tsx` (R2) and `ChatPanel.tsx` (R3) was mapped out from a data contract perspective; visual layout and user interactions will be executed in subsequent implementation passes.

## 4. Conclusion
The current codebase provides a clean, well-tested baseline with 0 errors. Upgrading `packages/protocol`, `apps/agent-host/src/planning/validatePlan.ts`, `apps/agent-host/src/protocol.ts`, and `apps/agent-host/src/session.ts` for R1 and R4 is clearly defined, fully specified in `analysis.md`, and ready for immediate implementation.

## 5. Verification Method
To independently verify this investigation and the system baseline:
1. `npm run test:protocol` — Verify protocol tests pass 100%.
2. `npm run test:host` — Verify agent host tests pass 100%.
3. `npm test` — Verify frontend unit & integration tests pass 100%.
4. `npm run typecheck:protocol; npm run typecheck:host` — Verify TypeScript compiler checks pass.
5. `npm run build` — Verify Vite production build completes cleanly.
6. Inspect `.agents/explorer_survey_1/analysis.md` for full contract definitions and algorithm specifications.

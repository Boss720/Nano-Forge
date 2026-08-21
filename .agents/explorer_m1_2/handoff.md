# Milestone 1 Plan Validation & Cycle Detection Handoff Report

**Agent**: Explorer M1.2  
**Milestone**: M1 (Agent Host Plan Validation & Cycle Detection)  
**Report Type**: Hard Handoff (Complete Investigation)

---

## 1. Observation

1. **`apps/agent-host/src/planning/validatePlan.ts` (lines 1-148)**:
   - `ValidationErrorCode` (lines 11-15) defines only 4 codes: `"duplicate_step_id"`, `"unknown_dependency"`, `"dependency_cycle"`, `"missing_approval"`.
   - `validatePlan` (lines 26-108) operates purely on flat `steps` arrays without checking `plan.phases`, `step.phaseId`, or empty steps.
   - Cycle detection (lines 60-94) uses 3-color DFS and string deduplication via `[...new Set(cycle)].sort().join("")`, but does not attach structured cycle node arrays (`cycle: string[]`) to the error object or validation result.
   - `PlanUIState` (line 111) defines 5 states: `"draft" | "awaiting_approval" | "executing" | "paused" | "completed"` — missing the 6th canonical state `"failed"`.
   - `nextPlanState` (lines 125-142) handles events `"execute"`, `"approve"`, `"pause"`, `"resume"`, `"complete"`, `"cancel"`, but lacks `"fail"` and `"reset"`, and lacks explicit `isValidPlanTransition` / `validatePlanTransition` functions.
2. **`apps/agent-host/src/planning/validatePlan.test.ts` (lines 1-136)**:
   - Contains 9 tests covering basic step ID deduplication, unknown dependencies, simple DFS cycle detection, side-effecting approval, and basic state transitions.
   - No tests exist for phase validation (unique phase IDs, `phaseId` references, empty phases), multi-phase cycle detection, 7 step statuses, or invalid state transitions.
3. **`apps/agent-host/src/runs/coordinator.ts` (lines 350-366)**:
   - Evaluates `const validation = validatePlan(plan);` and consumes `validation.ok` (`boolean`) and `validation.errors` (`ValidationError[]`).
   - If `!validation.ok`, emits `plan.validated` with `ok: false` and fails the run.
4. **Baseline Test Execution**:
   - `npm run test:host` executed with 16 test files passing (158 passed).
   - `npm run test:protocol` executed with 2 test files passing (11 passed).

---

## 2. Logic Chain

1. From **Observation 1**, `validatePlan.ts` currently lacks phase-awareness, structured cycle path returns, 7-step status checking, and the 6th lifecycle state `"failed"`.
2. From **Observation 3**, `RunCoordinator` relies on `validatePlan(plan)` returning `{ ok: boolean; errors: ValidationError[] }`. Upgrades must preserve this interface for backward compatibility while extending `ValidationError` with optional `cycle?: string[]` and returning `{ ok: boolean; valid: boolean; errors: ValidationError[]; cycle?: string[] }`.
3. To meet R1 in `ORIGINAL_REQUEST.md` and Features 1, 2, 3, 4 in `PROJECT.md`, `validatePlan.ts` must implement:
   - **Phase Validation**: Validate unique phase IDs (`duplicate_phase_id`), verify step `phaseId` exists in `plan.phases` (`unknown_phase`), and ensure all declared phases contain at least one step (`empty_phase`).
   - **Deterministic Cycle Detection**: Use 3-color DFS with canonical cycle rotation and deduplication to report both formatted path strings (`"stepA → stepB → stepA"`) and structured cycle arrays (`["stepA", "stepB", "stepA"]`).
   - **Status & Approval Invariant Validation**: Verify step status belongs to the 7 canonical statuses (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`) and enforce that `sideEffecting: true` strictly requires `approval: "required"`.
   - **6-State Plan Lifecycle Transitions**: Extend `PlanLifecycleState` to include `"failed"`, implement `nextPlanState` handling `"fail"` and `"reset"`, and export `isValidPlanTransition` and `validatePlanTransition`.
4. From **Observation 2**, `validatePlan.test.ts` must be extended with dedicated test suites for step validation, phase validation, deterministic cycle detection across phases and disjoint graphs, status/approval invariants, and comprehensive state transition checks.

---

## 3. Caveats

- The validator assumes `plan.phases` is optional for backward compatibility with existing flat test plans, but when `plan.phases` is defined, phase constraints (uniqueness, valid step references, non-empty phases) are strictly enforced.
- Circular dependency detection follows dependency edges (`dependsOn`). In `stepB.dependsOn = ["stepA"]`, the dependency edge is from `stepB` to `stepA`. When `stepA.dependsOn = ["stepB"]`, the cycle is `stepA → stepB → stepA`.

---

## 4. Conclusion

The architectural design and test specification for Milestone 1 Plan Validation and Cycle Detection are complete and documented in detail in `.agents/explorer_m1_2/analysis.md`.

### Core Deliverables Prepared for Implementer:
1. **Upgraded `apps/agent-host/src/planning/validatePlan.ts`**:
   - 8-pass non-aborting validation pipeline.
   - Comprehensive error codes (`duplicate_step_id`, `unknown_dependency`, `dependency_cycle`, `missing_approval`, `duplicate_phase_id`, `unknown_phase`, `empty_phase`, `invalid_step_status`, `invalid_plan_state`, `empty_plan`).
   - Canonical 3-color DFS cycle detector with structured `cycle: string[]` output.
   - 6-state lifecycle transition engine (`nextPlanState`, `canRunPlan`, `isValidPlanTransition`, `validatePlanTransition`).
2. **Upgraded `apps/agent-host/src/planning/validatePlan.test.ts`**:
   - 6 test suites covering 22 discrete test cases across phases, cycles, status invariants, and state machine transitions.

---

## 5. Verification Method

To verify the implementation once applied:

1. **Host Plan Validation Test Suite**:
   ```powershell
   npx vitest run apps/agent-host/src/planning/validatePlan.test.ts
   ```
   *Expected outcome*: All 22+ tests pass with 0 failures.

2. **Full Host Test Suite**:
   ```powershell
   npm run test:host
   ```
   *Expected outcome*: 16 test files pass (170+ total tests).

3. **Protocol Test Suite**:
   ```powershell
   npm run test:protocol
   ```
   *Expected outcome*: All protocol tests pass.

4. **TypeScript Build & Typecheck**:
   ```powershell
   npm run build
   ```
   *Expected outcome*: 0 TypeScript diagnostic errors and clean Vite build.

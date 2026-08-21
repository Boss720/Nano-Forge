# Handoff Report — Explorer Survey 2 (Frontend Architecture & R2 Control Plane)

**Author:** Survey Explorer 2  
**Date:** 2026-08-15  
**Milestone:** Phase 2 Planning Mode & DAG Control Surface Architecture  
**Working Directory:** `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\explorer_survey_2`  

---

## 1. Observation

1. **Frontend Architecture & Layout (`src/App.tsx`)**:
   - `App.tsx` (823 lines) coordinates the entire multi-rail layout: `TopBar`, `Sidebar`, `ChatPanel`, `ArtifactDock`, `PlanPanel`, `ModelPanel`, and responsive `<Sheet>` drawers for `< lg` (1024px) viewports (`src/App.tsx:169, 560-645`).
   - The plan inspection rail (`<aside data-testid="plan-rail" className="hidden min-h-0 w-80 shrink-0 flex-col lg:flex">`) is conditionally mounted when `host.plan` or `host.evidence` exists (`src/App.tsx:617-635`).
   - Host session is powered by `useHostSession(options)` (`src/lib/hostSession.ts:275-641`) which manages WebSocket messaging via `HostClient` (`src/lib/hostClient.ts`).

2. **Current `PlanPanel.tsx` Implementation (`src/sections/PlanPanel.tsx`)**:
   - `PlanPanel` takes props `plan: ExecutionPlan`, `className`, `onApproveStep`, `onRunApproved`, `onPause`, `onCancel`.
   - Maintains an isolated local approval ledger: `const [approvals, setApprovals] = useState<{ planId: string; stepIds: ReadonlySet<string> }>({ planId: plan.id, stepIds: new Set<string>() })` (`src/sections/PlanPanel.tsx:69-73`).
   - Implements the security downgrade invariant: unapproved required steps marked `running` by a host stream are downgraded to `"blocked"` in the UI (`src/sections/PlanPanel.tsx:79-84`).
   - Renders a flat list of steps with dependency badges (`dependsOn`), affected scopes (`affectedScopes`), estimates (`estimate`), and single-click approval button (`approve(step.id)`).
   - "Run" execution gate is disabled until `allApproved && plan.state !== "executing" && plan.state !== "completed"`.

3. **Protocol & Host Implementation (`packages/protocol/src/plan.ts`, `apps/agent-host/src/planning/validatePlan.ts`)**:
   - Protocol defines `StepStatus = "pending" | "running" | "succeeded" | "failed" | "blocked"`, `PlanStep`, and `ExecutionPlan` (`packages/protocol/src/plan.ts:12-68`).
   - Host `validatePlan` (`apps/agent-host/src/planning/validatePlan.ts:26-108`) validates duplicate IDs, unknown dependencies, dependency cycles via DFS, and requires `approval: "required"` on side-effecting steps.

4. **Testing Baseline**:
   - `npm test`: 21 test files, 204 tests all passing (100%).
   - `npm run test:protocol`: 2 test files, 11 tests all passing (100%).
   - `npm run test:host`: 16 test files, 158 tests all passing (100%).
   - `npm run build`: `tsc -b && vite build` completes with 0 errors.

---

## 2. Logic Chain

1. **Protocol Schema Upgrade**:
   - To fulfill R1 and R2, `packages/protocol/src/plan.ts` and `src/types/index.ts` must be extended with `PlanPhase` (`id`, `title`, `description`, `order`) and `step.phaseId`, `ready` and `skipped` step statuses, and optional plan revision tracking.
2. **Interactive Plan Composer State Machine**:
   - To support dynamic editing (adding steps/phases, editing, reordering, deleting, batch approvals, undo/redo), a pure state reducer `planComposerReducer` is necessary.
   - Real-time cycle validation (DFS / Tarjan) must run on dependency additions to prevent invalid DAG structures from being constructed or submitted.
3. **PlanPanel Component Modularization**:
   - `PlanPanel.tsx` should be decomposed into reusable subcomponents:
     - `PhaseAccordion`: Collapsible phase card with progress meter and `"Approve Phase"` batch button.
     - `StepTimelineItem`: Visual step card with status icons, connection timeline lines, badges, and approval checkboxes.
     - `DependencyBadgeList`: Clickable dependency pills.
     - `StepEditorModal`: Inline/modal step creation and attribute editor.
     - `PlanResourceSummary`: Total token, cost, and duration estimate rollups.
4. **Approval Gates Security Invariant**:
   - The client-side approval ledger must continue to guarantee that natural language or chat text never satisfies approval gates.
   - Batch phase approval (`"Approve Phase"`) and global `"Approve All"` actions will write the relevant step IDs into the ledger and dispatch approval frames (`approval.grant`).

---

## 3. Caveats

- **No Source Code Modified**: As a read-only Survey Explorer, no implementation code was altered in `src/`, `packages/`, or `apps/`.
- **DAG Canvas Viewport**: While ASCII wireframes and data models for visual DAG rendering are specified, complex canvas drag-and-drop graphs (e.g. React Flow) can be rendered alongside or as an alternative view mode to the primary hierarchical Phase Accordion Checklist.
- **WebSocket Frame Compatibility**: Existing host handlers expect `plan.submit` and `approval.grant`. New frames (`plan.propose`, `plan.update_step`) must maintain backward compatibility with existing tests.

---

## 4. Conclusion

The NanoForge frontend is well-structured, robust, and completely healthy (all 373 tests passing across all packages). The path to implementing **R2 (Antigravity-Grade Visual Plan Control Plane)** is clear:
1. Extend protocol types in `packages/protocol/src/plan.ts` and `src/types/index.ts` to include `PlanPhase` and updated `StepStatus`.
2. Implement `planComposerReducer` in `src/lib/` for interactive phase/step manipulation, batch approvals, cycle checks, and history management.
3. Refactor and upgrade `src/sections/PlanPanel.tsx` into a modular Phase Accordion control plane with step timeline rendering, dependency navigation, phase-level approvals, approve-all, and resource estimation rollups.
4. Maintain full test coverage by updating `PlanPanel.test.tsx` and adding `planComposerReducer.test.ts`.

Detailed analysis and architectural blueprints are available at `.agents/explorer_survey_2/analysis.md`.

---

## 5. Verification Method

To independently verify the facts and findings documented in this report:

1. **Verify Test Suites**:
   - `npm test` -> confirms 21 test files and 204 tests pass.
   - `npm run test:protocol` -> confirms 2 test files and 11 tests pass.
   - `npm run test:host` -> confirms 16 test files and 158 tests pass.
2. **Verify Typecheck and Build**:
   - `npm run build` (`tsc -b && vite build`) -> completes with 0 errors.
3. **Inspect Key Files**:
   - `src/sections/PlanPanel.tsx`: inspect current props, approval ledger (`approvals`), and status downgrade logic.
   - `src/App.tsx:613-635`: inspect host session wiring and plan rail mounting conditions.
   - `src/lib/hostSession.ts:527-542`: inspect browser step origin gating and approval flow.
   - `.agents/explorer_survey_2/analysis.md`: read full architecture survey.

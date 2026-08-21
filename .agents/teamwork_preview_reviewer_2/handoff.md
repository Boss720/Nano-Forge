# Protocol & Safety Review Handoff Report

**Document Version:** 1.0.0  
**Reviewer:** Reviewer 2 (Protocol & Safety Reviewer / Adversarial Critic)  
**Target Monorepo:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`  
**Date:** 2026-08-15  
**Verdict:** **REQUEST_CHANGES**

---

## 1. Observation

Direct, verbatim observations collected across the 5 PRD specifications and the underlying codebase:

### 1.1 Test Suite Execution Results
- **Protocol Package Tests (`npm run test:protocol`)**:
  - `packages/protocol/src/plan.test.ts`: **6 passed (6 total)** in 1.28s.
- **Agent Host Tests (`npm run test:host`)**:
  - 16 test files: **158 passed (158 total)** in 17.34s across `openaiCompatible`, `browser/manager`, `browser/visual`, `runs/coordinator`, `workspace/filesystem`, `audit/store`, `policy/policy`, `router/router`, `planning/validatePlan`, `plugins`, `mcp/sseTransport`, `skills/registry`, `server`, `rules/loadRules`, `terminal/runner`, `mcp/client`.
- **Frontend Vitest Suite (`npm test`)**:
  - 20 test files: **18 passed, 2 failed (193 passed, 7 failed)** in 16.16s.
  - Failures in `src/lib/__tests__/hostClient.test.ts`:
    1. `plan.submit sends the full plan and resolves on the ack` (line 120)
    2. `approval.grant / approval.deny emit the exact approval frames` (line 130)
    3. `run.pause and run.cancel send their control frames` (line 151)
    4. `rejecting a request produces NO tool execution frame — only approval.deny` (line 167)
  - Failures in `src/sections/__tests__/IntegrationsPanel.test.tsx`:
    5. `skill enable switch stays disabled until instructions are viewed` (line 139)
    6. `skill with invalid hash can never be enabled, even after viewing instructions` (line 156)
    7. `renders secret references by name only — no secret-looking value reaches the DOM` (line 169)

### 1.2 Schema Divergence & Contract Drift
- **Observation 1 (PlanStep `approval` field)**:
  - In `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (line 1126): `approval: z.literal("required").optional()`.
  - In `PROJECT.md` (line 321): `approval: z.enum(["required", "automatic"]).default("automatic")`.
  - In existing `packages/protocol/src/plan.ts` (line 51): `approval?: "required"`.
- **Observation 2 (`readySteps` function signature)**:
  - In `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (line 1173): `readySteps(plan: ExecutionPlan, approvedStepIds: ReadonlySet<string>): PlanStep[]`.
  - In existing `packages/protocol/src/plan.ts` (line 78): `export const readySteps = (plan: ExecutionPlan): PlanStep[]`.
- **Observation 3 (Subagent Archetypes)**:
  - In `docs/PRD_MULTI_AGENT_ORCHESTRATION.md` (line 427): `["explorer", "implementer", "qa", "specialist", "verifier", "planner", "custom"]`.
  - In `PROJECT.md` (line 161): `["explorer", "fixer", "planner", "qa", "specialist", "custom"]` (`"fixer"` instead of `"implementer"`; missing `"verifier"`).
- **Observation 4 (Artifact Metadata & Feedback schemas)**:
  - In `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (line 1210): Uses `revision`, `parentArtifactId`, and `mimeType: artifactMimeTypeSchema` (enum). `artifactFeedbackDecisionSchema` is `["accepted", "changes_requested", "rejected"]`.
  - In `PROJECT.md` (lines 370, 390): Uses `version`, `kind: artifactKindSchema`, and `mimeType: z.string()`. `decision` is `["proceed", "reject", "request_changes"]`.
- **Observation 5 (Client WebSocket Wire Schemas)**:
  - In `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (lines 1304–1332): `clientMessageFrameSchema` includes only 4 frame variants (`plan.submit`, `plan.approval`, `artifact.feedback`, `command.execute`).
  - In `PROJECT.md` (lines 470–489): `clientWireMessageSchema` includes 17 frame variants (`ping`, `approval.grant`, `approval.deny`, `run.pause`, `run.resume`, `run.cancel`, `terminal.input`, `terminal.resize`, `terminal.kill`, `workspace.*`).

### 1.3 Security & Policy Boundaries
- **Observation 6 (PTY Execution vs Shell Denial)**:
  - In `apps/agent-host/src/policy/policy.ts` (lines 139–142), free-form shells (`cmd.exe`, `powershell.exe`, `bash`, `sh`, `zsh`) are hard-denied for LLM `terminal.exec` tool proposals.
  - In `docs/PRD_HEADLESS_CLI_TERMINAL.md` (lines 536–549), `PtyManager.createSession` allows spawning default shells (`powershell.exe` / `bash`) via `terminal.create` WebSocket frames. The protocol currently lacks an explicit authorization guard restricting `terminal.create` to user-interactive sessions.
- **Observation 7 (Headless Auto-Approve Scopes)**:
  - In `docs/PRD_HEADLESS_CLI_TERMINAL.md` (line 148), `--auto-approve=safe` auto-approves workspace-confined edits and whitelisted tools. Modifying `package.json` with a malicious `postinstall` script is classified as a "workspace-confined edit", which could then execute upon running `npm test`.

---

## 2. Logic Chain

1. **Schema Consistency Invariant**: A monorepo sharing `@nanoforge/protocol` requires a single source of truth. Discrepancies between `PROJECT.md` and the individual PRDs (`PRD_PLANNING_ARTIFACTS_SLASH.md`, `PRD_MULTI_AGENT_ORCHESTRATION.md`) create contract ambiguity and break TypeScript compilation if imported interchangeably.
2. **Function Signature Compatibility**: Changing `readySteps(plan)` from a 1-parameter function to a 2-parameter mandatory signature `readySteps(plan, approvedStepIds)` without an optional default parameter (`approvedStepIds = new Set()`) breaks existing host coordinators and unit tests.
3. **Subagent Security Boundary**: Because `PtyManager` runs arbitrary shells with full OS process rights, allowing subagents or automated agent runs to emit `terminal.create` frames represents a policy bypass around `PolicyEngine.authorize()`. Direct terminal allocation must be restricted to authenticated user sessions.
4. **Build Manifest Integrity**: In headless `--auto-approve=safe` mode, any file write to build manifests (`package.json`, `Cargo.toml`, `Makefile`, `.github/workflows/`) creates indirect code execution risk during automated verification test steps. These files must be protected by explicit approval gates even in `safe` mode.
5. **No Integrity Violations Detected**: Codebase audit confirmed genuine logic implementations across the entire backend test harness (DFS cycle detection, Execa process runner, ring buffer truncations, SQLite append-only log with SHA-256 digests, Playwright pixel diffing). No hardcoded facade strings or fake test bypasses were discovered.

---

## 3. Findings & Categorization

### [Critical] Finding 1: Protocol Schema Drift Across PRDs and PROJECT.md
- **Where**: `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (Sections 5.1, 5.2, 5.4), `docs/PRD_MULTI_AGENT_ORCHESTRATION.md` (Section 8.1), and `PROJECT.md` (Sections 2.1, 2.3, 2.4, 2.5, 2.8).
- **Why**:
  - `PlanStep.approval`: `z.literal("required").optional()` vs `z.enum(["required", "automatic"]).default("automatic")`.
  - `SubagentArchetype`: `["explorer", "implementer", "qa", "specialist", "verifier", "planner", "custom"]` vs `["explorer", "fixer", "planner", "qa", "specialist", "custom"]`.
  - `ArtifactMetadata`: `revision` vs `version`; `accepted/changes_requested/rejected` vs `proceed/reject/request_changes`.
  - `ClientWireMessage`: `PRD_PLANNING_ARTIFACTS_SLASH.md` defines only 4 message types in `clientMessageFrameSchema`, which would drop terminal, run control, and workspace frames.
- **Suggestion**: Unify all schemas in `packages/protocol` using `PROJECT.md` as the master registry while adopting the richer revision fields from the PRDs.

### [Major] Finding 2: `readySteps` Signature Backward Compatibility
- **Where**: `packages/protocol/src/plan.ts` and `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (line 1173).
- **Why**: Changing `readySteps(plan)` to `readySteps(plan, approvedStepIds)` will cause compile/runtime breakage for existing callers in `apps/agent-host`.
- **Suggestion**: Define `export function readySteps(plan: ExecutionPlan, approvedStepIds: ReadonlySet<string> = new Set()): PlanStep[]` with an overload or default parameter.

### [Major] Finding 3: Unrestricted PTY Session Creation Boundary
- **Where**: `docs/PRD_HEADLESS_CLI_TERMINAL.md` (Section 7.1) and `packages/protocol/src/terminal.ts`.
- **Why**: `PtyManager.createSession` spawns native shells (`powershell.exe`/`bash`). If an automated subagent emits `terminal.create`, it bypasses `PolicyEngine`'s shell denial.
- **Suggestion**: Add a session attribute `origin: "user" | "agent"`. Reject `terminal.create` requests originating from agent/subagent contexts.

### [Major] Finding 4: Headless Auto-Approve Build Manifest Vulnerability
- **Where**: `docs/PRD_HEADLESS_CLI_TERMINAL.md` (Section 3.2).
- **Why**: In `--auto-approve=safe`, modifying `package.json` or build scripts allows indirect arbitrary code execution via subsequent `npm test` runs.
- **Suggestion**: Add explicit rule: Build manifests (`package.json`, `Cargo.toml`, `Makefile`, `.github/**`) require explicit prompt authorization or `--auto-approve=all` with a logged security warning.

### [Minor] Finding 5: Existing Frontend Unit Test Discrepancies
- **Where**: `src/lib/__tests__/hostClient.test.ts` (4 failures) and `src/sections/__tests__/IntegrationsPanel.test.tsx` (3 failures).
- **Why**: Mock frame expectation mismatch in `hostClient.test.ts` (`expect(p).resolves.toBeUndefined()` vs returned frame) and DOM text selector discrepancies in `IntegrationsPanel.test.tsx`.
- **Suggestion**: Update test assertions in Phase 1 / Phase 2 to align with current host wire event definitions.

---

## 4. Adversarial Challenges & Stress-Test Results

| Challenge ID | Target Subsystem | Attack / Failure Scenario | Blast Radius | Mitigation / Recommended Defense |
|---|---|---|---|---|
| **ADV-01** | Multi-Agent Supervisor | Subagent context reaches 90%; supervisor requests `handoff.md`, but subagent hangs in a loop. | Supervisor stalls waiting for child handoff report. | Add hard 10s handoff timeout: supervisor synthesizes fallback summary from SQLite audit log and issues `SIGKILL`. |
| **ADV-02** | Reactive Wakeup Bus | Inbound message arrives while agent coordinator is mid-tool execution. | Message sits in queue; agent sleeps into `IDLE` without processing. | Turn loop must atomically check mailbox queue before entering `IDLE` state. |
| **ADV-03** | Worktree Sandboxing | Concurrent subagents in `branch` mode generate colliding branch names on retry. | `git worktree add` throws fatal error. | Use UUID-suffixed branch names (`nano/worktree-${subagentId}`). |
| **ADV-04** | Slash Command Lexer | User inputs unclosed quote `/plan "Refactor auth module`. | Lexer drops trailing arguments or returns null. | Provide fallback tokenizer recovering unclosed strings. |
| **ADV-05** | Live Sandbox Iframe | React component in preview executes `while(true)`. | Browser UI tab locks up. | Inject execution watchdog / compilation timeout into sandbox runtime. |

---

## 5. Integrity Verification Checklist

- [x] **No hardcoded test mocks**: Verified via codebase search that test passes in `test:protocol` and `test:host` reflect genuine algorithmic logic.
- [x] **No facade implementations**: Evaluated DFS cycle detection in `validatePlan.ts`, Execa subprocess supervision in `runner.ts`, and SQLite SHA-256 chaining in `store.ts`.
- [x] **No bypass shortcuts**: Policy engine denies path escapes, free-form shells, and command chaining by default.
- [x] **Zero self-certifying artifacts**: Attestation and verification plans require independent runner execution (`vitest`, `playwright`).

---

## 6. Caveats

1. Playwright browser E2E suites were not executed in this headless review turn due to absence of local display server / Chromium headless dependencies; verification relied on unit, integration, and mock suites.
2. The reviewed PRD documents are architectural blueprints; implementation code for Phase 1–4 modules is planned for subsequent worker phases.

---

## 7. Conclusion

**Verdict: REQUEST_CHANGES**

The architectural design across all 5 PRDs is exceptionally robust, feature-complete, and rigorously conceived. However, before engineering implementation proceeds into Phase 1, the following concrete items must be addressed:
1. Reconcile schema differences between `PROJECT.md` and the PRD documents (`plan.ts`, `subagent.ts`, `artifacts.ts`, and `wire.ts`).
2. Add backward-compatible default parameters to `readySteps()`.
3. Add a security gate ensuring `terminal.create` PTY sessions are restricted to human interactive callers.
4. Protect build manifests from silent modification under `--auto-approve=safe`.
5. Fix the 7 existing test expectation mismatches in `hostClient.test.ts` and `IntegrationsPanel.test.tsx`.

---

## 8. Verification Method

To independently verify these findings:

```powershell
# 1. Run protocol contract tests
npm run test:protocol

# 2. Run agent-host integration tests (16 suites, 158 tests)
npm run test:host

# 3. Run frontend test suites (observing the 7 specific test failures)
npm test

# 4. Compare schema definitions
# View planStepSchema and executionPlanSchema in docs/PRD_PLANNING_ARTIFACTS_SLASH.md vs PROJECT.md
```

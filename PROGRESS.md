# NanoForge Hardening & Production Readiness Progress Tracking (Phases 0–7)

## Master Phase Status Matrix

| Phase | Description | Status | Changed Files | Tests Added / Updated | Verification Gates |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | Baseline Inspection & Verification Setup | **COMPLETED** | `PROGRESS.md` | Baseline Recorded (60 test files / 616 tests) | Typecheck: PASS<br>Lint: PASS<br>Tests: 616/616 PASS<br>Build: PASS |
| **Phase 1** | Repair Host Run-Control Acknowledgements | **COMPLETED** | `packages/protocol/src/lifecycle.ts`<br>`packages/protocol/src/__tests__/lifecycle.test.ts`<br>`apps/agent-host/src/protocol.ts`<br>`apps/agent-host/src/session.ts`<br>`apps/agent-host/src/session.runControl.test.ts`<br>`apps/agent-host/src/session.runControl.adversarial.test.ts`<br>`src/lib/hostClient.ts`<br>`src/lib/hostSession.ts`<br>`src/lib/__tests__/hostClient.test.ts`<br>`src/lib/__tests__/hostClient.runControl.test.ts`<br>`src/lib/__tests__/hostClient.runControl.adversarial.test.ts` | Unit tests (`lifecycle.test.ts`, `hostClient.test.ts`, `hostClient.runControl.test.ts`, `hostClient.runControl.adversarial.test.ts`) & Integration/Adversarial tests (`session.runControl.test.ts`, `session.runControl.adversarial.test.ts`) | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: 623/623 PASS<br>build: PASS |
| **Phase 2** | Harden Swarm Slash Commands & Subagent Paths | **COMPLETED** | `packages/protocol/src/subagents.ts`<br>`apps/agent-host/src/session.ts`<br>`apps/agent-host/src/agents/supervisor.ts`<br>`apps/agent-host/src/session.command.adversarial.test.ts`<br>`apps/agent-host/src/agents/agents.adversarial.test.ts` | Unit tests (`session.command.test.ts`) & Adversarial tests (`session.command.adversarial.test.ts`, `agents.adversarial.test.ts`) | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: 625/625 PASS |
| **Phase 3** | Reviewed Local Writes Opt-In & Conflict Safety | **COMPLETED** | `scripts/nanoforge-launcher.cjs`<br>`src/types/index.ts`<br>`src/sections/ConnectDialog.tsx`<br>`src/hooks/useAgentOrchestration.ts`<br>`src/hooks/__tests__/useAgentOrchestration.test.tsx`<br>`src/sections/__tests__/ConnectDialog.writes.test.tsx`<br>`scripts/__tests__/nanoforge-launcher.writes.test.ts` | Unit & hook tests (`useAgentOrchestration.test.tsx`, `ConnectDialog.writes.test.tsx`, `nanoforge-launcher.writes.test.ts`) | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: 635/635 PASS |
| **Phase 4** | Fix Session Lifecycle Leaks & Cancellation Correctness | **COMPLETED** | `apps/agent-host/src/session.ts`<br>`apps/agent-host/src/agents/supervisor.ts`<br>`apps/agent-host/src/daemons/supervisor.ts`<br>`apps/agent-host/src/daemons/scheduler.ts`<br>`src/hooks/useAgentOrchestration.ts`<br>`apps/agent-host/src/lifecycle.test.ts` | Disconnect lifecycle tests (11 connect/disconnect cycles with zero listener warnings), run-scoped cancellation tests | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>Zero MaxListenersExceededWarning |
| **Phase 5** | Tighten Loopback Origin & Search Handling | **COMPLETED** | `apps/agent-host/src/server.ts`<br>`apps/agent-host/src/workspace/filesystem.ts`<br>`apps/agent-host/src/security_invariants.adversarial.test.ts` | Exact allowed origin tests, null/missing origin rejection tests, `--` positional delimiter search injection tests | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test:host: PASS |
| **Phase 6** | Attachment Retention & Swarm UX Semantics | **COMPLETED** | `src/lib/attachments/validation.ts`<br>`src/lib/attachments/snapshots.ts`<br>`src/hooks/useSessionPersistence.ts`<br>`src/sections/ConnectDialog.tsx`<br>`apps/agent-host/src/agents/supervisor.ts`<br>`src/lib/attachments/validation.test.ts`<br>`src/lib/attachments/snapshots.test.ts` | Snapshot store clear/keys tests, expanded sensitive filename pattern tests, chat snapshot pruning tests | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: PASS |
| **Phase 7** | Final Verification & Release Readiness | **COMPLETED** | `tests/e2e/e2e_phase7_smoke.test.ts`<br>`tests/e2e/helpers/testHost.ts`<br>`PROGRESS.md` | Full E2E smoke integration test (origin check, default write denial, reviewed write with SHA-256, conflict rejection, plan submit/pause/cancel ACKs, slash inspect confinement) | Typecheck: PASS (4 pkgs)<br>Lint: PASS (0 errs)<br>Tests: 643/643 PASS (64 files)<br>Build: PASS (dist & bundle)<br>No Listener Warnings |

---

## Phase 0: Baseline Inspection & Verification Setup

### Status: COMPLETED

### Description
Establish a clean baseline on the `hardening-phases-0-7` feature branch by verifying existing codebase health across all packages, running full static analysis, typechecking, linting, and comprehensive test suites, and cataloging pre-existing defects and quality signals.

### Changed Files
- `PROGRESS.md`: Initialized comprehensive Phase 0–7 tracking matrix and baseline record.

### Tests Added / Updated
- Baseline suite verified: 60 test files, 616 tests passed across root, protocol, agent-host, core, sdk, and E2E suites.

### Verification Results

| Gate / Command | Result | Notes / Details |
| :--- | :--- | :--- |
| `cmd.exe /c pnpm typecheck` | **PASS** (code 0) | 6/6 Turbo tasks successful across `@nanoforge/protocol`, `@nanoforge/core`, `@nanoforge/sdk`, `@nanoforge/agent-host` |
| `cmd.exe /c pnpm exec tsc -b` | **PASS** (code 0) | 0 root frontend TypeScript diagnostics |
| `cmd.exe /c pnpm lint` | **PASS** (code 0) | 0 ESLint errors/warnings across entire workspace |
| `cmd.exe /c pnpm test -- --run` | **PASS** (code 0) | 60 test files passed, 616 tests passed (28.28s) |
| `cmd.exe /c pnpm test:protocol` | **PASS** (code 0) | 18 test files passed, 378 tests passed (2.28s) |
| `cmd.exe /c pnpm test:host` | **PASS** (code 0) | 44 test files passed, 418 tests passed (9.08s) |
| `cmd.exe /c pnpm test:core` | **PASS** (code 0) | 8 test files passed, 95 tests passed (1.70s) |
| `cmd.exe /c pnpm test:sdk` | **PASS** (code 0) | 1 test file passed, 13 tests passed (0.95s) |
| `cmd.exe /c pnpm test:e2e` | **PASS** (code 0) | 8 test files passed, 178 tests passed (7.71s) |

---

## Phase 1: Repair Host Run-Control Acknowledgements

### Status: COMPLETED

### Description
Ensured all host run-control and mutation operations (`plan.submit`, `run.pause`, `run.resume`, `run.cancel`, `approval.grant`, `approval.deny`, `tool.response`) return typed success/error responses containing the caller's original `requestId`. For plan submissions, the acknowledgement frame carries both `runId` and `planId`. Eliminated client-side request timeouts caused by mismatched/untyped notifications and removed silent `.catch(() => {})` error swallowing in `hostSession.ts`, routing errors to `setLastError`.

### Key Objectives Achieved
1. Introduced 7 typed success-result schemas in `packages/protocol/src/lifecycle.ts` and unit tested them in `packages/protocol/src/__tests__/lifecycle.test.ts`.
2. Updated `apps/agent-host/src/protocol.ts` to re-export schemas and accept `requestId: idSchema.optional()` on all client mutation request schemas and host error frame.
3. Updated `apps/agent-host/src/session.ts` to emit typed result frames with `requestId` and `runId`, route `unknown_run` errors with `requestId` and `runId`, and support `SocketApprovalGate.resolve` by exact `requestId` or `${runId}:${stepId}` prefix.
4. Updated `src/lib/hostClient.ts` to parse typed result frames and resolve `submitPlan`, `pauseRun`, `resumeRun`, `cancelRun`, `grantApproval`, `denyApproval`, and `sendToolResponse` immediately via `requestResult`.
5. Updated `src/lib/hostSession.ts` to route errors from `sendGrant`, `runApproved`, `pause`, `cancel`, and `stopToolRun` to `setLastError`.
6. Added full client-host integration tests in `apps/agent-host/src/session.runControl.test.ts` covering immediate resolution, runId retrieval, pause/resume/cancel results, approval resolution, unknown run error handling, and zero pending frame leaks.

### Changed Files
- `packages/protocol/src/lifecycle.ts`
- `packages/protocol/src/__tests__/lifecycle.test.ts`
- `apps/agent-host/src/protocol.ts`
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/session.runControl.test.ts`
- `apps/agent-host/src/session.runControl.adversarial.test.ts`
- `src/lib/hostClient.ts`
- `src/lib/hostSession.ts`
- `src/lib/__tests__/hostClient.test.ts`
- `src/lib/__tests__/hostClient.runControl.test.ts`
- `src/lib/__tests__/hostClient.runControl.adversarial.test.ts`

---

## Phase 2: Harden Swarm Slash Commands & Subagent Paths

### Status: COMPLETED

### Description
Replaced raw string casting of slash-command arguments with protocol Zod schema validation (`invokeSubagentParamsSchema`, `manageSubagentsParamsSchema`, `sendMessageParamsSchema`). Confined subagent inspection and metadata paths strictly within `.agents/<name>_<shortId>` inside the workspace root using multi-pass sanitization, allowlist enforcement, and canonical + relative path checks.

### Key Objectives Achieved
1. Built a typed command adapter in `apps/agent-host/src/session.ts` for slash command parsing (`/swarm run`, `/swarm inspect`, `/swarm list`, `/swarm tree`, `/swarm pause`, `/swarm resume`, `/swarm stop`, `/swarm message`) with strict protocol Zod schema validation and structured error response `{ code: "invalid_command", issues: [...] }`.
2. Restricted `/swarm inspect` to `manageSubagentsInspectFileSchema` enum values (`progress.md`, `BRIEFING.md`, `handoff.md`, `DISPATCH.md`, `analysis.md`).
3. Added defense-in-depth in `SubagentSupervisor.manageSubagents()` validating allowlist compliance, multi-pass path sanitization (rejecting null bytes and URL encodings), `.agents` containment, and subagent directory lexical/canonical confinement before reading files.
4. Validated and normalized subagent names in `SubagentSupervisor.spawnSubagent()` using `validateSubagentName()` (enforcing `/^[a-zA-Z0-9_\-]+$/`, rejecting path separators, `..`, drive prefixes, control chars) and verified metadata directory confinement inside `<workspaceRoot>/.agents`.
5. Added comprehensive unit and adversarial test suites covering traversal attempts (`--file ../../../secret`, `/etc/passwd`, `C:\Windows\win.ini`), URL encodings (`%2e%2e%2f`), malicious names, invalid budgets/timeouts, and valid inspection of all 5 allowed files.

### Changed Files
- `packages/protocol/src/subagents.ts`
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/agents/supervisor.ts`
- `apps/agent-host/src/session.command.adversarial.test.ts`
- `apps/agent-host/src/agents/agents.adversarial.test.ts`

---

## Phase 3: Reviewed Local Writes Opt-In & Conflict Safety

### Status: COMPLETED

### Description
Ensured local workspace writes are genuinely opt-in (disabled by default in launcher) and protected against concurrent modification conflicts via atomic hash/mtime verification.

### Key Objectives Achieved
1. Changed `scripts/nanoforge-launcher.cjs` so `NANOFORGE_ALLOW_WORKSPACE_WRITES` defaults to `0` (disabled by default).
2. Added an explicit user-facing "Enable reviewed local writes" setting tab in `src/sections/ConnectDialog.tsx` showing the active workspace root and requiring deliberate confirmation.
3. Updated `VirtualFile` in `src/types/index.ts` to retain `sha256`, `modified`, and `size`.
4. In `src/hooks/useAgentOrchestration.ts`, `writeWorkspaceFile` transmits `expectedSha256` and `expectedModified`; catches `write_conflict` without marking patches applied and surfaces an actionable conflict notice.
5. Preserved host-side `allowWorkspaceWrites` check as the definitive privileged security boundary.

### Changed Files
- `scripts/nanoforge-launcher.cjs`
- `src/types/index.ts`
- `src/sections/ConnectDialog.tsx`
- `src/hooks/useAgentOrchestration.ts`
- `src/hooks/__tests__/useAgentOrchestration.test.tsx`
- `src/sections/__tests__/ConnectDialog.writes.test.tsx`
- `scripts/__tests__/nanoforge-launcher.writes.test.ts`

---

## Phase 4: Fix Session Lifecycle Leaks & Cancellation Correctness

### Status: COMPLETED

### Description
Eliminated EventEmitter listener leaks on `DaemonSupervisor`, `TaskScheduler`, and `SubagentSupervisor` by storing and invoking unsubscribe callbacks on WebSocket close. Refactored orchestration cancellation from global refs to run-scoped cancellation objects.

### Key Objectives Achieved
1. In `apps/agent-host/src/session.ts`, stored unsubscribe handles (`unsubSubagents`, `unsubMemory`, `unsubSupervisor`, `unsubScheduler`, `unsubEventLog`) and invoked each on socket close.
2. In `apps/agent-host/src/agents/supervisor.ts`, stored `unsubDaemons` and `unsubScheduler` from constructor and invoked them in `dispose()`.
3. Set `setMaxListeners(100)` on `DaemonSupervisor`, `TaskScheduler`, and `SubagentSupervisor`.
4. Guarded shared daemon/pty manager disposal so server-owned instances persist while connection-owned instances tear down cleanly.
5. In `src/hooks/useAgentOrchestration.ts`, replaced global `demoCancelledRef`/`abortRef` with run-scoped `ActiveRun` object `{ runId, sessionId, agentMsgId, cancelled, controller }`.
6. Verified 11 connect/disconnect cycles in `lifecycle.test.ts` with zero listener warnings.

### Changed Files
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/agents/supervisor.ts`
- `apps/agent-host/src/daemons/supervisor.ts`
- `apps/agent-host/src/daemons/scheduler.ts`
- `src/hooks/useAgentOrchestration.ts`
- `apps/agent-host/src/lifecycle.test.ts`

---

## Phase 5: Tighten Loopback Origin & Search Handling

### Status: COMPLETED

### Description
Enforced strict WebSocket origin validation on the agent host, rejecting `null`, missing origins, and unapproved wildcards. Hardened workspace search against ripgrep command-line flag injection.

### Key Objectives Achieved
1. In `apps/agent-host/src/server.ts`, implemented `DEFAULT_ALLOWED_ORIGINS` (`http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:4173`, `http://127.0.0.1:4173`, `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4040`, `http://127.0.0.1:4040`, `https://nano-gpt.com`).
2. Rejected `null` and missing origins by default unless `allowNonBrowserClients: true` is explicitly provided.
3. In `apps/agent-host/src/workspace/filesystem.ts`, placed `--` positional delimiter before search queries in `handleSearch` to prevent ripgrep option injection (e.g. `--help`, `-F`).
4. Clamped `maxResults` to `[1, 500]`, validated include glob patterns, and returned structured `WorkspaceFileError` on tool errors.

### Changed Files
- `apps/agent-host/src/server.ts`
- `apps/agent-host/src/workspace/filesystem.ts`
- `apps/agent-host/src/security_invariants.adversarial.test.ts`

---

## Phase 6: Attachment Retention & Swarm UX Semantics

### Status: COMPLETED

### Description
Implemented bounded attachment retention with IndexedDB snapshot cleanup on chat deletion and cache pruning. Synchronized attachment filename blocklists with host sensitive-file policies. Accurately reported swarm subagent execution states.

### Key Objectives Achieved
1. In `src/lib/attachments/validation.ts`, expanded `isSensitiveFileName` to block `.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`, `.terraformrc`, `id_rsa*`, `id_ed25519*`, cloud credential directories (`.aws`, `.azure`, `.docker`, `.gnupg`, `.kube`, `.ssh`, `.terraform.d`), and service account JSONs.
2. In `src/lib/attachments/snapshots.ts`, added `clear()` and `keys()` methods to `AttachmentSnapshotStore` (both `MemoryAttachmentSnapshotStore` and `IndexedDbAttachmentSnapshotStore`).
3. In `src/hooks/useSessionPersistence.ts`, cleaned up IndexedDB snapshot IDs when chats or workspaces are permanently deleted.
4. In `src/sections/ConnectDialog.tsx`, added a "Clear local attachment cache" button.
5. In `apps/agent-host/src/agents/supervisor.ts`, updated pause/resume messages to accurately describe state as marked inactive/active by supervisor.

### Changed Files
- `src/lib/attachments/validation.ts`
- `src/lib/attachments/snapshots.ts`
- `src/hooks/useSessionPersistence.ts`
- `src/sections/ConnectDialog.tsx`
- `apps/agent-host/src/agents/supervisor.ts`
- `src/lib/attachments/validation.test.ts`
- `src/lib/attachments/snapshots.test.ts`

---

## Phase 7: Final Verification & Release Readiness

### Status: COMPLETED

### Description
Executed full static and integration verification across all workspace packages, verified clean zero-defect execution with zero listener warnings, and verified production bundle creation.

### Key Objectives Achieved
1. **Automated Static Verification**:
   - `pnpm typecheck`: 6/6 Turbo tasks passed across all packages (`@nanoforge/protocol`, `@nanoforge/agent-host`, `@nanoforge/core`, `@nanoforge/sdk`).
   - `pnpm lint`: ESLint passed with 0 errors and 0 warnings.
2. **Automated Unit & Integration Verification**:
   - `pnpm test -- --run`: 64 test files passed, 643 tests passed in 28.18s with **ZERO** `MaxListenersExceededWarning` messages.
3. **End-to-End Smoke Test**:
   - Added `tests/e2e/e2e_phase7_smoke.test.ts` verifying connection with expected origin, workspace read, write disabled by default, explicit write enablement with SHA-256 verification, conflict detection, plan submit/pause/cancel acknowledgements, and `/swarm inspect` directory traversal rejection.
4. **Clean Production Build & Packaging**:
   - `pnpm build`: Vite build completed successfully generating production assets in `dist/`.
   - Packager tests verified complete Windows release bundle creation (`release/NanoForge-v0.6.0-windows-x64.zip`).
5. **Git Tree Integrity**:
   - Working tree strictly verified with zero `.agents/**` modifications.

---

## Historical Workspace Context (Pre-Hardening Baseline)
Prior implementation waves (Wave 1 Workspace/Chat migration, Swarm slash commands integration, Local Drive workspace picker & reviewed writes, and NanoGPT presentation readiness waves A/A2) established the initial feature surface through commit `0c95978`. The hardening roadmap (Phases 0–7) builds directly on this baseline to deliver enterprise-grade security, lifecycle stability, and production readiness.

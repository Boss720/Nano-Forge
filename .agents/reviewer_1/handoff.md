# Phase 4 & Phase 5 Independent Review Report

**Reviewer**: Reviewer 1 (Role: Protocol & System Architecture Reviewer, Adversarial Critic)  
**Date**: 2026-08-15  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Executive Summary & Verdict

- **Verdict**: **REQUEST_CHANGES**
- **Overall System Quality**: High — Protocol layer, UI control plane, sandboxing policy, circular ring buffers, and scheduler engines are rigorously designed and implemented without integrity shortcuts or facades.
- **Blocking Finding**: `npm run test:host` exits with **code 1** due to an unhandled promise rejection in `SubagentSupervisor.recordTokens()` and `apps/agent-host/src/agents/supervisor.test.ts`.

| Suite | Status | Details |
|---|---|---|
| `npm run test:protocol` | **PASS** | 9 test files, 214 tests passing (0 failures) |
| `npm test` (Frontend) | **PASS** | 32 test files, 302 tests passing (0 failures) |
| `npm run build` | **PASS** | TypeScript + Vite production build clean in 12.24s |
| `npm run test:host` | **FAIL (Exit 1)** | 35 test files passed (303 tests), but **1 unhandled rejection** in `supervisor.test.ts` |

---

## 2. Review Findings

### [Major] Finding 1: Unhandled Promise Rejection in `SubagentSupervisor.recordTokens` Escalation Path

- **What**: During token budget limit breach testing, `SubagentSupervisor.recordTokens()` fires a background asynchronous escalation (`void this.escalateFailure(subagentId, node.error, "replace")`). The test in `apps/agent-host/src/agents/supervisor.test.ts` is synchronous (`() => { ... }`) and completes before the clone's asynchronous disk file creation (`fs.writeFile(progress.md)`) finishes. When `afterEach` tears down `tmpRoot`, the floating promise attempts to write to the deleted directory, throwing an unhandled `ENOENT` rejection:
  ```
  Error: ENOENT: no such file or directory, open 'C:\Users\Hp\AppData\Local\Temp\nanoforge-supervisor-test-UX8sFX\.agents\budget_agent_clone_1f3892d0\progress.md'
    at SubagentSupervisor.spawnSubagent (src/agents/supervisor.ts:134:5)
    at SubagentSupervisor.escalateFailure (src/agents/supervisor.ts:468:29)
  ```
- **Where**: 
  - `apps/agent-host/src/agents/supervisor.ts:427`
  - `apps/agent-host/src/agents/supervisor.test.ts:62`
- **Why**: Vitest treats unhandled promise rejections as test runner failures and exits with code 1. In production, unhandled floating promises can lead to uncaught exceptions if disk I/O or worktree operations fail during background clone spawning.
- **Suggested Fix**:
  1. In `SubagentSupervisor.recordTokens()`, attach a `.catch(...)` handler or error logger to `this.escalateFailure(...)` so floating promise rejections do not escape into the global process event loop.
  2. In `apps/agent-host/src/agents/supervisor.test.ts:62`, convert the test to `async () => { ... }` and ensure either `escalateFailure` is handled or the test waits for background asynchronous operations before tearing down `tmpRoot`.

---

## 3. Review Dimensions & Architecture Audit

### 3.1 Protocol Layer (`packages/protocol/src/subagents.ts`, `tasks.ts`)
- **Isomorphic & Pure**: Zero Node.js runtime dependencies, pure Zod validation.
- **State Machine**: 7 canonical lifecycle states (`running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored`) with strict transition matrices (`isValidStateTransition`).
- **5-Field Cron Engine**: Handles standard 5-field cron syntax (`min hour dom month dow`), supporting step increments (`*/5`), ranges (`1-5`), named months/days (`JAN-DEC`, `SUN-SAT`), and bounds checking without external packages.
- **Actor Mailbox & Messages**: Priority queue schemas (`high`, `normal`, `low`), correlation IDs, referenced artifacts, and structured `<system_notification>` reactive wakeup templates.

### 3.2 Agent Host Engine (`apps/agent-host/src/agents/`, `daemons/`)
- **Supervisor Hierarchy**: Enforces maximum depth <= 3 (`SEC-SUB-05`) with `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED` and max active subagents <= 8 with `ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED`.
- **Cascading Teardown**: `HierarchyManager.killTree()` uses post-order depth traversal to abort turn execution loops, prune Git worktrees, terminate bound daemon processes, and cancel active schedules.
- **Actor Mailbox Authorization (SEC-SUB-03)**: `SubagentMailbox.validateAuthorization()` strictly verifies that senders only send messages to their direct parent, direct children, or siblings sharing the same parent.
- **Daemon Process Supervisor**: Detached long-running processes (`isDaemon: true`), STDIN interactive input (`send_input`), and bounded 2MB circular ring buffer (`CircularRingBuffer`) with chunk slicing and eviction.
- **Reactive Task Scheduler**: Supports one-shot timers with conditional early cancellation (`never`, `any`, `<sender-id>`) and 5-field recurring cron schedules with `maxIterations`.

### 3.3 Workspace Isolation & Security Confinement (`policy.ts`, `gitWorktree.ts`)
- **SEC-SUB-01 Path Confinement**: `authorizeSubagentPathAccess()` blocks writes outside the subagent's assigned `.agents/<name>_<shortId>/` folder, forbids writing to `.agents/` root, enforces read-only restrictions for `explorer`, `verifier`, and `planner` archetypes, and confines `branch` mode to worktree directories and `share` mode to ephemeral scratch directories.
- **Git Worktree Isolation**: `createWorktree()`, `pruneWorktree()`, and `listWorktrees()` use safe `git worktree add -B` and `git worktree remove --force` commands.

### 3.4 Visual Control Plane (`src/sections/SubagentsPanel.tsx`, `subagents/`, `hostClient.ts`, `hostSession.ts`)
- **Main Control Dock**: Responsive multi-tab dock (`AgentSwarmTreeView`, `AgentToolInspector`, `AgentMailboxViewer`, `DaemonTaskManager`, `SpawnSubagentModal`).
- **Reactive State Synchronization**: `hostSession.ts` parses subagent lifecycle events (`subagent.spawned`, `subagent.state_changed`, `subagent.message_sent`, `subagent.tree_updated`, `task.*`, `schedule.*`) and updates React state in real time.
- **UI Invariant Enforcement**: `SpawnSubagentModal.tsx` calculates supervisor tree depths and proactively disables spawning with a visible SEC-SUB-05 banner if target depth exceeds 3 tiers.

---

## 4. Adversarial Stress-Testing & Integrity Verification

- **Integrity Violation Check**: **PASS (NO VIOLATIONS DETECTED)**.
  - No hardcoded test results, facade logic, or test bypasses found.
  - Dynamic schemas, real crypto UUID generation, true subprocess spawning, and actual Git worktree invocations are implemented throughout.
- **Adversarial Scenarios Tested**:
  - Deeply nested fork bomb attempts (Depth 4+) -> Blocked with `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED`.
  - Concurrency flooding (> 8 subagents) -> Blocked with `ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED`.
  - Cross-tree message spoofing / ACL breakout -> Blocked with `ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT`.
  - Path traversal escaping workspace (`../../../etc/passwd`, `%2e%2e`) -> Denied.
  - Cross-agent metadata overwrite -> Denied with `SEC-SUB-01 Violation`.
  - Rapid concurrent message dispatch (50 parallel messages) -> Processed without data corruption.

---

## 5. 5-Component Handoff Report

### 1. Observation
- `npm run test:protocol`: Exited 0 (214 tests passing).
- `npm test`: Exited 0 (302 tests passing).
- `npm run build`: Exited 0 (Vite build successful).
- `npm run test:host`: Exited 1 with unhandled rejection:
  `Error: ENOENT: no such file or directory, open '...budget_agent_clone_1f3892d0\progress.md'` at `SubagentSupervisor.spawnSubagent` (line 134) triggered by `SubagentSupervisor.recordTokens` (line 427) during `src/agents/supervisor.test.ts`.

### 2. Logic Chain
1. `SubagentSupervisor.recordTokens()` triggers `void this.escalateFailure(subagentId, node.error, "replace")` when token budget limit is exceeded.
2. `escalateFailure` for `"replace"` calls `await this.spawnSubagent()`, which writes files (`DISPATCH.md`, `BRIEFING.md`, `progress.md`) asynchronously.
3. Because `recordTokens()` does not await `this.escalateFailure()` and lacks a `.catch()` boundary, and `supervisor.test.ts` executes `recordTokens()` synchronously, Vitest tears down `tmpRoot` in `afterEach` before the async file write completes.
4. The write fails with `ENOENT`, resulting in an unhandled promise rejection that causes Vitest to fail the run with exit code 1.

### 3. Caveats
- No other functional or security defects were identified across protocol, host, or visual control plane implementations.
- All 303 individual host test cases asserted and passed; the exit code 1 is solely attributable to the unhandled background promise during the test cleanup phase.

### 4. Conclusion
The implementation of Phase 4 & Phase 5 is functionally complete and adheres strictly to architecture, security invariants (SEC-SUB-01..05), and UI requirements. However, because `npm run test:host` fails with exit code 1 due to the unhandled rejection in the budget escalation path, changes are requested to fix this defect and ensure 100% clean test execution.

### 5. Verification Method
1. Fix the floating promise in `apps/agent-host/src/agents/supervisor.ts` and update `apps/agent-host/src/agents/supervisor.test.ts`.
2. Run the four verification commands:
   - `npm run test:protocol`
   - `npm run test:host`
   - `npm test`
   - `npm run build`
3. Verify that all 4 commands exit with code 0 without any unhandled rejections or compiler warnings.

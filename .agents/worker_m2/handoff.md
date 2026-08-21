# Handoff Report — Milestone 2: Host Engine, Sandboxing & Daemons

## 1. Observation
- **Scope Implemented:**
  1. Subagent Lifecycle Engine (`apps/agent-host/src/agents/`):
     - `types.ts`: Internal node types, escalation decision records.
     - `registry.ts`: `SubagentRegistry` managing node state transitions, parent-to-child index, custom template registry, and stale heartbeat liveness sweeps.
     - `mailbox.ts`: `SubagentMailbox` priority queues (`high` > `normal` > `low`), audit history ledger, and `SEC-SUB-03` authorization check (parent, child, or sibling only).
     - `wakeup.ts`: `ReactiveWakeupEngine` zero-polling event-driven wakeups formatting structured `<system_notification>` blocks.
     - `hierarchy.ts`: `HierarchyManager` enforcing max recursion depth <= 3 (`SEC-SUB-05`, `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED`), max concurrency <= 8 active subagents (`ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED`), and post-order cascading `killTree` with worktree pruning.
     - `supervisor.ts`: `SubagentSupervisor` orchestrating spawning (`inherit`, `branch`, `share`), metadata scaffolding (`BRIEFING.md`, `progress.md`, `DISPATCH.md`), managing, token budget metering (`SEC-SUB-04`), and 5-rung failure escalation ladder (`retry` -> `replace` -> `skip` -> `redistribute` -> `degrade`).
     - `tools.ts`: Tool handlers (`executeInvokeSubagentTool`, `executeManageSubagentsTool`, `executeSendMessageTool`, `executeDefineSubagentTool`).
     - `index.ts`: Module exports.
  2. Background Daemon Task Supervisor & Scheduler (`apps/agent-host/src/daemons/`):
     - `types.ts`: Task and schedule data structures.
     - `supervisor.ts`: `CircularRingBuffer` (bounded to 2MB) and `DaemonSupervisor` managing detached process lifecycles, streaming outputs, STDIN inputs, and cross-platform tree kills.
     - `scheduler.ts`: `TaskScheduler` managing one-shot timers (`never`, `any`, `<sender-id>` early cancel), 5-field cron parsing, and creator termination cleanup.
     - `manager.ts`: `DaemonManager` combining supervisor and scheduler.
     - `tools.ts`: Tool handlers (`executeManageTaskTool`, `executeScheduleTool`).
     - `index.ts`: Module exports.
  3. Workspace Sandboxing & Git Worktree (`apps/agent-host/src/workspace/` and `src/policy/`):
     - `apps/agent-host/src/workspace/gitWorktree.ts`: `createWorktree`, `pruneWorktree`, `listWorktrees`.
     - `apps/agent-host/src/policy/policy.ts`: `authorizeSubagentPathAccess()` and `canonicalizeSubagentPath()` enforcing `SEC-SUB-01` metadata isolation, path traversal defense (`..`, `%2e%2e`), read-only archetype constraints, and isolation mode confinement (`branch` to worktree, `share` to scratch).
  4. Fastify Server & WebSocket RPC Wire:
     - `apps/agent-host/src/protocol.ts`: RPC schemas for subagents (`subagent.invoke`, `subagent.manage`, `subagent.sendMessage`, `subagent.define`) and daemons (`task.manage`, `schedule.create`) along with result and event schemas.
     - `apps/agent-host/src/session.ts`: Injected `SubagentSupervisor` and `DaemonManager`, wired RPC dispatch handlers, event fan-out, and cleanup on socket close.

- **Verification Results:**
  - `npm run test:host`: 35 test files passed (303 tests, 0 failures).
  - `npm run test:protocol`: 9 test files passed (214 tests, 0 failures).
  - `npm test`: 25 root test files passed (266 tests, 0 failures).
  - `npm run typecheck:host`: 0 errors.
  - `npm run typecheck:protocol`: 0 errors.
  - `npm run build`: Production build succeeded in 9.66s.

## 2. Logic Chain
1. **Sandboxing (SEC-SUB-01 & Git Worktrees):**
   - Subagents require isolated scratch/branch spaces while maintaining access to read-only project files or shared metadata.
   - `gitWorktree.ts` leverages Git's native worktree capabilities (`git worktree add -B <branch> <path> HEAD` and `git worktree remove --force <path>`) for true branch isolation without disk bloat.
   - `authorizeSubagentPathAccess()` canonicalizes all paths (decoding URI components, normalizing separators, and resolving Windows case insensitivity) before verifying workspace boundaries, strictly denying writes outside the subagent's assigned `.agents/<id>` folder or worktree/scratch space.
2. **Actor Mailbox & Reactive Resumption (SEC-SUB-03):**
   - Polling wastes compute and introduces latency. `ReactiveWakeupEngine` utilizes event-driven callbacks to format and inject structured `<system_notification>` blocks directly upon message arrival or child completion.
   - Mailbox access control enforces supervision boundaries: only parent, child, or sibling agents under the same parent can exchange messages; cross-tree spoofing attempts are rejected with `ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT`.
3. **Hierarchy & Resource Safeguards (SEC-SUB-04 & SEC-SUB-05):**
   - `HierarchyManager` computes tree depth and denies any spawn exceeding depth 3 with `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED` or exceeding 8 concurrent agents with `ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED`.
   - `SubagentSupervisor` meters token usage against assigned budgets (`SEC-SUB-04`), automatically terminating offending subagents and executing the 5-rung failure escalation ladder.
   - Cascading tree termination (`killTree`) traverses the hierarchy in post-order, terminating leaves before parents, cleaning up associated worktrees, and disposing background daemon processes.
4. **Daemon Ring Buffer & Task Scheduler:**
   - Long-running daemons require bounded memory log streaming. `CircularRingBuffer` dynamically evicts oldest chunks once the 2MB threshold is reached while tracking truncation flags.
   - `TaskScheduler` supports conditional one-shot timers (`any` or specific `<sender-id>`) that automatically cancel upon matching message receipt or synthesize a fallback notification if the monitored sender terminates prematurely.

## 3. Caveats
- Git worktree creation requires the workspace to be an initialized Git repository with at least one commit (`HEAD`). If tested in an uninitialized folder, `git init` must precede worktree allocation (as handled in tests).
- Windows process tree termination uses `taskkill /pid <PID> /T /F` while POSIX environments send signals to the detached process group (`-PID`). Both paths are implemented and covered.

## 4. Conclusion
Milestone 2 (Host Engine, Sandboxing & Daemons) is complete, fully tested, and ready for integration with Milestone 3 (UI Components and Protocol Integration). All architectural invariants (`SEC-SUB-01`, `SEC-SUB-03`, `SEC-SUB-04`, `SEC-SUB-05`), zero-polling reactive wakeups, 2MB circular ring buffers, and 5-rung escalation ladders have been verified by 303 host tests, 214 protocol tests, and full monorepo typechecks.

## 5. Verification Method
To independently verify this milestone:
1. Run agent host unit, integration, and adversarial tests:
   ```powershell
   npm run test:host
   ```
2. Run protocol test suite:
   ```powershell
   npm run test:protocol
   ```
3. Run TypeScript typecheck:
   ```powershell
   npm run typecheck:host
   npm run typecheck:protocol
   ```
4. Run monorepo production build:
   ```powershell
   npm run build
   ```
- **Files to Inspect:**
  - `apps/agent-host/src/agents/`: `registry.ts`, `mailbox.ts`, `wakeup.ts`, `hierarchy.ts`, `supervisor.ts`, `tools.ts`.
  - `apps/agent-host/src/daemons/`: `supervisor.ts`, `scheduler.ts`, `manager.ts`, `tools.ts`.
  - `apps/agent-host/src/workspace/gitWorktree.ts` and `apps/agent-host/src/policy/policy.ts`.
  - `apps/agent-host/src/session.ts` and `apps/agent-host/src/protocol.ts`.

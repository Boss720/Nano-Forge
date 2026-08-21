# NanoForge Phase 4 & Phase 5: Codebase & Architecture Survey Report

**Author:** Codebase & Architecture Explorer  
**Date:** 2026-08-15  
**Target:** NanoForge Monorepo (`packages/protocol`, `apps/agent-host`, `src`)  
**Mission:** Comprehensive architectural audit and implementation blueprint for Phase 4 (Multi-Agent Swarm Orchestration, Workspace Sandboxing, Background Daemon Supervisor) & Phase 5 (Production Hardening, Visual Control Plane, End-to-End Verification).

---

## 1. Executive Summary & Verification Baseline

### 1.1 Monorepo Health & Test Baseline
All test suites and production build scripts were executed and verified directly on the current codebase:
- **`npm run test:protocol`**: **151 / 151 passed (100%)** across 6 test files (`artifacts.test.ts`, `commands.test.ts`, `commands.adversarial.test.ts`, `plan.test.ts`, `terminal.test.ts`, `terminal.adversarial.test.ts`).
- **`npm run test:host`**: **246 / 246 passed (100%)** across 24 test files (including `coordinator.test.ts`, `coordinator.adversarial.test.ts`, `cli.test.ts`, `ptyManager.test.ts`, `mcp/client.test.ts`, `policy.test.ts`, `server.test.ts`, `validatePlan.test.ts`).
- **`npm test` (Frontend)**: **266 / 266 passed (100%)** across 25 test files (including `PlanPanel.test.tsx`, `TerminalDock.test.tsx`, `ChatComposer.test.tsx`, `IntegrationsPanel.test.tsx`, `ArtifactDock.test.tsx`, `App.hostWiring.test.tsx`).
- **Total Automated Test Suite**: **663 / 663 automated tests passing (100%)** across 55 test files.
- **`npm run build` (`tsc -b && vite build`)**: **0 Errors**, clean production build (`dist/index.html`, `dist/assets/`).

### 1.2 Monorepo Layout & Workspace Topologies
- **Root**: `package.json` with scripts: `dev`, `build`, `test`, `test:protocol`, `test:host`, `typecheck:protocol`, `typecheck:host`, `start:host`.
- **`packages/protocol`**: Isomorphic pure TypeScript package with no Node dependencies. Contains schemas and pure algorithms for plans (`plan.ts`), slash commands (`commands.ts`), model routing (`routing.ts`), artifacts (`artifacts.ts`), and virtual terminals (`terminal.ts`).
- **`apps/agent-host`**: Authenticated Fastify Node.js agent host running on loopback with cryptographic single-use bearer tokens. Houses the `RunCoordinator`, policy engine (`policy.ts`), audit sink (`audit/store.ts`), MCP client, PTY terminal manager (`ptyManager.ts`), CLI runner (`cli/`), and workspace filesystem handlers.
- **Frontend (`src/`)**: React 19 + Vite interface. Contains the multi-rail shell (`App.tsx`, `Sidebar.tsx`, `TopBar.tsx`), `ChatPanel.tsx`, `PlanPanel.tsx`, `TerminalDock.tsx`, `ArtifactDock.tsx`, `ModelPanel.tsx`, `IntegrationsPanel.tsx`, and WebSocket bridge (`lib/hostClient.ts`, `lib/hostSession.ts`).

---

## 2. Deep Dive: Requirement Analysis & Existing Code Integration

---

### Requirement R1: Multi-Agent Protocol & Subagent Lifecycle Engine

#### 2.1 Current State in Codebase
- Currently, `RunCoordinator` in `apps/agent-host/src/runs/coordinator.ts` is single-threaded and executes one plan per run sequentially.
- `packages/protocol/src/commands.ts` already parses `@agent:<id>` mention tokens in user input (`commandMentionsSchema`), but `packages/protocol/src/subagents.ts` does not yet exist.
- `docs/PRD_MULTI_AGENT_ORCHESTRATION.md` provides complete Zod schemas and supervisor tree architecture specifications.

#### 2.2 Files to Create / Expand
1. **`packages/protocol/src/subagents.ts`** (New File):
   - **Identifiers & Schemas**:
     - `subagentIdSchema`: `z.string().uuid()`
     - `subagentArchetypeSchema`: `z.enum(["explorer", "implementer", "qa", "specialist", "verifier", "planner", "custom"])`
     - `subagentStatusSchema`: `z.enum(["spawning", "running", "idle", "waiting_for_input", "waiting_for_dependents", "waiting_for_message", "canceling", "errored", "blocked", "completed", "failed", "terminated"])`
     - `workspaceIsolationModeSchema`: `z.enum(["inherit", "branch", "share"])`
     - `supervisorStrategySchema`: `z.enum(["one_for_one", "one_for_all", "rest_for_one"])`
   - **Tool Parameter Schemas**:
     - `invokeSubagentParamsSchema` & `invokeSubagentResultSchema`: `archetype`, `roles`, `prompt`, `workspaceIsolation`, `allowedToolKinds`, `timeoutSeconds`, `budgetTokens`, `skills`, `model`.
     - `manageSubagentsParamsSchema` & `manageSubagentsResultSchema`: actions `list`, `status`, `kill`, `pause`, `resume`, `inspect`.
     - `sendMessageParamsSchema` & `agentMessageFrameSchema`: `recipientId`, `subject`, `body`, `referencedArtifacts`.
     - `defineSubagentParamsSchema` & `defineSubagentResultSchema`: dynamic custom agent registration with prompt, archetypes, and tool whitelist.
     - `subagentSummarySchema`: `id`, `parentId`, `archetype`, `status`, `workingDirectory`, `startedAt`, `completedAt`, `lastHeartbeat`, `tokensUsed`, `lastProgressSummary`.
   - **Wire Events**:
     - `subagentSpawnEventSchema`, `subagentStateEventSchema`, `subagentMessageEventSchema`, `subagentWireEventSchema`.
   - **Export in `packages/protocol/src/index.ts`**.

2. **`apps/agent-host/src/agents/supervisor.ts`** (New File):
   - `SubagentSupervisor` class extending `EventEmitter`.
   - Manages subagent nodes in memory, parent-to-children relationship maps.
   - **Security Invariant `SEC-SUB-05`**: Recursion depth validation (max depth = 3).
   - **Concurrency Limit**: Max active subagents (e.g. 8).
   - **Reactive Wakeups (Zero Polling)**:
     - Mailbox queue for each subagent.
     - `dispatchMessage()` adds `AgentMessageFrame` and calls recipient coordinator's `notifyWakeup({ type: "message", frame })`.
     - Suspends agents in `IDLE` state when no active tools run; resumes deterministically on mailbox arrival, timer, or sender termination.
   - **Fallback Reactive Wakeup**:
     - If `<sender-id>` fails/crashes/terminates before sending a message, waiting agents are notified with `sender_terminated` to prevent deadlocks in `IDLE`.
   - **Failure Escalation Ladder**:
     - `Retry` (transient errors, up to 3) $\to$ `Replace` (context saturation > 85%, clean handoff) $\to$ `Skip` (non-blocking steps) $\to$ `Redistribute` (split task among parallel workers) $\to$ `Degrade` (halt & prompt user).
   - **Cascading Teardown**:
     - `killTree(rootId)` recursively terminates all child processes, frees Git worktrees, cancels scheduled tasks, and cleans memory maps.

3. **`apps/agent-host/src/agents/mailbox.ts`** (New File):
   - Message routing broker ensuring strict authorization (`SEC-SUB-03` - inter-agent messages must route through supervisor mailbox).
   - Links referenced handoff artifacts (`handoff.md`, `analysis.md`).

4. **`apps/agent-host/src/agents/tools.ts`** (New File):
   - Tool executor functions for `invoke_subagent`, `manage_subagents`, `send_message`, `define_subagent`.

---

### Requirement R2: Workspace Isolation & Branch Sandboxing

#### 2.1 Current State in Codebase
- `apps/agent-host/src/policy/policy.ts` currently provides `isWithinWorkspace` and `resolveWithinWorkspace` validating cwd against a single `workspaceRoot`.
- `apps/agent-host/src/workspace/filesystem.ts` provides workspace read/write/stat/search RPCs.
- `apps/agent-host/src/policy/default-policy.json` contains default shell/executable deny lists.

#### 2.2 Files to Create / Expand
1. **`apps/agent-host/src/workspace/gitWorktree.ts`** (New File):
   - `createWorktree(workspaceRoot, worktreePath, branchName)`: Uses `git worktree add -b <branch> <path>` to establish an isolated workspace for `branch` mode subagents.
   - `pruneWorktree(workspaceRoot, worktreePath)`: Uses `git worktree remove --force <path>` and `git branch -D <branch>` to clean up on subagent termination.
2. **`apps/agent-host/src/policy/policy.ts`** (Expand):
   - Add subagent-specific path containment rule `SEC-SUB-01`:
     - Subagents in `inherit` or `share` mode may only write scratch files, memory, and handoffs within their allocated `.agents/<agent_name>_<id>/` folder.
     - Writing to another subagent's folder (`.agents/<other_id>/`) is unconditionally denied.
     - Protect `.git/` and system files from direct unauthorized mutation.
   - Support `share` mode: in-memory overlay or temporary directory with `.patch` output verification.

---

### Requirement R3: Background Daemon Task Supervisor & Scheduler

#### 2.1 Current State in Codebase
- `apps/agent-host/src/terminal/runner.ts` and `ptyManager.ts` currently manage transient terminal executions and virtual PTY sessions.
- In `packages/protocol/src/commands.ts`, `/schedule <interval|cron> <prompt>` is declared as a built-in slash command with `requiresHost: true`.
- Background daemon supervisor (`isDaemon: true`), persistent ring buffers, and cron/one-shot scheduling are needed.

#### 2.2 Files to Create / Expand
1. **`packages/protocol/src/tasks.ts`** (New File):
   - `taskIdSchema`: `z.string().uuid()`
   - `taskStatusSchema`: `z.enum(["running", "completed", "failed", "cancelled"])`
   - `scheduleConditionSchema`: `z.union([z.literal("never"), z.literal("any"), z.string().uuid()])`
   - `scheduleParamsSchema`: `prompt`, `durationSeconds`, `cronExpression`, `timerCondition`, `maxIterations`, `isDaemon`.
   - `manageTaskParamsSchema`: `action: "list" | "kill" | "status" | "send_input"`, `taskId`, `input`.
   - `taskSummarySchema`, `manageTaskResultSchema`, `scheduleResultSchema`.
   - Export in `packages/protocol/src/index.ts`.

2. **`apps/agent-host/src/daemons/manager.ts`** (New File):
   - `DaemonSupervisor` class:
     - Spawns and manages detached background processes (`isDaemon: true`).
     - Tracks PIDs, process groups, CPU/uptime metrics.
     - Maintains dedicated 2MB circular ring buffer per daemon for live stdout/stderr log tailing.
     - Provides interactive `send_input` to pipe stdin into running daemon tasks.
     - `cancelSubagentTasks(subagentId)`: Cancels all non-daemon background tasks when their owning subagent dies.
     - Session teardown hook: clean termination of all spawned processes on server shutdown.

3. **`apps/agent-host/src/daemons/scheduler.ts`** (New File):
   - `TaskScheduler` class:
     - One-shot timer management (`durationSeconds`): calculates trigger timestamp, sets `setTimeout`, evaluates `timerCondition` (`never`, `any`, `<sender-id>`).
     - Recurring cron management (`cronExpression`): calculates next tick, manages iteration count against `maxIterations`.
     - Wakeup integration: when a timer fires, injects high-priority notification into the target agent's turn loop.
     - Fallback cancellation: if `<sender-id>` terminates prematurely, immediately cancels conditional timer and wakes waiting agent.

4. **`apps/agent-host/src/daemons/tools.ts`** (New File):
   - LLM tool definitions for `manage_task` and `schedule`.

---

### Requirement R4: Multi-Agent Swarm Visual Control Plane

#### 2.1 Current State in Codebase
- Existing visual panels in `src/sections/`:
  - `PlanPanel.tsx`: Visual DAG step inspector, approval ledger.
  - `ChatPanel.tsx` / `ChatComposer.tsx`: Chat transcript, slash command palette, context chips.
  - `TerminalDock.tsx`: Multi-tab PTY terminal interface.
  - `ArtifactDock.tsx`: Multi-format artifact viewer (Monaco diffs, Mermaid, LiveSandbox).
  - `IntegrationsPanel.tsx`: Rules, skills, MCP servers.
- `src/sections/SubagentsPanel.tsx` does not yet exist.

#### 2.2 Files to Create / Expand
1. **`src/sections/SubagentsPanel.tsx`** (New File):
   - **Hierarchical Agent Tree Visualizer**:
     - Visual tree graph showing parent-child hierarchy, archetypes, live status badges (`running`, `idle`, `blocked`, `completed`, `failed`, `terminated`), uptime clock, token counters, and memory inspect buttons.
   - **Live Tool Execution Inspector**:
     - Displays active tool calls per subagent, arguments, stdout/stderr chunk streaming, and policy decision badges.
   - **Inter-Agent Mailbox Inspector**:
     - Chronological / threaded feed of messages passed via `send_message` with sender/recipient badges, timestamps, subject, body text, and clickable artifact links (`handoff.md`).
   - **Background Daemon Tasks & Schedule Monitor**:
     - Real-time table of daemon processes and active cron/timer schedules.
     - Actions: `Kill Task`, `Send Input` (interactive modal), `Tail Logs` (view ring buffer).
   - **Dynamic Subagent Spawner Modal**:
     - Form to configure and spawn subagents interactively (`Archetype`, `Prompt`, `Workspace Mode`, `Tools`, `Budget`).

2. **`src/lib/hostClient.ts` & `src/lib/hostSession.ts`** (Expand):
   - Protocol wire message shapes for `subagent.spawned`, `subagent.state`, `subagent.message`, `task.started`, `task.output`, `task.state`, `schedule.triggered`.
   - Client methods: `invokeSubagent()`, `manageSubagents()`, `sendMessage()`, `manageTask()`, `schedule()`.
   - React state hooks for subagents and background daemon tasks.

3. **`src/sections/TopBar.tsx` & `src/App.tsx`** (Expand):
   - TopBar Swarm status badge with active subagent count counter and shortcut button to open `SubagentsPanel`.
   - Side rail / dock toggle integration in `App.tsx`.

---

### Requirement R5: Comprehensive Tests, Production Build & Master Handoff

#### 5.1 Test Suites to Implement
1. **`packages/protocol/__tests__/subagents.test.ts` & `tasks.test.ts`**:
   - Schema validation for all parameter types, return shapes, and wire frames.
   - Adversarial / edge-case tests for invalid UUIDs, cyclic sender IDs, negative budgets, and malformed cron strings.
2. **`apps/agent-host/__tests__/agents/supervisor.test.ts` & `mailbox.test.ts`**:
   - Unit & integration tests for subagent tree spawning, depth limit (`SEC-SUB-05`), concurrency throttling, mailbox message routing, reactive wakeups without polling, fallback wakeups on sender crash, and cascading tree kill.
3. **`apps/agent-host/__tests__/daemons/manager.test.ts` & `scheduler.test.ts`**:
   - Tests for daemon process lifecycle, 2MB ring buffer retention, stdin forwarding, one-shot timers, cron schedules, and scoped task cancellation.
4. **`apps/agent-host/__tests__/policy/sandboxing.test.ts`**:
   - Negative security tests verifying `.agents/` path confinement, prevention of cross-agent directory writes, and worktree isolation.
5. **`src/sections/__tests__/SubagentsPanel.test.tsx`** & co-located `SubagentsPanel.test.tsx`:
   - React Testing Library tests for tree visualizer, live status changes, message feed, daemon task actions, and dynamic spawner submission.

---

## 3. Monorepo Structural Inventory

| Component / Subsystem | Current Files | Planned Files (Phase 4 & 5) | Status |
|---|---|---|---|
| **Protocol Schemas** (`packages/protocol/src/`) | `plan.ts`, `commands.ts`, `routing.ts`, `artifacts.ts`, `terminal.ts`, `index.ts` | `subagents.ts`, `tasks.ts` | Ready for creation |
| **Agent Supervisor** (`apps/agent-host/src/agents/`) | None | `supervisor.ts`, `mailbox.ts`, `tools.ts`, `escalation.ts` | Ready for creation |
| **Daemon & Scheduler** (`apps/agent-host/src/daemons/`) | None | `manager.ts`, `scheduler.ts`, `tools.ts` | Ready for creation |
| **Workspace Sandboxing** (`apps/agent-host/src/workspace/`) | `filesystem.ts`, `watcher.ts`, `index.ts` | `gitWorktree.ts`, policy updates | Ready for creation |
| **Policy Engine** (`apps/agent-host/src/policy/`) | `policy.ts`, `default-policy.json` | Subagent path confinement rules | Ready for expansion |
| **Host Session & Protocol** (`apps/agent-host/src/`) | `session.ts`, `protocol.ts`, `server.ts` | Subagent & Task WebSocket handlers | Ready for expansion |
| **Visual Control Plane** (`src/sections/`) | `PlanPanel.tsx`, `TerminalDock.tsx`, `ArtifactDock.tsx`, `ChatPanel.tsx` | `SubagentsPanel.tsx` | Ready for creation |
| **Client Transport** (`src/lib/`) | `hostClient.ts`, `hostSession.ts` | Subagent/Daemon wire methods | Ready for expansion |
| **Automated Tests** | 55 test files (663 tests passing) | +8 new test files (~120+ new tests) | Target: 100% Pass |

---

## 4. Key Architectural Invariants & Security Mandates

1. **Zero Natural Language Authority (`SEC-SUB-01`)**: No natural language text generated by an LLM turn may satisfy an approval gate or escalate permissions.
2. **Strict Workspace Isolation (`SEC-SUB-02`)**: Subagents must never write scratch files, memory files, or handoffs outside their allocated `.agents/<id>/` directory.
3. **Hierarchy Depth Ceiling (`SEC-SUB-05`)**: Max supervisor recursion depth is strictly capped at 3 tiers. Spawning beyond depth 3 immediately throws `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED`.
4. **Zero-Polling Reactive Wakeups**: When an agent completes a turn or awaits a message/timer, its execution is frozen in `IDLE`. Host sessions thaw and resume agents strictly upon inbound mailbox frames or timer triggers.
5. **No Orphaned Daemons**: All active child processes and Git worktrees are registered in process tables and cleanly torn down (`killTree`) on session termination.

---
*Report generated and certified by Codebase & Architecture Explorer.*

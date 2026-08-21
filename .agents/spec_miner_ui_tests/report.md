# NanoForge Phase 4 & Phase 5: Visual Control Plane & E2E Testing Specification Report

**Date:** 2026-08-15  
**Spec Miner Role:** Visual Control Plane & E2E Testing Spec Miner  
**Target Systems:** `src/sections/SubagentsPanel.tsx`, `src/components/`, `src/lib/`, `packages/protocol`, `apps/agent-host`, Vitest Test Suites  
**Authoritative Sources:** `ORIGINAL_REQUEST.md`, `docs/PRD_MULTI_AGENT_ORCHESTRATION.md`, `PROJECT.md`, `TEST_INFRA.md`, `HANDOFF.md`, Monorepo Codebase

---

## 1. Executive Summary

Phase 4 and Phase 5 of NanoForge expand the platform from single-threaded execution into a **full-scale Multi-Agent Swarm Orchestration system** with an **autonomous background supervisor**, **workspace isolation (`.agents/`)**, an **Antigravity-grade Visual Control Plane (`SubagentsPanel.tsx`)**, and **100% automated test coverage** across all monorepo tiers.

This specification mining report defines the architecture, user interaction model, data contracts, and verification matrix for:
1. **Frontend Architecture & Navigation Integration**: Seamless extension of `App.tsx`, `TopBar.tsx`, and `hostSession.ts` to support multi-agent monitoring and control without degrading baseline single-run UI performance.
2. **Visual Control Plane Components**:
   - `SubagentsPanel.tsx`: Top-level multi-tab swarm control dock and dashboard.
   - `AgentSwarmTreeView.tsx`: Hierarchical supervision tree with real-time status badges, heartbeat monitors, and branch node action gates.
   - `AgentToolInspector.tsx`: Real-time streaming tool execution inspector with parameter inspection and stdout/stderr output viewer.
   - `AgentMailboxViewer.tsx`: Inter-agent message log and mailbox exchange viewer with 5-component handoff report rendering and artifact links.
   - `DaemonTaskManager.tsx` & `ScheduleMonitor.tsx`: Background daemon task supervisor and one-shot timer/cron scheduler with interactive STDIN input and process termination.
   - `SpawnSubagentModal.tsx`: Dynamic agent spawner dialog with archetype presets, role tagging, tool permission gates, and recursion depth limits.
3. **Monorepo Testing Framework & Matrix**: Complete test suite definitions for `npm run test:protocol`, `npm run test:host`, and `npm test` ensuring 100% pass rate and 0 build errors in `npm run build`.

---

## 2. Frontend Architecture & IPC Bridge Analysis

### 2.1 UI Layout & Navigation Integration
The NanoForge frontend (`src/App.tsx`) utilizes a multi-rail, reactive dashboard architecture:
- **`TopBar.tsx`**: Contains global status badges (connection status, aggregate token usage, active cost) and dock toggle buttons (`onOpenArtifacts`, `onOpenCosts`, `onOpenImages`, `onOpenSettings`).
  - **Phase 4 Extension**: Add `onOpenSubagents` trigger button with active subagent count badge (e.g. `Bot` or `Network` icon with indicator dot).
- **`Sidebar.tsx`**: Left navigation rail containing session history and virtual filesystem (`files`).
- **`ChatPanel.tsx`**: Central conversation timeline with interactive composer, tool cards, and slash command caret popover.
- **Side Rails / Docks**:
  - `ArtifactDock.tsx` (`w-[440px]` right rail): Multi-format preview (Monaco diff, sandbox iframe, Mermaid SVG, Markdown alerts, visual diff).
  - `PlanPanel.tsx` (`w-80` right rail): Visual planning mode with phase accordions, DAG dependency badges, and approval ledgers.
  - `SubagentsPanel.tsx`: Can dock as a collapsible side rail (`w-[480px]` or `w-[540px]`) or expand into a full modal/dialog workspace for swarm visualization.
- **`hostSession.ts` Bridge**: React hook managing bidirectional WebSocket synchronization with `apps/agent-host`. Extended with:
  - `subagents: SubagentSummary[]`
  - `activeSubagentId: string | null`
  - `interAgentMessages: AgentMessageFrame[]`
  - `daemonTasks: SupervisedTask[]`
  - `schedules: SupervisedSchedule[]`
  - Mutation methods: `spawnSubagent`, `killSubagent`, `killSubagentTree`, `sendMessage`, `manageTask`, `cancelSchedule`.

### 2.2 Wire Protocol Message Flow
```
+-----------------------------------------------------------------------------------------+
|                                    NANOFORGE CLIENT                                      |
|  (src/lib/hostClient.ts <-> src/lib/hostSession.ts <-> src/sections/SubagentsPanel.tsx) |
+-----------------------------------------------------------------------------------------+
       ▲                                                                   │
       │ Host -> Client Event Frames                                       │ Client -> Host Action Frames
       │ - subagent.spawned (SubagentSummary)                              │ - subagent.invoke (InvokeSubagentParams)
       │ - subagent.state (status, reason, tokens)                         │ - subagent.kill (subagentId, cascade)
       │ - subagent.message (AgentMessageFrame)                            │ - subagent.send_message (recipientId, body)
       │ - task.spawned / task.state / task.output                         │ - task.kill / task.send_input
       │ - schedule.triggered / schedule.cancelled                         │ - schedule.create / schedule.cancel
       │                                                                   ▼
+-----------------------------------------------------------------------------------------+
|                                   AGENT HOST BACKEND                                    |
|   (apps/agent-host/src/agents/ <-> apps/agent-host/src/daemons/ <-> Fastify WebSocket) |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Visual Control Plane Detailed Component Design

### 3.1 `SubagentsPanel.tsx` (Top-Level Container)

#### Architecture & Layout
- **Container**: Flexbox column dock with header, metrics summary bar, navigation tabs, active view canvas, and slide-out inspector.
- **Tabs**:
  1. `Swarm Tree` (`AgentSwarmTreeView`): Hierarchical tree graph of all subagents.
  2. `Tool Activity` (`AgentToolInspector`): Real-time tool execution stream and parameter inspector.
  3. `Inter-Agent Messages` (`AgentMailboxViewer`): Cross-agent mailbox message logs and handoffs.
  4. `Daemons & Schedules` (`DaemonTaskManager`): Background daemon processes and cron/timer monitors.
- **Top Summary Metrics Bar**:
  - `Active Agents`: Counter with status color dot (e.g. `3 Running · 1 Idle · 0 Blocked`).
  - `Total Tokens`: Aggregated token consumption across all spawned subagents.
  - `Active Tasks`: Running background daemon count (`isDaemon: true`).
  - `Active Timers`: Pending one-shot and recurring cron schedules.
- **Global Actions**:
  - `Spawn Agent`: Primary button triggering `SpawnSubagentModal`.
  - `Kill All / Terminate Swarm`: Destructive button with confirmation alert.
  - `Filter & Search`: Filter subagents by archetype, status, or search query.

---

### 3.2 `AgentSwarmTreeView.tsx` (Hierarchical Swarm Tree Visualizer)

#### Visual Model & Connectors
- **Hierarchical Tree View**: Renders the parent-child supervision tree starting from the Root Orchestrator down to depth 3.
- **Branch Indentation & Connectors**:
  - Depth-based padding (`pl-4`, `pl-8`, `pl-12`).
  - Left-hand tree connector lines (`border-l-2 border-border/60`, curve corner `rounded-bl`).
  - Collapse/expand chevron button on nodes with child agents.

#### Live Status Badges & Color Palette
| Subagent Status | Visual Styling | Icon | Indicator |
|---|---|---|---|
| `spawning` | `bg-blue-500/10 text-blue-400 border-blue-500/30` | `Loader2` (spin) | Blue pulsing ring |
| `running` | `bg-emerald-500/10 text-emerald-400 border-emerald-500/30` | `Activity` / `Play` | Emerald pulsing dot |
| `idle` | `bg-slate-500/10 text-slate-400 border-slate-500/30` | `Moon` / `Coffee` | Muted slate dot |
| `blocked` / `waiting_for_input` | `bg-amber-500/10 text-amber-400 border-amber-500/30` | `ShieldAlert` / `Pause` | Amber warning ring |
| `waiting_for_dependents` | `bg-indigo-500/10 text-indigo-400 border-indigo-500/30` | `Hourglass` | Indigo slow pulse |
| `canceling` | `bg-orange-500/10 text-orange-400 border-orange-500/30` | `RefreshCw` (spin) | Orange spinning indicator |
| `completed` | `bg-teal-500/10 text-teal-400 border-teal-500/30` | `CheckCircle2` | Solid teal check |
| `failed` / `errored` | `bg-red-500/10 text-red-400 border-red-500/30` | `AlertTriangle` / `XCircle` | Red error highlight |
| `terminated` | `bg-muted text-muted-foreground border-border` | `Square` / `Slash` | Muted gray |

#### Node Card Details
- **Archetype Pill**: Distinct badge per archetype:
  - `explorer`: Cyan (`bg-cyan-500/10 text-cyan-400`)
  - `implementer`: Purple (`bg-purple-500/10 text-purple-400`)
  - `qa`: Orange (`bg-orange-500/10 text-orange-400`)
  - `specialist`: Emerald (`bg-emerald-500/10 text-emerald-400`)
  - `verifier`: Indigo (`bg-indigo-500/10 text-indigo-400`)
  - `planner`: Amber (`bg-amber-500/10 text-amber-400`)
- **Metadata Badges**:
  - `Workspace Mode`: `inherit` (shared), `branch: nano/<id>` (Git worktree), or `share` (scratch VFS).
  - `Uptime`: Calculated from `startedAt` (e.g. `2m 14s`).
  - `Tokens`: Formatted token usage (`12.4k tok`).
  - `Heartbeat Liveness`: Green if `now - lastHeartbeat < 30s`; Amber if `< 180s`; Red `STALLED` if `> 180s`.
- **Node Action Buttons**:
  - `Select / Inspect`: Sets node as active to view tools and mailbox.
  - `Message`: Opens quick message modal to send input to this subagent.
  - `Kill Agent`: Terminates single subagent.
  - `Kill Tree`: Cascading termination of subagent and all its descendants.

---

### 3.3 `AgentToolInspector.tsx` (Real-Time Tool Execution Viewer)

#### Features & State View
- **Selected Agent Context**: Displays tool stream and state for the active subagent.
- **Tool Invocations Feed**: Reverse chronological list or live tail stream of tool runs.
- **Tool Card Header**:
  - Kind icon (`terminal.exec` -> Terminal, `file.read` -> FileText, `file.edit` -> Edit3, `workspace.search` -> Search, `browser.action` -> Globe, `mcp.call` -> Plug).
  - Tool Title & Target (e.g. `npm test`, `src/server.ts`).
  - Execution Status badge (`running`, `done`, `error`, `approval_required`).
  - Execution Duration (`durationMs`) & Return Exit Code.
- **Collapsible Parameter Inspector**:
  - Formatted JSON / key-value tree viewer displaying verbatim arguments.
  - Copy parameters to clipboard button.
- **Live Output Console (`ToolOutputViewer`)**:
  - ANSI-colored streaming terminal output viewer with 2MB circular buffer retention.
  - Auto-scroll toggle (`Follow output`).
  - Output truncation indicator (`[Output capped at 2MB]`).
  - Manual cancellation button (`Stop Tool`) for currently running executions.

---

### 3.4 `AgentMailboxViewer.tsx` (Inter-Agent Message & Mailbox Exchange Viewer)

#### Features & Layout
- **Cross-Agent Communication Bus**: Shows chronological stream of `send_message` frames exchanged between root, parent, and child subagents.
- **Message Flow Card**:
  - Header: Sender pill with archetype color $\to$ Arrow $\to$ Recipient pill.
  - Timestamp (ISO + relative `12s ago`).
  - Subject line (e.g. `Handoff Report: Authentication Refactor`).
- **Structured Message Body**:
  - Full Markdown rendering with syntax highlighting.
  - **Standard 5-Component Handoff Accordion**: Automatically detects and renders handoff sections with distinct iconography:
    1. 🔍 **Observation**: Verbatim commands, line numbers, and file paths.
    2. 🧠 **Logic Chain**: Step-by-step reasoning.
    3. ⚠️ **Caveats**: Scope assumptions and non-investigated areas.
    4. 🎯 **Conclusion**: Actionable verdict.
    5. 🧪 **Verification Method**: Test commands and reproduction steps.
- **Referenced Artifacts Gallery**: Clickable chips for all attached files (e.g. `.agents/exp_1/handoff.md`, `src/App.tsx`).
- **Interactive Quick-Reply Composer**:
  - Allows human operator to inject guidance or reply directly to a waiting subagent's mailbox queue.

---

### 3.5 `DaemonTaskManager.tsx` & `ScheduleMonitor.tsx` (Daemon Tasks & Scheduler)

#### Background Daemon Tasks Panel
- **Task List View**: Displays all background processes spawned with `isDaemon: true` or through terminal daemons.
- **Task Table Columns**:
  - `Task ID` (UUID prefix).
  - `Executable & Args` (e.g. `vite dev --port 5173`).
  - `CWD` / `Worktree`.
  - `PID` (Host process group ID).
  - `Uptime` (Elapsed duration).
  - `Status` (`running`, `completed`, `failed`, `cancelled`).
- **Interactive Controls**:
  - `Send Input` bar: Interactive STDIN input box to transmit commands or keystrokes to running daemons (`manage_task: send_input`).
  - `Kill Task` button: Sends `SIGTERM` / `SIGKILL` (`manage_task: kill`).
  - `Log Terminal Modal`: Opens real-time scrollback log viewer for the daemon.

#### Scheduler & Timer Monitor Panel
- **One-Shot Timers Section**:
  - Lists active alarms created by `schedule(DurationSeconds=...)`.
  - Countdown progress bar with remaining seconds.
  - `TimerCondition` indicator:
    - `never`: Unconditional timer.
    - `any`: Cancels early on any message.
    - `<sender-id>`: Bound to specific subagent sender with fallback termination wakeup protection.
  - Cancel Alarm button (`manage_task: kill`).
- **Recurring Cron Jobs Section**:
  - Lists scheduled jobs created with `CronExpression`.
  - Humanized cadence description (e.g. `"*/5 * * * *" -> "Every 5 minutes"`).
  - Iteration tracker: `Iteration X / Max Y` (or `Unlimited`).
  - Daemon indicator badge (`isDaemon: true` survives task completion; `false` bound to subagent lifetime).
  - Cancel Cron button.

---

### 3.6 `SpawnSubagentModal.tsx` (Dynamic Agent Spawner)

#### Spawner Modal Form Fields
1. **Parent Agent Selector**: Dropdown showing existing active agents; defaults to Root Orchestrator. Depth counter indicates current depth (1 to 3).
2. **Archetype Selector**: Visual grid of archetypes with default tool sets and descriptions (`explorer`, `implementer`, `qa`, `specialist`, `verifier`, `planner`, `custom`).
3. **Roles Input**: Multi-tag input for specialized role assignments (e.g. `["refactoring", "vitest_expert"]`).
4. **Mission Prompt Area**: Expandable Markdown textarea with character counter and syntax validation.
5. **Workspace Isolation Mode**:
   - `inherit`: Shared root workspace with isolated `.agents/<id>/` metadata.
   - `branch`: Isolated Git worktree (`nano/<id>`) for concurrent code modifications.
   - `share`: Read-only root with temporary scratch overlay.
6. **Tool Permission Checkbox Matrix**: Granular allow-list (`file.read`, `file.edit`, `file.write`, `terminal.exec`, `workspace.search`, `browser.action`, `mcp.call`).
7. **Resource Limits**:
   - `Timeout`: Range slider (60s to 7200s, default 600s).
   - `Token Budget`: Number input (e.g. 50,000 tokens).
   - `Model Selection`: Model catalog picker.
8. **Skills Attachment**: Dropdown to bundle pre-configured domain skills (e.g. `science`, `android`, `customizations`).

#### Pre-Flight Validation Rules
- **Depth Validation**: If `depth >= 3`, spawner disables creation and warns `SEC-SUB-05: Maximum supervisor hierarchy depth of 3 tiers reached`.
- **Concurrency Check**: If active subagents count $\ge 8$, warns user and requests termination of idle workers.
- **Form Validation**: Requires non-empty prompt and valid workspace mode.

---

## 4. Discovered Features & Specification Matrix

### Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Subagent Protocol | `invoke_subagent` Tool | Spawns child agent under supervision tree with isolation mode and tool restrictions | `archetype`, `roles`, `prompt`, `workspaceIsolation`, `allowedToolKinds`, `timeoutSeconds`, `budgetTokens`, `skills` | `{ subagentId, workingDirectory, status, startedAt }` | Throws `ERR_SUBAGENT_MAX_DEPTH` if depth > 3; throws on invalid archetype | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 & `ORIGINAL_REQUEST.md` R1 |
| 2 | Subagent Protocol | `manage_subagents` Tool | Queries status, monitors heartbeats, inspects metadata files, and terminates child subagents | `action` (`list`, `status`, `kill`, `pause`, `resume`, `inspect`), `subagentId`, `inspectFile` | `{ success, subagents?, detail?, inspectedContent? }` | Returns `success: false` if `subagentId` not found; throws on unauthorized peer kill | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 & `ORIGINAL_REQUEST.md` R1 |
| 3 | Subagent Protocol | `send_message` Tool | Typed cross-agent message passing with reactive wakeup triggers | `recipientId`, `subject`, `body`, `referencedArtifacts` | `{ messageId, timestamp }` | Throws if recipient does not exist or has terminated | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 & `ORIGINAL_REQUEST.md` R1 |
| 4 | Subagent Protocol | `define_subagent` Tool | Dynamically registers custom subagent archetype definitions and prompt templates | `archetype`, `systemPromptTemplate`, `defaultTools`, `description` | `{ success, archetype }` | Throws on duplicate archetype name or empty system prompt | `ORIGINAL_REQUEST.md` R1 |
| 5 | Workspace Isolation | `inherit` Workspace Mode | Shared workspace root with private metadata directory in `.agents/<subagentId>/` | `workspaceIsolation: "inherit"` | File system sandbox confining scratch writes to `.agents/` | Denies writes outside assigned folder unless authorized in plan step | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.1 & `ORIGINAL_REQUEST.md` R2 |
| 6 | Workspace Isolation | `branch` Worktree Mode | Isolated Git worktree in `.agents/worktrees/<id>` on branch `nano/<id>` | `workspaceIsolation: "branch"` | Full isolated worktree filesystem | Auto-pruned on subagent termination; throws if git worktree fails | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.1 & `ORIGINAL_REQUEST.md` R2 |
| 7 | Workspace Isolation | `share` Scratch Mode | Read-only workspace mirror with temporary overlay scratch directory | `workspaceIsolation: "share"` | Patch-based export mechanism | Denies direct modifications to project root | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.1 & `ORIGINAL_REQUEST.md` R2 |
| 8 | Daemon Supervisor | `manage_task` Tool | Background daemon process management (`list`, `kill`, `status`, `send_input`) | `action` (`list`, `kill`, `status`, `send_input`), `taskId`, `input` | `{ success, tasks?, status?, output? }` | Returns error if `taskId` invalid; handles process termination errors cleanly | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.1 & `ORIGINAL_REQUEST.md` R3 |
| 9 | Daemon Scheduler | `schedule` Tool | One-shot liveness timer and recurring cron schedule coordinator | `prompt`, `durationSeconds`, `cronExpression`, `timerCondition`, `maxIterations`, `isDaemon` | `{ scheduleId, nextTriggerAt, status }` | Throws if neither or both duration and cron specified; throws on malformed cron | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.2 & `ORIGINAL_REQUEST.md` R3 |
| 10 | Control Plane | `SubagentsPanel` Container | Multi-tab swarm management control plane and overview dashboard | Active subagents, messages, daemon tasks, schedules | Interactive UI dock with metrics and subviews | Falls back to empty state when host is absent or no agents spawned | `ORIGINAL_REQUEST.md` R4 |
| 11 | Control Plane | `AgentSwarmTreeView` | Hierarchical tree visualizer with live status badges, uptime, and node action buttons | Supervision tree nodes, status transitions | Interactive tree canvas with branch expand/collapse | Visual indicator for `STALLED` heartbeats (>180s) | `PRD_MULTI_AGENT_ORCHESTRATION.md` §3 & `ORIGINAL_REQUEST.md` R4 |
| 12 | Control Plane | `AgentToolInspector` | Real-time tool execution viewer, structured parameter inspector, and log stream | Selected agent tool runs, stdout/stderr streams | Collapsible JSON tree, live terminal log with 2MB ring buffer | Handles truncated output cleanly; provides manual tool cancel | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.1 & `ORIGINAL_REQUEST.md` R4 |
| 13 | Control Plane | `AgentMailboxViewer` | Cross-agent message timeline with 5-component handoff rendering and artifact links | Inbound/outbound message frames | Structured cards with Markdown, handoff accordions, quick-reply | Malformed handoff text falls back to standard Markdown | `PRD_MULTI_AGENT_ORCHESTRATION.md` §4 & `ORIGINAL_REQUEST.md` R4 |
| 14 | Control Plane | `DaemonTaskManager` | Live monitor for background daemons and cron schedules with interactive STDIN | Active tasks and cron timers from host session | Interactive table with `Kill`, `Send Input`, and `View Logs` | Displays process exit codes and error logs on crash | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7 & `ORIGINAL_REQUEST.md` R4 |
| 15 | Control Plane | `SpawnSubagentModal` | Dynamic agent spawner dialog with archetypes, tool gates, and validation | Form inputs (archetype, prompt, tools, isolation, limits) | Dispatches `invoke_subagent` WebSocket frame | Disables spawn and warns if max depth (3) or concurrency (8) exceeded | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 & `ORIGINAL_REQUEST.md` R4 |
| 16 | Host Engine | Reactive Wakeup Multiplexer | Wakes suspended `IDLE` agents on mailbox, task, or timer events without polling | Inbound event frames (`subagent.message`, `task.state`, `schedule.triggered`) | Dispatches prompt turns to LLM execution loop | Drops duplicate wakeups; synthesizes fallback wakeup on sender termination | `PRD_MULTI_AGENT_ORCHESTRATION.md` §4.1 & `ORIGINAL_REQUEST.md` R1 |
| 17 | Host Engine | Failure Escalation Ladder | 5-step autonomous recovery (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`) | Tool failure, context saturation (>85%), policy denial | Autonomous recovery action or user UI prompt | Degrades to user gate if all autonomous rungs exhausted | `PRD_MULTI_AGENT_ORCHESTRATION.md` §6.1 |
| 18 | Host Engine | SQLite Audit Database | Tamper-proof recording of all subagent runs, messages, and tool invocations in `audit.db` | Subagent events, messages, tool executions | Persistent SQLite audit records | Handles concurrent SQLite writes safely with WAL mode | `PRD_MULTI_AGENT_ORCHESTRATION.md` §10.2 |

---

## 5. Edge Cases & Resilience Matrix

### Edge Cases Discovered & Behavior

| # | Feature | Input / Condition | Observed / Required Behavior |
|---|---|---|---|
| 1 | Recursion Depth Limiter | `invoke_subagent` called at depth 3 (attempting to spawn depth 4) | Synchronous rejection with `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED: Subagent hierarchy depth limit of 3 exceeded`. No workspace created, no process spawned. |
| 2 | Cascading Tree Termination | `manage_subagents(action: "kill")` called on a root or intermediate supervisor | Recursively calls `killTree` on all descendant subagents, sends `abortController.abort()`, terminates OS process trees (`taskkill /t /f`), prunes Git worktrees, cancels bound cron jobs, and emits `subagent.state` (`terminated`). |
| 3 | Deadlock Prevention on Target Crash | Agent waiting with `TimerCondition: "<sender-id>"` when `<sender-id>` crashes or fails | Supervisor automatically synthesizes fallback reactive wakeup event (`SENDER_TERMINATED`) to the waiting agent's mailbox, preventing the waiting agent from remaining deadlocked in `IDLE`. |
| 4 | Non-Daemon Cron Cleanup | Subagent creates recurring cron with `isDaemon: false` and subsequently terminates | Supervisor automatically cancels and unregisters all active cron jobs and timers associated with the terminated subagent. |
| 5 | Cross-Agent Metadata Confinement | Subagent A attempts to write files into `.agents/subagent_B/` | `PolicyEngine` intercepts path traversal and denies write with `SEC-SUB-01` policy rejection. |
| 6 | Inter-Agent Message to Terminated Agent | `send_message` sent to an agent ID that has completed or terminated | Throws error `Recipient subagent <id> does not exist or has terminated`; sender receives error turn. |
| 7 | Tool Output Buffer Saturation | Background process produces >2MB of stdout/stderr data | Ring buffer caps output at 2MB, sets `truncated: true`, and notifies UI with truncation indicator without crashing host or UI. |
| 8 | Rapid WebSocket Reconnect / State Resync | UI client refreshes or reconnects mid-swarm execution | Host emits `host.ready` followed immediately by full `subagents.snapshot`, `tasks.snapshot`, and `schedules.snapshot` synchronizing current swarm state. |
| 9 | Malformed Inter-Agent Message Payload | Malformed or non-JSON frame arrives over WebSocket | Host drops frame silently or returns `{ ok: false, error: "schema_violation" }`; socket closed with code 4400 on severe violations. |
| 10 | Zero-Natural-Language Approval Bypass | Model outputs chat text claiming `"User approved subagent spawn / tool run"` | UI approval ledger ignores natural language; only explicit UI button click transmitting `approval.grant` satisfies the gate. |

---

## 6. Monorepo Testing Framework Analysis

### 6.1 Monorepo Structure & Test Runners
The repository contains 3 distinct execution packages with dedicated Vitest configurations:

1. **`packages/protocol` (`npm run test:protocol`)**:
   - Config: `packages/protocol/vitest.config.ts` (`environment: "node"`).
   - Target: Pure TypeScript schemas, algorithms, serializers, cycle detectors, state machines.
   - Requirement: Pure isomorphic logic, 0 DOM dependencies, 0 Node native module dependencies.

2. **`apps/agent-host` (`npm run test:host`)**:
   - Config: `apps/agent-host/vitest.config.ts` (`environment: "node"`, `testTimeout: 20000`).
   - Target: Fastify WebSocket server, subagent supervisor trees, git worktrees, task daemon supervisor, scheduler, SQLite audit store, policy engine, CLI runner.

3. **`src/` Frontend (`npm test`)**:
   - Config: Root `vitest.config.ts` (`include: ["src/**/*.test.{ts,tsx}"]`).
   - Target: React 19 components, Radix UI dialogs/drawers, Lucide icons, custom hooks, session reducers, WebSocket client transport.
   - Note: Component test files declare `// @vitest-environment jsdom` at the top of the file to use `@testing-library/react` and `user-event`.

4. **Production Build & Typechecking**:
   - `npm run build`: Executes `tsc -b && vite build`.
   - `npm run typecheck:protocol`: `tsc -p packages/protocol/tsconfig.json`.
   - `npm run typecheck:host`: `tsc -p apps/agent-host/tsconfig.json`.

---

## 7. Comprehensive Test Suite Matrix (100% Target Coverage)

To achieve 100% test pass rate across all tiers and maintain the certified quality standard of NanoForge, the test suite matrix is structured across 5 tiers:

### Tier 1: Protocol Test Suite (`packages/protocol`) — `npm run test:protocol`

| Test File | Test Cases & Focus Areas | Target Assertions |
|---|---|---|
| `packages/protocol/src/subagents.test.ts` | Zod schema validation for `invokeSubagentParamsSchema`, `manageSubagentsParamsSchema`, `sendMessageParamsSchema`, `subagentSummarySchema`, `agentMessageFrameSchema`, `subagentWireEventSchema`. | Validates required fields, defaults, UUID formats, archetype enum checks, and wire event discriminated unions. |
| `packages/protocol/src/tasks.test.ts` | Zod schema validation for `scheduleParamsSchema`, `manageTaskParamsSchema`, `taskIdSchema`, `taskStatusSchema`, `scheduleConditionSchema`. | Enforces mutually exclusive `durationSeconds` vs `cronExpression` refinement rule. |
| `packages/protocol/src/subagents.adversarial.test.ts` | Negative and boundary tests: prompt injection in subagent prompt, invalid UUIDs, depth overflow payloads, malformed JSON frames, cyclic dependency graphs. | Rejects malformed payloads with descriptive Zod errors. |

### Tier 2: Agent Host & Daemon Test Suite (`apps/agent-host`) — `npm run test:host`

| Test File | Test Cases & Focus Areas | Target Assertions |
|---|---|---|
| `apps/agent-host/src/agents/supervisor.test.ts` | Subagent spawning, depth calculation, metadata directory initialization (`BRIEFING.md`, `progress.md`), status lifecycle transitions. | Confirms spawn at depth 1, 2, 3; confirms rejection at depth > 3 (`SEC-SUB-05`). |
| `apps/agent-host/src/agents/mailbox.test.ts` | Inter-agent message passing (`send_message`), mailbox queueing, reactive wakeup dispatch. | Verifies message delivery, reactive wakeup without sleep polling, and rejection when recipient terminated. |
| `apps/agent-host/src/agents/treeKill.test.ts` | Cascading supervisor termination (`killTree`). | Verifies root kill terminates all descendant subagents, releases worktrees, cancels bound cron jobs, and triggers fallback wakeup on waiting agents. |
| `apps/agent-host/src/daemons/taskSupervisor.test.ts` | Background daemon lifecycle (`isDaemon: true`), PID tracking, interactive STDIN forwarding (`send_input`), process termination (`kill`). | Confirms process spawn, STDIN echo, 2MB ring buffer retention, and clean teardown. |
| `apps/agent-host/src/daemons/scheduler.test.ts` | One-shot timers (`DurationSeconds`) with conditions (`never`, `any`, `<sender-id>`) and recurring cron schedules (`CronExpression`). | Verifies accurate trigger firing, early cancel on condition match, and cancellation via `manage_task`. |
| `apps/agent-host/src/policy/workspaceIsolation.test.ts` | Workspace sandboxing modes (`inherit`, `branch` with worktrees, `share`) and path confinement. | Verifies writes confined to `.agents/<id>`, worktree creation/pruning, and rejection of path traversal (`../../`). |
| `apps/agent-host/src/audit/subagentAudit.test.ts` | Tamper-proof SQLite audit logging of subagent runs, messages, and tool executions. | Verifies database insertion and query retrieval from `audit.db`. |
| `apps/agent-host/src/routes/subagents.test.ts` | Fastify WebSocket integration for subagent events (`subagent.spawned`, `subagent.state`, `subagent.message`). | Validates end-to-end WebSocket frame broadcasting to connected clients. |

### Tier 3: Frontend & UI Component Test Suite (`src/`) — `npm test`

| Test File | Test Cases & Focus Areas | Target Assertions |
|---|---|---|
| `src/sections/__tests__/SubagentsPanel.test.tsx` | Main container mounting, tab switching (`Swarm Tree`, `Tool Activity`, `Messages`, `Daemons`), summary metric counters, empty state fallback. | Verifies tab rendering, metric accuracy, and responsiveness. |
| `src/sections/__tests__/AgentSwarmTreeView.test.tsx` | Hierarchical tree node rendering, branch connectors, status badges for all 7 states, heartbeat liveness indicators, interactive `Kill` / `Inspect` buttons. | Confirms tree hierarchy, status styling, and callback triggers. |
| `src/sections/__tests__/AgentToolInspector.test.tsx` | Tool run list, parameter JSON viewer, live streaming output console, truncation badge, manual tool stop button. | Verifies argument display, streaming text updates, and cancel dispatch. |
| `src/sections/__tests__/AgentMailboxViewer.test.tsx` | Message timeline, sender $\to$ recipient flow pills, Markdown rendering, 5-component handoff accordion expansion, artifact links, quick-reply composer. | Verifies message list rendering, handoff parsing, and reply submission. |
| `src/sections/__tests__/DaemonTaskManager.test.tsx` | Background daemon table, interactive STDIN input submission, `Kill` button, one-shot timer countdown, cron schedule list, schedule cancellation. | Verifies interactive controls, task status badges, and cancel triggers. |
| `src/sections/__tests__/SpawnSubagentModal.test.tsx` | Modal form inputs, archetype selection, isolation mode selection, tool permission checkboxes, pre-flight validation (depth limit warning, required prompt). | Confirms form validation, submission callback with correct payload, and depth block. |
| `src/lib/__tests__/hostSession.subagents.test.ts` | `useHostSession` hook state updates on inbound subagent, task, and schedule WebSocket frames. | Verifies state accumulation, agent selection, and reactive mutation methods. |

---

## 8. Build Verification & Quality Assurance Gate

To certify complete success:
1. **`npm run test:protocol`**: All protocol schema and algorithm unit tests pass (100%).
2. **`npm run test:host`**: All host supervisor, mailbox, worktree, task daemon, and scheduler tests pass (100%).
3. **`npm test`**: All frontend component and integration tests pass (100%).
4. **`npm run typecheck:protocol` & `npm run typecheck:host`**: Zero TypeScript diagnostic errors.
5. **`npm run build`**: `tsc -b && vite build` completes with 0 errors and creates clean production bundles.
6. **Documentation & Handoff**: Deliver exhaustive `report.md` and standard 5-component `handoff.md`.

---
*End of Specification Report: NanoForge Phase 4 & Phase 5 Visual Control Plane & E2E Testing*

# NanoForge Phase 4 & Phase 5: Protocol & Agent Host Technical Specification

**Document Version:** 1.0.0  
**Target Subsystems:** `packages/protocol/src/subagents.ts`, `apps/agent-host/src/agents/`, `apps/agent-host/src/policy/`, `apps/agent-host/src/daemons/`  
**Status:** Approved Technical Specification  
**Integrity Mode:** Development  
**Target Repository:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`  

---

## 1. Executive Summary & Architecture Overview

NanoForge Phase 4 and Phase 5 deliver an enterprise-grade, actor-model multi-agent orchestration platform, background daemon supervisor, workspace sandboxing engine, and reactive scheduler.

The system replaces single-threaded LLM execution with:
1. **Hierarchical Supervision Trees**: Dynamic parent-child agent topologies with Erlang/OTP-inspired restart strategies (`one_for_one`, `one_for_all`, `rest_for_one`), cascading aborts, and recursion depth caps.
2. **Actor-Model Mailbox Protocol**: Asynchronous, strongly-typed message passing (`send_message`) with zero-token, zero-CPU reactive wakeups that eliminate polling loops.
3. **Multi-Workspace Sandboxing**: Fine-grained workspace isolation modes (`inherit`, `branch` with isolated Git worktrees, and `share` with ephemeral scratch overlays) enforcing strict `.agents/<subagentId>/` path confinement.
4. **Resilient Failure Escalation Ladder**: Deterministic 5-rung recovery protocol (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`).
5. **Background Daemon Supervisor & Reactive Scheduler**: Supervised background processes (`isDaemon: true`), 5-field cron parser, and conditional one-shot liveness timers (`schedule`) controlled via interactive primitives (`manage_task`).

```
+---------------------------------------------------------------------------------------------------+
|                                  NANOGORGE SYSTEM TOPOLOGY                                        |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|   [ Web Control Plane / React UI ]  <-------- WebSocket / Wire Protocol --------> [ Agent Host ]  |
|                                                                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   |                              APPS / AGENT-HOST SUBSYSTEMS                                 |   |
|   |                                                                                           |   |
|   |   +-----------------------------+                 +-----------------------------------+   |   |
|   |   |   Subagent Supervisor Tree  |                 |     Daemon & Timer Scheduler      |   |   |
|   |   |  - SubagentRegistry         |                 |  - DaemonSupervisor (isDaemon)    |   |   |
|   |   |  - Execution Coordinator    |                 |  - CronParser & One-Shot Timers   |   |   |
|   |   |  - Mailbox Message Bus      |                 |  - RingBuffer Log Captures (2MB)  |   |   |
|   |   |  - Reactive Wakeup Engine   |                 |  - Interactive STDIN Multiplexer  |   |   |
|   |   +--------------+--------------+                 +-----------------+-----------------+   |   |
|   |                  |                                                  |                         |   |
|   |                  v                                                  v                         |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   |                      Policy & Workspace Sandboxing Engine                         |   |   |
|   |   |  - Workspace Isolation Modes: inherit | branch (git worktree) | share (scratch)   |   |   |
|   |   |  - Path Confinement: Strict `.agents/<subagentId>/` isolation                     |   |   |
|   |   |  - Anti-Traversal: Canonicalization, Symlink Escape Prevention, No `..` breakouts |   |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Module 1: `packages/protocol/src/subagents.ts` Specification

This module defines the isomorphic, runtime-independent Zod schemas and TypeScript interfaces for subagent definitions, execution states, mailbox messages, lifecycle events, and LLM tool parameters. It must have **zero Node.js dependencies** (`fs`, `child_process`, `net`) to allow direct browser and server consumption.

### 2.1 Identifiers, Enums, and State Machine

#### Subagent States
The subagent lifecycle enforces 7 canonical runtime states:

```typescript
export const subagentStateSchema = z.enum([
  "running",                 // Actively executing LLM turns or tool processes
  "idle",                    // Execution suspended awaiting inbound events (0 CPU/token cost)
  "waiting_for_input",       // Blocked on interactive user input or approval gate
  "waiting_for_dependents",  // Suspended awaiting completion/results from child subagents
  "waiting_for_message",     // Suspended awaiting an incoming message from a designated sender
  "canceling",               // Graceful abort initiated; cleaning up resources and worktrees
  "errored",                 // Unrecoverable runtime exception, syntax error, or crash
]);
export type SubagentState = z.infer<typeof subagentStateSchema>;
```

#### Archetypes & Workspace Isolation Modes
```typescript
export const subagentArchetypeSchema = z.enum([
  "explorer",    // Read-only reconnaissance, dependency mapping, code analysis
  "implementer", // Code modifications, refactoring, feature implementation
  "qa",          // Bug reproduction, test generation, lint/regression repair
  "specialist",  // Domain-specific skills (Science, Android, DB, Security)
  "verifier",    // Independent audit, assertion verification, visual inspection
  "planner",     // High-level DAG decomposition, scheduling, dependency analysis
  "custom",      // User-defined or dynamically registered agent configurations
]);
export type SubagentArchetype = z.infer<typeof subagentArchetypeSchema>;

export const workspaceIsolationModeSchema = z.enum([
  "inherit",     // Shared workspaceRoot; isolated .agents/<id>/ metadata
  "branch",      // Isolated Git worktree (.agents/worktrees/<id>/ on nano/<id> branch)
  "share",       // Read-only workspace root + ephemeral scratch directory
]);
export type WorkspaceIsolationMode = z.infer<typeof workspaceIsolationModeSchema>;

export const supervisorStrategySchema = z.enum([
  "one_for_one", // If a child fails, restart only that child
  "one_for_all", // If a child fails, terminate and restart all sibling children
  "rest_for_one",// If a child fails, terminate and restart children spawned after it
]);
export type SupervisorStrategy = z.infer<typeof supervisorStrategySchema>;
```

### 2.2 Core Data Structures

#### `SubagentConfig` / `SubagentDefinition`
Represents the declarative configuration used to spawn or register a subagent:
```typescript
export const subagentConfigSchema = z.object({
  name: z.string().min(1).max(64),
  archetype: subagentArchetypeSchema,
  roles: z.array(z.string().min(1)).default([]),
  systemPrompt: z.string().max(65536).optional(),
  model: z.string().max(128).optional(),
  workspaceIsolation: workspaceIsolationModeSchema.default("inherit"),
  allowedTools: z.array(z.string().min(1)).optional(),
  allowedToolKinds: z.array(z.string().min(1)).optional(),
  timeoutSeconds: z.number().int().positive().max(7200).default(600),
  budgetTokens: z.number().int().positive().optional(),
  skills: z.array(z.string().min(1)).default([]),
  environmentVariables: z.record(z.string(), z.string()).optional(),
});
export type SubagentConfig = z.infer<typeof subagentConfigSchema>;
```

#### `SubagentInfo` / `SubagentSummary`
Represents the live runtime state and telemetry of a subagent:
```typescript
export const subagentInfoSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  archetype: subagentArchetypeSchema,
  roles: z.array(z.string()),
  state: subagentStateSchema,
  workingDirectory: z.string(),
  worktreePath: z.string().optional(),
  isolationMode: workspaceIsolationModeSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  lastHeartbeat: z.string().datetime(),
  tokensUsed: z.number().int().nonnegative().default(0),
  turnCount: z.number().int().nonnegative().default(0),
  lastProgressSummary: z.string().optional(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
});
export type SubagentInfo = z.infer<typeof subagentInfoSchema>;
```

#### `SubagentMessage`
Represents an inter-agent mailbox message frame:
```typescript
export const subagentMessageSchema = z.object({
  messageId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string().optional(),
  recipientId: z.string().uuid(),
  timestamp: z.string().datetime(),
  subject: z.string().min(1).max(256),
  body: z.string().min(1).max(65536),
  referencedArtifacts: z.array(z.string()).default([]),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  correlationId: z.string().uuid().optional(),
});
export type SubagentMessage = z.infer<typeof subagentMessageSchema>;
```

#### `SubagentLifecycleEvent`
Wire protocol frames dispatched to WebSocket clients and audit logs:
```typescript
export const subagentLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subagent.spawned"),
    subagent: subagentInfoSchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.state_changed"),
    subagentId: z.string().uuid(),
    previousState: subagentStateSchema,
    newState: subagentStateSchema,
    reason: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.message_sent"),
    message: subagentMessageSchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.heartbeat"),
    subagentId: z.string().uuid(),
    lastVisited: z.string().datetime(),
    progressSummary: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.completed"),
    subagentId: z.string().uuid(),
    tokensUsed: z.number().int().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    handoffArtifact: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.errored"),
    subagentId: z.string().uuid(),
    error: z.string(),
    code: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.tree_updated"),
    rootId: z.string().uuid(),
    activeCount: z.number().int().nonnegative(),
    tree: z.array(subagentInfoSchema),
    at: z.string().datetime(),
  }),
]);
export type SubagentLifecycleEvent = z.infer<typeof subagentLifecycleEventSchema>;
```

### 2.3 LLM Tool Parameter and Result Schemas

#### 1. `invoke_subagent`
Spawns a child agent under the calling agent's supervision:
```typescript
export const invokeSubagentParamsSchema = z.object({
  archetype: subagentArchetypeSchema,
  name: z.string().min(1).max(64).optional(),
  roles: z.array(z.string().min(1)).default([]),
  prompt: z.string().min(1).max(32768),
  workspaceIsolation: workspaceIsolationModeSchema.default("inherit"),
  allowedTools: z.array(z.string()).optional(),
  allowedToolKinds: z.array(z.string()).optional(),
  timeoutSeconds: z.number().int().positive().max(7200).default(600),
  budgetTokens: z.number().int().positive().optional(),
  skills: z.array(z.string()).default([]),
  model: z.string().optional(),
});
export type InvokeSubagentParams = z.infer<typeof invokeSubagentParamsSchema>;

export const invokeSubagentResultSchema = z.object({
  subagentId: z.string().uuid(),
  name: z.string(),
  archetype: subagentArchetypeSchema,
  workingDirectory: z.string(),
  state: subagentStateSchema,
  startedAt: z.string().datetime(),
});
export type InvokeSubagentResult = z.infer<typeof invokeSubagentResultSchema>;
```

#### 2. `manage_subagents`
Supervises, queries, pauses, resumes, inspects, or terminates child agents:
```typescript
export const manageSubagentsActionSchema = z.enum([
  "list",     // List all child subagents with status, uptime, tokens
  "status",   // Fetch detailed status and telemetry for subagentId
  "kill",     // Abort subagent and all its descendants cleanly
  "pause",    // Suspend turn scheduling for subagentId
  "resume",   // Resume turn scheduling for subagentId
  "inspect",  // Verbatim read of BRIEFING.md, progress.md, handoff.md, DISPATCH.md
]);
export type ManageSubagentsAction = z.infer<typeof manageSubagentsActionSchema>;

export const manageSubagentsParamsSchema = z.object({
  action: manageSubagentsActionSchema,
  subagentId: z.string().uuid().optional(),
  inspectFile: z.enum([
    "progress.md",
    "BRIEFING.md",
    "handoff.md",
    "DISPATCH.md",
    "analysis.md",
  ]).optional(),
  recursive: z.boolean().default(false),
});
export type ManageSubagentsParams = z.infer<typeof manageSubagentsParamsSchema>;

export const manageSubagentsResultSchema = z.object({
  action: manageSubagentsActionSchema,
  subagents: z.array(subagentInfoSchema).optional(),
  detail: subagentInfoSchema.optional(),
  inspectedContent: z.string().optional(),
  success: z.boolean(),
  message: z.string().optional(),
});
export type ManageSubagentsResult = z.infer<typeof manageSubagentsResultSchema>;
```

#### 3. `send_message`
Dispatches an inter-agent mailbox message and triggers a reactive wakeup:
```typescript
export const sendMessageParamsSchema = z.object({
  recipientId: z.string().uuid(),
  subject: z.string().min(1).max(256),
  body: z.string().min(1).max(65536),
  referencedArtifacts: z.array(z.string()).default([]),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
});
export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;

export const sendMessageResultSchema = z.object({
  messageId: z.string().uuid(),
  deliveryTimestamp: z.string().datetime(),
  recipientStatus: subagentStateSchema,
  delivered: z.boolean(),
});
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;
```

#### 4. `define_subagent`
Dynamically defines and registers a custom subagent template:
```typescript
export const defineSubagentParamsSchema = z.object({
  name: z.string().min(1).max(64),
  archetype: subagentArchetypeSchema.default("custom"),
  description: z.string().min(1).max(1024),
  systemPromptTemplate: z.string().min(1).max(32768),
  defaultRoles: z.array(z.string()).default([]),
  defaultAllowedTools: z.array(z.string()).optional(),
  defaultIsolation: workspaceIsolationModeSchema.default("inherit"),
  defaultBudgetTokens: z.number().int().positive().optional(),
  defaultTimeoutSeconds: z.number().int().positive().default(600),
  skills: z.array(z.string()).default([]),
});
export type DefineSubagentParams = z.infer<typeof defineSubagentParamsSchema>;

export const defineSubagentResultSchema = z.object({
  definitionId: z.string().uuid(),
  name: z.string(),
  archetype: subagentArchetypeSchema,
  registered: z.boolean(),
});
export type DefineSubagentResult = z.infer<typeof defineSubagentResultSchema>;
```

---

## 3. Module 2: `apps/agent-host/src/agents/` Specification

The agent host module provides server-side execution orchestration, supervisor trees, message routing, and zero-polling reactive scheduling.

### 3.1 Architecture Components

```
apps/agent-host/src/agents/
├── registry.ts         # SubagentRegistry: In-memory & persisted state index
├── coordinator.ts      # SubagentCoordinator: Turn loop, token budget meter, prompt setup
├── mailbox.ts          # SubagentMailbox: Actor FIFO queues, priority routing, audit ledger
├── wakeup.ts           # ReactiveWakeupEngine: Event-driven resume triggers (no polling)
├── hierarchy.ts        # HierarchyManager: Depth validation, parent/child trees, cascading kill
└── supervisor.ts       # SubagentSupervisor: Top-level coordinator uniting all components
```

### 3.2 Subagent Registry (`registry.ts`)
- **State Map**: `Map<SubagentId, SubagentNode>` storing node state, abort controller, token counters, mailbox queue, and working directories.
- **Index Sets**:
  - `parentToChildren: Map<SubagentId, Set<SubagentId>>` for instantaneous tree traversals.
  - `archetypeIndex: Map<SubagentArchetype, Set<SubagentId>>` for fleet metrics.
  - `templateRegistry: Map<string, DefineSubagentParams>` for dynamic subagent definitions.
- **Heartbeat & Liveness Tracker**:
  - Automatically sweeps nodes every 15 seconds.
  - Marks nodes `stalled` if `state === "running"` and `now - lastHeartbeat > heartbeatTimeoutMs` (default 180s) without active subprocess IO.

### 3.3 Subagent Execution Coordinator (`coordinator.ts`)
- **Lifecycle Bootstrap**:
  1. Creates metadata directory `.agents/<archetype>_<id>/`.
  2. Synthesizes and writes initial `BRIEFING.md`, `progress.md`, and `DISPATCH.md`.
  3. Prepares scoped `Policy` instance with restricted `workspaceRoot` and authorized tools.
  4. Configures child `RunCoordinator` with dedicated token meter.
- **Token Budget Invariant (`SEC-SUB-04`)**:
  - Tracks total tokens used across turns (`tokensUsed = inputTokens + outputTokens`).
  - If `budgetTokens` is exceeded:
    - Suspends current turn immediately.
    - Emits `subagent.state_changed` with `state: "errored"` and reason: `"Budget tokens exceeded"`.
    - Triggers Failure Escalation Ladder (Rung 2: `Replace`).

### 3.4 Mailbox & Message Routing (`mailbox.ts`)
- **Actor-Model Semantics**:
  - Each subagent has an independent mailbox FIFO queue with priority sorting (`high` > `normal` > `low`).
  - High-priority frames (e.g. `kill`, `abort`, `budget_warning`) jump to the head of the queue.
- **Authorization Invariant (`SEC-SUB-03`)**:
  - Sender may only message:
    1. Its direct parent (`recipientId === parentId`).
    2. Any of its direct children (`recipient.parentId === senderId`).
    3. Any sibling sharing the same parent (`recipient.parentId === sender.parentId`).
  - Messages crossing unauthorized boundaries are rejected with `ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT`.

### 3.5 Reactive Wakeup Engine (`wakeup.ts`)
**Zero-Polling Invariant**: Agents never enter busy-wait loops or CPU sleep loops.

```
                    REACTIVE WAKEUP STATE TRANSITIONS
+-------------------------------------------------------------------------------+
| State: RUNNING                                                                |
| - Turn finishes with no pending tool proposals                                |
|   ===> Transitions to IDLE (or WAITING_FOR_MESSAGE / WAITING_FOR_DEPENDENTS)  |
| - Process context frozen in memory/SQLite. Zero token burn.                   |
+---------------------------------------+---------------------------------------+
                                        |
                 Event Arrives on Bus   |
                 - Inbound Message      |
                 - Child State Change   |
                 - Background Task Done |
                 - Timer Trigger        |
                                        v
+-------------------------------------------------------------------------------+
| Event Multiplexer Thaws Agent Context                                         |
| - Formats structured <system_notification> block into transcript history      |
| - Transitions State: IDLE ===> RUNNING                                        |
| - Triggers next LLM turn immediately (< 50ms latency)                         |
+-------------------------------------------------------------------------------+
```

#### Structured Wakeup Notification Block:
```markdown
<system_notification>
## Reactive Wakeup Trigger: [MESSAGE_RECEIVED | CHILD_COMPLETED | TASK_COMPLETED | TIMER_EXPIRED]
- **Source**: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d (Implementer_1)
- **Timestamp**: 2026-08-15T07:15:30.100Z
- **Payload Summary**: Succeeded step: "Update fastify routes" with 100% test pass.
- **Attached Artifact**: c:/.../.agents/implementer_1/handoff.md
</system_notification>
```

### 3.6 Hierarchy Management & Cascading Abort (`hierarchy.ts`)
- **Recursion Depth Limit (`SEC-SUB-05`)**: Max tree depth is hard-capped at 3 levels (`Root` $\to$ `Level 1` $\to$ `Level 2`). Attempting to spawn at Depth 4 throws `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED`.
- **Concurrency Limit**: Maximum concurrent active subagents capped at 8.
- **Cascading Termination (`killTree`)**:
  - Recursively traverses the subagent subtree post-order.
  - Aborts child `AbortController` instances.
  - Terminates OS process trees via `taskkill /t /f` (Windows) or `process.kill(-pid, "SIGKILL")` (POSIX).
  - Prunes Git worktrees via `git worktree remove --force`.
  - Cancels all subagent-bound timers and daemons (`isDaemon: false`).
  - Synthesizes fallback wakeups (`SENDER_TERMINATED`) to any waiting parents or peers.

### 3.7 Resilient Failure Escalation Ladder

| Rung | Trigger Condition | Autonomous Action | Fallback Condition |
|---|---|---|---|
| **1. Retry** | Transient tool error, syntax error, exit code $\neq 0$ | Feed error diagnostic back into prompt context (max 3 attempts). | If 3 attempts fail $\to$ Escalate to Rung 2. |
| **2. Replace** | Context window $> 85\%$ full, repeated stall, or budget limit | Request partial `handoff.md`, terminate stalled agent, spawn clean clone with handoff context. | If replacement fails $\to$ Escalate to Rung 3. |
| **3. Skip** | Non-critical step failure (lint, cosmetic check) | Mark step `skipped`, log warning in audit ledger, unlock DAG dependents. | If step is critical/blocking $\to$ Escalate to Rung 4. |
| **4. Redistribute**| Task complexity exceeds single archetype | Supervisor splits task into smaller chunks and spawns multiple specialized agents (e.g. Explorer + Implementer). | If split fails $\to$ Escalate to Rung 5. |
| **5. Degrade** | Fatal policy rejection, unresolvable build blocker | Pause DAG execution, freeze state, generate interactive UI prompt for manual user intervention. | N/A (Halted safely). |

---

## 4. Module 3: `apps/agent-host/src/policy/` (Workspace Sandboxing & Confinement)

This module enforces strict path confinement, filesystem isolation, and execution permissions across subagent archetypes and isolation modes.

### 4.1 Workspace Isolation Modes

```
+---------------------------------------------------------------------------------------------------+
|                                 WORKSPACE ISOLATION ARCHITECTURES                                 |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  1. INHERIT MODE (Sequential / Read-Only):                                                        |
|     Root Workspace: /repo                                                                         |
|       ├── src/                                                                                    |
|       └── .agents/                                                                                |
|             ├── orchestrator/   (Isolated metadata: BRIEFING.md, progress.md)                     |
|             └── explorer_4a9b/  (Isolated metadata: BRIEFING.md, progress.md, analysis.md)        |
|                                                                                                   |
|  2. BRANCH MODE (Concurrent Feature Development):                                                 |
|     Root Workspace: /repo (main)                                                                  |
|       └── .agents/worktrees/                                                                      |
|             ├── imp_1/  --> Linked Git Worktree on branch "nano/imp-1"                            |
|             └── qa_1/   --> Linked Git Worktree on branch "nano/qa-1"                             |
|     * Modifications are completely invisible to root workspace until merged.                      |
|                                                                                                   |
|  3. SHARE MODE (Verification & Scratch Testing):                                                  |
|     Root Workspace: /repo (Mounted READ-ONLY)                                                     |
|     Scratch Overlay: .agents/scratch_<id>/ (Mounted READ-WRITE for temp build artifacts & patch)  |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

### 4.2 Strict Path Confinement Invariants

```typescript
export interface ConfinementPolicy {
  subagentId: string;
  workspaceRoot: string;
  metadataDir: string;        // .agents/<name>_<id>/
  effectiveWorkspaceRoot: string; // workspaceRoot or worktreePath
  isolationMode: WorkspaceIsolationMode;
  allowedWriteScopes: string[];   // Explicit directories/files allowed for writes
  allowSourceTreeWrites: boolean;
}
```

#### Confinement Invariants:
1. **Metadata Isolation (`SEC-SUB-01`)**: A subagent may write metadata (`BRIEFING.md`, `progress.md`, `handoff.md`, `analysis.md`, `DISPATCH.md`) ONLY into its assigned `metadataDir` (`.agents/<name>_<id>/`). Any write to `.agents/<otherAgentId>/` or `.agents/` root is rejected with `"deny"`.
2. **Directory Traversal Prevention**:
   - `../` sequences that resolve outside `effectiveWorkspaceRoot` return `isWithinWorkspace === false`.
   - Symlinks are fully resolved via `fs.realpathSync` to ensure they do not point outside the sandbox.
   - Cross-platform case-insensitive comparisons on Windows (`process.platform === "win32"`).
3. **Source Tree Modification Gating**:
   - In `inherit` mode: `explorer`, `verifier`, `planner` archetypes have `allowSourceTreeWrites: false` (read-only). Writes are unconditionally denied.
   - `implementer` and `qa` archetypes may only write to paths matching `allowedWriteScopes`.
   - In `branch` mode: Writes are confined strictly to the allocated `worktreePath`.
   - In `share` mode: Writes to source tree are denied; writes to `scratchDir` are allowed.

---

## 5. Module 4: `apps/agent-host/src/daemons/` (Daemons & Scheduler)

This module supervises detached, long-running processes (dev servers, file watchers, compilation tasks) and provides high-precision cron and one-shot timer scheduling.

### 5.1 Architecture Components

```
apps/agent-host/src/daemons/
├── supervisor.ts       # DaemonSupervisor: Process lifecycle, PIDs, ring buffers, streaming
├── scheduler.ts        # Scheduler: 5-field cron parser, one-shot timers, conditional cancel
├── manager.ts          # Interactive manage_task controller (list, kill, status, send_input)
└── types.ts            # Data contracts, Zod schemas, and ring buffer configs
```

### 5.2 Background Daemon Supervisor (`supervisor.ts`)

#### Process Lifecycle & Output Ring Buffers:
- **Spawning**: Spawns detached processes with `isDaemon: true` using structured arguments (no shell interpolation).
- **Circular Ring Buffer**:
  - Allocates a dedicated 2MB in-memory circular ring buffer per daemon task.
  - Retains the most recent $N$ KB of standard output and error without unbounded memory growth.
- **Interactive STDIN**:
  - Supports `send_input` to pass strings or EOF control characters to the running process.
- **Teardown**:
  - Every daemon process is registered in a process group registry.
  - On host shutdown or session close, all active process groups are killed recursively.

### 5.3 Cron Schedule Parser & One-Shot Timer (`scheduler.ts`)

#### Tool Definition: `schedule`
```typescript
export const scheduleConditionSchema = z.union([
  z.literal("never"),          // Fires unconditionally at duration expiry
  z.literal("any"),            // Cancels early if ANY message arrives
  z.string().uuid(),           // Cancels early if a message arrives from specific senderId
]);
export type ScheduleCondition = z.infer<typeof scheduleConditionSchema>;

export const scheduleParamsSchema = z.object({
  prompt: z.string().min(1).max(4096),
  durationSeconds: z.number().int().positive().optional(),
  cronExpression: z.string().min(9).max(64).optional(),
  timerCondition: scheduleConditionSchema.default("never"),
  maxIterations: z.number().int().positive().optional(),
  isDaemon: z.boolean().default(false),
}).refine(
  (data) => (data.durationSeconds !== undefined) !== (data.cronExpression !== undefined),
  { message: "Must specify exactly one of durationSeconds or cronExpression" }
);
export type ScheduleParams = z.infer<typeof scheduleParamsSchema>;
```

#### 5-Field Cron Parser Rules:
- Supports standard cron format: `[minute] [hour] [day-of-month] [month] [day-of-week]`
  - Asterisk: `*` (every value)
  - Step values: `*/5` (every 5 units)
  - Ranges: `1-5`
  - Lists: `1,3,5`
- Bounds:
  - `minute`: `0-59`
  - `hour`: `0-23`
  - `day-of-month`: `1-31`
  - `month`: `1-12` (or `0-11` mapped)
  - `day-of-week`: `0-6` (`0` = Sunday)
- Lifecycle binding:
  - When `isDaemon: false`, cron jobs and timers are tied to the creating agent and auto-cancelled when that agent completes or terminates.
  - When `isDaemon: true`, cron jobs persist across agent turns.

### 5.4 Interactive Daemon Management (`manager.ts`)

#### Tool Definition: `manage_task`
```typescript
export const manageTaskParamsSchema = z.object({
  action: z.enum(["list", "kill", "status", "send_input"]),
  taskId: z.string().uuid().optional(),
  input: z.string().optional(),
});
export type ManageTaskParams = z.infer<typeof manageTaskParamsSchema>;

export const taskSummarySchema = z.object({
  taskId: z.string().uuid(),
  pid: z.number().int().positive(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  isDaemon: z.boolean(),
  status: z.enum(["running", "completed", "failed", "killed"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable(),
  recentLogs: z.string().optional(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const manageTaskResultSchema = z.object({
  action: z.enum(["list", "kill", "status", "send_input"]),
  tasks: z.array(taskSummarySchema).optional(),
  task: taskSummarySchema.optional(),
  success: z.boolean(),
  message: z.string().optional(),
});
export type ManageTaskResult = z.infer<typeof manageTaskResultSchema>;
```

---

## 6. Discovered Features & Complete Feature Inventory

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Subagents | `invoke_subagent` | Spawns a supervised child agent with isolated workspace | `InvokeSubagentParams` | `InvokeSubagentResult` | Max depth $> 3$ error; invalid role error | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 |
| 2 | Subagents | `manage_subagents` | Supervises, pauses, resumes, inspects, or kills child subagents | `ManageSubagentsParams` | `ManageSubagentsResult` | Unknown subagent error; inspection missing file error | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 |
| 3 | Subagents | `send_message` | Inter-agent typed mailbox message with reactive wakeup | `SendMessageParams` | `SendMessageResult` | Recipient missing / terminated error; ACL violation | `PRD_MULTI_AGENT_ORCHESTRATION.md` §2.1 |
| 4 | Subagents | `define_subagent` | Registers a reusable custom subagent template | `DefineSubagentParams` | `DefineSubagentResult` | Duplicate name / invalid schema error | `ORIGINAL_REQUEST.md` R1 |
| 5 | Subagents | `SubagentState` 7-State FSM | Enforces `running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored` | State transitions | State events | Invalid transition rejection | `ORIGINAL_REQUEST.md` R1 |
| 6 | Subagents | Supervision Trees | `one_for_one`, `one_for_all`, `rest_for_one` restart topologies | Supervisor events | Restart decisions | Cycle detection / max restart limit | `PRD_MULTI_AGENT_ORCHESTRATION.md` §3.1 |
| 7 | Subagents | Token Budget Enforcement | Tracks input/output tokens per subagent against `budgetTokens` | Token stream | Abort / Replace | Hard abort on quota breach | `PRD_MULTI_AGENT_ORCHESTRATION.md` §10.1 |
| 8 | Subagents | Zero-Polling Wakeups | Event-driven agent wakeups from mailbox, daemons, and timers | Event frame | Transcript injection | Drops malformed frames; logs warning | `PRD_MULTI_AGENT_ORCHESTRATION.md` §4.1 |
| 9 | Sandboxing | `inherit` Isolation Mode | Shared repo workspace with private `.agents/<id>/` metadata | File requests | Authorized file IO | Unauthorized source write denied | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.1 |
| 10 | Sandboxing | `branch` Worktree Mode | Isolated Git worktree `.agents/worktrees/<id>/` on dedicated branch | File requests | Worktree file IO | Worktree creation/pruning failure | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.1 |
| 11 | Sandboxing | `share` Scratch Mode | Read-only repo root with writable scratch overlay directory | File requests | Scratch file IO | Root mutation denied | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.1 |
| 12 | Sandboxing | Path Confinement | Strictly confines `.agents/` writes to own `.agents/<id>/` | Candidate path | Resolved path / Deny | Immediate policy denial on breakout | `PRD_MULTI_AGENT_ORCHESTRATION.md` §5.2 |
| 13 | Sandboxing | Traversal / Symlink Defense | Rejects `..` breakouts and resolves real filesystem targets | Normalized path | Safe path or null | Traversal blocked with `deny` | `apps/agent-host/src/policy/policy.ts` |
| 14 | Daemons | `isDaemon: true` Tasks | Manages detached long-running dev servers and compilation jobs | Command & args | `TaskId` & PID | Process spawn failure / crash | `ORIGINAL_REQUEST.md` R3 |
| 15 | Daemons | Circular Ring Buffer | Retains 2MB circular stdout/stderr stream per daemon | Process stdout/err | Retained logs | Truncation flag emitted | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.1 |
| 16 | Daemons | `manage_task` | Interactive control (`list`, `kill`, `status`, `send_input`) | `ManageTaskParams` | `ManageTaskResult` | Unknown `taskId` error; dead process IO error | `ORIGINAL_REQUEST.md` R3 |
| 17 | Scheduler | One-Shot Timers | `durationSeconds` timer with `never`, `any`, or `<senderId>` cancel | `ScheduleParams` | Timer ID & wakeup | Overlapping condition conflict error | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.2 |
| 18 | Scheduler | 5-Field Cron Parser | Evaluates standard 5-field cron strings with `maxIterations` | `CronExpression` | Cron job handle | Invalid cron syntax error | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.2 |
| 19 | Scheduler | Fallback Wakeups | Synthesizes immediate wakeup if a target sender crashes/dies | Death event | Fallback frame | Recipient already terminated (ignored) | `PRD_MULTI_AGENT_ORCHESTRATION.md` §7.2 |
| 20 | Escalation | 5-Rung Failure Ladder | `Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade` | Error diagnostics | Escalation action | Degrades to manual UI prompt | `PRD_MULTI_AGENT_ORCHESTRATION.md` §6.1 |

---

## 7. Edge Cases and Handling Matrix

| # | Feature | Edge Case Input / Scenario | Expected / Observed Behavior |
|---|---|---|---|
| 1 | `invoke_subagent` | Child attempts to spawn subagent at hierarchy depth $> 3$ | Throws `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED` and halts spawn attempt. |
| 2 | `invoke_subagent` | Parent attempts to spawn child with tools parent does not possess | Policy engine strips unauthorized tools or rejects spawn with `ERR_SUBAGENT_ESCALATION_DENIED`. |
| 3 | `send_message` | Subagent sends message to terminated or nonexistent `recipientId` | Returns `{ delivered: false }` and throws explicit `ERR_SUBAGENT_RECIPIENT_NOT_FOUND`. |
| 4 | `send_message` | Peer attempts to message an agent outside its supervision tree | Mailbox drops message with audit warning `ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT`. |
| 5 | `schedule` | Timer configured with `TimerCondition: "<senderId>"` but `<senderId>` crashes | Supervisor detects sender death and synthesizes an immediate fallback wakeup `SENDER_TERMINATED`. |
| 6 | `schedule` | Both `durationSeconds` and `cronExpression` provided simultaneously | Zod validation error: `"Must specify exactly one of durationSeconds or cronExpression"`. |
| 7 | `manage_task` | `send_input` called on a task that has already exited | Returns `{ success: false, message: "Process has already exited" }`. |
| 8 | Workspace Isolation | Subagent in `inherit` mode attempts to write `.agents/<peerId>/progress.md` | Policy engine detects path breakout and rejects write with `PolicyDecision: "deny"`. |
| 9 | Workspace Isolation | Subagent attempts Windows case manipulation (`.AGENTS/` vs `.agents/`) | Path normalizer converts Windows paths to canonical lowercase before comparison. |
| 10 | Workspace Isolation | Subagent attempts path traversal via URL encoding or `..%2F..` | Path canonicalizer decodes and resolves absolute path before confinement check. |
| 11 | Daemons | Process writes $> 100\text{MB}$ output in 10 seconds | 2MB circular ring buffer overwrites oldest chunks, sets `truncated: true`, host remains stable. |
| 12 | Supervision Trees | Root agent killed while 5 nested subagents and 3 daemons are running | `killTree` cleanly aborts all subagents, deletes worktrees, and kills OS process groups without orphans. |

---

## 8. Verification & Test Plan

To achieve 100% test coverage and ensure zero regressions across all packages:

### 8.1 Protocol Unit Tests (`packages/protocol/__tests__/subagents.test.ts`)
- **Schema Validation Tests**:
  - Validate all 7 `SubagentState` transitions.
  - Validate `SubagentConfig`, `SubagentInfo`, `SubagentMessage`, and `SubagentLifecycleEvent` Zod schemas.
  - Validate `invoke_subagent`, `manage_subagents`, `send_message`, `define_subagent`, `schedule`, and `manage_task` parameter schemas.
  - Validate cron parser against valid expressions (`*/5 * * * *`, `0 9 * * 1-5`) and invalid expressions (`invalid-cron`, `60 * * * *`).

### 8.2 Host Agent & Supervisor Tests (`apps/agent-host/__tests__/agents/`)
- **Supervisor Tree Tests (`supervisor.test.ts`)**:
  - Test spawning child subagents with `inherit`, `branch`, and `share` modes.
  - Test max depth enforcement (depth 1, 2, 3 succeed; depth 4 throws error).
  - Test cascading abort (`killTree`) ensuring all child nodes and worktrees are cleaned up.
- **Mailbox & Wakeup Tests (`mailbox.test.ts`)**:
  - Test inter-agent message passing and FIFO priority queue delivery.
  - Test reactive wakeup resumption within $< 50\text{ms}$ with zero polling loops.
  - Test fallback wakeups when target senders crash or terminate.
- **Sandboxing & Confinement Tests (`apps/agent-host/__tests__/policy/sandboxing.test.ts`)**:
  - Test write confinement to assigned `.agents/<id>/` directory.
  - Test rejection of directory traversal attempts (`../../`, symlink breakouts).
  - Test Git worktree creation and safe pruning.
- **Daemon Supervisor & Scheduler Tests (`apps/agent-host/__tests__/daemons/`)**:
  - Test background daemon spawning with `isDaemon: true` and ring buffer output retention.
  - Test interactive `manage_task` operations (`list`, `status`, `send_input`, `kill`).
  - Test one-shot timer and recurring cron schedule triggers.

---
*End of Technical Specification Report*

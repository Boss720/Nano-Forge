# Architectural Survey: Backend, Host Daemon, Protocol, CLI Runner & PTY Stream Systems

**Explorer:** `survey_explorer_1`  
**Date:** 2026-08-15  
**Target Repository:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`  
**Status:** Investigation Complete & Verified

---

## 1. Executive Summary & Investigation Scope

This report delivers a deep architectural investigation into the backend daemon, wire protocol, CLI execution runner, and terminal IPC infrastructure of NanoForge.

### Scope Evaluated:
1. **`packages/protocol/`**: Pure isomorphic types, Zod schemas, DAG validation, slash command tokenizer, multi-model routing, and artifact definitions.
2. **`apps/agent-host/`**: Fastify WebSocket daemon, single-use cryptographic token authentication, session composition, run coordinator, policy authorization engine, and supervised execution runner.
3. **CLI Runner (`bin/nanoforge.ts` & `apps/agent-host/src/cli/`)**: Headless CLI architecture, non-interactive fail-closed approval policies, NDJSON streaming over stdout, and POSIX exit code contracts.
4. **Terminal IPC & PTY Dock**: Virtual terminal session management on the host (`node-pty` / child process), stdin forwarding, resize frames (`SIGWINCH`), ANSI output streaming, and multi-tab frontend dock (`@xterm/xterm`).

---

## 2. Protocol Subsystem (`packages/protocol/`)

### 2.1 Design Principles & Zero-Node Invariant
`packages/protocol/` is an isomorphic TypeScript package compiled with `noEmit: true` and consumed by both the browser control plane (`src/`) and the agent host daemon (`apps/agent-host/`).
- **Zero-Node API Invariant**: It imports NO Node.js runtime modules (`fs`, `net`, `child_process`, `os`, `process`, `crypto`).
- **Immutable State Transitions**: All collections in `ExecutionPlan` use `readonly` arrays. Status updates generate new immutable objects.
- **Validation**: All wire payloads have matching Zod schemas and inferred TypeScript types.

### 2.2 Existing File & Schema Inventory

```
packages/protocol/src/
├── index.ts          # Public barrel export
├── plan.ts           # Plan DAG schema, 7-state lifecycle, topological resolver, cycle validation
├── commands.ts       # Slash command parser, 8 built-in definitions, POSIX tokenizer, mentions
├── routing.ts        # Multi-model routing contracts, privacy classes, scoring functions
├── artifacts.ts      # Artifact metadata schemas, MIME detection, feedback types
└── *.test.ts         # 69 unit tests across 4 suites (100% passing)
```

#### Detailed Breakdown:

1. **`plan.ts` (Execution Plans & DAG Engine)**:
   - **Step Status (`StepStatus`)**: Canonical 7-state enum:
     `"pending" | "ready" | "running" | "succeeded" | "failed" | "blocked" | "skipped"`
   - **Plan Lifecycle State (`PlanLifecycleState`)**: Canonical 6-state enum:
     `"draft" | "awaiting_approval" | "executing" | "paused" | "completed" | "failed"`
   - **Step Estimates (`StepEstimate`)**: `{ tokens?: number, costUsd?: number, durationSec?: number }`
   - **Phase Grouping (`PlanPhase`)**: `{ id: string, title: string, description?: string, order: number }`
   - **Plan Step (`PlanStep`)**: `{ id, title, description?, phaseId?, status, dependsOn, approval?: "required"|"auto", sideEffecting?: boolean, affectedScopes?, estimate?, artifacts? }`
   - **Execution Plan (`ExecutionPlan`)**: `{ id, title?, goal?, phases?, steps, state?, revision?, createdAt?, updatedAt? }`
   - **Topological Resolver (`readySteps`)**: Evaluates steps where all upstream `dependsOn` steps are `"succeeded"`. Enforces the dual approval gate: if `approval === "required"`, the step is released ONLY if explicitly present in `approvedStepIds`.
   - **Status Cascading (`resolvePlanStepStatuses`)**: Automatically cascades failure and skip states down dependent branches.
   - **DAG Validation (`validatePlanDAG`)**: Pure deterministic DFS 3-color cycle detection with canonical cycle rotation (e.g. `[A, B, C, A]`), duplicate step ID detection, unknown dependency detection, unknown phase validation, and security rule: `sideEffecting: true` steps MUST declare `approval: "required"`.

2. **`commands.ts` (Slash Commands & Context Mentions)**:
   - **Categories (`SlashCommandCategory`)**: `"planning" | "execution" | "context" | "system" | "workspace" | "custom"`
   - **Context Mentions (`CommandMentions`)**: Extracted mentions: `@file:<path>`, `@rule:<name>`, `#symbol:<sym>`, `@agent:<id>`.
   - **Parsed Wire Representation (`SlashCommandWire`)**: `{ command, positional, flags, rawInput, mentions }`
   - **Frames**: `CommandExecuteFrame` (`type: "command.execute"`) and `CommandResultFrame` (`type: "command.result"`).
   - **8 Built-in Slash Commands (`BUILTIN_SLASH_COMMANDS`)**:
     1. `/plan` (aliases: `/p`): Switch to Planning Mode, open DAG composer.
     2. `/goal` (aliases: `/g`): Set active workspace objective banner.
     3. `/schedule` (aliases: `/cron`): Schedule one-shot timer or cron daemon (`requiresHost: true`).
     4. `/browse` (aliases: `/b`): Launch managed Playwright browser session (`requiresHost: true`).
     5. `/learn`: Extract repo conventions into a reusable skill definition.
     6. `/cost` (aliases: `/usage`): Open Token and Provider Cost Analytics modal (`clientOnly: true`).
     7. `/compact`: Compress conversation context window (`--keep=N`).
     8. `/clear` (aliases: `/reset`): Clear active chat transcript (`clientOnly: true`).
   - **Lexer/Tokenizer (`parseSlashCommand`)**: POSIX tokenizer supporting single/double quotes, escape characters, `--key=value`, `--flag`, `-f`, and mention token prefixes.

3. **`routing.ts` (Model Routing & Scoring)**:
   - Data privacy classes: `"local"` (rank 3), `"cloud-eu"` (rank 2), `"cloud"` (rank 1).
   - Scoring formulas: 60% capability + 20% latency + 20% cost. User pinned model overrides scoring.

4. **`artifacts.ts` (Artifact Contracts)**:
   - Formats: `"diff" | "markdown" | "mermaid" | "html" | "code" | "image" | "json"`.
   - Heuristic format detection via filename extension and content sniffing.

### 2.3 Gap Analysis in `packages/protocol/`
- **Missing `terminal.ts`**: The PTY wire frames specified in `docs/PRD_HEADLESS_CLI_TERMINAL.md` (e.g. `ptySessionIdSchema`, `ptyCreateFrameSchema`, `ptyInputFrameSchema`, `ptyResizeFrameSchema`, `ptyKillFrameSchema`, `ptyDataEventSchema`, `ptyExitEventSchema`) have not yet been added to `packages/protocol/src/terminal.ts` or exported from `index.ts`.
- **Missing CLI Stream Schemas**: Structured event schemas for CLI NDJSON streaming (`session.init`, `turn.start`, `model.delta`, `tool.start`, `tool.chunk`, `tool.end`, `session.complete`).

---

## 3. Host Daemon Architecture (`apps/agent-host/`)

### 3.1 Network Topology & Server Setup
- **Framework**: Fastify v5.11.3 with `@fastify/websocket` v11.3.0.
- **Interface Binding**: Binds strictly to `127.0.0.1` (loopback only). Rejects any public network binding. Port is ephemeral (0) or configured via `PORT` environment variable.
- **HTTP Endpoints**:
  - `GET /health` -> Returns `{ ok: true, version: "0.1.0" }`.
  - `GET /agent` (WebSocket) -> Requires `?token=<single-use-token>`.

### 3.2 Authentication & Cryptographic Token Store (`server.ts:46-88`)
- **Token Generation**: 192-bit cryptographic random tokens generated with `crypto.randomBytes(24).toString("base64url")` (32-128 character base64url).
- **Single-Use Consume Contract**:
  - `createTokenStore()` stores outstanding tokens in an in-memory set (default max 64 outstanding).
  - When a WebSocket client connects, `tokenStore.consume(token)` checks if the token exists and immediately deletes it from the set.
  - If token is invalid, missing, or already consumed: socket is immediately closed with WebSocket Close Code **4401 (`CLOSE_UNAUTHORIZED`)**.
- **Frame Validation**:
  - Every inbound message on `/agent` is validated using `decodeClientMessage` (`protocol.ts:298-310`).
  - If schema validation fails or JSON is malformed: socket is closed with WebSocket Close Code **4400 (`CLOSE_INVALID_MESSAGE`)**.

```
[ Client Request: ws://127.0.0.1:<port>/agent?token=<tok> ]
                      │
                      ▼
            [ tokenStore.consume(tok) ]
            ├── False ──► Close Socket with 4401 (CLOSE_UNAUTHORIZED)
            └── True  ──► Upgrade to WebSocket & invoke attachAgentSession()
                                │
                                ▼
                      [ decodeClientMessage(frame) ]
                      ├── Invalid ──► Close Socket with 4400 (CLOSE_INVALID_MESSAGE)
                      └── Valid   ──► Route to Workspace RPC / Coordinator / Approval Gate
```

### 3.3 Session Composition (`session.ts`)
When a client connects, `attachAgentSession` instantiates:
- **`AuditStore`**: SQLite/JSON append-only ledger located in `<workspaceRoot>/.nanoforge/runs`.
- **`InMemoryProviderRegistry` & `OpenAICompatibleAdapter`**: Handles LLM inference requests.
- **`SocketApprovalGate`**: Correlates tool execution approval requests (`tool.approval_required`) with client responses (`approval.grant`, `approval.deny`, `tool.response`).
- **`RunCoordinator` (`runs/coordinator.ts`)**: Manages the autonomous agent turn loop:
  1. `readySteps(plan)` calculates executable steps.
  2. `route(request, profiles)` selects the optimal model.
  3. `provider.streamChat()` streams model proposals.
  4. `authorize(policy, toolRequest)` evaluates security policy (`allow`, `ask`, `deny`).
  5. If `ask`, pauses execution and invokes `approvalGate.requestApproval()`.
  6. Executes approved tools via `runner` (`runTerminalJob`).
  7. Records events in `RunEventLog` and broadcasts `run.state` / `run.event` over WebSocket.
- **Workspace RPC Dispatcher**: Serves filesystem operations (`workspace.readDir`, `workspace.readFile`, `workspace.stat`, `workspace.search`, `workspace.gitStatus`, `workspace.writeFile` [gated behind `allowWorkspaceWrites`], `workspace.watch` via Chokidar).

### 3.4 Terminal Execution Subsystem (`terminal/runner.ts`)
Current terminal execution is tailored for batch tool execution (`runTerminalJob`):
- **Execution Engine**: `execa` with `shell: false`. Accepts structured `{ executable, args[] }`.
- **Workspace Confinement**: `resolveWithinWorkspace(workspaceRoot, spec.cwd)` verifies that the target working directory resolves inside `workspaceRoot`. Throws `RunnerSpecError` synchronously before process spawn if path escapes (e.g. `../../`).
- **Restricted Environment**: Strips all sensitive host environment variables (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TOKEN`). Retains only whitelisted variables (`PATH`, `SystemRoot`, `COMSPEC`, `TEMP`, `HOME`, `USERPROFILE`, etc.).
- **Buffer Capping**: `OutputCap` maintains a 1 MiB circular buffer retaining stdout/stderr tail and setting `truncated: true` when exceeded.
- **Process Tree Teardown**: `killProcessTree` terminates the entire process tree using `taskkill /pid <pid> /t /f` on Windows and `process.kill(-pid, "SIGKILL")` on POSIX.

---

## 4. Headless CLI Runner Architecture (`nanoforge run`)

### 4.1 CLI Requirements & Entry Points
The standalone CLI is designed for CI/CD pipelines, automated scripts, and test-fix loops.

```
bin/
└── nanoforge.ts                # Executable binary entrypoint (#!/usr/bin/env node)
apps/agent-host/src/cli/
├── index.ts                    # Command dispatcher & argument parser
├── commands/
│   ├── run.ts                  # `nanoforge run <prompt>` (Autonomous headless runner)
│   ├── plan.ts                 # `nanoforge plan <goal>` (Plan generation only)
│   ├── serve.ts                # `nanoforge serve` (Start background daemon)
│   ├── attach.ts               # `nanoforge attach <sessionId>` (Attach to PTY session)
│   └── doctor.ts               # `nanoforge doctor` (System diagnostics)
├── formatters/
│   ├── ndjson.ts               # Line-delimited JSON stream
│   ├── json.ts                 # Final aggregate JSON payload
│   ├── text.ts                 # ANSI colored TUI output
│   └── raw.ts                  # Raw assistant text
└── daemonClient.ts             # IPC / Named pipe / WebSocket client
```

### 4.2 Non-Interactive Fail-Closed Policy Matrix
In headless non-interactive mode (when standard input is not a TTY or no interactive approval client is attached):
- **`--auto-approve=none` (Default)**: Any tool classified as `ask` by the policy engine requires explicit approval. Because no interactive approval client is attached, the execution engine MUST NOT hang indefinitely; it immediately fails closed and exits with **Exit Code 4 (`ERR_APPROVAL_DENIED`)**.
- **`--auto-approve=safe` (or `-y` / `--yes`)**: Auto-approves read-only tools and workspace-confined edits. Denies destructive operations (`rm -rf`, `del`, shell escalations) and fails closed with Exit Code 4 if attempted.
- **`--auto-approve=all`**: Auto-approves non-denied tools up to configured budget/turn limits, but **never** bypasses path traversal guards or root directory destruction.
- **Filesystem Canonicalization**: Enforces `fs.realpathSync` to prevent symlink/junction escape attacks.

### 4.3 POSIX Exit Code Matrix

| Exit Code | Constant Name | Description | CI/CD Action |
|---|---|---|---|
| **`0`** | `EXIT_SUCCESS` | Task completed successfully, verification passed. | Proceed to next stage |
| **`1`** | `EXIT_AGENT_FAILURE` | Agent finished turns without resolving goal / test failure. | Fail build; show error log |
| **`2`** | `EXIT_POLICY_VIOLATION` | Attempted unauthorized tool call, path escape, or denied binary. | Fail build immediately |
| **`3`** | `EXIT_USER_CANCELLED` | Execution interrupted via `SIGINT` (`Ctrl+C`) or `SIGTERM`. | Abort pipeline cleanly |
| **`4`** | `EXIT_TIMEOUT_EXCEEDED` / `ERR_APPROVAL_DENIED` | Timeout reached or non-interactive `ask` encountered under `auto-approve=none`. | Retry / adjust approve tier |
| **`5`** | `EXIT_CONFIG_AUTH_ERROR` | Missing API key, invalid CLI args, daemon auth failure. | Fail setup; fix env |
| **`6`** | `EXIT_VERIFICATION_FAILED` | Code edited but automated test verification failed on final turn. | Block PR merge |

### 4.4 Streaming Output Modes
1. **NDJSON Stream (`--output=ndjson`)**: Emits one JSON event per line on `stdout` (`session.init`, `turn.start`, `model.delta`, `tool.start`, `tool.chunk`, `tool.end`, `session.complete`).
2. **Aggregated JSON (`--output=json`)**: Collects all turns, metrics, diffs, and verification outcomes, outputting a single JSON object at termination.
3. **Text Mode (`--output=text`)**: ANSI colored logs with progress spinners on `stderr` and clean output on `stdout`.

---

## 5. Bidirectional Terminal IPC & PTY Virtual Terminal Dock

### 5.1 Interactive PTY vs Batch Terminal Runner
NanoForge requires two distinct terminal execution layers:
1. **Batch Runner (`terminal/runner.ts`)**: Used by the agent for non-interactive tool commands (e.g. `npm test`, `git status`). Uses `execa` with `shell: false`.
2. **Interactive PTY Manager (`terminal/ptyManager.ts`)**: Used for the Virtual Terminal Dock (`TerminalDock.tsx`) to support interactive user and agent sessions (running `vim`, `htop`, `npm init`, interactive git rebases, REPLs).

```
+---------------------------------------------------------------------------------------------+
|                                  VIRTUAL TERMINAL DOCK                                      |
+---------------------------------------------------------------------------------------------+
|  [Tab 1: Server (Vite)]  [Tab 2: Agent Runner]  [Tab 3: Bash]  [+ New Tab]   [_] [□] [x]   |
+---------------------------------------------------------------------------------------------+
|  $ npm run dev                                                                              |
|  > nanoforge@0.0.0 dev                                                                      |
|  > vite                                                                                     |
|                                                                                             |
|  VITE v7.3.0  ready in 420 ms                                                               |
|  ➜  Local:   http://localhost:5173/                                                         |
|  ➜  press h + enter to show help                                                            |
+---------------------------------------------------------------------------------------------+
```

### 5.2 Terminal Wire Protocol Specification (`packages/protocol/src/terminal.ts`)

#### Client-to-Host Frames:
- **`terminal.create`**: `{ type: "terminal.create", sessionId?, title?, executable?, args?, cwd?, env?, cols: 80, rows: 24 }`
- **`terminal.input`**: `{ type: "terminal.input", sessionId, data: string }` (raw keystrokes/stdin)
- **`terminal.resize`**: `{ type: "terminal.resize", sessionId, cols: number, rows: number }` (window size sync)
- **`terminal.kill`**: `{ type: "terminal.kill", sessionId, signal?: "SIGTERM" | "SIGKILL" | "SIGINT" }`

#### Host-to-Client Frames:
- **`terminal.created`**: `{ type: "terminal.created", sessionId, title, pid, cols, rows }`
- **`terminal.data`**: `{ type: "terminal.data", sessionId, data: string }` (UTF-8 ANSI stream)
- **`terminal.exit`**: `{ type: "terminal.exit", sessionId, exitCode: number | null, signal: string | null }`

### 5.3 Host PTY Manager Implementation Architecture (`apps/agent-host/src/terminal/ptyManager.ts`)
- **OS PTY Spawning**:
  - Windows: Spawns ConPTY pseudo-console via `node-pty.spawn("powershell.exe", ...)` (or `cmd.exe`).
  - POSIX: Spawns `openpty`/`forkpty` via `node-pty.spawn("bash", ...)`.
- **2MB Circular Ring Buffer**: Retains recent terminal output in memory per session so that clients reconnecting or switching tabs immediately receive full scrollback without data loss.
- **WebSocket Backpressure Management**:
  - Monitors `socket.bufferedAmount`.
  - When `bufferedAmount > 64 KB`, calls `ptyProcess.pause()`.
  - Listens for WebSocket `drain` event; when `bufferedAmount < 16 KB`, calls `ptyProcess.resume()`.
- **Environment Sanitization**: Applies `DEFAULT_ENV_ALLOWLIST` to prevent leaking API keys and tokens into interactive shells.

### 5.4 Frontend Terminal Dock Component (`src/sections/TerminalDock.tsx`)
- Multi-tab management: add tab, switch active tab, close tab with `x`.
- `@xterm/xterm` integration with `@xterm/addon-fit` for container auto-resizing and `@xterm/addon-webgl` for hardware acceleration.
- Keyboard input: `term.onData(data)` forwards raw bytes via `terminal.input` frame.
- Resize observer: dynamically computes columns/rows on layout changes and transmits `terminal.resize` frame.
- Dock controls: Collapsible height (minimized 36px, standard 256px, expanded 384px).

---

## 6. Synthesis, Key Findings & Implementation Roadmap

### 6.1 State of the Repository Summary

| Component | Status | Existing Files | Key Observations |
|---|---|---|---|
| **Protocol** | Mostly Complete | `plan.ts`, `commands.ts`, `routing.ts`, `artifacts.ts` | 69 tests pass. Lacks `terminal.ts` PTY frame schemas. |
| **Host Daemon** | Functional & Tested | `server.ts`, `session.ts`, `protocol.ts`, `runs/` | 166 tests pass. Single-use token auth and loopback security rock-solid. |
| **Batch Runner** | Production-Ready | `terminal/runner.ts`, `types.ts` | Supervised `execa` runner with workspace containment, timeout, process tree kill. |
| **Interactive PTY** | Missing | None | Needs `ptyManager.ts` backed by `node-pty` / child_process fallback. |
| **CLI Runner** | Missing | None (`bin/nanoforge.ts` absent) | Needs `bin/nanoforge.ts`, `cli/index.ts`, `commands/run.ts`, formatters, exit codes. |
| **Frontend UI** | Partially Complete | `PlanPanel.tsx`, `ChatPanel.tsx`, `ArtifactDock.tsx` | 204 tests pass. Build passes (`npm run build`). Needs `TerminalDock.tsx` and slash palette popover. |

### 6.2 Phased Delivery Strategy for Phase 2 & Phase 3

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                                PHASE 2 & 3 IMPLEMENTATION MATRIX                          |
+───────────────────────────────────────────────────────────────────────────────────────────+
| Phase 2 (Frontend Planning & Slash Command UI):                                           |
|   1. Upgrade `src/sections/PlanPanel.tsx` with collapsible Phase Group accordions.        |
|   2. Upgrade `src/sections/ChatPanel.tsx` with floating Slash Palette & @file mention.   |
|   3. Wire Planning Mode transition when selecting `/plan <goal>`.                         |
+───────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3 (Headless CLI & Interactive PTY Terminal):                                        |
|   1. Add `packages/protocol/src/terminal.ts` wire schemas & export in `index.ts`.         |
|   2. Implement `apps/agent-host/src/terminal/ptyManager.ts` with 2MB ring buffer & IPC.   |
|   3. Add terminal WebSocket message handlers in `apps/agent-host/src/protocol.ts`.        |
|   4. Implement `bin/nanoforge.ts` & `apps/agent-host/src/cli/` runner engine.             |
|   5. Implement `src/sections/TerminalDock.tsx` with @xterm/xterm and multi-tab support.   |
|   6. Add comprehensive unit & integration tests across all new modules.                   |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

# NanoForge: Current Architecture Audit

**Document Version:** 1.0.0  
**Audit Date:** 2026-09-26  
**Scope:** Verified Codebase State (`packages/protocol`, `apps/agent-host`, `packages/core`, `packages/sdk`, `src/`)  
**Baseline Verification:** 100% Pass Across All Test Suites (168 test files, 2,060 tests)

---

## 1. System Overview & Monorepo Topology

NanoForge is a local-first, agentic development environment and desktop application shell designed to safely orchestrate autonomous and human-in-the-loop coding workflows. It pairs a React 19 single-page application frontend with a privileged loopback Fastify daemon (`agent-host`), communicating across an isomorphic, typed WebSocket RPC protocol.

### 1.1 Workspace Architecture

The repository is organized as a pnpm monorepo managed with Turborepo:

```
nano-forge/
├── apps/
│   └── agent-host/            # Privileged Node.js daemon (Fastify, WebSocket, PTY, MCP)
├── packages/
│   ├── protocol/              # Pure isomorphic schemas, wire contracts, and domain types
│   ├── core/                  # Headless ReAct agent loop, provider adapters, context compaction
│   └── sdk/                   # Programmatic TypeScript client for headless automation
├── src/                       # React 19 desktop control plane (Vite, Tailwind, Radix UI)
├── scripts/                   # Packager, launcher, installer, and workspace scripts
├── docs/                      # Architectural specifications and plans
└── tests/                     # End-to-end integration and security test suites
```

### 1.2 Package Roles & Dependency Graph

The workspace enforces a strict acyclic dependency hierarchy:

```
┌────────────────────────────────────────────────────────┐
│                  @nanoforge/protocol                   │
│   (Zero runtime dependencies except Zod; pure types)   │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
┌───────────────┴───────────────┐ ┌──────┴───────────────┐
│       @nanoforge/core         │ │ @nanoforge/agent-host│
│ (ReAct kernel, adapters)      │ │ (Fastify, PTY, WS)   │
└───────────────▲───────────────┘ └──────▲───────────────┘
                │                        │
┌───────────────┴───────────────┐        │
│       @nanoforge/sdk          │        │
│ (Programmatic client)         │        │
└───────────────────────────────┘        │
                │                        │
┌───────────────┴────────────────────────┴───────────────┐
│                     Desktop UI (src/)                  │
│       (React 19, Vite, Tailwind, WebSocket client)     │
└────────────────────────────────────────────────────────┘
```

---

## 2. Core Subsystems

### 2.1 Privileged Agent Host (`apps/agent-host`)

The agent host daemon is implemented with Node.js and Fastify (`apps/agent-host/src/server.ts`), providing a secure bridge between the browser UI and operating system capabilities.

1. **Loopback Binding & Network Isolation:**
   - The daemon binds strictly to `127.0.0.1` (`HOST = "127.0.0.1"`). External interfaces (e.g. `0.0.0.0`) are forbidden by security invariants.
   - Origin checking actively validates inbound WebSocket handshakes against allowed local origins (`http://localhost:*`, `http://127.0.0.1:*`, `vscode-webview://*`, or packaged Electron origins). Unrecognized origins are rejected with HTTP 401 / WebSocket close code 4401.

2. **Single-Use Auth Tokens:**
   - Client authentication utilizes ephemeral, cryptographically secure 32-character base64url tokens issued by `createTokenStore()` (`apps/agent-host/src/server.ts`).
   - Tokens can only be consumed once upon WebSocket upgrade. Subsequent connection attempts using the same token fail with close code 4401.

3. **Session Lifecycle & Resource Disposal:**
   - When a client disconnects, `attachAgentSession` (`apps/agent-host/src/session.ts`) performs teardown: active PTY streams are closed, unsubscribers are triggered, pending capability requests are revoked in the broker, and audit stores are flushed.

### 2.2 React 19 Desktop Control Plane (`src/`)

The user interface is built with React 19, Vite, Tailwind CSS, and Radix UI primitives.

1. **State Management & Persistence:**
   - UI session state, active workspace selection, chat drafts, and theme preferences are managed in `src/lib/persist.ts` via local storage abstraction.
   - Raw secrets (API keys) and local filesystem tokens are strictly host-managed; browser storage stores only opaque workspace identifiers and non-sensitive UI settings.

2. **Actionable Empty States & Onboarding:**
   - Actionable empty states guide first-run onboarding (`src/sections/__tests__/ChatPanel.onboarding.test.tsx`), offering immediate folder selection or a guided local demo mode without exposing internal port numbers or transport tokens.

3. **Multi-Modal Visual Status:**
   - Status indicators (`src/sections/__tests__/TopBar.multimodal.test.tsx`) combine color, geometric icons, and human-readable text labels to satisfy accessibility and WCAG standards.

### 2.3 Wire Protocol (`packages/protocol`)

The protocol package provides shared Zod schemas defining all bidirectional messages exchanged over `ws://127.0.0.1:<port>/agent?token=<token>`.

1. **Client to Host Messages (`clientMessageSchema`):**
   - `ping`: Connection heartbeat.
   - `plan.submit`: Submits an execution plan for validation and execution.
   - `run.pause`, `run.resume`, `run.cancel`: Lifecycle control for active runs.
   - `approval.grant`, `approval.deny`, `capability.approval`: Human authorization for gated tools and workspace writes.
   - `workspace.*`: Scoped filesystem requests (`readDir`, `readFile`, `writeFile`, `stat`, `search`, `gitStatus`, `watch`, `unwatch`).
   - `memory.*`: Agent memory persistence (`memory.set`, `memory.get`, `memory.query`, `memory.delete`).
   - `subagent.*`: Multi-agent management (`invoke`, `manage`, `sendMessage`, `define`).
   - `task.*`, `schedule.*`: Background daemons and recurring scheduled tasks.

2. **Host to Client Messages (`hostMessageSchema`):**
   - `host.ready`: Initial handshake providing host instance ID, version, and validated workspace descriptor.
   - `run.state`: Broadcasts state transitions (`queued`, `running`, `approval_required`, `done`, `error`, `cancelled`).
   - `run.event`: Streaming ledger of step lifecycle events, token usage, and tool proposals.
   - `capability.approval_required`: Emitted when an operation requires explicit capability authorization.
   - `workspace.*.result` and `workspace.error`: Correlated filesystem responses tagged with generation IDs.

---

## 3. Security, Sandboxing & Capability Governance

### 3.1 Workspace Sandboxing & Path Confinement

1. **Broad Root Prohibition:**
   - Root validation (`apps/agent-host/src/workspace/runtime.ts`) rejects drive roots (`C:\`, `/`), user home directories (`~`, `/home/user`), and broad system directories (`/etc`, `/usr`, `C:\Windows`) with `WorkspaceRootError('root_too_broad')`.

2. **Path Confinement & Symlink Traversal:**
   - Every file operation in `apps/agent-host/src/workspace/filesystem.ts` canonicalizes target paths via `path.resolve` and verifies they remain strictly within `workspaceRoot`. Path traversal attempts (`../../`) throw `path_outside_root`.

3. **Atomic Writes with SHA-256 Conflict Detection:**
   - `handleWriteFile` performs pre-write SHA-256 integrity verification. If `expectedSha256` is provided and does not match the on-disk file content, the write is aborted with `write_conflict`.
   - File mutations write to temporary files first (`.tmp.<uuid>`) and atomically rename over the target path to prevent corrupt or partial writes.

### 3.2 Capability Approval Gate

1. **Broker Architecture (`apps/agent-host/src/capabilities/broker.ts`):**
   - Mutations (disk writes, destructive commands, background scheduling) must obtain a cryptographic grant from `CapabilityBroker`.
   - Each grant binds `hostInstanceId`, `clientSessionId`, `workspaceId`, `generation`, `runId`, `stepId`, `toolId`, and SHA-256 argument digests.

2. **Approval Handshake:**
   - Untrusted sessions trigger a `capability.approval_required` frame containing opaque digests.
   - The operation remains deferred in memory until the user sends a matching `capability.approval` frame.
   - Once approved, the grant is marked consumed (`uses: "single"`), preventing replay attacks.
   - Configured or trusted sessions (such as integration test harnesses via `preApprovedWrites: true`) can execute writes directly when workspace writes have been pre-authorized.

### 3.3 Terminal & Process Isolation

1. **PTY Manager (`apps/agent-host/src/terminal/ptyManager.ts`):**
   - Direct interactive terminal creation over WebSocket (`terminal.create`) is disabled by host policy (`terminal_interactive_denied`) to prevent unauthorized shell injection.
   - Structured command execution runs via `runTerminalJob` (`runner.ts`), enforcing strict execution timeouts, working directory confinement, and environment variable sanitation.

---

## 4. Execution Engine: DAG Planning & Subagents

### 4.1 DAG Plan Validation (`apps/agent-host/src/planning/validatePlan.ts`)

1. **Cycle Detection & Topological Sorting:**
   - Before any execution step can run, `validatePlan` constructs a directed dependency graph.
   - Depth-first search (DFS) with three-color marking (`unvisited`, `visiting`, `visited`) detects dependency cycles.
   - Plans with cycles fail validation with Exit Code 6 (`dependency_cycle`).

2. **Step Metadata:**
   - Steps require explicit identification, phase classification (`Discovery & Analysis`, `Execution & Implementation`, `Verification & Audit`), and clear risk classification (`MUTATING`, `APPROVAL REQUIRED`).

### 4.2 Multi-Agent Hierarchy & Shared Memory

1. **Subagent Supervisor (`apps/agent-host/src/agents/supervisor.ts`):**
   - Enforces a tree hierarchy with a maximum depth of 3 and maximum active concurrency of 8 subagents.
   - Subagents are isolated in dedicated folders under `.agents/<name>_<shortId>/` containing `DISPATCH.md`, `BRIEFING.md`, and `progress.md`.
   - Workspace isolation modes: `inherit` (shared root), `branch` (Git worktree isolation), and `share` (scratch space).

2. **Shared Memory Engine (`apps/agent-host/src/agents/memory.ts`):**
   - Provides an in-memory document and key-value store with namespace isolation (`global`, `swarm`, `agent:<id>`).
   - Supports TTL-based expiration, tag queries, prefix searches, and real-time subscription broadcasts (`memory.event`).

---

## 5. Verified Test Coverage & Quality Baseline

Every package in the repository includes automated Vitest test suites. Verification confirms 100% clean passes:

| Test Suite Scope | Command | Test Files | Total Tests | Pass Status | Duration |
|---|---|---|---|---|---|
| Pure Protocol Contracts | `npm run test:protocol` | 18 | 394 | **100% PASS** | ~3.5s |
| Agent Host Daemon | `npm run test:host` | 55 | 789 | **100% PASS** | ~12.8s |
| Core ReAct Kernel | `npm run test:core` | 8 | 95 | **100% PASS** | ~2.5s |
| Programmatic SDK | `npm run test:sdk` | 1 | 13 | **100% PASS** | ~1.3s |
| Desktop UI & E2E Workflows | `npm test` | 86 | 769 | **100% PASS** | ~47.6s |
| Composite TypeScript Build | `npm run build` | Solution (`tsc -b && vite build`) | All bundles | **100% PASS** | ~12.6s |
| Turborepo Typecheck | `npm run typecheck` | 4 packages (6 tasks) | Zero errors | **100% PASS** | ~5.1s |

**Total Verified Baseline:** 168 test suites, 2,060 unit and end-to-end tests passing with zero failures.

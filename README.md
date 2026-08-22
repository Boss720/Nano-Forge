# NanoForge

> **High-Assurance Agentic Workspace & Autonomous Swarm Platform**

NanoForge is an enterprise-grade agentic workbench and multi-agent swarm orchestration platform engineered for high assurance, deterministic sandboxing, and seamless embedding into [`nano-gpt.com`](https://nano-gpt.com).

---

## 1. System Architecture

NanoForge is organized as an isomorphic TypeScript monorepo with clean separation between wire schemas, agent kernel execution, host orchestration daemons, visual workbench docks, and client SDKs.

```
┌────────────────────────────────────────────────────────┐
│              Frontend Workbench (src/)                 │
│   (AppLayout, SessionManager, Connection, VoiceHUD)    │
│   (Swarm Tree, Mailbox, Tool Inspector, Daemons)       │
└──────────────────────────┬─────────────────────────────┘
                           │ WebSocket / REST (ws://127.0.0.1:4040/ws)
                           ▼
┌────────────────────────────────────────────────────────┐
│            Agent Host Daemon (apps/agent-host)         │
│  Fastify WS ── Session ── Policy Engine ── PTY/Daemons │
│     │               │                              │   │
│     ▼               ▼                              ▼   ▼   │
│ Audit Ledger    Supervisor                     Subagents│
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│               Shared Protocol & SDK                    │
│   packages/protocol (Zod) ── packages/core (ReAct)     │
│   packages/sdk (@nanoforge/sdk client)                 │
└────────────────────────────────────────────────────────┘
```

### Workspace Packages

| Package | Path | Description |
|---|---|---|
| **`@nanoforge/protocol`** | `packages/protocol/` | Isomorphic TypeScript definitions, Zod wire schemas, 7-state subagent FSM, tool definitions, and 5-field cron parsing engine. Zero native Node dependencies. |
| **`@nanoforge/core`** | `packages/core/` | Headless autonomous ReAct agent kernel, streaming LLM provider adapters, cancellation tree, and context compaction. |
| **`@nanoforge/sdk`** | `packages/sdk/` | Programmatic isomorphic TypeScript client SDK for embedding NanoForge capabilities into external platforms and `nano-gpt.com`. |
| **`@nanoforge/agent-host`** | `apps/agent-host/` | Fastify HTTP/WebSocket server running local agent orchestration, daemon task supervisor, PTY terminal multiplexer, policy approval engine, and append-only SQLite audit ledger. |
| **Frontend UI** | `src/` | React 19 web/desktop workbench featuring modular docks (Chat, Monaco Diff Viewer, Terminal, Subagents Swarm Tree, Artifacts, Voice HUD). |
| **Release & Tools** | `scripts/` | Standalone launcher (`nanoforge-launcher.cjs`), Windows Single Executable Application builder (`build-exe.js`), and automated release packager (`package-release.js`). |

---

## 2. Quickstart & Installation

### Prerequisites
- **Node.js**: `>= 20.0.0` (LTS recommended)
- **pnpm**: `>= 9.0.0` (`pnpm` is the exclusive package manager)

### Setup
```bash
# Clone the repository
git clone https://github.com/bosscube1/nano-forge.git
cd nano-forge

# Install monorepo dependencies
pnpm install

# Run typechecks and build all packages
pnpm build:all
```

### Development
```bash
# Start Vite frontend development server (http://localhost:5173)
pnpm dev

# Start Fastify Agent Host daemon (http://127.0.0.1:4040)
pnpm start:host

# Run frontend and host simultaneously
pnpm turbo:build
```

---

## 3. Standalone Launcher & CLI Usage

NanoForge includes a zero-dependency dual launcher (`scripts/nanoforge-launcher.cjs`) that hosts the frontend static UI and spawns the background Fastify agent host.

```bash
# Start standalone launcher
pnpm start:launcher

# Custom ports and token configuration
node scripts/nanoforge-launcher.cjs --port 5000 --host-port 5001 --token my-custom-token --no-open
```

### Launcher CLI Options

| Flag | Default | Description |
|---|---|---|
| `--port <number>`, `--port=<number>` | `4173` | UI HTTP server port |
| `--host-port <number>`, `--host-port=<number>` | `4174` | Agent Host backend port |
| `--token <string>`, `--token=<string>` | Auto-generated | 192-bit cryptographic authentication token |
| `--no-open` | `false` | Prevent opening the browser automatically |
| `--dry-run` | `false` | Validate configurations and exit without binding ports |
| `--help`, `-h` | — | Display CLI usage reference |

### Building Distribution Packages & Windows Executable

```bash
# Compile standalone Windows binary (NanoForge.exe via Node SEA)
pnpm build:exe

# Assemble complete release package zip (release/NanoForge-v*-windows-x64.zip)
pnpm package
```

---

## 4. Agent Host Endpoints & WebSocket Protocol

### HTTP Endpoints

- **`GET /health`**
  Returns operational status and subsystem metrics.
  ```json
  {
    "status": "healthy",
    "version": "0.1.0",
    "uptime": 124.5,
    "pid": 14200,
    "subsystems": {
      "subagents": { "active": 2, "maxConcurrency": 8 },
      "daemons": { "active": 1 },
      "memory": { "heapUsedMB": 42.1, "rssMB": 89.4 }
    }
  }
  ```

- **`POST /api/session`**
  Initializes an agent execution session with security tokens.

- **`GET /api/audit`**
  Streams append-only SQLite audit ledger event logs for security auditing.

### WebSocket Interface

- **Endpoint**: `ws://127.0.0.1:4040/ws?token=<crypto_token>`
- **Authentication**: Validated against active token in query string.
- **Wire Framing**: JSON payloads strictly validated against `@nanoforge/protocol` Zod schemas (`clientMessageSchema`, `hostMessageSchema`).
- **Close Codes**:
  - `4401`: Unauthorized Origin or Invalid Token
  - `4400`: Protocol Schema Violation
  - `1000`: Graceful Termination / Normal Closure

---

## 5. Environment Variables & Configuration

| Variable | Default | Description |
|---|---|---|
| `HOST` / `BIND_ADDRESS` | `127.0.0.1` | Network interface to bind HTTP and WebSocket servers (set to `0.0.0.0` for containerized deployments). |
| `PORT` | `4040` | Port for Fastify agent host server. |
| `NANOFORGE_AUTH_TOKEN` | Generated | Pre-shared token override for headless automation. |
| `NANOFORGE_WORKSPACE_ROOT` | Current working directory | Root directory where agent file operations are confined. |
| `LOG_LEVEL` | `info` | Pino structured logger level (`debug`, `info`, `warn`, `error`, `silent`). |
| `ALLOWED_ORIGINS` / `CORS_ORIGIN` | `http://127.0.0.1:*, http://localhost:*` | Comma-separated list of allowed origins for WebSocket and CORS headers. |
| `MAX_SUBAGENT_DEPTH` | `3` | Maximum hierarchical supervision depth (`SEC-SUB-05`). |
| `MAX_CONCURRENT_SUBAGENTS` | `8` | Maximum active concurrent subagents throttle. |

---

## 6. Security Model & Invariants

NanoForge implements defense-in-depth access controls across all execution layers:

1. **Path Confinement & Anti-Traversal (`SEC-SUB-01`)**:
   - Every file operation resolves canonical paths with `fs.realpathSync`.
   - Prevents directory traversal (`..`, `%2e%2e`), symlink escapes, and Windows case-sensitivity path bypasses.
   - Restricts subagent file modifications strictly to their allocated workspace bounds (`.agents/<id>/` in `inherit` mode, or dedicated Git worktrees in `branch` mode).

2. **Mailbox Access Control (`SEC-SUB-03`)**:
   - Subagents can only transmit mailbox messages to their direct parent, direct children, or sibling subagents under the same parent.
   - Cross-tree message passing is rejected with `ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT`.

3. **Hierarchy Depth & Concurrency Bounds (`SEC-SUB-05`)**:
   - Subagent supervision trees are capped at depth $\le 3$ to eliminate fork bombs.
   - Active concurrent agent count is throttled to $\le 8$.

4. **Token Budget Metering (`SEC-SUB-04`)**:
   - Enforces per-agent token limits. Breaching quotas triggers the 5-rung failure escalation protocol (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`).

5. **XSS & Content Security Isolation**:
   - Mermaid diagrams render inside isolated sandboxes with strict DOMPurify sanitization.
   - Content Security Policy (CSP) headers block untrusted script execution.

6. **Credential Protection**:
   - API keys and crypto tokens are stored in ephemeral memory and never written to plain-text browser `localStorage`.

---

## 7. Programmatic SDK Integration (`@nanoforge/sdk`)

The `@nanoforge/sdk` package provides a typed client library for integrating NanoForge into web applications and programmatic backend workflows.

```typescript
import { NanoForgeClient } from '@nanoforge/sdk';

// 1. Initialize client connection
const client = new NanoForgeClient({
  hostUrl: 'ws://127.0.0.1:4040/ws',
  token: process.env.NANOFORGE_AUTH_TOKEN,
  autoReconnect: true,
});

await client.connect();

// 2. Create and stream an agent session
const session = await client.createSession({
  workspaceRoot: '/path/to/project',
});

const plan = {
  id: 'plan_1',
  goal: 'Run test suite and optimize bundle',
  tasks: [
    { id: 'task_1', title: 'Run vitest', tool: 'run_command', args: { command: 'pnpm test' } },
  ],
};

for await (const event of client.streamRun(plan)) {
  console.log(`[Event ${event.type}]`, event.payload);
}

// 3. Graceful disconnection
await client.disconnect();
```

---

## 8. Testing & Verification

NanoForge includes extensive test coverage across unit, component, integration, and adversarial suites.

```bash
# Run pure protocol schema tests (packages/protocol)
pnpm test:protocol

# Run Fastify agent host, daemon, and policy tests (apps/agent-host)
pnpm test:host

# Run core ReAct agent kernel tests (packages/core)
pnpm test:core

# Run SDK client tests (packages/sdk)
pnpm test:sdk

# Run frontend React workbench tests (src/)
pnpm test

# Run end-to-end integration tests (tests/e2e/)
pnpm test:e2e

# Run all test suites across monorepo in parallel via Turbo
pnpm test:all

# Typecheck and build production bundle
pnpm typecheck:all
pnpm build
```

---

## 9. License

Proprietary and Confidential. Copyright &copy; 2026 NanoForge / nano-gpt.com. All rights reserved.


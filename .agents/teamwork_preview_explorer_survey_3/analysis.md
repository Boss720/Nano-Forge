# NanoForge Phase 6 Comprehensive Survey: Standalone Packaging (R4) & Test Suite Infrastructure (R5)

**Date**: 2026-08-15  
**Surveyor**: Explorer 3 (`teamwork_preview_explorer_survey_3`)  
**Scope**: Standalone Windows Executable Tooling (`release/`), Dual Launch Architecture, Complete Monorepo Test Baseline (`test:protocol`, `test:host`, `test`, `build`), and Phase 6 Test Coverage Specifications.  
**Integrity Mode**: Development  

---

## 1. Executive Summary

A comprehensive investigation of the NanoForge monorepo was performed to establish the exact architecture and implementation plan for **Requirement R4 (Executable Packaging & Installer Tooling)** and **Requirement R5 (Test Suites & 100% Verification Integrity)**.

### Key Verification Baseline Summary

| Suite / Check | Command | Status | Test Files | Tests Passed | Duration |
|---|---|:---:|:---:|:---:|:---:|
| **Protocol Suite** | `npm run test:protocol` | **PASS (100%)** | 9 | 214 / 214 | 1.63s |
| **Agent Host Suite** | `npm run test:host` | **PASS (100%)** | 36 | 322 / 322 | 6.87s |
| **Frontend UI Suite** | `npm test` | **PASS (100%)** | 32 | 302 / 302 | 76.27s |
| **Monorepo Production Build** | `npm run build` (`tsc -b && vite build`) | **PASS (100%)** | — | 2,545 modules | 37.25s |
| **Protocol Typecheck** | `npm run typecheck:protocol` | **PASS (100%)** | — | 0 errors | 3.2s |
| **Host Typecheck** | `npm run typecheck:host` | **FAIL (1 error)** | — | 1 error (Fix identified) | 6.5s |
| **TOTAL VERIFIED TESTS** | — | **PASS** | **77 files** | **838 tests** | **~85s** |

---

## 2. Requirement R4: Standalone Packaging & Executable Tooling Audit

### 2.1 Current Packaging Artifacts & Limitations

1. **`release/NanoForge.exe` (37.65 MB)**:
   - Compiled binary artifact generated from `scripts/nanoforge-launcher.cjs` using `@yao-pkg/pkg` / `pkg`.
   - **Current Defect**: It currently only hosts a basic HTTP static file server pointing to `dist/` on port 4173 and issues a Windows shell command `start "" "http://127.0.0.1:4173"`.
   - **Missing Backend**: It does **NOT** spawn or host the Fastify Agent Host daemon (`apps/agent-host/src/server.ts`). When the user runs `NanoForge.exe`, the UI loads in the browser but displays "Disconnected" and cannot execute agent workflows, PTY terminals, daemon tasks, or subagent swarms unless the user manually runs `npm run start:host` in a separate terminal.

2. **`scripts/nanoforge-launcher.cjs` (34 lines)**:
   ```javascript
   const http = require('node:http');
   const fs = require('node:fs');
   const path = require('node:path');
   const { exec } = require('node:child_process');

   const root = process.pkg
     ? path.join(path.dirname(process.execPath), 'dist')
     : path.join(__dirname, '..', 'dist');
   const port = Number(process.env.NANOFORGE_PORT || 4173);
   // Only serves static files from root!
   ```

3. **`release/` Directory State**:
   - `release/NanoForge.exe` (legacy static-only binary).
   - `release/dist/` (static build assets).
   - **Missing**: Distribution installer scripts (`.ps1` / `.bat`), uninstaller scripts, shortcut generators, dual-launch host-bundler scripts.

---

### 2.2 Dual Launch Architecture Specification

In Phase 6, `NanoForge.exe` must provide **seamless dual launch**: booting both the Fastify Agent Host daemon (with all backend capabilities: PTY terminal, subagent supervisor, mailbox, daemon scheduler, shared memory, and token telemetry) and the Web UI visual control plane.

```
                      ┌───────────────────────────────────────┐
                      │            NanoForge.exe              │
                      │  (Unified Windows Runtime Launcher)   │
                      └──────────────────┬────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │    Local Agent Host       │                   │    Web UI Static Server   │
   │ Fastify Loopback Daemon   │                   │ (Node HTTP or Fastify)    │
   │ Port: 4174 (127.0.0.1)    │                   │ Port: 4173 (127.0.0.1)    │
   │                           │                   │                           │
   │ • Subagent Supervisor     │                   │ • Serves release/dist/    │
   │ • Shared Memory Engine    │                   │ • Auto-injects Host Port  │
   │ • Token Telemetry Meter   │                   │ • Fallback to index.html  │
   │ • PTY Terminal Manager    │                   └─────────────┬─────────────┘
   │ • SQLite Audit Ledger     │                                 │
   └─────────────▲─────────────┘                                 │
                 │                                               │
                 │ WebSocket (ws://127.0.0.1:4174/agent?token=)  │
                 └───────────────────────┬───────────────────────┘
                                         │
                                         ▼
                      ┌───────────────────────────────────────┐
                      │        Default System Browser         │
                      │       http://127.0.0.1:4173/          │
                      │      (Visual Control Plane)           │
                      └───────────────────────────────────────┘
```

#### Dual Launch Operational Sequence:
1. **Port Selection & Conflict Prevention**:
   - UI Port: `4173` (configurable via `NANOFORGE_PORT` / `NANOFORGE_UI_PORT`).
   - Host Port: `4174` (configurable via `NANOFORGE_HOST_PORT`).
   - If ports are occupied, dynamically scan for available ephemeral loopback ports.
2. **Agent Host Daemon Initialization**:
   - Initialize Fastify instance binding strictly to `127.0.0.1`.
   - Issue a fresh single-use cryptographic token (`tokenStore.issue()`).
   - Mount all WebSocket endpoints: `/agent` (runs & approvals), `/pty` (virtual terminals), `/subagents` (swarm lifecycle & shared memory).
3. **Web UI Serving**:
   - Serve production assets from adjacent `dist/` directory.
   - Serve SPA fallback to `index.html` with headers: `Cache-Control: no-cache`.
4. **Browser Auto-Launch**:
   - Construct launch URL: `http://127.0.0.1:4173/?hostPort=4174&token=${sessionToken}`.
   - Trigger Windows launcher via `exec('start "" "${launchUrl}"')` (or `xdg-open` / `open` cross-platform).
5. **Lifecycle Management & Graceful Teardown**:
   - Intercept `SIGINT`, `SIGTERM`, `SIGHUP`.
   - Gracefully close active PTY sessions, kill background daemons, flush SQLite audit log, close Fastify sockets, and exit cleanly.

---

### 2.3 Standalone Executable Packaging & Installer Tooling

To ensure 100% reproducible Windows builds and distribution packaging, the following scripts and files must be established in `scripts/` and `release/`:

#### 1. Unified Launcher Runtime Script (`scripts/nanoforge-launcher.cjs`)
A robust Node CJS script that bundles both the Fastify host daemon and the static UI server, compiles them with `esbuild`, and packages them into `release/NanoForge.exe`.

#### 2. Release Packaging Pipeline Script (`scripts/package-release.js`)
An automated build pipeline that:
- Executes `npm run build` to compile the Vite frontend into `dist/`.
- Uses `esbuild` to bundle `apps/agent-host/src/server.ts` and `scripts/nanoforge-launcher.cjs` into a self-contained runtime `release/launcher-bundle.cjs`.
- Packages the standalone binary `release/NanoForge.exe` (using Node SEA or `@yao-pkg/pkg`).
- Copies `dist/` into `release/dist/`.
- Validates binary launch in headless test mode (`release/NanoForge.exe --dry-run`).
- Creates a release ZIP archive: `release/NanoForge-v0.6.0-windows-x64.zip`.

#### 3. Windows PowerShell Distribution Installer (`release/install-nanoforge.ps1`)
- Checks system architecture (x64) and administrator privileges (optional, user-space install default).
- Installs into `$env:LOCALAPPDATA\NanoForge` (e.g. `C:\Users\<User>\AppData\Local\NanoForge`).
- Copies `NanoForge.exe`, `dist/`, and configuration templates.
- Creates Start Menu shortcut: `"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\NanoForge.lnk"`.
- Creates Desktop shortcut: `"$env:USERPROFILE\Desktop\NanoForge.lnk"`.
- Adds `$env:LOCALAPPDATA\NanoForge` to user `PATH` environment variable.
- Outputs clean ASCII banner and launch instructions.

#### 4. Windows One-Click Batch Installer (`release/install-nanoforge.bat`)
A one-click double-clickable batch wrapper that invokes PowerShell execution policy bypass:
```cmd
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-nanoforge.ps1"
pause
```

#### 5. Windows Clean Uninstaller (`release/uninstall-nanoforge.ps1`)
- Terminates running `NanoForge.exe` processes.
- Removes Desktop and Start Menu shortcuts.
- Cleans `$env:LOCALAPPDATA\NanoForge`.
- Removes user PATH entry.

---

## 3. Requirement R5: Test Suites & Coverage Analysis

### 3.1 Current Test Suite Status (838 Passing Tests)

#### A. Protocol Suite (`packages/protocol/` — 9 files, 214 tests)
- `artifacts.test.ts` (5 tests): MIME types, markdown, diff, mermaid, html artifact detection.
- `commands.test.ts` (12 tests): POSIX arg tokenization, flag parsing, quote escaping.
- `commands.adversarial.test.ts` (29 tests): Malformed strings, injections, boundary flags.
- `plan.test.ts` (23 tests): DFS/Tarjan cycle detection, topological `readySteps()`, approval gates.
- `subagents.test.ts` (22 tests): Subagent configs, archetypes, isolation schemas, mailbox schemas.
- `subagents.adversarial.test.ts` (16 tests): Depth violations, role spoofing, invalid schemas.
- `tasks.test.ts` (25 tests): Cron schemas, timer conditions, daemon task lifecycles.
- `terminal.test.ts` (16 tests): PTY message frames, resize, exit code parsing.
- `terminal.adversarial.test.ts` (66 tests): Malformed terminal input, ANSI escapes, buffer overflows.

#### B. Agent Host Suite (`apps/agent-host/` — 36 files, 322 tests)
- `audit/store.test.ts` (9 tests): SQLite HMAC hashing, immutable event ledger.
- `browser/manager.test.ts` (14 tests): Headless Playwright browser management.
- `browser/visual.test.ts` (12 tests): Pixelmatch screenshot visual comparisons.
- `mcp/client.test.ts` (17 tests): Isolated stdio client, secret injection, tool namespacing.
- `mcp/sseTransport.test.ts` (1 test): SSE transport.
- `planning/validatePlan.test.ts` (17 tests): Plan validation rules.
- `plugins/plugins.test.ts` (2 tests): Plugin manifest loader.
- `policy/policy.test.ts` (16 tests): Workspace confinement, path traversal.
- `policy/sandboxing.test.ts` (8 tests): Subprocess sandboxing.
- `providers/openaiCompatible.test.ts` (7 tests): SSE stream parsing.
- `router/router.test.ts` (10 tests): Multi-model router scoring.
- `rules/loadRules.test.ts` (10 tests): Rule pack discovery & glob matching.
- `runs/coordinator.test.ts` (10 tests): Run lifecycle, pause/resume.
- `runs/coordinator.adversarial.test.ts` (25 tests): Host error resilience.
- `server.test.ts` (11 tests): Fastify loopback, bearer auth, WS endpoints.
- `skills/registry.test.ts` (11 tests): Skill indexing, manifest parsing.
- `terminal/runner.test.ts` (9 tests): Execa process spawning, timeout kill.
- `terminal/ptyManager.test.ts` (10 tests): Node-pty process virtualization.
- `workspace/filesystem.test.ts` (10 tests): Safe file reading/writing.
- `workspace/gitWorktree.test.ts` (3 tests): Git worktree isolation.
- `daemons/manager.test.ts` (2 tests): Daemon task lifecycle.
- `daemons/scheduler.test.ts` (6 tests): Timer scheduling.
- `daemons/supervisor.test.ts` (8 tests): Background process supervision.
- `cli/approval.test.ts` (7 tests): Headless CLI approval rules.
- `cli/cli.test.ts` (9 tests): CLI option parsing.
- `cli/formatters.test.ts` (7 tests): NDJSON and terminal formatters.
- `cli/plan.test.ts` (5 tests): Headless plan command.
- `cli/planner.test.ts` (5 tests): Plan generator.
- `cli/run.test.ts` (12 tests): Non-interactive run command.
- `agents/agents.adversarial.test.ts` (4 tests): Stress tests.
- `agents/challenge_stress.adversarial.test.ts` (18 tests): Tree limits and concurrency.
- `agents/hierarchy.test.ts` (5 tests): Depth and tree relationships.
- `agents/mailbox.test.ts` (7 tests): Inter-agent messaging.
- `agents/registry.test.ts` (5 tests): In-memory agent registry.
- `agents/supervisor.test.ts` (6 tests): Subagent lifecycle management.
- `agents/wakeup.test.ts` (4 tests): Reactive wakeup conditions.

#### C. Frontend UI Suite (`src/` — 32 files, 302 tests)
- `lib/__tests__/agentLoop.test.ts` (12 tests): Verification loop.
- `lib/__tests__/context.test.ts` (9 tests): Context windowing.
- `lib/__tests__/exporter.test.ts` (8 tests): Export formats.
- `lib/__tests__/hostClient.test.ts` (14 tests): Host WS transport.
- `lib/__tests__/hostSession.subagents.test.ts` (10 tests): Swarm host session hooks.
- `lib/__tests__/nanogpt.test.ts` (21 tests): Model pricing.
- `lib/__tests__/patchParse.test.ts` (9 tests): Diff parsing.
- `lib/__tests__/persist.test.ts` (14 tests): LocalStorage session persist.
- `lib/__tests__/sessionReducer.test.ts` (7 tests): Session state reducer.
- `lib/__tests__/syntax.test.ts` (13 tests): Language syntax detection.
- `lib/__tests__/usage.test.ts` (7 tests): Token cost accounting.
- `lib/__tests__/usageLog.test.ts` (11 tests): Historical run log.
- `lib/__tests__/vfs.test.ts` (15 tests): Virtual filesystem.
- `lib/__tests__/x402.test.ts` (15 tests): HTTP 402 quotes.
- `sections/ChatComposer.test.tsx` (13 tests): Input, mentions, slash commands.
- `sections/PlanPanel.test.tsx` (16 tests): Plan visualizer, approvals.
- `sections/TerminalDock.test.tsx` (16 tests): Virtual terminal dock.
- `sections/__tests__/AgentMailboxViewer.test.tsx` (4 tests): Swarm mailbox UI.
- `sections/__tests__/AgentSwarmTreeView.test.tsx` (6 tests): Swarm tree visualization.
- `sections/__tests__/AgentToolInspector.test.tsx` (4 tests): Live tool stream UI.
- `sections/__tests__/App.hostWiring.test.tsx` (6 tests): End-to-end UI host integration.
- `sections/__tests__/ArtifactDock.test.tsx` (4 tests): Artifact viewer.
- `sections/__tests__/BrowserPermissionDialog.test.tsx` (7 tests): Browser permission UI.
- `sections/__tests__/ChatComposer.test.tsx` (13 tests): Composer slash & mentions.
- `sections/__tests__/DaemonTaskManager.test.tsx` (4 tests): Daemon task manager UI.
- `sections/__tests__/IntegrationsPanel.test.tsx` (7 tests): Integrations settings.
- `sections/__tests__/ModelPanel.ConnectDialog.test.tsx` (4 tests): Model settings.
- `sections/__tests__/PlanPanel.test.tsx` (16 tests): Plan approvals.
- `sections/__tests__/RouteDecisionCard.test.tsx` (5 tests): Router decision cards.
- `sections/__tests__/SpawnSubagentModal.test.tsx` (4 tests): Agent spawn dialog.
- `sections/__tests__/SubagentsPanel.test.tsx` (4 tests): Swarm control plane.
- `sections/__tests__/VisualEvidenceCard.test.tsx` (4 tests): Visual evidence cards.

---

### 3.2 TypeScript Typecheck Gap Analysis (`typecheck:host`)

Running `npm run typecheck:host` (`tsc -p apps/agent-host/tsconfig.json`) fails with 1 error:

```
apps/agent-host/src/agents/challenge_stress.adversarial.test.ts(130,57): error TS2345: 
Argument of type '{ action: "kill"; subagentId: string; }' is not assignable to parameter of type '{ action: "status" | "list" | "kill" | "pause" | "resume" | "inspect"; recursive: boolean; subagentId?: string | undefined; inspectFile?: "progress.md" | "BRIEFING.md" | "handoff.md" | "DISPATCH.md" | "analysis.md" | undefined; }'.
  Property 'recursive' is missing in type '{ action: "kill"; subagentId: string; }' but required in type 'ManageSubagentsParams'.
```

#### Exact Root Cause:
In `packages/protocol/src/subagents.ts:279-284`:
```typescript
export const manageSubagentsParamsSchema = z.object({
  action: manageSubagentsActionSchema,
  subagentId: z.string().uuid().optional(),
  inspectFile: manageSubagentsInspectFileSchema.optional(),
  recursive: z.boolean().default(false),
});
export type ManageSubagentsParams = z.infer<typeof manageSubagentsParamsSchema>;
```
Because `recursive` has `.default(false)`, `z.infer` outputs `{ recursive: boolean }` as a **required** property on the output type, whereas `z.input<typeof manageSubagentsParamsSchema>` makes `recursive?: boolean` optional on the input type.

#### Resolution for Implementers:
In `packages/protocol/src/subagents.ts`:
Define `export type ManageSubagentsInput = z.input<typeof manageSubagentsParamsSchema>;` or update `recursive: z.boolean().optional().default(false)`.
In `apps/agent-host/src/agents/supervisor.ts`:
Accept `params: ManageSubagentsInput | ManageSubagentsParams`.

---

### 3.3 New Test Suites Required for Phase 6

To ensure 100% test coverage and full verification of the Phase 6 feature set, the following new test suites must be implemented:

#### 1. Shared Memory Engine Test Suites
- **`packages/protocol/src/memory.test.ts` (12 tests)**:
  - Validates `memory.set`, `memory.get`, `memory.query`, `memory.delete` schemas.
  - Tests key namespacing (`swarm.*`, `agent:<id>.*`, `global.*`), wildcard patterns (`*`, `?`), and size limits (max 64KB per value).
- **`apps/agent-host/src/agents/memory.test.ts` (16 tests)**:
  - In-memory key-value store with namespace isolation.
  - Atomic read-modify-write operations, TTL expiration, and event broadcasting (`memory.changed`).
  - Cross-agent read/write security boundaries.
- **`src/sections/__tests__/SharedMemoryViewer.test.tsx` (8 tests)**:
  - Renders shared memory key-value table.
  - Filtering by namespace, searching keys, adding new key-value pairs, and deleting keys.
  - Real-time updates when WebSocket `memory.changed` events arrive.

#### 2. Token & Latency Telemetry Test Suites
- **`packages/protocol/src/telemetry.test.ts` (10 tests)**:
  - Validates telemetry schemas (`telemetry.node_metrics`, `telemetry.swarm_summary`).
  - Checks prompt tokens, completion tokens, cached tokens, USD cost estimation, and turn latency distributions (p50, p90, p99).
- **`apps/agent-host/src/agents/telemetry.test.ts` (14 tests)**:
  - Tracks token usage per agent node and aggregates across swarm hierarchy.
  - Calculates runtime turn durations and latency meters.
  - Emits `telemetry.update` wire protocol frames.
- **`src/sections/__tests__/TelemetryMeter.test.tsx` (8 tests)**:
  - Renders live token count meters, USD cost badges, and latency gauges.
  - Displays per-agent sparklines and swarm totals.

#### 3. Dynamic UI Palette & Theme Customizer Test Suites
- **`src/lib/__tests__/themePalette.test.ts` (12 tests)**:
  - Theme preset catalog (Cyberpunk Amber, Cobalt Tech, Emerald Obsidian, Midnight Slate, Solar Crimson).
  - Dynamic HSL calculation and CSS custom property formatting (`--background`, `--primary`, `--accent`, `--border`).
  - DOM `:root` property injection and `localStorage` persistence and hydration.
  - Color contrast calculation and WCAG AA contrast ratio compliance.
- **`src/sections/__tests__/ThemeCustomizer.test.tsx` (10 tests)**:
  - Renders palette picker dialog / settings tab.
  - Swatches click immediately applies theme without page reload.
  - Custom color picker sliders update CSS properties in real-time.
  - Reset to default restores original Amber Forge theme.

#### 4. Standalone Packaging & Dual-Launch Tests
- **`scripts/__tests__/packaging.test.ts` (6 tests)**:
  - Validates `nanoforge-launcher.cjs` port configuration and startup logic.
  - Tests SPA fallback resolution for `dist/index.html`.
  - Verifies presence and syntax of PowerShell installer scripts (`release/install-nanoforge.ps1`).

---

## 4. Concrete Implementation Blueprint for Phase 6

### Step 1: Fix Protocol & Host Type Discrepancies
1. In `packages/protocol/src/subagents.ts`:
   - Update `manageSubagentsParamsSchema` so `recursive: z.boolean().optional().default(false)`.
   - Add `SharedMemory` and `Telemetry` schemas.
2. Run `npm run typecheck:host` to verify 0 errors.

### Step 2: Implement Phase 6 Backend (Shared Memory & Telemetry)
1. Create `apps/agent-host/src/agents/memory.ts`:
   - Implement `SharedMemoryStore` with `get`, `set`, `query`, `delete`, and event emitter.
2. Create `apps/agent-host/src/agents/telemetry.ts`:
   - Implement `TelemetryCollector` with per-node and aggregate token/latency tracking.
3. Wire both into `apps/agent-host/src/agents/supervisor.ts`, `session.ts`, and `server.ts`.
4. Add unit test suites in `apps/agent-host/src/agents/memory.test.ts` and `telemetry.test.ts`.

### Step 3: Implement Phase 6 Frontend (Theme Palette, Shared Memory UI, Telemetry)
1. Create `src/lib/themePalette.ts`:
   - Theme palette definitions, CSS variable applier, localStorage persistence.
2. Create `src/sections/ThemeCustomizer.tsx` (or `PaletteSelector.tsx`) and integrate into Header / Settings.
3. Create `src/sections/subagents/SharedMemoryViewer.tsx` and integrate as a tab in `SubagentsPanel.tsx`.
4. Enhance `SubagentsPanel.tsx` header with detailed Token Usage & Latency telemetry gauges.
5. Add test suites in `src/lib/__tests__/` and `src/sections/__tests__/`.

### Step 4: Standalone Packaging & Distribution Installer Scripts (R4)
1. Update `scripts/nanoforge-launcher.cjs`:
   - Implement dual-launching: start Fastify Host Daemon on port 4174 and UI static file server on port 4173 (or combined server).
   - Generate session authentication token and auto-launch default browser: `start "" "http://127.0.0.1:4173/?hostPort=4174&token=..."`.
2. Create `scripts/package-release.js`:
   - Automates `npm run build`, `esbuild` host bundling, `pkg` binary packaging for `release/NanoForge.exe`, copying assets to `release/dist/`, and archiving to `release/NanoForge-v0.6.0-windows-x64.zip`.
3. Create distribution installer scripts in `release/`:
   - `release/install-nanoforge.ps1` (PowerShell installer with Desktop & Start Menu shortcuts).
   - `release/install-nanoforge.bat` (one-click batch wrapper).
   - `release/uninstall-nanoforge.ps1` (clean uninstaller).
4. Update root `package.json` scripts:
   - `"package": "node scripts/package-release.js"`
   - `"verify": "npm run typecheck:protocol && npm run typecheck:host && npm run test:protocol && npm run test:host && npm test && npm run build"`

---

## 5. Verification Checklist & Success Criteria

- [x] Baseline test suites verified: Protocol (214/214), Host (322/322), Frontend (302/302).
- [x] Monorepo build verified: `npm run build` completes with 0 errors (2,545 modules).
- [x] Host typecheck gap identified with exact single-line fix.
- [x] Dual-launch architecture fully specified with port management and token handshake.
- [x] Windows executable and PowerShell distribution installer scripts specified.
- [x] All new test suites for Shared Memory, Telemetry, Theme Palette, and Packaging designed.

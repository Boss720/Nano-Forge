# Comprehensive Monorepo Build System, Test Infrastructure & Verification Harness Survey

**Date:** 2026-08-15  
**Surveyor:** survey_explorer_3  
**Working Directory:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`  
**Integrity Mode:** Development  

---

## 1. Executive Summary

A comprehensive investigation was conducted across the NanoForge codebase, examining all build configurations, TypeScript configurations, test runners, existing test suites, and verification harnesses.

### Key Metrics Summary
| Metric | Status / Count | Evidence |
|---|---|---|
| **Total Test Files** | 41 test files | 4 protocol + 16 host + 21 frontend/lib |
| **Total Unit/Integration Tests** | 439 passing tests (100%) | Protocol: 69, Host: 166, Frontend/Lib: 204 |
| **`npm run test:protocol`** | **PASS** (69/69 tests) | Duration: 821ms |
| **`npm run test:host`** | **PASS** (166/166 tests) | Duration: 4.94s |
| **`npm test`** (Frontend) | **PASS** (204/204 tests) | Duration: 9.92s |
| **`npm run build`** (`tsc -b && vite build`) | **PASS** (0 errors) | Duration: 35.22s, output in `dist/` |
| **`npm run typecheck:protocol`** | **PASS** (0 errors) | `tsc -p packages/protocol/tsconfig.json` |
| **`npm run typecheck:host`** | **FAIL** (3 TS errors) | `apps/agent-host/src/runs/coordinator.ts:332, 338, 340` |

---

## 2. Monorepo Structure & Package Scripts

### 2.1 Monorepo Topography
NanoForge is structured as a single-root monorepo with three logical layers:
1. **Frontend App (`src/`)**: React 19 + Vite 7 + Tailwind CSS multi-rail IDE.
2. **Shared Protocol (`packages/protocol/`)**: Pure TypeScript contracts, Zod schemas, topological algorithms, routing algorithms, and slash command schemas.
3. **Local Agent Host (`apps/agent-host/`)**: Node.js Fastify daemon, policy engine, process supervisor, browser manager, and SQLite audit ledger.

```
nano-forge/
├── package.json                         # Monorepo root package definition
├── tsconfig.json                        # Composite project references (app, node)
├── tsconfig.app.json                    # Frontend TypeScript config (src/)
├── tsconfig.node.json                   # Node/Vite build config
├── vite.config.ts                       # Vite bundler configuration
├── vitest.config.ts                     # Frontend Vitest configuration
├── packages/
│   └── protocol/
│       ├── tsconfig.json                # Protocol TS config (isolated)
│       ├── vitest.config.ts             # Protocol Vitest config
│       └── src/                         # Protocol source & tests
├── apps/
│   └── agent-host/
│       ├── tsconfig.json                # Host TS config (with @protocol/* path alias)
│       ├── vitest.config.ts             # Host Vitest config (with @protocol alias)
│       └── src/                         # Host daemon source & tests
└── src/                                 # Frontend UI source & tests
```

### 2.2 Package Manifest Analysis
- **Root `package.json`**:
  - Acts as the central dependency manager for the entire workspace.
  - Contains 31 runtime dependencies (Fastify, WebSocket, Radix UI, Lucide, Tailwind, Zod, etc.) and 23 devDependencies (TypeScript, Vite, Vitest, Testing Library, Playwright-core, ESLint).
- **Subpackage `package.json` Status**:
  - `packages/protocol/package.json`: **Does not exist**.
  - `apps/agent-host/package.json`: **Does not exist**.
  - All dependency resolution is centralized in root `node_modules`. Path aliases (`@/*` -> `./src/*` and `@protocol/*` -> `../../packages/protocol/src/*`) are configured via `tsconfig.json` and `vitest.config.ts` files.

### 2.3 Script Inventory (`package.json:6-17`)
| Script | Command Line | Target Scope | Observed Status |
|---|---|---|---|
| `dev` | `vite` | Starts local Vite dev server on port 3000 | Functional |
| `build` | `tsc -b && vite build` | Typechecks frontend and bundles production dist | **PASS** (35.22s, 0 errors) |
| `lint` | `eslint .` | Runs ESLint across workspace | Functional |
| `preview` | `vite preview` | Serves production build preview | Functional |
| `test` | `vitest run` | Runs frontend unit/component tests in `src/` | **PASS** (204/204 tests) |
| `test:protocol` | `vitest run --config packages/protocol/vitest.config.ts` | Runs protocol tests in `packages/protocol/src/` | **PASS** (69/69 tests) |
| `test:host` | `vitest run --config apps/agent-host/vitest.config.ts` | Runs agent host tests in `apps/agent-host/src/` | **PASS** (166/166 tests) |
| `typecheck:protocol` | `tsc -p packages/protocol/tsconfig.json` | Typechecks shared protocol package | **PASS** (0 errors) |
| `typecheck:host` | `tsc -p apps/agent-host/tsconfig.json` | Typechecks local agent host app | **FAIL** (3 type errors) |
| `start:host` | `tsx apps/agent-host/src/server.ts` | Starts backend Fastify daemon | Functional |

---

## 3. Build System & TypeScript Configuration Hierarchy

### 3.1 Build Execution Analysis (`npm run build`)
- Command: `tsc -b && vite build`
- Execution Result:
  - Modules Transformed: 2,456 modules.
  - Output Assets:
    - `dist/index.html` (0.44 kB)
    - `dist/assets/index-CNpXl4kZ.css` (97.00 kB)
    - `dist/assets/ImagePanel-9DvReBKx.js` (8.13 kB)
    - `dist/assets/index-BaK-cfmd.js` (960.48 kB)
  - Exit Code: `0` (Success).

### 3.2 TypeScript Configuration Hierarchy & Scope Isolation
1. **Root `tsconfig.json`**:
   - Uses project references: `[ { "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" } ]`.
   - Sets baseUrl `.` with path alias `@/*` -> `./src/*`.
2. **`tsconfig.app.json`**:
   - Targets `ES2022`, module `ESNext`, `jsx: react-jsx`, `strict: true`.
   - `include: ["src"]`.
   - Only checks `src/` files.
3. **`tsconfig.node.json`**:
   - Targets `ES2023`, module `ESNext`, `moduleResolution: bundler`.
   - `include: ["vite.config.ts"]`.
4. **`packages/protocol/tsconfig.json`**:
   - Targets `ES2022`, module `ESNext`, `moduleResolution: Bundler`, `strict: true`, `types: ["node"]`.
   - `include: ["src"]`.
5. **`apps/agent-host/tsconfig.json`**:
   - Targets `ES2022`, module `ESNext`, `moduleResolution: Bundler`, `strict: true`, `types: ["node"]`.
   - Path mapping: `"@protocol/*": ["../../packages/protocol/src/*"]`.
   - `include: ["src", "test"]`.

### 3.3 Critical TypeScript Discrepancy in `apps/agent-host`
Running `npm run typecheck:host` (`tsc -p apps/agent-host/tsconfig.json`) fails with 3 errors:
```
apps/agent-host/src/runs/coordinator.ts(332,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
apps/agent-host/src/runs/coordinator.ts(338,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
apps/agent-host/src/runs/coordinator.ts(340,7): error TS2322: Type '{ affectedScopes?: readonly string[] | undefined; sideEffecting?: boolean | undefined; approval?: "required" | "auto" | undefined; id: string; title: string; dependsOn: readonly string[]; }[]' is not assignable to type 'SubmittedStep[]'.
  Types of property 'approval' are incompatible.
    Type '"required" | "auto" | undefined' is not assignable to type '"required" | undefined'.
      Type '"auto"' is not assignable to type '"required"'.
```

#### Root Cause Analysis:
1. In `packages/protocol/src/plan.ts:105`, `PlanStep.approval` was extended to `z.enum(["required", "auto"]).optional()` and `ExecutionPlan.goal` is optional `goal?: string`.
2. In `apps/agent-host/src/runs/events.ts:35`, `SubmittedStep.approval` was typed strictly as `approval?: "required"`, and `PlanSubmittedEvent.goal` was typed as `goal: string`.
3. In `apps/agent-host/src/runs/coordinator.ts:330-348`, `plan.goal` and `s.approval` are mapped without fallback defaults or type widening.
4. **Resolution Required:** Synchronize `apps/agent-host/src/runs/events.ts` and `coordinator.ts` to accept `approval?: "required" | "auto"` and `goal: plan.goal ?? ""` or `goal?: string`.

---

## 4. Test Infrastructure & Test Frameworks

### 4.1 Test Framework
The entire monorepo standardizes on **Vitest v4.1.10**.

### 4.2 Configuration Breakdown
1. **Frontend (`vitest.config.ts`)**:
   - `test.environment`: `"node"` default.
   - `test.include`: `["src/**/*.test.{ts,tsx}"]`.
   - Path alias: `@` -> `./src`.
   - UI component tests declare `// @vitest-environment jsdom` at line 1.
2. **Protocol (`packages/protocol/vitest.config.ts`)**:
   - `test.environment`: `"node"`.
   - `test.include`: `["src/**/*.test.ts"]`.
   - Zero-dependency hermetic pure TypeScript tests.
3. **Agent Host (`apps/agent-host/vitest.config.ts`)**:
   - `test.environment`: `"node"`.
   - `test.include`: `["src/**/*.test.ts"]`.
   - `test.testTimeout`: 20,000ms (to allow fastify server and process spawning tests).
   - Path alias: `@protocol` -> `../../packages/protocol/src`.

### 4.3 Testing Libraries & Helpers
- `@testing-library/react` (v16.3.2): React DOM rendering and assertion utilities.
- `@testing-library/user-event` (v14.6.3): Realistic user interactions (clicks, keyboard input).
- `@testing-library/jest-dom` (v7.0.1): DOM matcher extensions (`toBeInTheDocument`, etc.).
- `jsdom` (v30.0.1): In-memory DOM emulation for UI component testing.
- `playwright-core` (v1.62.1): Used internally by `apps/agent-host/src/browser/` for headless browser automation and screenshot diffing. Note: Jest and standalone Playwright test runners (`playwright test`) are not configured.

---

## 5. Existing Test Suites & Test Inventory

### 5.1 Test Execution Results Matrix
| Suite | Runner Command | Test Files | Total Tests | Passed | Failed | Duration |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Protocol** | `npm run test:protocol` | 4 | 69 | 69 | 0 | 821ms |
| **Agent Host** | `npm run test:host` | 16 | 166 | 166 | 0 | 4.94s |
| **Frontend / Lib** | `npm test` | 21 | 204 | 204 | 0 | 9.92s |
| **TOTAL** | — | **41** | **439** | **439** | **0** | **~15.7s** |

### 5.2 Detailed Test File Catalog

#### Protocol Test Suite (`packages/protocol/src/` — 4 files, 69 tests)
1. `artifacts.test.ts` (5 tests): Format detection for diff, html, mermaid, markdown, json, images.
2. `commands.test.ts` (12 tests): POSIX argument tokenizer, quoting, flag parsing, command dispatch.
3. `plan.test.ts` (23 tests): DAG cycle detection (DFS/Tarjan), topological `readySteps()`, phase validation, state transitions.
4. `commands.adversarial.test.ts` (29 tests): Escaped quotes, nested flags, unknown tokens, malformed commands, boundary inputs.

#### Agent Host Test Suite (`apps/agent-host/src/` — 16 files, 166 tests)
1. `audit/store.test.ts` (9 tests): SQLite audit ledger, event hashing, sequence verification.
2. `browser/manager.test.ts` (14 tests): Headless Playwright lifecycle, tab isolation, origin gating.
3. `browser/visual.test.ts` (12 tests): Screenshot capture, pixelmatch visual diff assertions.
4. `mcp/client.test.ts` (17 tests): Isolated stdio client, tool namespace validation, secret injection.
5. `mcp/sseTransport.test.ts` (1 test): SSE transport for remote MCP servers.
6. `planning/validatePlan.test.ts` (17 tests): Server-side DAG cycle detection and step approval invariants.
7. `plugins/plugins.test.ts` (2 tests): Plugin manifest schema validation and loader.
8. `policy/policy.test.ts` (16 tests): Workspace confinement, path traversal prevention, command whitelists.
9. `providers/openaiCompatible.test.ts` (7 tests): SSE stream parsing, model delta frames, error handling.
10. `router/router.test.ts` (10 tests): Multi-model scoring router (capability, latency, cost).
11. `rules/loadRules.test.ts` (10 tests): Rule pack loading, glob matching, priority ordering.
12. `runs/coordinator.test.ts` (10 tests): Run lifecycle, pause/resume, approval gates, event streaming.
13. `server.test.ts` (11 tests): Fastify loopback daemon, bearer handshake, REST & WS endpoints.
14. `skills/registry.test.ts` (11 tests): Skill indexing, manifest parsing, instruction loader.
15. `terminal/runner.test.ts` (9 tests): Subprocess execution with Execa, timeout termination, 1MB output cap.
16. `workspace/filesystem.test.ts` (10 tests): Safe file reading/writing within workspace bounds.

#### Frontend / Lib Test Suite (`src/` — 21 files, 204 tests)
- **Library Tests (`src/lib/__tests__/` — 13 files, 147 tests)**:
  - `agentLoop.test.ts` (12 tests): Auto edit-verify loop, verification prompt injection.
  - `context.test.ts` (9 tests): Token estimation, message windowing, prompt assembly.
  - `exporter.test.ts` (8 tests): Markdown and JSON export formatting.
  - `hostClient.test.ts` (14 tests): WebSocket client transport, reconnection, request-response matching.
  - `nanogpt.test.ts` (21 tests): Model catalog, pricing calculation, magnitude heuristic fallback.
  - `patchParse.test.ts` (9 tests): Unified diff parsing, hunk extraction.
  - `persist.test.ts` (14 tests): LocalStorage session persistence, state restoration.
  - `sessionReducer.test.ts` (7 tests): Redux-style session actions (append message, update tool state).
  - `syntax.test.ts` (13 tests): Language detection, code block highlight parsing.
  - `usage.test.ts` (7 tests): Aggregate token and USD cost computation.
  - `usageLog.test.ts` (11 tests): Historical usage run logging, per-model rollups.
  - `vfs.test.ts` (15 tests): In-memory virtual file system, patch application.
  - `x402.test.ts` (15 tests): HTTP 402 pay-per-request quote parsing and authorization.
- **Section / Component Tests (`src/sections/__tests__/` — 8 files, 57 tests)**:
  - `App.hostWiring.test.tsx` (6 tests): End-to-end multi-rail wiring, host session state, approval routing.
  - `ArtifactDock.test.tsx` (4 tests): Multi-format artifact viewer, tab switching, modification submission.
  - `BrowserPermissionDialog.test.tsx` (7 tests): Origin allow/deny permissions, non-escalation invariants.
  - `IntegrationsPanel.test.tsx` (7 tests): MCP/Skills/Rules UI management, toggle handlers.
  - `ModelPanel.ConnectDialog.test.tsx` (4 tests): Model configuration and connection modal.
  - `PlanPanel.test.tsx` (12 tests): Approval-required badge, step states, chat non-authority.
  - `RouteDecisionCard.test.tsx` (5 tests): Router fallback decision rendering and approval gates.
  - `VisualEvidenceCard.test.tsx` (4 tests): Visual diff gallery, assertion status rendering.

---

## 6. Requirement-Driven Test Gap Analysis

### 6.1 R1: Phase 2 UI (Visual Planning Mode & Slash Command Engine)
| Feature Area | Current Status | Test Gap | Needed Test Suite |
|---|---|---|---|
| **Phase Group Accordions** (`PlanPhase`) | Model exists in protocol, but `PlanPanel.tsx` renders flat list | 0 tests for accordion collapse/expand, phase status meters, phase order | `src/components/plan/__tests__/PhaseAccordion.test.tsx` |
| **Interactive Step/Phase Approvals** | Single-step approve button tested | Missing phase-level "Approve Phase" and global "Approve All" toggle tests | `src/sections/__tests__/PlanPanel.approval.test.tsx` |
| **DAG Dependency Badges** | DependsOn IDs rendered as text | Missing interactive clickable dependency badges, dependency status pills | `src/components/plan/__tests__/DependencyBadgeList.test.tsx` |
| **Slash Command Popover** | Core parser tested; UI popover not implemented | Missing keyboard navigation (`Up`/`Down`/`Enter`/`Esc`), trigger on `/`, arg hints | `src/components/__tests__/SlashCommandPalette.test.tsx` |
| **Context Mentions (`@file`, `@rule`)** | Mention schema defined in protocol | Missing fuzzy workspace file lookup, mention token insertion, chip rendering | `src/components/__tests__/ContextMention.test.tsx` |
| **Planning Mode Trigger** | `/plan` parsed in protocol | Missing App-level transition to Planning Mode when `/plan <goal>` is entered | `src/sections/__tests__/ChatPanel.slashIntegration.test.tsx` |

### 6.2 R2: Standalone Headless CLI Runner (`nanoforge run`)
| Feature Area | Current Status | Test Gap | Needed Test Suite |
|---|---|---|---|
| **CLI Entrypoint** (`bin/nanoforge.ts`) | File does not exist | 0 tests for CLI arg parsing, help text, flag validation | `apps/agent-host/src/cli/__tests__/cli.test.ts` |
| **Non-Interactive Run** (`nanoforge run "<prompt>"`) | Coordinator exists; no headless runner | Missing headless loop execution, non-interactive auto-approval policies | `apps/agent-host/src/cli/__tests__/run.test.ts` |
| **NDJSON Event Stream** | Coordinator emits events | Missing stdout NDJSON stream formatter, stderr progress formatting | `apps/agent-host/src/cli/__tests__/ndjsonFormatter.test.ts` |
| **CLI Exit Code Semantics** | Not implemented | Missing POSIX exit code assertions (0=Success, 1=Fail, 2=Policy, 3=Syntax) | `apps/agent-host/src/cli/__tests__/exitCodes.test.ts` |
| **Headless Plan Generation** (`nanoforge plan "<goal>"`) | Protocol validatePlan exists | Missing headless plan output in JSON/table formats | `apps/agent-host/src/cli/__tests__/plan.test.ts` |
| **Daemon Auto-Discovery & Handshake** | Fastify server exists | Missing CLI discovery over loopback socket/named pipe and token auth | `apps/agent-host/src/cli/__tests__/daemonClient.test.ts` |

### 6.3 R3: Bidirectional PTY Virtual Terminal Dock
| Feature Area | Current Status | Test Gap | Needed Test Suite |
|---|---|---|---|
| **Terminal Dock UI** (`TerminalDock.tsx`) | File does not exist | 0 tests for xterm.js rendering, tab creation/close, active tab switching | `src/sections/__tests__/TerminalDock.test.tsx` |
| **PTY Host Manager** (`ptyManager.ts`) | Only basic Execa runner exists | Missing node-pty process spawning, Windows ConPTY/pty fork, ring buffers | `apps/agent-host/src/terminal/__tests__/ptyManager.test.ts` |
| **PTY Wire Protocol** | Protocol lacks terminal schemas | Missing Zod schemas and WS handlers for `terminal.open`, `stdin`, `resize`, `data`, `exit` | `packages/protocol/src/terminal.test.ts` & `apps/agent-host/src/server.terminal.test.ts` |
| **Interactive Terminal Stdin/Resize** | Not implemented | Missing stdin forwarding from xterm to node-pty, resize event forwarding | `apps/agent-host/src/terminal/__tests__/ptyIpc.test.ts` |

### 6.4 R4: Integration, Protocol Synchronization & Build Verification
| Feature Area | Current Status | Test Gap | Needed Test Suite |
|---|---|---|---|
| **Typecheck Consistency** | `typecheck:host` fails | Missing sync between `PlanStep.approval`, `goal` in `events.ts` and protocol | `apps/agent-host/src/runs/events.ts` fix |
| **Wire Protocol Synchronization** | Basic Fastify WS tests exist | Missing end-to-end WS tests for `plan.propose`, `plan.update_step`, `plan.approve`, `command.execute` | `apps/agent-host/src/__tests__/wireSync.test.ts` |
| **Unified Verification Script** | Scripts are fragmented (`test`, `test:protocol`, `test:host`) | Missing unified `npm run test:all` or `npm run verify` script to run all 3 suites and typechecks | `package.json` scripts upgrade |

---

## 7. Recommended Test Harness & Infrastructure Action Items

1. **Fix `typecheck:host` Type Mismatch**:
   - Update `apps/agent-host/src/runs/events.ts:35` to `approval?: "required" | "auto"`.
   - Update `apps/agent-host/src/runs/events.ts:59` to `goal?: string` (or normalize with `goal: plan.goal ?? ""`).
   - Fix `apps/agent-host/src/runs/coordinator.ts:330-348` to properly map `goal` and `approval`.
2. **Synchronize Frontend `PlanStepStatus` & `PlanUIState` Types**:
   - Update `src/types/index.ts` to include `"ready"`, `"skipped"` in `PlanStepStatus` and `"failed"` in `PlanUIState`.
3. **Add Unified Monorepo Test & Verification Scripts in `package.json`**:
   - `"test:all": "vitest run --config packages/protocol/vitest.config.ts && vitest run --config apps/agent-host/vitest.config.ts && vitest run"`
   - `"typecheck:all": "tsc -b && tsc -p packages/protocol/tsconfig.json && tsc -p apps/agent-host/tsconfig.json"`
   - `"verify": "npm run typecheck:all && npm run test:all && npm run build"`
4. **Implement Missing Component & Integration Test Suites**:
   - Phase 2 UI test suites for `PhaseAccordion`, `SlashCommandPalette`, and `ActiveGoalBanner`.
   - Phase 3 Headless CLI test suites in `apps/agent-host/src/cli/__tests__/`.
   - Phase 3 PTY terminal test suites in `packages/protocol/`, `apps/agent-host/src/terminal/`, and `src/sections/__tests__/`.

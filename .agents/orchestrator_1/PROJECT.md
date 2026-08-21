# Project: NanoForge Phase 2 & Phase 3 Implementation

## Architecture
- **Monorepo Topology**: Single-root package configuration with TypeScript project references across `packages/protocol`, `apps/agent-host`, and `src/` (frontend).
- **Protocol Boundary (`packages/protocol`)**: Zero-dependency shared contracts (`plan.ts`, `commands.ts`, `routing.ts`, `artifacts.ts`, `terminal.ts`).
- **Agent Host Backend (`apps/agent-host`)**: Fastify loopback daemon with WebSocket JSON-RPC / NDJSON streaming, RunCoordinator, PTY Manager, Approval Gate, Workspace and Audit stores.
- **Headless CLI (`bin/nanoforge.ts`, `apps/agent-host/src/cli/`)**: Non-interactive command-line interface supporting `nanoforge run` and `nanoforge plan` with structured NDJSON event feeds.
- **Frontend UI (`src/`)**: React 19 + Tailwind CSS + Vitest frontend, featuring Antigravity-style Visual Planning (`PlanPanel.tsx`), Extensible Slash Command Engine (`ChatComposer.tsx`), and Multi-Tab Virtual Terminal Dock (`TerminalDock.tsx` with `@xterm/xterm`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Protocol PTY Frames & Host Type Sync | Define `terminal.ts` Zod schemas and sync `events.ts`/`coordinator.ts` types | M1 | Survey & R3 |
| 2 | Visual Plan Phase Accordions | `PlanPanel.tsx` collapsible `PlanPhase` groups, step counters, DAG badges | M2 | R1 |
| 3 | Interactive Step/Phase Approval Toggles | Per-step and batch per-phase approval controls in `PlanPanel.tsx` | M2 | R1 |
| 4 | Floating Slash Command Caret Popover | Keyboard navigation (`Up`/`Down`/`Enter`/`Escape`), `/plan`, `/goal`, etc. in `ChatComposer.tsx` | M2 | R1 |
| 5 | `@file` Context Mention Autocomplete | Fuzzy file search popup and context mention chips in `ChatComposer.tsx` | M2 | R1 |
| 6 | Headless CLI Runner (`nanoforge run`) | Standalone CLI entrypoint `bin/nanoforge.ts` & `apps/agent-host/src/cli/` with NDJSON streaming | M3 | R2 |
| 7 | Headless Plan Generation (`nanoforge plan`) | Standalone plan generator CLI with JSON/NDJSON output | M3 | R2 |
| 8 | Host Daemon PTY Session Manager | `apps/agent-host/src/terminal/ptyManager.ts` managing child/node-pty streams & ring buffer | M4 | R3 |
| 9 | Bidirectional Virtual Terminal Dock | `src/sections/TerminalDock.tsx` with `@xterm/xterm`, multi-tab sessions, ANSI, resize sync | M4 | R3 |
| 10 | Comprehensive Test Suite & Quality Verification | Unit, integration & E2E tests for R1-R4, 100% pass rate, 0 build errors | M5 | R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Protocol & Backend Alignment | `packages/protocol/src/terminal.ts`, `events.ts`, `coordinator.ts` type fixes | none | DONE |
| 2 | Phase 2 Frontend Planning & Slash UI | `PlanPanel.tsx`, `ChatComposer.tsx`, `ChatPanel.tsx`, `@file` autocomplete | M1 | DONE |
| 3 | Headless CLI Runner & NDJSON Stream | `bin/nanoforge.ts`, `apps/agent-host/src/cli/`, POSIX exit codes | M1 | DONE |
| 4 | Terminal Dock & Host PTY Stream | `apps/agent-host/src/terminal/ptyManager.ts`, `src/sections/TerminalDock.tsx` | M1 | DONE |
| 5 | E2E Testing, Hardening & Final Audit | Full test suite execution across monorepo, build verification, forensic audit | M2, M3, M4 | IN_PROGRESS |

## Interface Contracts

### Protocol Terminal Wire Frames (`packages/protocol/src/terminal.ts`)
- `terminal.create`: `{ id?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string>; shell?: string }`
- `terminal.input`: `{ id: string; data: string }`
- `terminal.resize`: `{ id: string; cols: number; rows: number }`
- `terminal.kill`: `{ id: string; signal?: string }`
- `terminal.created`: `{ id: string; pid: number; cols: number; rows: number }`
- `terminal.data`: `{ id: string; data: string }`
- `terminal.exit`: `{ id: string; exitCode: number; signal?: string }`

### ChatComposer & PlanPanel Contracts
- `ChatComposer`: Props `{ onSendMessage: (text: string, mentions?: ContextMention[]) => void; onTriggerPlan?: (goal: string) => void; disabled?: boolean; workspaceFiles?: VirtualFile[] }`
- `PlanPanel`: Renders `PlanPhase` groupings with status indicators, per-step approval switches, and `onApprovePhase(phaseId)` batch approval helper.

### Headless CLI Invocation
- `nanoforge run "<prompt>" [--json] [--output <dir>] [--auto-approve <none|safe|all>] [--timeout <sec>]`
- `nanoforge plan "<goal>" [--json]`
- Exit codes: 0 (Success), 1 (Failure), 2 (Policy violation), 3 (Cancelled), 4 (Approval denied / timeout), 5 (Config/Auth error), 6 (Verification failed).

## Code Layout
- `packages/protocol/src/`: Shared Zod schemas and validation logic
- `apps/agent-host/src/cli/`: Headless CLI implementation and formatters
- `apps/agent-host/src/terminal/`: Terminal runner and PTY manager
- `bin/nanoforge.ts`: Standalone CLI binary entrypoint
- `src/sections/`: UI components (`PlanPanel.tsx`, `ChatComposer.tsx`, `ChatPanel.tsx`, `TerminalDock.tsx`)

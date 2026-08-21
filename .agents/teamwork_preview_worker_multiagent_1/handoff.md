# Handoff Report: Multi-Agent Orchestration & Headless CLI PRD Authoring

**Author:** Worker 2 (Multi-Agent & Headless Architecture Lead)  
**Date:** 2026-08-15  
**Working Directory:** `.agents/teamwork_preview_worker_multiagent_1`  
**Deliverable Targets:**
1. `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/docs/PRD_MULTI_AGENT_ORCHESTRATION.md`
2. `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/docs/PRD_HEADLESS_CLI_TERMINAL.md`

---

## 1. Observation

Direct code examination of the repository and the 3 survey reports revealed:
1. **Host & Coordinator Structure (`apps/agent-host/src/runs/coordinator.ts:210-908`)**:
   - `RunCoordinator` currently executes static DAG steps in sequence with a single model proposal per step.
   - LLM tool proposals are hardcoded strictly to `terminal.exec`; subagent invocation, file edits, browser verification, and background tasks are not natively routable.
   - Assistant text tokens (`delta.text`) are swallowed locally (`coordinator.ts:862`), and terminal child process stream chunks (`handle.events`) are unhooked from the WebSocket wire during runs (`coordinator.ts:757-785`).
2. **Protocol Surface (`packages/protocol/src/`)**:
   - `packages/protocol` only exported `plan.ts` and `routing.ts` without shared wire protocol message definitions, subagent lifecycles, background task management, or terminal PTY frames.
3. **Terminal Architecture (`src/sections/ChatPanel.tsx:351-444`, `apps/agent-host/src/terminal/runner.ts`)**:
   - Terminal execution was represented as static `<pre>` text blocks inside `ToolRunCard`.
   - Zero PTY / `@xterm/xterm` / `node-pty` integration existed in the codebase, preventing interactive stdin prompts, ANSI TrueColor rendering, or dynamic terminal resizing.
4. **Headless Execution Capabilities**:
   - The host had a daemon starter (`server.ts:267-280`) but lacked a standalone headless CLI command runner (`nanoforge run <prompt>`) with automated policy approval tiers, NDJSON streaming, and standardized POSIX exit codes.

---

## 2. Logic Chain

1. **Multi-Agent Orchestration Requirement**:
   - Complex development tasks exceed single-agent context windows and cause hallucination loops.
   - By designing an Erlang/OTP-inspired **Supervisor Tree** with specialized subagent archetypes (`explorer`, `implementer`, `qa`, `specialist`, `verifier`, `planner`), subagents can operate in parallel with isolated context windows.
   - By eliminating busy-wait polling loops and introducing an **Actor-Model Mailbox Bus (`send_message`) with Reactive Wakeups**, agents sleep at zero token and CPU cost until explicit inbound messages, task completions, or timer events arrive.
   - By providing 3 **Workspace Isolation Modes** (`inherit`, `branch` with Git worktrees, and `share`), concurrent agents can modify code without filesystem race conditions.
   - By specifying a 5-rung **Failure Escalation Ladder** (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`), the system autonomously recovers from test errors, context saturation, and tool failures.

2. **Headless CLI & Terminal Requirement**:
   - CI/CD automation, scripting, and developer terminal ergonomics require non-interactive execution and real PTY emulation.
   - By designing `nanoforge run <prompt>` with configurable `--auto-approve` tiers (`none`, `safe`, `all`), `--output` formats (`text`, `json`, `ndjson`, `raw`), and POSIX exit codes (`0` to `6`), NanoForge becomes fully automatable in pipelines.
   - By integrating `node-pty` on the backend and `@xterm/xterm` (with WebGL, Fit, Unicode11 addons) on the frontend in a multi-tab `TerminalDock`, developers gain hardware-accelerated, TrueColor interactive terminal capabilities.

---

## 3. Caveats

1. **Git Worktree Support**: `branch` isolation mode assumes the target workspace is a valid Git repository with `git` available in `PATH`. For non-git directories, the system falls back to `inherit` mode with `.agents/` metadata confinement.
2. **PTY Platform Differences**: `node-pty` uses ConPTY on Windows 10+ and standard POSIX pseudo-terminals on Linux/macOS. Windows environments without ConPTY will fall back to winpty or structured `execa` child process pipes.
3. **Headless Approval Bounds**: In headless mode with `--auto-approve=safe`, commands are authorized based on strict policy rules. Actions attempting privilege escalation (`sudo`, `runas`) or path traversal outside `workspaceRoot` will always result in `EXIT_POLICY_VIOLATION` (Exit Code 2).

---

## 4. Conclusion

We have authored and delivered two exhaustive, production-grade technical PRD specifications:

1. **`docs/PRD_MULTI_AGENT_ORCHESTRATION.md`** (867 lines):
   - Executive Summary, Goals, Non-Goals, and Architecture Topologies.
   - Hierarchical Subagent Model (`invoke_subagent`, `manage_subagents`, `send_message`).
   - Supervisor Trees (`OneForOne`, `OneForAll`, `RestForOne`), formal State Machines, and Heartbeat Liveness.
   - Reactive Wakeup Event Multiplexer (Zero-Polling).
   - Workspace Isolation Modes (`inherit`, `branch` with Git worktrees, `share`).
   - 5-Rung Failure Escalation Ladder with recovery logic.
   - Background Daemon Tasks and `schedule` tool (One-shot timers and Cron jobs).
   - Production-ready TypeScript protocol definitions in `@protocol/subagent` and `@protocol/tasks`.
   - Fastify WebSocket and route handlers in `apps/agent-host`.
   - Security constraints and SQLite tamper-proof audit ledger (`audit.db`).

2. **`docs/PRD_HEADLESS_CLI_TERMINAL.md`** (514 lines):
   - Headless CLI Architecture (`nanoforge run <prompt>`).
   - Non-interactive execution flags (`--auto-approve`, `--output`, `--max-turns`, `--timeout`, etc.).
   - Standard I/O framing, NDJSON event streaming, and POSIX Exit Code Contract (0 to 6).
   - Embedded PTY integration (`@xterm/xterm` + `node-pty`).
   - Multi-tab Terminal Dock UI component (`TerminalDock.tsx`).
   - Host daemon PTY session manager (`PtyManager.ts`) with 2MB circular ring buffers and flow control.
   - Complete automated verification test matrix.

---

## 5. Verification Method

To independently inspect and verify the deliverables:

1. **Inspect Deliverable Files**:
   - `docs/PRD_MULTI_AGENT_ORCHESTRATION.md`
   - `docs/PRD_HEADLESS_CLI_TERMINAL.md`

2. **Verify Monorepo Integrity & Test Suites**:
   ```powershell
   npm run test:protocol
   npm run test:host
   npm test
   ```

3. **Verify Typecheck**:
   ```powershell
   npm run typecheck:protocol
   npm run typecheck:host
   ```

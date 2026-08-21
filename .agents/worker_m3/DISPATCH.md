## 2026-08-15T07:23:07Z
You are Worker 3 (Role: Frontend & Visual Control Plane Engineer).
Your task is to implement Milestone 3 of NanoForge Phase 4 & Phase 5:

Working Directory: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge
Agent Metadata Directory: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/worker_m3/
Authoritative Requirements: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/ORIGINAL_REQUEST.md
Architecture & Specifications: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md and .agents/spec_miner_ui_tests/report.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope of Work for Milestone 3:
1. Client Transport & Session Hooks:
   - Expand `src/lib/hostClient.ts`: Add subagent and daemon task RPC methods (`invokeSubagent`, `manageSubagents`, `sendMessage`, `defineSubagent`, `manageTask`, `createSchedule`) and typed WebSocket event handlers (`subagent.spawned`, `subagent.state`, `subagent.message`, `subagent.tree_updated`, `task.*`, `schedule.*`).
   - Expand `src/lib/hostSession.ts`: Add subagents state, activeSubagentId, inter-agent messages, daemon tasks, schedules, and reactive mutation dispatchers.
2. Visual Control Plane Components (`src/sections/SubagentsPanel.tsx` and subcomponents in `src/sections/subagents/`):
   - `SubagentsPanel.tsx`: Top-level dock / container with tabs ("Swarm Tree", "Tool Activity", "Messages", "Daemons & Schedules"), top metrics bar (active agents, tokens, daemons, timers), spawn button, filter/search, kill all.
   - `AgentSwarmTreeView.tsx`: Visual hierarchical supervision tree with depth indentation/connectors, status badges for all 7 states ("running", "idle", "waiting_for_input", "waiting_for_dependents", "waiting_for_message", "canceling", "errored"), uptime, tokens, liveness indicators (green/amber/red STALLED > 180s), select/inspect, message, kill agent, kill tree.
   - `AgentToolInspector.tsx`: Active subagent tool execution stream, kind icons, duration, collapsible JSON parameter tree, live ANSI/streaming log output console with 2MB buffer, auto-scroll, stop tool button.
   - `AgentMailboxViewer.tsx`: Inter-agent message log with sender/recipient pills, Markdown body, 5-component handoff accordion (Observation, Logic Chain, Caveats, Conclusion, Verification Method), artifact link chips, quick-reply composer.
   - `DaemonTaskManager.tsx`: Background daemon task list (PID, command, cwd, uptime, status, interactive STDIN input bar, kill button, log modal) and one-shot timer/cron monitors (countdown, cadence, iteration count, cancel).
   - `SpawnSubagentModal.tsx`: Dynamic spawner dialog with archetypes, roles, prompt, isolation mode ("inherit", "branch", "share"), tool permission check grid, timeout/tokens limits, pre-flight validation (warning and block if depth >= 3 or concurrency >= 8).
3. Shell Integration:
   - `src/sections/TopBar.tsx`: Swarm status toggle button with active subagent count badge.
   - `src/App.tsx`: Dock / toggle integration for `SubagentsPanel` alongside `PlanPanel`, `ArtifactDock`, etc.
4. Comprehensive React Component & Integration Tests:
   - Create test suites in `src/sections/__tests__/` and `src/lib/__tests__/` (e.g. `SubagentsPanel.test.tsx`, `AgentSwarmTreeView.test.tsx`, `AgentToolInspector.test.tsx`, `AgentMailboxViewer.test.tsx`, `DaemonTaskManager.test.tsx`, `SpawnSubagentModal.test.tsx`, `hostSession.subagents.test.ts`).
   - Run `npm test`, `npm run test:host`, `npm run test:protocol`, and `npm run build` using `run_command` in `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`.
   - Ensure 100% of all tests pass with 0 errors, and clean production build with 0 TypeScript/Vite errors.
5. Write handoff report to `.agents/worker_m3/handoff.md` and send a completion message back to parent.

## 2026-08-15T12:50:57Z
You are Worker M3 for NanoForge (M3: Frontend Swarm Capabilities, Shared Memory UI & Playground).
Your working directory is: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_worker_m3/

You MUST read:
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/ORIGINAL_REQUEST.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_explorer_survey_2/analysis.md
- Existing frontend swarm components (`src/sections/SubagentsPanel.tsx`, `src/sections/subagents/`, `src/lib/hostClient.ts`, `src/lib/hostSession.ts`)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Exclusively Owned Files:
1. `src/sections/subagents/AgentMemoryViewer.tsx`: Create a full-featured cross-agent shared memory explorer & editor tab. Includes namespace dropdown/filter (`global`, `swarm`, `agent:<id>`, `private:<id>`, etc.), search input, formatted JSON viewer, entry metadata inspector (key, namespace, author, version, TTL, byte size), "Set Key" modal dialog, "Delete Key" action, and "Query" filter.
2. `src/sections/subagents/AgentSwarmPlayground.tsx`: Create an interactive E2E swarm execution playground with prompt dispatch console, step-by-step turn execution, simulated/real turn toggle, turn status logs, and supervisor failure injection controls (`one_for_one`, `one_for_all`, `rest_for_one`).
3. `src/sections/subagents/AgentSwarmTreeView.tsx`: Add token budget progress gauges (emerald/amber/red), turn latency badges (avg & last turn latency ms), burn rate indicators (tok/s), and estimated USD cost meters to subagent node cards.
4. `src/sections/SubagentsPanel.tsx`: Embed the new `Playground` and `Shared Memory` tabs into the main dock, and upgrade the top summary metrics bar (Active Agents, Token Consumption with prompt/completion breakdown, Burn Rate & Latency, Shared Memory count, Daemons & Timers).
5. `src/lib/hostClient.ts` & `src/lib/hostSession.ts`: Add WebSocket RPC helpers (`setSharedMemory`, `getSharedMemory`, `querySharedMemory`, `deleteSharedMemory`, `dispatchPlaygroundTurn`, `simulateAgentTurn`, `injectAgentFailure`) and wire event listeners for `memory.entry_set`, `memory.entry_deleted`, `memory.cleared`, and `subagent.telemetry_updated`.
6. `src/sections/subagents/__tests__/AgentMemoryViewer.test.tsx` & `src/sections/subagents/__tests__/AgentSwarmPlayground.test.tsx`: Comprehensive component tests.

Verification commands:
- Run `npm test`
- Run `npm run build`
Ensure 100% tests pass and 0 build errors.

Output Requirements:
- Write `changes.md` and `handoff.md` to your working directory.
- Send a completion message to the orchestrator.

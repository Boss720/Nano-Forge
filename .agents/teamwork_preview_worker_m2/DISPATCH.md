## 2026-08-15T12:44:36Z
You are Worker M2 for NanoForge (M2: Agent Host Engine Shared Memory & Telemetry).
Your working directory is: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_worker_m2/

You MUST read:
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/ORIGINAL_REQUEST.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_explorer_survey_1/analysis.md
- Existing `apps/agent-host/src/` files

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Exclusively Owned Files:
- `apps/agent-host/src/agents/memory.ts`: Create `SharedMemoryEngine` class extending EventEmitter with namespace support (`global`, `swarm`, `agent:<id>`, `private:<id>`), version incrementing, TTL expiration sweeper, search/query matching, lifecycle event emitting, and unit-tested methods.
- `apps/agent-host/src/agents/telemetry.ts`: Create `TelemetryTracker` class tracking prompt/completion tokens, calculated USD cost based on model rates, tokens/sec throughput, turn counts, last turn latency, average turn latency, and p95 turn latency.
- `apps/agent-host/src/agents/tools.ts`: Add tool executors for memory operations: `executeMemorySetTool`, `executeMemoryGetTool`, `executeMemoryQueryTool`, `executeMemoryDeleteTool`.
- `apps/agent-host/src/agents/supervisor.ts`: Integrate `SharedMemoryEngine` and `TelemetryTracker` into the supervisor and lifecycle methods (`recordTurnTelemetry`, etc.).
- `apps/agent-host/src/protocol.ts`: Wire message schemas for memory requests/results and telemetry events.
- `apps/agent-host/src/session.ts`: Wire inbound WebSocket handlers for `memory.set`, `memory.get`, `memory.query`, `memory.delete` and forward memory events to clients.
- `apps/agent-host/src/agents/memory.test.ts` (and/or `telemetry.test.ts`): Comprehensive unit and concurrency tests for memory engine, TTL expiration, namespace isolation, telemetry tracking, and tool execution.

Verification commands:
- Run `npm run test:host`
- Run `npm run typecheck:host`
Ensure 100% tests pass and 0 TypeScript errors.

Output Requirements:
- Write `changes.md` and `handoff.md` to your working directory.
- Send a completion message to the orchestrator.

# Changes Summary: Milestone M2 (Agent Host Engine Shared Memory & Telemetry)

## Overview
Implemented the cross-agent shared memory engine, token consumption & latency telemetry tracking system, memory tool execution bindings, supervisor lifecycle integration, and WebSocket RPC routing for NanoForge Agent Host.

## Modified & Created Files

### 1. `apps/agent-host/src/agents/memory.ts` (NEW)
- Created `SharedMemoryEngine` class extending `EventEmitter`.
- Implemented in-memory key-value storage with namespace sandboxing (`global`, `swarm`, `agent:<id>`, `private:<id>`, and custom namespaces).
- Implemented automatic version incrementing on subsequent mutations and timestamp tracking.
- Implemented TTL expiration detection and periodic background sweeping (`sweepExpired()`, `startSweeper()`, `stopSweeper()`).
- Implemented search/query matching with substring search across keys and values, tag intersection filtering, and pagination offset/limit.
- Implemented typed event emissions (`memory.entry_set`, `memory.entry_deleted`, `memory.cleared`, and general `event`).

### 2. `apps/agent-host/src/agents/telemetry.ts` (NEW)
- Created `TelemetryTracker` class for per-agent and fleet-wide metrics.
- Tracked prompt tokens, completion tokens, total tokens, and turn count.
- Computed USD cost based on model input/output rates (`costPer1kInput`, `costPer1kOutput`).
- Implemented latency statistics: last turn latency, mean average latency, and 95th percentile latency (`calculateP95Latency`).
- Computed streaming throughput rate (tokens / sec) and accumulated tool execution durations.
- Implemented fleet-wide aggregation (`getFleetTelemetry()`).

### 3. `apps/agent-host/src/agents/types.ts`
- Updated `SubagentNode` interface to include optional `telemetry?: SubagentTelemetry;`.

### 4. `apps/agent-host/src/agents/registry.ts`
- Updated `SubagentRegistry.getSummary(id)` to include `telemetry: node.telemetry` in `SubagentInfo` wire summaries.

### 5. `apps/agent-host/src/agents/tools.ts`
- Added tool executor functions:
  - `executeMemorySetTool(memoryEngine, rawParams, authorInfo)`
  - `executeMemoryGetTool(memoryEngine, rawParams)`
  - `executeMemoryQueryTool(memoryEngine, rawParams)`
  - `executeMemoryDeleteTool(memoryEngine, rawParams)`

### 6. `apps/agent-host/src/agents/supervisor.ts`
- Instantiated `SharedMemoryEngine` (`this.memory`) and `TelemetryTracker` (`this.telemetry`) in `SubagentSupervisor`.
- Added `recordTurnTelemetry(subagentId, input)` method to record turn metrics, enforce token budget limits, update node telemetry, and emit `"subagent.telemetry_updated"` lifecycle events.
- Initialized telemetry on subagent spawn.

### 7. `apps/agent-host/src/agents/index.ts`
- Exported `./memory.js` and `./telemetry.js`.

### 8. `apps/agent-host/src/protocol.ts`
- Added client message schemas for `memory.set`, `memory.get`, `memory.query`, and `memory.delete`.
- Added host message schemas for `memory.set.result`, `memory.get.result`, `memory.query.result`, `memory.delete.result`, and `memory.event`.

### 9. `apps/agent-host/src/session.ts`
- Added `memoryEngine` to `AgentSessionOptions`.
- Subscribed to memory events and forwarded them over WebSocket as `{ type: "memory.event", event, at }`.
- Handled inbound client messages for `memory.set`, `memory.get`, `memory.query`, and `memory.delete`.

### 10. `apps/agent-host/src/agents/memory.test.ts` (NEW)
- Added 22 tests covering CRUD, versioning, namespace sandboxing, TTL expiration, query filtering, pagination, lifecycle events, tool executors, and high-volume concurrent writes.

### 11. `apps/agent-host/src/agents/telemetry.test.ts` (NEW)
- Added 10 tests covering p95 latency calculation, token accumulation, cost estimation, tool duration tracking, fleet aggregation, supervisor integration, wire event broadcasting, and budget overflow escalation.

### 12. `apps/agent-host/src/server.test.ts`
- Added integration test verifying WebSocket RPC handling for memory requests and event broadcasts.

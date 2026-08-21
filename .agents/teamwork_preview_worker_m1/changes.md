# Changes Ledger: Milestone 1 (M1: Protocol Shared Memory & Telemetry)

## Overview
Implemented pure isomorphic Zod schemas, TypeScript types, wire protocol lifecycle events, and helper utilities for Cross-Agent Shared Memory and Subagent Telemetry in `@protocol` (`packages/protocol`).

---

### 1. `packages/protocol/src/memory.ts` (New File)
- **Error Codes & Constants**:
  - `MEMORY_ERROR_CODES`: `ERR_MEMORY_KEY_INVALID`, `ERR_MEMORY_NAMESPACE_INVALID`, `ERR_MEMORY_TTL_INVALID`, `ERR_MEMORY_ENTRY_NOT_FOUND`, `ERR_MEMORY_LIMIT_EXCEEDED`, `ERR_MEMORY_UNAUTHORIZED`.
  - `DEFAULT_MEMORY_NAMESPACE = "global"`, `MAX_MEMORY_KEY_LENGTH = 256`, `MAX_MEMORY_NAMESPACE_LENGTH = 128`, `MAX_MEMORY_TAG_LENGTH = 64`, `MAX_MEMORY_QUERY_LIMIT = 100`, `DEFAULT_MEMORY_QUERY_LIMIT = 50`.
- **Core Schemas & Types**:
  - `memoryEntrySchema` / `MemoryEntry`: Core shared memory record with key, value, namespace, authorId, authorName, tags, version, createdAt, updatedAt, ttlSeconds, expiresAt.
- **Tool Parameter & Result Schemas**:
  - `memorySetParamsSchema` / `MemorySetParams` & `memorySetResultSchema` / `MemorySetResult`
  - `memoryGetParamsSchema` / `MemoryGetParams` & `memoryGetResultSchema` / `MemoryGetResult`
  - `memoryQueryParamsSchema` / `MemoryQueryParams` / `MemoryQueryParamsInput` & `memoryQueryResultSchema` / `MemoryQueryResult`
  - `memoryDeleteParamsSchema` / `MemoryDeleteParams` & `memoryDeleteResultSchema` / `MemoryDeleteResult`
- **Wire Lifecycle Events**:
  - `memoryLifecycleEventSchema` / `MemoryLifecycleEvent` discriminated union with `memory.entry_set`, `memory.entry_deleted`, `memory.cleared`.
- **Pure Helpers**:
  - `formatMemoryKey(namespace, key)`: Formats namespaced internal key (`namespace:::key`).
  - `parseMemoryKey(internalKey)`: Parses internal key back to `{ namespace, key }`.
  - `isMemoryExpired(entry, referenceTime)`: Accurate expiration check against timestamps.
  - `createMemoryEntry(params, options)`: Pure constructor computing TTL, version, and ISO timestamps.
  - `matchesMemoryQuery(entry, params)`: Pure search/filtering against namespace, query (key or serialized value), and tags.
  - `validateMemoryNamespace(namespace)`: Boundary and character whitelist validator.
  - `validateMemoryKey(key)`: Boundary, non-empty, and null-byte validator.

---

### 2. `packages/protocol/src/subagents.ts` (Updated File)
- **Telemetry Schema & Types**:
  - `subagentTelemetrySchema` / `SubagentTelemetry`: Tracks `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd`, `tokensPerSecond`, `turnCount`, `avgTurnLatencyMs`, `lastTurnLatencyMs`, `p95TurnLatencyMs`, `totalDurationMs`, `toolDurationMs`.
  - `createDefaultSubagentTelemetry()`: Zero-initialized telemetry factory helper.
- **SubagentInfo Extension**:
  - Added optional `telemetry: subagentTelemetrySchema.optional()` field to `subagentInfoSchema`.
- **Wire Event Extension**:
  - Added `subagent.telemetry_updated` variant (`type: "subagent.telemetry_updated"`, `subagentId`, `telemetry`, `at`) to `subagentLifecycleEventSchema`.
- **Schema Fix**:
  - Updated `manageSubagentsParamsSchema` to have `recursive: z.boolean().optional()`.

---

### 3. `packages/protocol/src/index.ts` (Updated File)
- Exported all symbols from `./memory` via `export * from "./memory";`.

---

### 4. `packages/protocol/src/memory.test.ts` (New File)
- Comprehensive test suite covering constants, error codes, `memoryEntrySchema`, `memorySetParamsSchema`, `memorySetResultSchema`, `memoryGetParamsSchema`, `memoryGetResultSchema`, `memoryQueryParamsSchema`, `memoryQueryResultSchema`, `memoryDeleteParamsSchema`, `memoryDeleteResultSchema`, `memoryLifecycleEventSchema`, pure helper utilities, adversarial injection attempts, and JSON roundtrip serialization.

---

### 5. `packages/protocol/src/subagents.test.ts` (Updated File)
- Added tests for `subagentTelemetrySchema`, `subagentInfoSchema` with telemetry, all 8 variants of `subagentLifecycleEventSchema`, `manageSubagentsParamsSchema` with recursive options, and `createDefaultSubagentTelemetry`.

---

### Verification Summary
- `npm run typecheck:protocol` — 0 errors
- `npm run test:protocol` — 10 test files passed (239 tests total, 100% pass)
- `npm run typecheck:host` — 0 errors
- `npm run test:host` — 36 test files passed (322 tests total, 100% pass)
- `npm test` — 32 frontend test files passed (302 tests total, 100% pass)

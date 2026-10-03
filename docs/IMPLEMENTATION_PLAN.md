# NanoForge: 12-Phase Implementation Roadmap

**Document Version:** 1.0.0  
**Status:** Active Implementation Plan  
**Target Roadmap:** Phases 0 through 12  
**Baseline Verified:** Milestone 0 (Phase 0) Complete — 100% Tests Green

---

## 1. Roadmap Architecture Overview

The transformation of NanoForge unfolds across 12 distinct, verifiable phases. The guiding principles across all phases are:
1. **Non-Destructive Evolution:** `KEEP -> EXTEND -> REFACTOR -> REPLACE`.
2. **Strict File Ownership:** When parallelizing across subagents, assign clear file boundaries.
3. **Economical Model Routing:** Capability-floor model selection with free-first priority.
4. **Zero-Regression Mandate:** Every milestone must pass `npm run build`, `npm run typecheck`, and all relevant test suites before completion.

---

## 2. Phase 0 to Phase 6 Implementation Specifications

### Phase 0: Forensic Baseline & Architecture Documentation (Milestone M0)
- **Status:** **COMPLETED**
- **Objective:** Establish verified baseline across monorepo build and test suites, fix legacy test harness friction in agent host, and author authoritative architecture documentation.
- **Key Deliverables:**
  - `apps/agent-host/src/session.ts`: Configured `preApprovedWrites` support for pre-authorized sessions without breaking untrusted capability approval gating; wired `memory.*` RPC messages (`memory.set`, `memory.get`, `memory.query`, `memory.delete`) directly to `memoryEngine` with correlated request IDs.
  - `apps/agent-host/src/server.ts`: Propagated `preApprovedWrites` through session initialization.
  - `docs/CURRENT_ARCHITECTURE.md`: Complete verified audit of loopback daemon, React 19 UI, wire protocol, DAG runner, sandboxing, and test coverage.
  - `docs/ROUTER_ARCHITECTURE.md`: Subsystem blueprint for `packages/llm-router`.
  - `docs/IMPLEMENTATION_PLAN.md`: 12-phase phased implementation plan.
- **Acceptance Criteria & Verification:**
  - `npm run build`: Exit code 0, bundles created in `dist/`.
  - `npm run test:protocol`: 18/18 test files pass (394 tests).
  - `npm run test:host`: 55/55 test files pass (789 tests).
  - `npm test`: 86/86 test files pass (769 tests).
  - Total tests passing: 2,060+ with 0 failures.

---

### Phase 1: Universal Provider Contract & Normalized Interfaces
- **Milestone:** M1
- **File Ownership:**
  - `packages/llm-router/package.json`
  - `packages/llm-router/tsconfig.json`
  - `packages/llm-router/vitest.config.ts`
  - `packages/llm-router/src/providers/types.ts`
  - `packages/llm-router/src/providers/base.ts`
  - `packages/llm-router/src/providers/__tests__/types.test.ts`
- **Core Deliverables:**
  - Package scaffolding for `@nanoforge/llm-router` depending only on `@nanoforge/protocol` and `zod`.
  - Definition of `LLMProvider`, `ModelDescriptor`, `LLMRequest`, `LLMResponse`, `LLMEvent`, and `QuotaState`.
  - Standard error class hierarchy: `LLMProviderError` with standard codes (`RATE_LIMIT`, `TIMEOUT`, `INVALID_TOOL_CALL`, `CONTEXT_TOO_LARGE`, `LOW_CONFIDENCE`, `PROVIDER_OFFLINE`, `AUTHENTICATION_ERROR`, `QUOTA_EXHAUSTED`).
- **Acceptance Criteria:**
  - `packages/llm-router` compiles cleanly under composite TypeScript references (`tsc -b`).
  - Unit tests verify schema round-trips for all provider request/response formats.
  - Zero circular workspace dependencies.

---

### Phase 2: Local Model Provider (Ollama Adapter)
- **Milestone:** M2
- **File Ownership:**
  - `packages/llm-router/src/providers/ollama.ts`
  - `packages/llm-router/src/providers/__tests__/ollama.test.ts`
- **Core Deliverables:**
  - Full Ollama adapter implementing `LLMProvider`.
  - Discovery: `GET /api/tags` with automatic model tag and capability detection.
  - Health probe: `GET /api/version` with 1500ms timeout; offline detection handles `ECONNREFUSED` gracefully without unhandled rejections.
  - Generation and NDJSON streaming parser for `POST /api/chat`.
  - Support for native Ollama function/tool calling.
  - Zero-cost pricing metadata (`isFree: true`, costs = $0.00).
- **Acceptance Criteria:**
  - Unit tests verify model tag parsing, NDJSON streaming chunks, tool call generation, and offline error classification.
  - Vitest mocks verify offline daemon behavior does not crash the host.

---

### Phase 3: Cloud Provider Adapters (Gemini, Groq, OpenRouter, OpenAI-Compatible)
- **Milestone:** M3
- **File Ownership:**
  - `packages/llm-router/src/providers/gemini.ts`
  - `packages/llm-router/src/providers/groq.ts`
  - `packages/llm-router/src/providers/openrouter.ts`
  - `packages/llm-router/src/providers/openaiCompatible.ts`
  - `packages/llm-router/src/providers/factory.ts`
  - `packages/llm-router/src/providers/__tests__/cloudAdapters.test.ts`
- **Core Deliverables:**
  - Google Gemini adapter: REST v1beta mapping, system instructions, function declarations, 429 (`RESOURCE_EXHAUSTED`) backoff.
  - Groq adapter: High-speed SSE streaming, rate-limit header extraction (`x-ratelimit-remaining-*`, `retry-after`).
  - OpenRouter adapter: Identification of `:free` models, attribution headers, dynamic pricing discovery.
  - Generic OpenAI-compatible adapter: Connects to local runtimes (LM Studio, vLLM, LocalAI).
  - `ProviderFactory` providing unified instantiation and provider pooling.
- **Acceptance Criteria:**
  - Unit tests verify wire format conversions, token usage extraction, and HTTP error code translation across all four cloud providers.

---

### Phase 4: Model Registry & Dynamic Quota Tracker
- **Milestone:** M4
- **File Ownership:**
  - `packages/llm-router/src/registry/modelRegistry.ts`
  - `packages/llm-router/src/registry/capabilities.ts`
  - `packages/llm-router/src/quota/quotaTracker.ts`
  - `packages/llm-router/src/quota/cooldown.ts`
  - `packages/llm-router/src/registry/__tests__/registry.test.ts`
  - `packages/llm-router/src/quota/__tests__/quota.test.ts`
- **Core Deliverables:**
  - In-memory `ModelRegistry` cataloging discovered local models and configured cloud models.
  - Four-tier classification: Tier 0 (Local), Tier 1 (Cheap Free), Tier 2 (Strong Free), Tier 3 (Scarce High-Capability).
  - Dynamic health state machine: `HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `OFFLINE`.
  - Exponential backoff cooldown manager: scales cooldowns (5s $\to$ 15s $\to$ 60s $\to$ 300s) on consecutive rate limits.
  - Non-fabricated quota tracker: strictly records `null` when headers are absent; calculates scarcity penalties when remaining quotas are known.
- **Acceptance Criteria:**
  - Cooldown manager test proves rate-limited models are excluded from candidate pools during cooldown and reinstated after expiration.
  - Quota tracker test confirms zero fabricated values.

---

### Phase 5: Task Classifier & Capability-Floor Router
- **Milestone:** M5
- **File Ownership:**
  - `packages/llm-router/src/routing/taskClassifier.ts`
  - `packages/llm-router/src/routing/candidateFilter.ts`
  - `packages/llm-router/src/routing/scorer.ts`
  - `packages/llm-router/src/routing/router.ts`
  - `packages/llm-router/src/routing/fallback.ts`
  - `packages/llm-router/src/routing/__tests__/router.test.ts`
- **Core Deliverables:**
  - `TaskClassifier`: Categorizes tasks into `TRIVIAL`, `LIGHT`, `STANDARD`, `COMPLEX`, and `CRITICAL` based on token heuristics, file operations, and keywords.
  - `CandidateFilter`: Enforces hard constraints (provider health, privacy class, vision, tool support, context window, capability floor, free-only policy).
  - Deterministic Scoring Engine: Evaluates quality, reliability, speed, and scarcity penalties with deterministic tie-breaking (Score $\to$ Cost $\to$ Alphabetical).
  - `CapabilityFloorRouter`: Selects the least scarce model meeting the floor; provides user model pinning support; enforces free-first routing by default.
  - Capability Escalation Ladder: Automatically escalates on repeated capability errors (`INVALID_TOOL_CALL`, `LOW_CONFIDENCE`).
- **Acceptance Criteria:**
  - Router unit tests prove trivial tasks select Tier 0/Tier 1 models, while complex architecture tasks select Tier 2/Tier 3 models.
  - Free-first tests verify paid models are never selected without explicit opt-in.

---

### Phase 6: Model-Independent AgentState & Compact Handoff
- **Milestone:** M6
- **File Ownership:**
  - `packages/llm-router/src/state/agentState.ts`
  - `packages/llm-router/src/state/handoff.ts`
  - `packages/llm-router/src/state/contextBudget.ts`
  - `packages/llm-router/src/state/__tests__/state.test.ts`
  - `tests/e2e/llm-router/failover429.test.ts`
- **Core Deliverables:**
  - Decoupled `AgentState` recording objectives, DAG plan progress, architectural decisions, modified files, tool results, and test outcomes.
  - Compact Handoff Generator (`compactHandoff`): Generates concise markdown summaries for incoming models, omitting conversational chat replay.
  - Automated HTTP 429 Failover Harness: Integration test simulating mid-task rate limit (HTTP 429) on Step 5, verifying model failover to secondary candidate and completion of Step 6 with zero state loss and zero conversation replay.
- **Acceptance Criteria:**
  - Automated 429 failover test passes cleanly with 0 regressions.
  - Full production build (`npm run build`) and test suites (`npm test`, `npm run test:host`, `npm run test:protocol`) remain 100% green.

---

## 3. Extended Roadmap (Phases 7 through 12)

### Phase 7: Sub-Agent Model Assignment & Tier-Based Specialization (Milestone M7)
- **Status:** **COMPLETED**
- **Core Deliverables:**
  - `packages/protocol/src/subagents.ts`: Added `subagentModelTierSchema`, archetype tier defaults (`ARCHETYPE_DEFAULT_TIERS`), capability floors (`ARCHETYPE_CAPABILITY_FLOORS`), tier default token budgets (`TIER_DEFAULT_TOKEN_BUDGETS`), pro concurrency limit (`MAX_CONCURRENT_PRO_SUBAGENTS = 2`), and subagent routing decision schema.
  - `apps/agent-host/package.json` & `tsconfig.json`: Linked `@nanoforge/llm-router` into agent host workspace dependencies and compiler paths.
  - `apps/agent-host/src/agents/hierarchy.ts`: Enforced pro tier concurrency boundary (max 2 active `pro` agents) alongside global depth and concurrency gates.
  - `apps/agent-host/src/agents/supervisor.ts`: Wired `LLMRouter` into `SubagentSupervisor`; implemented archetype capability floor selection with free-first priority; enabled local model preference for `flash_lite` tasks; implemented dynamic model tier step-up ($\text{flash\_lite} \to \text{flash} \to \text{pro}$) on failure ladder replacement.
  - `apps/agent-host/src/agents/subagent_model_routing.test.ts`: 6/6 tests green covering archetype defaults, explicit overrides, `inherit` inheritance, LLMRouter capability routing, pro concurrency rejection, and escalation tier step-up.
- **Acceptance Gate:** 100% tests green across all 173 test files (2,192 tests), zero build errors.

### Phase 8: Parallel Independent Sub-Agents & Worktree Isolation (Milestone M8)
- **Status:** **COMPLETED**
- **Core Deliverables:**
  - `packages/protocol/src/subagents.ts`: Added `ERR_SUBAGENT_FILE_COLLISION: "ERR_SUBAGENT_FILE_COLLISION"`, optional `fileOwnership` pattern array across `invokeSubagentParamsSchema`, `subagentInfoSchema`, and `subagentConfigSchema`.
  - `apps/agent-host/src/agents/ownership.ts`: Implemented `FileOwnershipManager` with canonical path normalization, glob/regex overlap checking, multi-mode collision detection, and automated lock release upon agent termination.
  - `apps/agent-host/src/agents/supervisor.ts`: Wired `FileOwnershipManager` into `SubagentSupervisor`; enforced collision gating in `spawnSubagent` with `ERR_SUBAGENT_FILE_COLLISION`; linked cascading ownership release into `HierarchyManager.killTree` and `SubagentSupervisor.dispose`.
  - `apps/agent-host/src/workspace/gitWorktree.ts`: Extended worktree manager with `getWorktreeDiff`, `validateWorktreeMerge`, `mergeWorktree`, and branch deletion pruning (`deleteBranch: true`).
  - `apps/agent-host/src/planning/parallelPlanner.ts`: Implemented DAG topological wave partitioning, file scope conflict resolution (serialization or Git worktree isolation), economical model tier classification (`flash_lite` / `flash` / `pro`), and pro-tier concurrency bounding (`MAX_CONCURRENT_PRO_SUBAGENTS = 2`).
  - Automated Suites: Added `apps/agent-host/src/agents/ownership.test.ts` (10/10 green), `apps/agent-host/src/agents/subagent_parallel_worktree.test.ts` (4/4 green), `apps/agent-host/src/workspace/gitWorktree.test.ts` (6/6 green), and `apps/agent-host/src/planning/parallelPlanner.test.ts` (7/7 green).
- **Acceptance Gate:** 100% tests green across all 176 test files (2,217 tests), zero build errors on `npm run build` (`tsc -b && vite build`).

### Phase 9: Context Compaction Engine & Sliding Token Budgets (Milestone M9)
- **Status:** **COMPLETED**
- **Core Deliverables:**
  - `packages/llm-router/src/context/budget.ts`: Implemented `SlidingTokenBudget` partitioning context across 5 distinct zones (`systemPrompt`, `activeStep`, `relevantFiles`, `toolOutputs`, `history`) with 75% watermark compaction detection.
  - `packages/llm-router/src/context/compaction.ts`: Implemented `ToolOutputPruner` (ANSI stripping, consecutive log deduplication, head/tail sliding truncation with token-omission markers), `StepSummarizer` (DAG task condensation preserving architectural decisions, file changes, and errors), and `ContextCompactor` (10-tier context priority ladder).
  - `packages/llm-router/src/context/repoMap.ts`: Implemented `RepositoryMapGenerator` generating dense structural topological maps (< 150 words / < 300 tokens).
  - Automated Suites: `packages/llm-router/src/context/__tests__/compaction.test.ts` (8/8 green), `repoMap.test.ts` (1/1 green), and `apps/agent-host/src/agents/context_compaction.test.ts` (3/3 green).
- **Acceptance Gate:** 100% tests green across monorepo, zero build errors.

### Phase 10: Tool System Normalization & Safe Execution Sandbox (Milestone M10)
- **Status:** **COMPLETED**
- **Core Deliverables:**
  - `packages/protocol/src/tools.ts`: Added standard MCP tool schema definitions (`mcpToolDefinitionSchema`, `mcpToolCallParamsSchema`, `mcpToolCallResultSchema`), command safety classification (`classifyCommandSafety`, `CommandSafetyCategory`: `SAFE` | `MODIFYING` | `DANGEROUS`), and standard `BUILTIN_MCP_TOOLS` catalog (`read_file`, `write_file`, `replace_file_content`, `create_file`, `list_directory`, `search_files`, `search_text`, `git_status`, `git_diff`, `run_command`, `run_tests`).
  - `apps/agent-host/src/tools/sandbox.ts`: Implemented `ToolExecutionSandbox` enforcing workspace path boundary confinement, canonical resolution, rejection of path traversal (`..`), null bytes, and sensitive files (`.git/`, `.env*`, SSH keys), command safety risk gating, capability broker verification, and output telemetry pruning.
  - `apps/agent-host/src/tools/builtinAdapter.ts`: Implemented `BuiltinToolAdapter` with deterministic execution handlers for all coding tools, git inspection, and sandboxed terminal commands.
  - `apps/agent-host/src/tools/mcpRegistry.ts`: Implemented `UnifiedMcpToolRegistry` normalizing builtin tools and external MCP server tools into a unified MCP catalog with sandboxed dispatch and telemetry collection.
  - Automated Suites: Added `apps/agent-host/src/tools/mcp_normalization.test.ts` (11/11 green), fixed optional `fileOwnership` expectation in `session.command.adversarial.test.ts` (15/15 green).
- **Acceptance Gate:** 100% tests green across all 180 test files (2,240 tests passed, 0 failures), production build clean (`tsc -b && vite build` in 22s).

### Phase 11: Desktop UI Integration & Router Telemetry Dashboard (Milestone M11)
- **Status:** **COMPLETED**
- **Core Deliverables:**
  - `src/sections/ModelRouterCard.tsx`: Implemented primary model details, tier badge, Free-First mode toggle switch, model pinning toggle (`AUTO` vs pinned), candidate scoring breakdown table (Quality, Reliability, Speed, Scarcity Penalty, Total Score), cooldown timer badges, quota indicators, and compact handoff inspector.
  - `src/sections/RouterTelemetryDashboard.tsx`: Implemented modal dialog rendering 4 key summary stat cards (Free-Tier Priority %, Total Routed, Avg Decision Latency, 429 Failovers with 0 data loss) and Provider Fleet Health status cards (Ollama, Gemini, Groq, OpenRouter).
  - Integration into UI Shell:
    - `src/sections/TopBar.tsx`: Added `Cpu` icon trigger button with active Free-First badge for Router Telemetry & Fleet Overview modal.
    - `src/sections/ModelPanel.tsx`: Added `modelRouterProps` prop supporting capability-floor router card with candidate matrix and handoff preview.
    - `src/components/layout/AppLayout.tsx`: Wired router telemetry modal state, computed live router stats, memoized candidate matrix, and passed controls to `TopBar` and `ModelPanel`.
  - Automated Suites: Added `src/sections/__tests__/ModelRouterCard.test.tsx` (5/5 green) and `src/sections/__tests__/RouterTelemetryDashboard.test.tsx` (3/3 green).
- **Acceptance Gate:** 100% tests green across all 182 test files (2,248 tests passed, 0 failures), production build clean (`tsc -b && vite build` in 11.11s).

### Phase 12: Production Hardening, Security Invariants Audit & Release Packaging (Milestone M12)
- **Status:** **COMPLETED**
- **Core Deliverables:**
  - 7 Security Invariants Audit (`tests/e2e/phase12_production_security_audit.test.ts`):
    - Invariant 1 (Loopback-Only Binding): Enforces Fastify daemon strictly binds to `127.0.0.1` and prevents external interface exposure.
    - Invariant 2 (Origin Header Validation): Actively rejects unauthorized cross-site origins (`http://evil-attacker.io`, `https://attacker-nano-gpt.com`, etc.) with close code 4401 (`CLOSE_UNAUTHORIZED`).
    - Invariant 3 (Single-Use Token Authentication): Enforces single-use token consumption, rejects missing/empty tokens, and immediately rejects reuse.
    - Invariant 4 (Sandbox Workspace Boundary Confinement): Prohibits path traversal (`..`), null bytes (`\0`), and confines filesystem access strictly inside workspace root via `ToolExecutionSandbox.confinePath()`.
    - Invariant 5 (Sensitive File Protection): Strictly blocks read/write access to `.git/`, `.env*`, `.ssh/`, `id_rsa`, `.aws/`, and credential files with `SecuritySandboxError`.
    - Invariant 6 (Command Safety Classification & Gating): Classifies destructive system commands (`rm -rf`, `del /s`, `format`, `sudo`, `mkfs`, `dd`, `curl | bash`) as `DANGEROUS` to mandate approval gating.
    - Invariant 7 (Free-First Routing Adherence): Verifies `LLMRouter` deterministically routes to zero-cost models (Tier 0 local & Tier 1 free) when Free-First mode is active.
  - Release Packaging & Distribution:
    - Executed `npm run package` (`node scripts/package-release.js`) creating verified distribution bundle at `release/bundle/` and native archive at `release/NanoForge-v0.6.0-windows-x64.zip` (34.30 MB).
    - Verified packaging integrity with `scripts/__tests__/packaging.test.ts` (13/13 tests green).
- **Acceptance Gate:** 100% tests green across all 183 test files (**2,258 tests passed, 0 failures**), production build clean (`tsc -b && vite build` in 10.25s).

---

## 4. Phase Verification Matrix

| Phase | Milestone Target | Test Command | Acceptance Gate |
|---|---|---|---|
| Phase 0 | M0 Baseline & Docs | `npm run test:protocol && npm run test:host && npm test` | 0 test failures, build clean |
| Phase 1 | M1 Universal Contract | `vitest run packages/llm-router/src/providers` | Interface round-trips pass |
| Phase 2 | M2 Ollama Local | `vitest run packages/llm-router/src/providers/__tests__/ollama.test.ts` | NDJSON streaming & offline pass |
| Phase 3 | M3 Cloud Adapters | `vitest run packages/llm-router/src/providers/__tests__/cloudAdapters.test.ts` | 4 cloud adapters pass |
| Phase 4 | M4 Registry & Quota | `vitest run packages/llm-router/src/registry packages/llm-router/src/quota` | Cooldowns & tiers pass |
| Phase 5 | M5 Floor Router | `vitest run packages/llm-router/src/routing` | Deterministic scoring & floors pass |
| Phase 6 | M6 State & 429 Failover | `vitest run tests/e2e/llm-router/failover429.test.ts` | 429 failover with 0 context replay |
| Phase 7 | M7 Sub-Agent Model Assignment | `vitest run apps/agent-host/src/agents/subagent_model_routing.test.ts` | Model tier specialization & pro limit pass |
| Phase 8 | M8 Parallel Worktrees & Locks | `vitest run apps/agent-host/src/agents/ownership.test.ts apps/agent-host/src/planning/parallelPlanner.test.ts` | Collision detection & worktree isolation pass |
| Phase 9 | M9 Context Compaction | `vitest run packages/llm-router/src/context` | 75% watermark pruner & repo map pass |
| Phase 10 | M10 Tool Normalization & Sandbox | `vitest run apps/agent-host/src/tools/mcp_normalization.test.ts` | Unified MCP catalog & path confinement pass |
| Phase 11 | M11 Desktop UI Integration | `vitest run src/sections/__tests__/ModelRouterCard.test.tsx src/sections/__tests__/RouterTelemetryDashboard.test.tsx` | Router card, telemetry modal & TopBar pass |
| Phase 12 | M12 Hardening & Packaging | `vitest run tests/e2e/phase12_production_security_audit.test.ts scripts/__tests__/packaging.test.ts` | 7 security invariants verified & zip built |
| All | Complete Monorepo CI | `npm run build && npm test && npm run test:host && npm run test:protocol && npm run test:router` | 183 files, 2,258 tests (100% green) |

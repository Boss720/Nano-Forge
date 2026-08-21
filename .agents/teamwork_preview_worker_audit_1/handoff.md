# Handoff Report: Audit, Codebase Anatomy, 7-Pillar Gap Matrix & Master Architecture

**Agent Name:** `teamwork_preview_worker_audit_1`  
**Role:** Worker 1 (Audit & Gap Matrix Author)  
**Parent Agent:** `a6a4f434-5115-4594-b55c-150748c87bf0`  
**Date:** 2026-08-15T02:39:00Z  

---

## 1. Observation

Direct code examination of `apps/agent-host`, `packages/protocol`, and `src/`, integrated with the three comprehensive survey reports (`teamwork_preview_explorer_survey_1`, `teamwork_preview_explorer_survey_2`, and `teamwork_preview_explorer_survey_3`), revealed the following architectural facts:

1. **Dual Execution Decoupling**:
   - `src/App.tsx:337-395` drives Browser-Direct Mode over OpenAI-compatible SSE with an in-memory Virtual File System (`src/lib/vfs.ts`) and a 2-turn maximum verification loop (`src/lib/agentLoop.ts`).
   - `apps/agent-host/src/` implements a privileged Fastify WebSocket daemon executing DAG `ExecutionPlan` structures with model routing, sandboxed Execa terminal execution, Playwright browser actions, and an append-only SQLite ledger (`audit.db`).
2. **Tool Feedback & Output Truncation in Coordinator**:
   - In `apps/agent-host/src/runs/coordinator.ts:862`, model text deltas (`delta.text`) are accumulated locally into a variable and swallowed—they are not forwarded over WebSocket to the client.
   - In `apps/agent-host/src/runs/coordinator.ts:746-838`, terminal subprocess stdout/stderr is hashed and stored to disk, but **not fed back to the LLM**. The host runs strictly single-shot step executions without an autonomous multi-turn repair loop.
3. **Protocol Fragmentation**:
   - `packages/protocol/src/` currently exports only plan types (`plan.ts`) and routing formulas (`routing.ts`).
   - Wire Zod schemas reside in `apps/agent-host/src/protocol.ts`, while frontend client types are hand-rolled in `src/lib/hostClient.ts`.
4. **Tool Surface Constraint**:
   - `apps/agent-host/src/policy/policy.ts:123`, `apps/agent-host/src/runs/coordinator.ts:210-224`, and `apps/agent-host/src/protocol.ts:39-44` hardcode `kind: "terminal.exec"`. Filesystem RPCs, BrowserManager actions, MCP tools, and subagents cannot pass through the unified policy gate.
5. **Absence of PTY, Subagents, and Rich Artifact Canvas**:
   - Terminal execution is rendered as static text `<pre>` blocks inside chat cards; no interactive xterm.js or PTY backend exists.
   - Subagents, multi-agent mailbox routing, slash command palettes, and Monaco side-by-side diff viewers are absent from the current implementation.

---

## 2. Logic Chain

```
[Observation 1: Dual Execution Decoupling & Protocol Fragmentation]
                    │
                    ├──> Browser mode has multi-turn & streaming, but lacks real OS & tools.
                    ├──> Host mode has OS tools & security, but lacks streaming & feedback loops.
                    └──> Protocol schemas are duplicated across 3 separate files.
                    │
                    ▼
[Deduction 1: Unified Protocol Package as Single Source of Truth]
  We must specify a unified `@nanoforge/protocol` package exporting polymorphic `ToolRequest`
  unions, granular policy ACLs, multi-phase DAG plans, subagent mailboxes, and full MCP schemas.

[Observation 2: Policy & Coordinator constrained to terminal.exec]
                    │
                    ├──> policy.ts denies any non-terminal tool.
                    └──> coordinator.ts only exposes TERMINAL_TOOL_DEFINITION.
                    │
                    ▼
[Deduction 2: Polymorphic Tool Dispatch & Multi-Turn Host Loop]
  The coordinator must evolve into an iterative agent loop that feeds tool execution results
  back into the LLM conversation context, while the policy engine evaluates a polymorphic
  discriminated union covering FS, Terminal, Browser, MCP, and Subagent operations.

[Observation 3: Developer Ergonomics & UX Gaps vs Industry SOTA]
                    │
                    ├──> Claude Code CLI: Full multi-turn REPL, slash commands, headless execution.
                    ├──> Claude Desktop: Dedicated artifact panel, side-by-side diffs, full MCP.
                    └──> Antigravity: Hierarchical subagents, interactive planning mode, xterm.js dock.
                    │
                    ▼
[Deduction 3: Sequenced 4-Phase Delivery Roadmap (Easy/Free-First Strategy)]
  Phase 1: Free/Easy High-Value UI & Artifacts (Monaco diffs, ArtifactDock, Mermaid, Unified Protocol)
  Phase 2: Planning Mode & Slash Commands (Plan Composer, DAG visualization, /plan, Host multi-turn)
  Phase 3: Headless CLI & Terminal Ergonomics (xterm.js dock, node-pty, standalone CLI runner)
  Phase 4: Full Multi-Agent Orchestration & Persistent MCP Pool (Subagents, Mailbox, Fleet Monitor)
```

---

## 3. Caveats

1. **Protocol Integration Scope**: The TypeScript interface contracts specified in `PROJECT.md` and `docs/AUDIT_AND_GAP_ANALYSIS.md` are designed for immediate implementation in subsequent engineering worker tasks.
2. **Playwright Real vs Mock Backend**: Live Playwright browser execution requires Chromium installation (`npx playwright install chromium`); in CI/stub environments, `FakeBackend` provides full functional verification without external binaries.
3. **PTY Native Addon Compatibility**: `node-pty` in Phase 3 requires native compilation tools (Visual C++ Build Tools on Windows, `make`/`gcc` on POSIX).

---

## 4. Conclusion

We have completed the comprehensive architectural audit, codebase anatomy, 7-pillar capability gap analysis, master architecture specification, and milestone roadmap across two master artifacts:

1. **`c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/docs/AUDIT_AND_GAP_ANALYSIS.md`**:
   - Comprehensive codebase anatomy of `apps/agent-host`, `packages/protocol`, and `src/`.
   - Complete architectural breakdown and comparison of the dual execution models.
   - 10-phase execution loop tracing from prompt to tool execution to verification.
   - Deep forensic audits of Policy Engine (`policy.ts`), Supervised Runner (`runner.ts`), SQLite Audit Ledger (`store.ts`), MCP Client (`client.ts`), and Browser Visual Engine (`manager.ts`).
   - Detailed 7-Pillar Capability Gap Matrix comparing NanoForge vs Claude Code CLI, Claude Desktop, and Antigravity.
   - Synthesis of 5 core architectural bottlenecks and actionable trajectory.

2. **`c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md`**:
   - Master architecture, design principles, and unified system topology.
   - Complete TypeScript interface contracts for `@nanoforge/protocol` (Polymorphic `ToolRequest`, `GranularPolicy`, `SubagentManifest`, `ExecutionPlan`, `ArtifactMetadata`, `SlashCommand`, `McpResource`, and Bi-directional wire framing).
   - Complete 23-feature inventory mapped to milestones.
   - 4-Phase Delivery Roadmap structured around an "Easy/Free-First" strategy.
   - Monorepo code layout, development conventions, and automated verification rules.

---

## 5. Verification Method

To independently verify the authored artifacts and test suites:

1. **Inspect Authored Documentation Artifacts**:
   - `docs/AUDIT_AND_GAP_ANALYSIS.md` (Check completeness across all 8 sections and 7-pillar matrix)
   - `PROJECT.md` (Check type-safety of schemas, 23-feature inventory, 4-phase roadmap, and code layout)

2. **Run Monorepo Test Suites to Confirm Invariant Baseline**:
   ```powershell
   npm run test:protocol
   npm run test:host
   ```
   *Expected Result*: 100% passing tests (1 protocol suite with 6 tests; 16 host suites with 158 tests).

3. **Verify Monorepo Build and Types**:
   ```powershell
   npm run typecheck:protocol
   npm run typecheck:host
   ```

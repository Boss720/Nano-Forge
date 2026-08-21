## 2026-08-15T07:09:01Z

You are Worker 1 (Role: Protocol & Schemas Engineer).
Your task is to implement Milestone 1 of NanoForge Phase 4 & Phase 5:

Working Directory: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge
Agent Metadata Directory: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/worker_m1/
Authoritative Requirements: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/ORIGINAL_REQUEST.md
Architecture & Specifications: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md and .agents/spec_miner_protocol/report.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope of Work for Milestone 1:
1. Create `packages/protocol/src/subagents.ts`:
   - Zod schemas & TypeScript types for:
     - `subagentStateSchema` (7 states: "running", "idle", "waiting_for_input", "waiting_for_dependents", "waiting_for_message", "canceling", "errored")
     - `subagentArchetypeSchema` ("explorer", "implementer", "qa", "specialist", "verifier", "planner", "custom")
     - `workspaceIsolationModeSchema` ("inherit", "branch", "share")
     - `supervisorStrategySchema` ("one_for_one", "one_for_all", "rest_for_one")
     - `subagentConfigSchema`, `subagentInfoSchema` (or `subagentSummarySchema`), `subagentMessageSchema` (or `agentMessageFrameSchema`), `subagentLifecycleEventSchema`
     - Tool schemas: `invokeSubagentParamsSchema`, `invokeSubagentResultSchema`, `manageSubagentsParamsSchema`, `manageSubagentsResultSchema`, `sendMessageParamsSchema`, `sendMessageResultSchema`, `defineSubagentParamsSchema`, `defineSubagentResultSchema`
     - All wire events and helper functions
   - Zero Node.js runtime dependencies (pure TypeScript/Zod).
2. Create `packages/protocol/src/tasks.ts`:
   - Zod schemas & TypeScript types for:
     - `taskIdSchema`, `taskStatusSchema` ("running", "completed", "failed", "cancelled", "killed")
     - `scheduleConditionSchema` ("never", "any", z.string().uuid())
     - `scheduleParamsSchema` (with refinement enforcing exactly one of `durationSeconds` or `cronExpression`), `scheduleResultSchema`
     - `manageTaskParamsSchema` (actions: "list", "kill", "status", "send_input"), `taskSummarySchema`, `manageTaskResultSchema`
     - 5-field cron parsing helper / validation utilities (isomorphic)
3. Update `packages/protocol/src/index.ts` to export all new schemas, types, and utilities from `subagents.ts` and `tasks.ts`.
4. Write comprehensive tests in `packages/protocol/src/subagents.test.ts`, `packages/protocol/src/tasks.test.ts`, and `packages/protocol/src/subagents.adversarial.test.ts` (test edge cases, malformed payloads, regex/UUID checks, refinement checks, etc.).
5. Run `npm run test:protocol` and `npm run typecheck:protocol` using `run_command` in `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`. Ensure 100% of tests pass and 0 type errors exist.
6. Write a complete 5-component handoff report to `.agents/worker_m1/handoff.md` and send a completion message back to parent.

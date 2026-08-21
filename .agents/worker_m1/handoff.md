# Milestone 1: Subagent & Task Protocol Schemas Handoff Report

## 1. Observation

- **Task Scope**: Implementation of Milestone 1 for NanoForge Phase 4 & Phase 5:
  - Created `packages/protocol/src/subagents.ts` defining Zod schemas and TypeScript types for subagent state machines, archetypes, isolation modes, supervisor strategies, configurations, info/telemetry, mailbox messages, lifecycle wire events, and tool contracts (`invoke_subagent`, `manage_subagents`, `send_message`, `define_subagent`), with pure helper functions (`isValidStateTransition`, `createSubagentMessage`, `formatWakeupNotification`, `validateSubagentName`).
  - Created `packages/protocol/src/tasks.ts` defining Zod schemas and TypeScript types for background tasks, IDs, statuses, one-shot timers and recurring cron schedules (`schedule`), interactive daemon management (`manage_task`), lifecycle wire events, and an isomorphic 5-field cron parsing and evaluation engine (`parseCronExpression`, `isValidCronExpression`, `matchesCron`, `getNextCronOccurrence`).
  - Updated `packages/protocol/src/index.ts` to export all public types, schemas, constants, and helper functions from `./subagents` and `./tasks`.
  - Created unit and adversarial test suites:
    - `packages/protocol/src/subagents.test.ts` (22 unit tests covering all schemas, FSM transitions, and tools)
    - `packages/protocol/src/tasks.test.ts` (25 unit tests covering task schemas, cron expressions, and schedule conditions)
    - `packages/protocol/src/subagents.adversarial.test.ts` (16 adversarial stress tests covering malformed UUIDs, string overflows, malicious names, traversal injections, hostile cron syntax, and invalid tool arguments)
- **Verification Results**:
  - Command: `npm run typecheck:protocol` (`tsc -p packages/protocol/tsconfig.json`) exited with code 0 (0 type errors).
  - Command: `npm run test:protocol` (`vitest run --config packages/protocol/vitest.config.ts`) executed 9 test files, with all 214 tests passing:
    ```
    ✓ src/artifacts.test.ts (5 tests)
    ✓ src/commands.test.ts (12 tests)
    ✓ src/plan.test.ts (23 tests)
    ✓ src/commands.adversarial.test.ts (29 tests)
    ✓ src/terminal.test.ts (16 tests)
    ✓ src/tasks.test.ts (25 tests)
    ✓ src/subagents.test.ts (22 tests)
    ✓ src/subagents.adversarial.test.ts (16 tests)
    ✓ src/terminal.adversarial.test.ts (66 tests)
    Test Files  9 passed (9)
    Tests       214 passed (214)
    ```
  - Command: `npm run typecheck:host` exited with code 0.
  - Command: `npm run test:host` executed 24 test files with 246/246 tests passing.
  - Command: `npm test` executed 25 frontend test files with 266/266 tests passing.

## 2. Logic Chain

1. **Zero Runtime Dependency Invariant**: Both `subagents.ts` and `tasks.ts` import solely from `zod` and use native JavaScript / Web API primitives (`crypto.randomUUID()`, `Date`, `Set`, `RegExp`). They do not import Node.js native modules (`fs`, `child_process`, `net`), ensuring isomorphic usability across browser React UI and agent-host Node backend.
2. **7-State Subagent FSM Enforcement**: `subagentStateSchema` strictly implements the 7 canonical states ("running", "idle", "waiting_for_input", "waiting_for_dependents", "waiting_for_message", "canceling", "errored"). `isValidStateTransition` models valid transitions and verifies that `errored` is strictly terminal.
3. **Actor-Model Mailbox Framing**: `subagentMessageSchema` and `createSubagentMessage` provide strongly-typed message frames with UUID generation, priority tiers ("high", "normal", "low"), artifact attachment arrays, and correlation IDs.
4. **Mutual Exclusion in Schedule Parameters**: `scheduleParamsSchema` applies `.refine()` to ensure that exactly one of `durationSeconds` (one-shot timer) or `cronExpression` (recurring cron) is specified, accompanied by `.superRefine()` that verifies the syntactic validity of any provided cron string.
5. **Isomorphic 5-Field Cron Parser**: `parseCronExpression` parses standard cron syntax (`minute hour day-of-month month day-of-week`), supporting wildcards (`*`), steps (`*/5`), ranges (`1-5`, `MON-FRI`, `JAN-DEC`), and comma-separated lists (`1,3,5`), while rejecting negative values, floats, non-integers, and out-of-bounds indices. `getNextCronOccurrence` computes the next execution timestamp across month, year, and leap year boundaries.
6. **Adversarial Hardening**: The adversarial test suite validates defenses against path traversal injection in subagent names (`../../`, null bytes, command injection characters), malformed UUID payloads, string length overflows, and hostile cron syntax.

## 3. Caveats

- The protocol package provides schema contracts and pure evaluation functions; physical process spawning, PTY management, Git worktree isolation, and file system I/O are executed by the downstream `apps/agent-host` subsystems in subsequent milestones.
- No caveats regarding schema correctness or test passing status.

## 4. Conclusion

Milestone 1 is complete, fully verified, and ready for integration by downstream host agent workers:
- All required Zod schemas, TypeScript types, constants, and utilities are implemented and exported from `packages/protocol`.
- 100% of unit and adversarial tests pass (214/214 in protocol suite; 726 total across workspace).
- 0 TypeScript compilation or type checking errors exist.

## 5. Verification Method

To independently verify this milestone:
1. Run protocol typecheck:
   ```powershell
   npm run typecheck:protocol
   ```
   *Expected*: Exits with code 0 and no diagnostic errors.
2. Run protocol test suite:
   ```powershell
   npm run test:protocol
   ```
   *Expected*: 9 test files passed, 214 tests passed, 0 failures.
3. Inspect exported schemas:
   Inspect `packages/protocol/src/index.ts`, `packages/protocol/src/subagents.ts`, and `packages/protocol/src/tasks.ts`.

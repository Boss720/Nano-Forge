# Handoff Report: Protocol & Agent Host Specification Mining (Phase 4 & Phase 5)

## 1. Observation
- **`ORIGINAL_REQUEST.md` (lines 12–20, 30–37)**: Requires multi-agent protocol and host engine (`invoke_subagent`, `manage_subagents`, `send_message`, `define_subagent`), workspace sandboxing (`inherit`, `branch`, `share`), background daemon tasks (`manage_task`, `isDaemon: true`), and cron/timer scheduling (`schedule`).
- **`docs/PRD_MULTI_AGENT_ORCHESTRATION.md` (lines 415–636, 646–846)**: Details full Zod schemas and TypeScript interfaces for `subagentIdSchema`, `subagentArchetypeSchema`, `subagentStatusSchema`, `invokeSubagentParamsSchema`, `manageSubagentsParamsSchema`, `sendMessageParamsSchema`, `scheduleParamsSchema`, `manageTaskParamsSchema`, and `SubagentSupervisor` implementation with depth caps, mailbox queueing, reactive wakeups, worktree sandboxing, and cascading kill trees.
- **`docs/PHASED_ROADMAP_AND_VERIFICATION.md` (lines 388–496, 524–535)**: Outlines Phase 4 multi-agent orchestration architecture, 5-rung failure escalation ladder (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`), and 2MB circular ring buffer for daemon logging.
- **`packages/protocol/src/`**: Currently exports `plan.ts`, `commands.ts`, `routing.ts`, `artifacts.ts`, and `terminal.ts`. All 151 unit tests pass (`npm run test:protocol` output: `6 passed (6), 151 passed`).
- **`apps/agent-host/src/`**: Currently implements `policy/policy.ts` with `isWithinWorkspace` and `authorize`, `runs/coordinator.ts`, `runs/events.ts`, `session.ts`, and `server.ts`. All 246 unit tests pass (`npm run test:host` output: `24 passed (24), 246 passed`).

## 2. Logic Chain
1. *Observation 1 & 2*: `ORIGINAL_REQUEST.md` and `PRD_MULTI_AGENT_ORCHESTRATION.md` establish the need for an isomorphic protocol package (`packages/protocol/src/subagents.ts`) and corresponding host modules in `apps/agent-host/src/agents/`, `apps/agent-host/src/policy/`, and `apps/agent-host/src/daemons/`.
2. *Observation 3 & 4*: The protocol package must remain pure TypeScript with zero Node.js native API imports (`fs`, `net`, `child_process`), using Zod for validation so that both the browser UI and Node agent-host can share schemas seamlessly.
3. *Observation 2 & 5*: The subagent state machine requires 7 canonical states (`running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored`) to support actor-model mailbox routing without CPU/token polling.
4. *Observation 2 & 5*: The policy engine must enforce strict `.agents/<subagentId>/` confinement preventing cross-agent directory pollution, while providing Git worktrees for `branch` isolation and ephemeral scratch mounts for `share` isolation.
5. *Observation 2 & 3*: The daemon supervisor and scheduler must support long-running processes (`isDaemon: true`), 5-field cron parsing, one-shot timers with conditional cancellation (`never`, `any`, `<senderId>`), fallback reactive wakeups, and interactive control via `manage_task`.

## 3. Caveats
- No implementation code was written in this turn (spec mining is read-only).
- The specification defines the full contracts, Zod schemas, state machines, and host architecture needed for subsequent implementer subagents to execute Phase 4 and Phase 5 without ambiguity.

## 4. Conclusion
The protocol and agent-host specifications for NanoForge Phase 4 & Phase 5 have been extracted, synthesized, and documented in `report.md`. The design is fully aligned with Antigravity multi-agent protocols, Erlang/OTP supervision trees, and existing NanoForge code conventions.

## 5. Verification Method
1. Inspect the generated specification report:
   ```bash
   view_file AbsolutePath="c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/spec_miner_protocol/report.md"
   ```
2. Verify existing test suites continue to pass with 0 errors:
   ```bash
   npm run test:protocol
   npm run test:host
   ```
3. Invalidation condition: Any discrepancy between `report.md` and `ORIGINAL_REQUEST.md` / `PRD_MULTI_AGENT_ORCHESTRATION.md` regarding tool parameters (`invoke_subagent`, `manage_subagents`, `send_message`, `define_subagent`, `manage_task`, `schedule`), 7 subagent states, or workspace isolation modes.

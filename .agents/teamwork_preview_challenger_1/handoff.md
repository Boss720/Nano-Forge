# Adversarial Stress-Test Report: State Machines & Concurrency Architecture

**Author:** Challenger 1 (State Machine & Concurrency Challenger)  
**Target Documents:**
1. `docs/PRD_MULTI_AGENT_ORCHESTRATION.md`
2. `docs/PRD_PLANNING_ARTIFACTS_SLASH.md`
3. `docs/PRD_HEADLESS_CLI_TERMINAL.md`  
**Verdict:** `REQUEST_CHANGES` (High / Critical Concurrency & State Machine Risks)

---

## 1. Observation

Direct observations from PRD specifications, TypeScript source code, and test execution:

### Observation O1: Missing Supervisor Depth Validation & Unsafe Recursion in `SubagentSupervisor`
- **Location:** `docs/PRD_MULTI_AGENT_ORCHESTRATION.md`, Section 9.1 (Lines 678–722) and Section 10.1 (Line 836).
- **Verbatim Text:**
  - Section 10.1 Table declares invariant `SEC-SUB-05`: *"Max supervisor recursion depth is capped at 3 tiers. Enforcement Layer: SubagentSupervisor depth check. Failure Action: Rejection of invoke_subagent call."*
  - Section 9.1 `spawnChild` implementation:
    ```typescript
    async spawnChild(parentId: SubagentId | null, params: InvokeSubagentParams): Promise<SubagentSummary> {
      const id = randomUUID() as SubagentId;
      const agentDirName = `${params.archetype}_${id.slice(0, 8)}`;
      const metadataDir = path.join(this.workspaceRoot, ".agents", agentDirName);
      await fs.mkdir(metadataDir, { recursive: true });
      ...
      this.nodes.set(id, node);
      if (parentId) {
        if (!this.parentToChildren.has(parentId)) {
          this.parentToChildren.set(parentId, new Set());
        }
        this.parentToChildren.get(parentId)!.add(id);
      }
    ```
  - `killTree` implementation (Lines 756–776):
    ```typescript
    async killTree(rootId: SubagentId, reason = "Supervisor termination"): Promise<void> {
      const children = this.parentToChildren.get(rootId);
      if (children) {
        for (const childId of children) {
          await this.killTree(childId, `Cascading kill from parent ${rootId}`);
        }
      }
      ...
    }
    ```
- **Finding:** `spawnChild` performs zero depth validation or check against `parentId` lineage. Furthermore, `killTree` has no cycle guard (`visited` set) and does not clean up `parentToChildren` or `this.nodes`, causing unbounded map growth and potential infinite call stack recursion.

### Observation O2: Orphaned Cron Jobs & Deadlocked Timer Wakeups on Subagent Termination
- **Location:** `docs/PRD_MULTI_AGENT_ORCHESTRATION.md`, Section 7.2 (Lines 395–407) and Section 9.1 (Lines 756–776).
- **Verbatim Text:**
  - Section 7.2 declares `scheduleParamsSchema` with `isDaemon: boolean (default: false)`: *"Whether the cron survives the current task completion."*
  - Section 7.2 declares `TimerCondition: "<sender-id>"`: *"Cancels early if a message arrives specifically from `<sender-id>`."*
  - Section 9.1 `killTree` only aborts `node.abortController` and calls `pruneWorktree()`.
- **Finding:** `killTree` and subagent termination handlers do not register or cancel active scheduled cron jobs or timers associated with the subagent. When `isDaemon: false` cron jobs run, they continue firing indefinitely after subagent death. If an agent waits with `TimerCondition: "<sender-id>"` and `<sender-id>` crashes or fails without sending a message, the waiting agent remains deadlocked in `IDLE` for the entire `DurationSeconds`.

### Observation O3: Missing Cycle Detection & Unhandled Step Removal in `planComposerReducer`
- **Location:** `docs/PRD_PLANNING_ARTIFACTS_SLASH.md`, Section 2.4 (Lines 261–392) and Section 5.1 (Lines 1172–1188).
- **Verbatim Text:**
  - In `planComposerReducer.ts`:
    ```typescript
    case "ADD_DEPENDENCY": {
      if (action.stepId === action.dependsOnStepId) return state; // Self-loop forbidden
      const updatedSteps = state.plan.steps.map((s) => {
        if (s.id !== action.stepId) return s;
        if (s.dependsOn.includes(action.dependsOnStepId)) return s;
        return { ...s, dependsOn: [...s.dependsOn, action.dependsOnStepId] };
      });
      return pushHistory(state, { ...state.plan, steps: updatedSteps });
    }
    ```
  - In `PlanComposerAction` (Lines 243–260): `| { type: "REMOVE_STEP"; stepId: string }` and `| { type: "REMOVE_PHASE"; phaseId: string }` are declared in the type union, but **neither `case "REMOVE_STEP":` nor `case "REMOVE_PHASE":` exist in the switch block**.
  - In `readySteps`:
    ```typescript
    export function readySteps(plan: ExecutionPlan, approvedStepIds: ReadonlySet<string>): PlanStep[] {
      return plan.steps.filter((step) => {
        if (step.status !== "pending") return false;
        const depsSatisfied = step.dependsOn.every((depId) =>
          plan.steps.some((s) => s.id === depId && s.status === "succeeded")
        );
        if (!depsSatisfied) return false;
        if (step.approval === "required" && !approvedStepIds.has(step.id)) return false;
        return true;
      });
    }
    ```
- **Finding:** Reducer accepts multi-node dependency cycles ($A \to B \to A$). When cycles exist, `readySteps` returns `[]`, causing the host coordinator to hang in `executing` indefinitely. Deleting a step is unhandled and falls through to `default: return state;`. If a dependency is deleted manually, dangling IDs cause dependent steps to remain permanently pending.

### Observation O4: `LOAD_PLAN` Approval Ledger Wipe Triggers Execution Veto Storm
- **Location:** `docs/PRD_PLANNING_ARTIFACTS_SLASH.md`, Section 1.2 (Lines 93–95) and Section 2.4 (Lines 358–367).
- **Verbatim Text:**
  - Section 1.2 Invariant 2: *"If a compromised or faulty host attempts to transition an unapproved approval: 'required' step to 'running', the client UI immediately downgrades the rendered status to 'blocked' and dispatches an execution veto."*
  - Section 2.4 `LOAD_PLAN`:
    ```typescript
    case "LOAD_PLAN": {
      return {
        ...state,
        plan: action.plan,
        history: [action.plan],
        historyIndex: 0,
        isDirty: false,
        approvedStepIds: new Set(), // <--- WIPED
      };
    }
    ```
- **Finding:** Every `LOAD_PLAN` action (dispatched on host sync or plan update) resets `approvedStepIds` to an empty set. Any currently running step requiring approval is immediately flagged as unapproved by the client, triggering an automatic execution veto (`run.cancel`) and aborting legitimate running plans.

### Observation O5: Zero Backpressure in `PtyManager` and Ineffective Process Tree Termination on Windows
- **Location:** `docs/PRD_HEADLESS_CLI_TERMINAL.md`, Section 5.1 (Lines 268–280) and Section 7.1 (Lines 520–613).
- **Verbatim Text:**
  - Section 5.1 Diagram claims: *"Flow Control & Backpressure: Pauses child stdout when WebSocket buffer is full"*.
  - Section 7.1 `PtyManager.ts` implementation:
    ```typescript
    ptyProcess.onData((data: string) => {
      this.appendToBuffer(managed, data);
      this.emit("data", { sessionId: options.sessionId, data });
    });
    ...
    kill(sessionId: PtySessionId): void {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      session.process.kill();
      this.sessions.delete(sessionId);
    }
    ```
- **Finding:** `PtyManager.ts` contains zero backpressure or flow control logic. It never checks socket buffer watermarks or calls `ptyProcess.pause()` / `ptyProcess.resume()`. Furthermore, calling `session.process.kill()` on Windows signals only the immediate shell (`powershell.exe`) without killing child processes (dev servers, compilers, python scripts), leaving background zombie processes locking network ports.

### Observation O6: Existing Codebase Baseline Test Failures
- **Command:** `npm test`
- **Output:** 2 test suites failed (`src/lib/__tests__/hostClient.test.ts`, `src/sections/__tests__/IntegrationsPanel.test.tsx`), with 7 failing unit assertions in client host communication and integrations UI. (`npm run test:host` in `apps/agent-host` passed all 158 tests).

---

## 2. Logic Chain

1. **Depth & Spawning Invariants (O1 $\to$ Blast Radius Assessment)**:
   - PRD 1 claims `SEC-SUB-05` caps supervisor depth at 3 tiers to prevent resource exhaustion.
   - However, the host supervisor implementation in `apps/agent-host` omits depth calculation in `spawnChild`.
   - In recursive problem decomposition or prompt loops, subagents can spawn sub-subagents without limit.
   - Each spawn creates Git worktrees and allocates V8 event listeners.
   - *Conclusion:* System is vulnerable to runaway process/worktree fork bombs and Stack Overflow in `killTree`.

2. **Cron Lifecycle & Deadlock Freedom (O2 $\to$ Concurrency Failure)**:
   - PRD 1 specifies `isDaemon: false` for task-scoped cron jobs.
   - Termination routines do not clean up registered timers or background daemons.
   - When subagents complete or terminate, their background cron jobs continue running in the background.
   - Simultaneously, `TimerCondition: "<sender-id>"` only wakes on inbound *messages*. If the sender terminates/fails without messaging, the receiver deadlocks in `IDLE`.
   - *Conclusion:* Multi-agent schedules leak background jobs and deadlock on sender failures.

3. **Plan State Machine Determinism (O3, O4 $\to$ Plan Execution Failure)**:
   - PRD 2's `planComposerReducer` allows dependency cycles to be committed into state and lacks handlers for `REMOVE_STEP` and `REMOVE_PHASE`.
   - When a cycle is present, `readySteps` evaluates to empty, leaving the plan in `executing` state indefinitely without timeout or error.
   - When `LOAD_PLAN` is dispatched, wiping `approvedStepIds` triggers the client approval invariant veto, causing spurious execution cancellations mid-run.
   - *Conclusion:* Planning state machine is prone to execution deadlocks, unhandled step deletions, and approval race cancellation loops.

4. **Terminal Memory Safety & Process Lifecycle (O5 $\to$ Host Crash & Zombie Daemons)**:
   - PRD 3 claims backpressure support, but the implementation streams unthrottled `ptyProcess.onData` events directly to WebSocket emitters.
   - Fast data producers overflow WebSocket buffers and cause Node.js Heap OOM crashes.
   - On Windows, `session.process.kill()` fails to terminate the process tree, leaving child dev servers running and locking ports.
   - *Conclusion:* Terminal dock and headless CLI will leak zombie processes on Windows and crash under heavy stdout loads.

---

## 3. Caveats

- Complex multi-agent Git worktree 3-way merge conflict resolution is not fully specified in PRD 1 and was not tested against live Git repositories.
- WebGL rendering performance of `@xterm/addon-webgl` under 4K multi-monitor environments was evaluated theoretically based on xterm.js architecture.
- Baseline client test failures in `src/lib/__tests__/hostClient.test.ts` indicate existing pre-implementation client-side drift that must be resolved alongside protocol upgrades.

---

## 4. Conclusion & Required Architectural Changes

**Verdict:** **`REQUEST_CHANGES`**

The following architectural remediations MUST be incorporated into the PRD specifications and reference implementations prior to engineering execution:

### Required Changes for `PRD_MULTI_AGENT_ORCHESTRATION.md`:
1. **Enforce Recursion Depth & Cycle Guard in `SubagentSupervisor`**:
   - Implement `calculateDepth(parentId)` in `spawnChild`. If `depth >= 3`, throw `SupervisorError("MAX_DEPTH_EXCEEDED")`.
   - Add a `visited = new Set<SubagentId>()` cycle guard to `killTree`.
   - Prune `parentToChildren` entries and remove nodes from `this.nodes` on termination to prevent memory leaks.
2. **Implement Task/Schedule Ownership & Cleanup**:
   - Bind all `TaskId` and timer instances to the creating `SubagentId`.
   - In `killTree` and state transitions to `completed`/`failed`/`terminated`, automatically cancel all associated non-daemon tasks and timers.
3. **Handle Sender Termination in `TimerCondition`**:
   - When an agent transitions to `failed` or `terminated`, synthesize an immediate `TASK_TERMINATED` wakeup event for any waiting parent/peer.

### Required Changes for `PRD_PLANNING_ARTIFACTS_SLASH.md`:
1. **Add Cycle Detection & Step Deletion to `planComposerReducer`**:
   - Run Tarjan's SCC / cycle validation on `ADD_DEPENDENCY`. If a cycle is formed, reject the action or set `validationErrors`.
   - Implement `REMOVE_STEP` and `REMOVE_PHASE` cases, automatically filtering deleted step IDs from `dependsOn` arrays of all remaining steps.
2. **Fix Approval Ledger Invariant in `LOAD_PLAN`**:
   - Preserve existing `approvedStepIds` across `LOAD_PLAN` transitions for steps whose `id` and `sideEffecting` definitions have not changed.
3. **Add Batch Approval Wire Frame**:
   - Add `clientPlanBatchApprovalFrameSchema` with `stepIds: string[]` to prevent N-frame WebSocket network races on phase approvals.

### Required Changes for `PRD_HEADLESS_CLI_TERMINAL.md`:
1. **Implement WebSocket Backpressure in `PtyManager`**:
   - Implement high/low watermarks (e.g. 64KB / 16KB) on `ws.bufferedAmount`. Call `ptyProcess.pause()` when buffer exceeds high watermark, and `ptyProcess.resume()` on `drain`.
2. **Implement Process Tree Teardown for Windows & POSIX**:
   - Replace bare `session.process.kill()` with full process tree termination using `taskkill /pid <PID> /t /f` on Windows and `process.kill(-pid, "SIGKILL")` on POSIX (mirroring `apps/agent-host/src/terminal/runner.ts`).
3. **Fix Ring Buffer ANSI Escape Slicing**:
   - Use a structured byte ring buffer or headless xterm state buffer to prevent splitting multi-byte UTF-8 and ANSI escape sequences.

---

## 5. Verification Method

To independently verify these failure modes and their fixes:

1. **Depth Check Verification**:
   - Construct a test invoking `spawnChild` recursively 4 times in sequence.
   - *Assertion:* Tier 4 spawn must reject with `MAX_DEPTH_EXCEEDED` and zero orphaned `.agents/` directories.
2. **DAG Cycle & Deadlock Verification**:
   - In `planComposerReducer.test.ts`, dispatch `ADD_DEPENDENCY` with `Step 1 -> Step 2` and `Step 2 -> Step 1`.
   - *Assertion:* Reducer must return `validationErrors` and `readySteps` must not cause coordinator hang.
3. **Approval Ledger Drift Verification**:
   - In a running plan with approved Step 2, dispatch `LOAD_PLAN` with updated step estimate.
   - *Assertion:* Step 2 must remain approved in `approvedStepIds` and must not dispatch `run.cancel`.
4. **PTY Process Tree Teardown Verification (Windows)**:
   - Spawn a PTY session running `node -e "setInterval(() => {}, 1000)"`. Note child PID.
   - Call `ptyManager.kill(sessionId)`.
   - Run `tasklist /fi "PID eq <childPID>"` in PowerShell.
   - *Assertion:* Child PID must be completely terminated and not listed in `tasklist`.

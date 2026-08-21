# Handoff Report: Reviewer Full 2 (Headless CLI Runner, NDJSON Stream Protocol, Host PTY Manager)

## 1. Observation

### Verification Commands & Results

1. **Host Tests (`npm run test:host`)**:
   - Command: `vitest run --config apps/agent-host/vitest.config.ts`
   - Result: **PASS** (24 test files passed, 246 tests passed in 13.63s).
   - Test files verified include:
     - `src/cli/cli.test.ts` (9 tests passed)
     - `src/cli/approval.test.ts` (7 tests passed)
     - `src/cli/formatters.test.ts` (7 tests passed)
     - `src/cli/planner.test.ts` (5 tests passed)
     - `src/cli/plan.test.ts` (5 tests passed)
     - `src/cli/run.test.ts` (12 tests passed)
     - `src/terminal/ptyManager.test.ts` (10 tests passed)
     - `src/terminal/runner.test.ts` (9 tests passed)
     - `src/server.test.ts` (11 tests passed)

2. **Protocol Tests (`npm run test:protocol`)**:
   - Command: `vitest run --config packages/protocol/vitest.config.ts`
   - Result: **PASS** (6 test files passed, 151 tests passed in 1.61s).
   - Test files verified include `src/terminal.test.ts`, `src/terminal.adversarial.test.ts`, `src/plan.test.ts`, `src/commands.test.ts`, `src/commands.adversarial.test.ts`, `src/artifacts.test.ts`.

3. **Protocol Typecheck (`npm run typecheck:protocol`)**:
   - Command: `tsc -p packages/protocol/tsconfig.json`
   - Result: **PASS** (0 errors).

4. **Frontend Component Tests (`npm test`)**:
   - Command: `vitest run`
   - Result: **PASS** (25 test files passed, 266 tests passed in 18.09s).
   - Verified `TerminalDock.test.tsx` (16 tests), `PlanPanel.test.tsx`, `ChatComposer.test.tsx`, `App.hostWiring.test.tsx`, etc.

5. **Production Build (`npm run build`)**:
   - Command: `tsc -b && vite build`
   - Result: **PASS** (`✓ built in 13.95s`, 0 TypeScript/Vite errors for frontend).

6. **Host Typecheck (`npm run typecheck:host`)**:
   - Command: `tsc -p apps/agent-host/tsconfig.json`
   - Result: **FAIL (Exit Code 1)** with 8 TypeScript compiler errors:
   ```text
   apps/agent-host/src/cli/approval.test.ts(111,21): error TS2339: Property 'reason' does not exist on type 'ApprovalOutcome'.
     Property 'reason' does not exist on type '{ outcome: "granted"; }'.
   apps/agent-host/src/cli/approval.test.ts(115,21): error TS2339: Property 'reason' does not exist on type 'ApprovalOutcome'.
     Property 'reason' does not exist on type '{ outcome: "granted"; }'.
   apps/agent-host/src/cli/approval.test.ts(129,28): error TS2339: Property 'reason' does not exist on type 'ApprovalOutcome'.
     Property 'reason' does not exist on type '{ outcome: "granted"; }'.
   apps/agent-host/src/cli/run.test.ts(72,48): error TS18048: 'spec.args' is possibly 'undefined'.
   apps/agent-host/src/server.ts(212,36): error TS2367: This comparison appears to be unintentional because the types '0 | 2 | 3' and '1' have no overlap.
   apps/agent-host/src/server.ts(230,13): error TS2571: Object is of type 'unknown'.
   apps/agent-host/src/session.ts(128,36): error TS2367: This comparison appears to be unintentional because the types '0 | 2 | 3' and '1' have no overlap.
   apps/agent-host/src/session.ts(235,13): error TS2571: Object is of type 'unknown'.
   ```

---

## 2. Logic Chain

1. **Architecture & Feature Fulfillment Assessment**:
   - **Headless CLI Runner (`bin/nanoforge.ts`, `apps/agent-host/src/cli/`)**:
     - `bin/nanoforge.ts` correctly serves as executable standalone entrypoint (`#!/usr/bin/env node`), awaiting `runCLI(process.argv.slice(2))` and exiting with the resolved exit code.
     - `parseArgv` accurately parses positional prompts/goals, long options (`--prompt`, `--goal`, `--json`, `--ndjson`, `--auto-approve`, `--timeout`, `--token`, `--host`, `--output`, `--plan`), short flags (`-p`, `-g`, `-j`, `-o`, `-t`), boolean flags, and `--` end-of-flags delimiters.
     - `nanoforge run "<prompt>"` supports non-interactive execution either in-memory via `StandaloneRunner` or against an external daemon via `DaemonClient`.
     - `nanoforge plan "<goal>"` supports natural language plan synthesis and JSON plan parsing, validating DAG topology via `validatePlan` and rendering formatted markdown/JSON.
     - Output formatting supports rich ANSI text (`HumanFormatter`), live streaming feeds (`NdjsonFormatter`), and machine-readable JSON (`JsonFormatter`), respecting `--no-color` and `NO_COLOR` env.
     - Non-interactive security: `CLIApprovalGate` implements fail-closed approvals (`--auto-approve=none` denies all, `--auto-approve=safe` allows only read-only commands classified by `isSafeToolRequest`, and `--auto-approve=all` auto-grants).
     - Exit codes adhere strictly to POSIX mappings (0: Success, 1: Failure, 2: Policy violation, 3: Cancelled, 4: Approval denied / timeout, 5: Config / Auth error, 6: Verification failed).
   - **Interactive Host PTY Manager (`apps/agent-host/src/terminal/ptyManager.ts`, `server.ts`, `session.ts`)**:
     - `CircularScrollbackBuffer` maintains a 2MB cap (`DEFAULT_MAX_SCROLLBACK_BYTES = 2 * 1024 * 1024`), slicing head chunks on byte overflow and preventing memory leaks.
     - `PtyManager` supports dynamic `node-pty` loading with cross-platform fallback to stdio child process streams.
     - Environment sanitization filters against `DEFAULT_ENV_ALLOWLIST` and strips secret patterns (`/TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL/i`).
     - Workspace confinement uses `resolveWithinWorkspace`, throwing `RunnerSpecError` if cwd attempts directory traversal outside `workspaceRoot`.
     - Process tree termination is handled cleanly (`taskkill /pid <pid> /t /f` on Windows, process group kill on POSIX).
     - WebSocket dispatch is wired in `session.ts` and `server.ts`, dispatching `terminal.create`, `terminal.input`, `terminal.resize`, `terminal.kill`, and streaming `terminal.created`, `terminal.data`, `terminal.exit`.

2. **Integrity Check**:
   - Actively checked for hardcoded test results, facade implementations, bypassed tasks, or fabricated logs. None found: implementations are genuine, robust, and tested against live subprocesses and coordinator loops.

3. **Compilation & Type Safety Evaluation**:
   - Although Vite build and Vitest test executions pass at runtime, `npm run typecheck:host` (which runs `tsc -p apps/agent-host/tsconfig.json`) fails with 8 TypeScript errors.
   - The errors stem from strict null checks on `spec.args`, untyped property access on `JSON.parse` unknown results, un-narrowed `ApprovalOutcome` union types in tests, and comparing `socket.readyState` against `socket.OPEN` where the constant type narrows unexpectedly.
   - In accordance with review principles, since `typecheck:host` is a required verification step and has compiler failures, the verdict must be `REQUEST_CHANGES`.

---

## 3. Review Findings & Suggestions

### [Major] Finding 1: TypeScript Compilation Errors in `apps/agent-host`

- **What**: `npm run typecheck:host` fails with 8 TypeScript compiler errors.
- **Where**:
  1. `apps/agent-host/src/cli/approval.test.ts` lines 111, 115, 129
  2. `apps/agent-host/src/cli/run.test.ts` line 72
  3. `apps/agent-host/src/server.ts` lines 212, 230
  4. `apps/agent-host/src/session.ts` lines 128, 235
- **Why**:
  - In `approval.test.ts`: `outcome1` is typed as `{ outcome: "granted" } | { outcome: "denied"; reason: string } | { outcome: "expired" }`. Accessing `.reason` directly without type narrowing or assertion triggers `Property 'reason' does not exist on type '{ outcome: "granted"; }'`.
  - In `run.test.ts`: `spec.args` is optional (`string[] | undefined`), so calling `spec.args.join(" ")` fails strict null check TS18048.
  - In `server.ts` & `session.ts`:
    - `if (socket.readyState === 1 || socket.readyState === socket.OPEN)` fails TS2367 because `socket.readyState` is typed as `0 | 2 | 3` in some context when `socket.OPEN` is 1. `socket.readyState === 1` is sufficient.
    - `typeof (parsed as Record<string, unknown>).type === "string" && (parsed as Record<string, unknown>).type.startsWith("terminal.")` fails TS2571 because `Record<string, unknown>['type']` is `unknown`.
- **Suggested Fix**:
  - In `approval.test.ts`: Check `if (outcome1.outcome === "denied") expect(outcome1.reason)...` or cast `(outcome1 as { reason?: string }).reason`.
  - In `run.test.ts`: Use `(spec.args ?? []).join(" ")`.
  - In `server.ts` & `session.ts`:
    - Replace `if (socket.readyState === 1 || socket.readyState === socket.OPEN)` with `if (socket.readyState === 1)`.
    - In `server.ts` (line 230) & `session.ts` (line 235): Narrow/cast parsed object, e.g. `typeof (parsed as any).type === "string" && (parsed as any).type.startsWith("terminal.")` or `const msgType = (parsed as Record<string, string>).type; if (typeof msgType === "string" && msgType.startsWith("terminal."))`.

---

## 4. Adversarial Stress-Test & Challenge Analysis

### Challenge 1: Fail-Closed Non-Interactive Approval Under Unknown Tool Requests
- **Attack Scenario**: Subprocess proposes an unexpected command or dangerous tool (`rm -rf`, `format`, `dd`) during a non-interactive CI run.
- **Stress-Test Result**: `CLIApprovalGate` in mode `none` and `safe` immediately denies the request. In mode `safe`, `isSafeToolRequest` only permits items in `SAFE_READ_ONLY_EXECUTABLES` or safe git subcommands. Everything else fails closed and terminates with Exit Code 4 (`ERR_APPROVAL_DENIED`). **PASS**.

### Challenge 2: Massive Output Stream Overflow in Interactive Terminal Session
- **Attack Scenario**: Terminal process outputs massive data (>100MB) in a rapid burst.
- **Stress-Test Result**: `CircularScrollbackBuffer` evicts oldest chunks and slices the head chunk to ensure memory consumption never exceeds `DEFAULT_MAX_SCROLLBACK_BYTES` (2MB). Memory remains constant. **PASS**.

### Challenge 3: Path Traversal via Terminal Session Working Directory
- **Attack Scenario**: Terminal creation message requests `cwd: "../../../windows/system32"` or absolute path outside workspace.
- **Stress-Test Result**: `resolveWithinWorkspace(this.workspaceRoot, spec.cwd)` returns `null`, causing `createSession` to throw `RunnerSpecError: cwd escapes the workspace root`. Path traversal is prevented. **PASS**.

### Challenge 4: Credential and Secret Leakage via Child Shell Environment
- **Attack Scenario**: Host environment contains sensitive tokens (`OPENAI_API_KEY`, `NANOFORGE_TOKEN`, `AWS_SECRET_ACCESS_KEY`).
- **Stress-Test Result**: `buildTerminalEnv` filters keys against `DEFAULT_ENV_ALLOWLIST` and strips anything matching `/TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL/i`. Tokens are not leaked to spawned terminal sessions. **PASS**.

---

## 5. Caveats
- No other functional gaps were observed. All runtime unit, integration, and UI tests pass 100%. Once the 8 TypeScript compilation errors in `apps/agent-host` are fixed, `typecheck:host` will pass cleanly.

---

## 6. Conclusion & Review Verdict

**Verdict**: **REQUEST_CHANGES**

- **Summary**: The implementations of the Headless CLI Runner (`bin/nanoforge.ts`, `apps/agent-host/src/cli/`), NDJSON Stream Protocol, and Host PTY Manager (`ptyManager.ts`, `server.ts`, `session.ts`) are structurally well-designed, functionally robust, and secure. However, `npm run typecheck:host` fails with 8 TypeScript compiler errors that must be resolved to achieve a clean build and typecheck.

---

## 7. Verification Method

To independently verify after applying the fixes:
```bash
# 1. Verify Host Typecheck (Target Fix)
npm run typecheck:host

# 2. Verify Host Tests
npm run test:host

# 3. Verify Protocol Tests & Typecheck
npm run test:protocol
npm run typecheck:protocol

# 4. Verify Frontend Component Tests & Build
npm test
npm run build
```

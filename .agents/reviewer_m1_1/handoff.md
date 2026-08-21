# Review & Adversarial Verification Report — Milestone 1 (Protocol & Backend Alignment)

## 1. Observation

### Code Changes Inspected
1. **`packages/protocol/src/terminal.ts`**:
   - Implemented Zod schemas for all client-to-host and host-to-client PTY communication frames:
     - `terminalCreateSchema` (`type: "terminal.create"`, `id?: string`, `sessionId?: string`, `title?: string`, `cols: number (positive int, default 80)`, `rows: number (positive int, default 24)`, `cwd?: string`, `env?: Record<string, string>`, `shell?: string`, `executable?: string`, `args?: string[] (default [])`)
     - `terminalInputSchema` (`type: "terminal.input"`, `id: string`, `sessionId?: string`, `data: string`)
     - `terminalResizeSchema` (`type: "terminal.resize"`, `id: string`, `sessionId?: string`, `cols: number (positive int)`, `rows: number (positive int)`)
     - `terminalKillSchema` (`type: "terminal.kill"`, `id: string`, `sessionId?: string`, `signal?: string`)
     - `terminalCreatedSchema` (`type: "terminal.created"`, `id: string`, `sessionId?: string`, `title?: string`, `pid: number (positive int)`, `cols: number (positive int)`, `rows: number (positive int)`)
     - `terminalDataSchema` (`type: "terminal.data"`, `id: string`, `sessionId?: string`, `data: string`)
     - `terminalExitSchema` (`type: "terminal.exit"`, `id: string`, `sessionId?: string`, `exitCode: number (int)`, `signal?: string`)
   - Implemented discriminated unions: `terminalClientMessageSchema`, `terminalServerMessageSchema`, `terminalMessageSchema` using `.discriminatedUnion("type", [...])`.
   - Exported pure parsing and type predicate helpers: `parseTerminalClientMessage`, `safeParseTerminalClientMessage`, `parseTerminalServerMessage`, `safeParseTerminalServerMessage`, `parseTerminalMessage`, `safeParseTerminalMessage`, `isTerminalClientMessage`, `isTerminalServerMessage`, `isTerminalMessage`.
   - Provided backward/PRD compatibility aliases (`ptyCreateFrameSchema`, `ptyInputFrameSchema`, `ptyResizeFrameSchema`, `ptyKillFrameSchema`, `ptyCreatedEventSchema`, `ptyDataEventSchema`, `ptyExitEventSchema`, `ptyClientMessageSchema`, `ptyHostMessageSchema`).

2. **`packages/protocol/src/index.ts`**:
   - Line 9: `export * from "./terminal";` correctly re-exports all terminal schemas, types, and helpers from the root package.

3. **`packages/protocol/src/terminal.test.ts`**:
   - 16 comprehensive unit tests testing default values, custom configs, input validation, resize constraints (positive integers), kill signals, ANSI data handling, exit codes/signals, discriminated unions, parser functions, predicates, and JSON roundtrip serialization.

4. **`apps/agent-host/src/runs/events.ts`**:
   - Line 35: Updated `SubmittedStep.approval` definition to `approval?: "required" | "auto"`, ensuring type compatibility with `PlanStep.approval` from `@protocol/plan`.

5. **`apps/agent-host/src/runs/coordinator.ts`**:
   - Lines 332 & 338: Safely mapped `goal: plan.goal ?? plan.title ?? ""` for `auditStore.startRun` and the `plan.submitted` event payload, resolving `string | undefined` vs `string` mismatch.

### Independent Verification Execution
- `npm run typecheck:protocol`: Exited with code 0 (0 errors).
- `npm run typecheck:host`: Exited with code 0 (0 errors; all 3 previous TS2322 errors fully resolved).
- `npm run test:protocol`: Exited with code 0 (5 test files, 85 passed).
- `npm run test:host`: Exited with code 0 (16 test files, 166 passed).
- `npm test` (frontend test suite): Exited with code 0 (21 test files, 204 passed).
- `npm run build`: Exited with code 0 (full workspace build clean).

### Adversarial & Integrity Audit
- **Integrity Check**: Verified no hardcoded test shortcuts, dummy facades, external mock leaks, or fabricated verification outputs. All protocol validation logic uses real Zod schemas.
- **Strictness & Bounds**: Verified positive integer constraints on `cols`/`rows`/`pid` (`z.number().int().positive()`), bounded strings on `title`, `cwd`, `executable`, and type predicates safely executing `.safeParse(raw).success`.
- **Regression Check**: Verified existing run coordination, validation, audit store, policy enforcement, and frontend components remain 100% operational with 0 regressions.

## 2. Logic Chain

1. **Protocol Rigor & Completeness (Observation §1, §3)**: The schema definitions in `packages/protocol/src/terminal.ts` cover all PTY lifecycle events (`create`, `input`, `resize`, `kill`, `created`, `data`, `exit`). The use of `z.discriminatedUnion("type", [...])` guarantees high-performance, single-pass validation and discriminant-based type narrowing.
2. **Export Surface (Observation §2)**: Re-exporting via `packages/protocol/src/index.ts` ensures downstream modules (`apps/agent-host`, frontend `TerminalDock.tsx`, and CLI `bin/nanoforge.ts`) can import types and schemas directly from `@protocol`.
3. **Type Alignment & Error Resolution (Observation §4, §5)**: Aligning `SubmittedStep.approval` with `PlanStep.approval` (`"required" | "auto"`) and safely defaulting optional `goal` with `plan.goal ?? plan.title ?? ""` directly fixes the 3 TS2322 typecheck errors in `apps/agent-host` without side effects.
4. **Verification Evidence (Observation §Independent Verification)**: Clean typecheck and 100% test pass rates across protocol (85/85), agent host (166/166), frontend (204/204), and full build output establish that Milestone 1 is completely sound and ready for downstream milestones (M2: Frontend Planning & Slash UI, M3: Headless CLI, M4: PTY Terminal Dock).

## 3. Caveats

No caveats. All tasks assigned to Milestone 1 have been implemented, tested, and independently verified against monorepo quality gates.

## 4. Conclusion

**Verdict: APPROVE**

Milestone 1 satisfies all requirements:
- All required PTY frames defined with strict Zod types.
- Protocol schemas and helpers cleanly exported from `@protocol`.
- All 3 previous typecheck errors in `apps/agent-host` completely resolved.
- Zero regressions across existing protocol, backend, and frontend test suites.

## 5. Verification Method

To independently reproduce this verification:
1. `npm run typecheck:protocol` (TypeScript check for `@protocol`)
2. `npm run typecheck:host` (TypeScript check for `apps/agent-host`)
3. `npm run test:protocol` (Runs Vitest suite across `@protocol`)
4. `npm run test:host` (Runs Vitest suite across `apps/agent-host`)
5. `npm test` (Runs Vitest suite across frontend)
6. `npm run build` (Full project build)

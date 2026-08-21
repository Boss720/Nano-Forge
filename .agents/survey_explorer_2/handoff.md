# Handoff Report — survey_explorer_2

## 1. Observation

1. **Protocol Layer (`packages/protocol/`)**:
   - `packages/protocol/src/plan.ts` (lines 76-83): `planPhaseSchema` and `PlanPhase` (`id`, `title`, `description`, `order`) are fully defined. `executionPlanSchema` (lines 134-164) contains `phases?: readonly PlanPhase[]`. `readySteps` and `resolvePlanStepStatuses` (lines 178-301) provide topological step execution and cycle validation (`validatePlanDAG`).
   - `packages/protocol/src/commands.ts` (lines 109-223): 8 built-in slash command definitions (`BUILTIN_SLASH_COMMANDS`: `/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`) are defined. `parseSlashCommand` (lines 325-395) parses commands, positional args, flags (`--key=val`), and context mentions (`@file:`, `@rule:`, `#symbol:`, `@agent:`).
   - Test suites: `npm run test:protocol` runs 4 test files (`src/artifacts.test.ts`, `src/commands.test.ts`, `src/plan.test.ts`, `src/commands.adversarial.test.ts`) with 69 passed tests (100% pass).

2. **Plan Panel Component (`src/sections/PlanPanel.tsx`)**:
   - Lines 66–94: Implements local React approval ledger `approvals: { planId: string; stepIds: ReadonlySet<string> }`.
   - Lines 78–84: `effectiveStatus(step)` downgrades any unapproved `approval: "required"` step to `"blocked"` and `"awaiting approval"`, enforcing the zero natural language authority invariant.
   - Lines 123–214: Steps are rendered in a flat `<ol>` list. `plan.phases` is not utilized or rendered; there are no collapsible phase group accordions or phase-level batch approvals.

3. **Chat Panel & Composer (`src/sections/ChatPanel.tsx`)**:
   - Lines 90–150: Composer is currently embedded directly in `ChatPanel.tsx` with a standard `<textarea>` without slash command popovers or mention chips.
   - `src/sections/ChatComposer.tsx` does not exist as a standalone component.

4. **Terminal Subsystem & Virtual Terminal Dock**:
   - `src/sections/TerminalDock.tsx` does not exist.
   - `src/sections/ChatPanel.tsx` (lines 385–444) renders `ToolRunCard` for supervised jobs with static text excerpts.
   - `apps/agent-host/src/terminal/runner.ts` (lines 165–320) executes commands using `execa` with a 1MB output cap and process tree termination (`killProcessTree`).
   - `apps/agent-host/src/session.ts` (lines 53–88) handles `tool.approval_required` and `tool.output` frames over WebSocket, but lacks interactive PTY session management (`terminal.create`, `terminal.input`, `terminal.resize`, `terminal.data`, `terminal.exit`).

5. **Build and Verification Baseline**:
   - `npm run test:protocol`: 4 files, 69 tests passed.
   - `npm run test:host`: 16 files, 166 tests passed.
   - `npm test`: 21 files, 204 tests passed.
   - `npm run build`: 0 TypeScript or Vite bundling errors.

---

## 2. Logic Chain

1. **Phase 2 Planning UI Gaps**:
   - Observation 1 proves the protocol layer (`@protocol/plan`) already defines `PlanPhase` and hierarchical DAG execution contracts.
   - Observation 2 proves `PlanPanel.tsx` currently only renders a flat list and ignores `plan.phases`.
   - *Inference*: `PlanPanel.tsx` needs to be upgraded to iterate over `plan.phases` (with fallback for unphased steps), rendering `PlanPhase` collapsible accordions with aggregate phase progress and a batch `"Approve Phase"` button, while preserving the existing approval ledger security invariant and 12 existing `PlanPanel.test.tsx` test cases.

2. **Phase 2 Slash Commands & Mentions Gaps**:
   - Observation 1 proves `packages/protocol/src/commands.ts` already defines all 8 built-in commands and the tokenizer/mention parser.
   - Observation 3 proves `ChatPanel.tsx` embeds an unassisted `<textarea>` without popover autocomplete.
   - *Inference*: Extracting `src/sections/ChatComposer.tsx` and adding a floating caret/top-anchored popover with keyboard navigation (`Up`/`Down`/`Enter`/`Escape`) and `@file` context mention autocomplete will fulfill Requirement R1 without disturbing transcript rendering.

3. **Phase 3 Terminal Dock Gaps**:
   - Observation 4 proves `TerminalDock.tsx` is completely missing from the UI, and the host only has child process execution without PTY streams.
   - *Inference*: Fulfilling Requirement R3 requires:
     a. Defining `packages/protocol/src/terminal.ts` with `terminal.*` Zod schemas.
     b. Implementing `apps/agent-host/src/terminal/ptyManager.ts` (using `node-pty` / child stream, ring buffer, resize handling).
     c. Implementing `src/sections/TerminalDock.tsx` using `@xterm/xterm`, `@xterm/addon-fit`, and `@xterm/addon-webgl` with multi-tab session management.

4. **Safety & Zero Regression**:
   - Observation 5 confirms the entire test suite (439 tests total) and production build pass cleanly. Any subsequent implementation must maintain 100% test pass rate across all modules.

---

## 3. Caveats

- Node-pty on Windows requires native build tools (Visual Studio C++ build tools / ConPTY). An executable fallback using child process streams or graceful emulation should be provided if native compilation is absent in specific environments.
- Workspace file fuzzy search for `@file` mentions should utilize `files: VirtualFile[]` in demo mode and `WorkspaceClient.search` / `handleSearch` when connected to the live agent host.

---

## 4. Conclusion

The system has a solid architectural and protocol foundation (`packages/protocol`, `apps/agent-host`, `src/`). To complete Phase 2 and Phase 3:
1. **PlanPanel**: Upgrade with collapsible `PlanPhase` group accordions, step counters, and phase-level approval toggles.
2. **ChatComposer**: Extract into `src/sections/ChatComposer.tsx`, implementing floating slash palette (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`), keyboard navigation, and `@file` fuzzy context mention autocomplete.
3. **TerminalDock**: Implement `src/sections/TerminalDock.tsx` with `@xterm/xterm`, multi-tab session management, ANSI rendering, resize sync, and WebSocket PTY connection to host.
4. **Backend PTY & CLI**: Implement `apps/agent-host/src/terminal/ptyManager.ts` and `bin/nanoforge.ts` / `apps/agent-host/src/cli/` (`nanoforge run`).

---

## 5. Verification Method

To verify the findings and any future implementation:
1. Run protocol tests:
   ```powershell
   npm run test:protocol
   ```
2. Run host tests:
   ```powershell
   npm run test:host
   ```
3. Run frontend component tests:
   ```powershell
   npm test
   ```
4. Verify production build:
   ```powershell
   npm run build
   ```
5. Inspect files:
   - `src/sections/PlanPanel.tsx`
   - `src/sections/ChatPanel.tsx`
   - `src/sections/ChatComposer.tsx`
   - `src/sections/TerminalDock.tsx`
   - `packages/protocol/src/plan.ts`
   - `packages/protocol/src/commands.ts`

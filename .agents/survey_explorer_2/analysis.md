# Frontend UI, Planning Mode, Slash Commands, Mentions, and Terminal Architecture Survey

**Date:** 2026-08-15  
**Investigator:** `survey_explorer_2`  
**Scope:** Phase 2 (Antigravity-Style Visual Planning & Slash Command Caret Popover) and Phase 3 (Terminal Dock `@xterm/xterm` + `node-pty` / Host IPC, Headless CLI)  
**Target Files:**
- `src/sections/PlanPanel.tsx`
- `src/sections/ChatPanel.tsx` & proposed `src/sections/ChatComposer.tsx`
- Proposed `src/sections/TerminalDock.tsx`
- Frontend state architecture: `src/App.tsx`, `src/lib/hostSession.ts`, `src/lib/hostClient.ts`, `src/lib/sessionReducer.ts`, `src/hooks/*`, `packages/protocol/src/*`

---

## 1. Executive Summary & Verification Health

| Component / Subsystem | Current Status | Test Status | Key Findings & Gaps |
|---|---|---|---|
| **Plan Inspector (`src/sections/PlanPanel.tsx`)** | Functional Flat Step List | 12/12 passing | Implements local client approval ledger and runtime status downgrade (zero NL authority). **Gap**: Lacks collapsible `PlanPhase` accordions, batch phase approvals (`onApprovePhase`), and visual DAG rendering modes. |
| **Chat Composer (`src/sections/ChatPanel.tsx`)** | Inline `<textarea>` | Integrated in ChatPanel | Handles Enter to send, token usage metering, and model preferences. **Gap**: `ChatComposer.tsx` does not exist as an extracted component; lacks slash command floating palette (`/plan`, `/goal`, etc.), caret coordinate popover positioning, keyboard arrow navigation, and `@file` context mention autocomplete. |
| **Terminal Subsystem (`TerminalDock.tsx`)** | Chat `ToolRunCard` + Execa Host Runner | 9/9 runner tests | Backend has supervised `runTerminalJob` (execa, 1MB buffer, timeout, env whitelist). **Gap**: `src/sections/TerminalDock.tsx` does not exist; no `@xterm/xterm` multi-tab dock, no PTY WebSocket frames (`terminal.create`, `terminal.input`, `terminal.data`, `terminal.resize`). |
| **Frontend State & Store Architecture** | Hooks + Context + Reducers | 204/204 passing | Unified state hub in `App.tsx` + `useHostSession` + `useArtifacts`. Protocol schemas defined in `packages/protocol/src/plan.ts` and `packages/protocol/src/commands.ts`. Build passes cleanly (`npm run build` 0 errors). |

---

## 2. Deep Dive: `src/sections/PlanPanel.tsx` (Visual Planning & Phase DAG)

### 2.1 Current Implementation & Security Invariants
- **File Location:** `src/sections/PlanPanel.tsx` (244 lines)
- **Props Interface:**
  ```typescript
  export interface PlanPanelProps {
    plan: ExecutionPlan;
    className?: string;
    onApproveStep: (planId: string, stepId: string) => void;
    onRunApproved: (planId: string) => void;
    onPause: (planId: string) => void;
    onCancel: (planId: string) => void;
  }
  ```
- **Authoritative Client Approval Ledger:**
  - `PlanPanel` maintains its own local React state:
    ```typescript
    const [approvals, setApprovals] = useState<{ planId: string; stepIds: ReadonlySet<string> }>({
      planId: plan.id,
      stepIds: new Set<string>(),
    });
    ```
  - **Zero Natural Language Authority**: Model-generated text or chat strings cannot satisfy an approval gate. Only explicit user clicks (`approve(stepId)`) write to this ledger.
  - **Effective Status Downgrade**: If an unapproved step marked `approval: "required"` arrives from props or host as `"running"`, `effectiveStatus(step)` actively downgrades the displayed status to `"blocked"` and `"awaiting approval"`.
- **Rendered Elements:**
  - Plan header: Goal string, state badge (`draft`, `awaiting_approval`, `executing`, `paused`, `completed`), and pending approval count.
  - Step list: Flat `<ol>` mapping `plan.steps`.
  - Badges: Dependency edges (`depends on: [stepId]`), affected scopes (`scopes: [path]`), estimates (`~1.2k tok · ≈$0.0060 · ~8s`), `side-effecting` alert, artifacts list (`notes/inspect.md`).
  - Control footer: `Run` (disabled until `allApproved`), `Pause` (enabled when `executing`), `Cancel` (disabled when `completed`).

### 2.2 Gaps vs Requirement R1 & PRD Specification
1. **No Phase Groupings (`PlanPhase` Accordions)**:
   - `packages/protocol/src/plan.ts` and `src/types/index.ts` define `phases?: PlanPhase[]` (`id`, `title`, `description`, `order`).
   - `PlanPanel.tsx` ignores `plan.phases` and renders all steps in a flat list. Steps with `phaseId` are not grouped into collapsible phase accordions.
2. **Missing Phase-Level Batch Approvals**:
   - Users cannot click `"Approve Entire Phase"` to batch-authorize all approval-required steps belonging to a specific phase.
3. **Missing Visual DAG Status Badges & Graph Modes**:
   - Dependency edges are only rendered as simple textual pill tags (`depends on: depId`), without topological graph rendering or cycle warning indicators.

---

## 3. Deep Dive: `src/sections/ChatPanel.tsx` & `src/sections/ChatComposer.tsx` (Slash Commands & Mentions)

### 3.1 Current Implementation in `src/sections/ChatPanel.tsx`
- **File Location:** `src/sections/ChatPanel.tsx` (501 lines)
- **Current Composer Structure:**
  - Embedded directly in `ChatPanel` lines 90–150:
    ```tsx
    <div className="shrink-0 border-t border-border bg-card/60 px-5 py-3">
      <div className="rounded-lg border border-input bg-secondary/40 ...">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder={...}
        />
        ...
      </div>
    </div>
    ```
  - Includes model selector badge, live context meter (`usedTokens / budgetTokens`), `GenSettings` slider popover (temperature & max tokens), and `run agent` / `stop` buttons.
- **Protocol Foundations Already Built:**
  - `packages/protocol/src/commands.ts` defines:
    - 8 built-in commands: `/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`
    - POSIX argument tokenizer (`tokenizeCommand`), flag parser (`--key=val`, `-f`), and mentions extractor (`@file:<path>`, `@rule:<name>`, `#symbol:<name>`, `@agent:<id>`).
    - `parseSlashCommand(input)` and `formatSlashCommand(wire)` utilities.

### 3.2 Gaps vs Requirement R1 & PRD Specification
1. **Extraction of `ChatComposer.tsx`**:
   - The composer needs to be refactored out of `ChatPanel.tsx` into a modular, testable `src/sections/ChatComposer.tsx` (or `src/components/ChatComposer.tsx`).
2. **Floating Slash Command Palette (`/` Trigger)**:
   - Typing `/` at index 0 or after whitespace must open an autocomplete popover with fuzzy filtering over the 8 built-in commands and descriptions.
3. **Caret Popover Positioning**:
   - Popover must dynamically position above/near the caret or top-anchored above the textarea.
4. **Full Keyboard Navigation**:
   - `ArrowUp` / `ArrowDown`: Move active item highlight.
   - `Enter` / `Tab`: Select and autocomplete command into textarea.
   - `Escape`: Dismiss popover without clearing draft.
5. **Context Mention Autocomplete (`@file`)**:
   - Typing `@` or `@file:` triggers fuzzy file matching across workspace files (from `files: VirtualFile[]` in `App.tsx` or `WorkspaceClient.search()`), inserting `@file:<path>` chips.
6. **Command Dispatch Wiring**:
   - Selecting or executing `/plan <goal>` transitions the workspace into Planning Mode (creating/opening the plan in `useHostSession` or plan rail).
   - `/cost` opens `CostDashboard`.
   - `/clear` resets chat history.
   - `/goal <objective>` updates header banner.

---

## 4. Deep Dive: `src/sections/TerminalDock.tsx` (Terminal Dock, `@xterm/xterm` & PTY)

### 4.1 Current Implementation State
- **Frontend**:
  - `src/sections/TerminalDock.tsx` does **not** exist yet.
  - Currently, terminal commands only appear as static `ToolRunCard` components in `ChatPanel.tsx` (lines 350–445), displaying `t.executable`, `t.args`, `t.cwd`, `t.policyReason`, and truncated output in a `<pre>` block.
- **Backend Host (`apps/agent-host`)**:
  - `apps/agent-host/src/terminal/runner.ts`: `runTerminalJob(spec, options)` executes commands using `execa` with:
    - `shell: false`, structured `executable + args[]`
    - CWD confinement inside `workspaceRoot` via `resolveWithinWorkspace`
    - Environment whitelist (`DEFAULT_ENV_ALLOWLIST`) stripping sensitive API keys
    - 1MB output cap with circular buffer (`OutputCap`)
    - Process tree termination via `taskkill /pid <pid> /t /f` (Windows) or `process.kill(-pid, "SIGKILL")` (POSIX)
  - `apps/agent-host/src/session.ts`: Emits `tool.output` and `tool.approval_required` frames over WebSocket.

### 4.2 Gaps vs Requirement R3 & PRD Specification
1. **Frontend Component `TerminalDock.tsx`**:
   - Build a collapsible bottom dock in `src/sections/TerminalDock.tsx` with:
     - Multi-tab management (Tab list with active indicator, close buttons, `+` new tab).
     - Integration with `@xterm/xterm` (`Terminal`), `@xterm/addon-fit` (`FitAddon`), `@xterm/addon-webgl` (`WebglAddon`).
     - Dark theme matching NanoForge palette (`background: "#0d1117"`, `foreground: "#c9d1d9"`, ANSI 16/256/TrueColor support).
     - Window resize handling (`onResize` forwarding `cols` and `rows`).
     - Keystroke forwarding (`term.onData` forwarding raw stdin data to host).
2. **Terminal Wire Protocol & Host PTY Manager**:
   - Protocol frames in `packages/protocol/src/` (or `packages/protocol/src/terminal.ts`):
     - `terminal.create`: `{ sessionId, title, executable, args, cwd, cols, rows }`
     - `terminal.input`: `{ sessionId, data }`
     - `terminal.resize`: `{ sessionId, cols, rows }`
     - `terminal.kill`: `{ sessionId, signal }`
     - `terminal.data`: `{ sessionId, data }`
     - `terminal.exit`: `{ sessionId, exitCode, signal }`
   - Host `PtyManager` in `apps/agent-host/src/terminal/ptyManager.ts` using `node-pty` (or child process PTY stream on ConPTY/openpty) with backpressure management.

---

## 5. Frontend State & Store Architecture

### 5.1 Architecture Overview
The NanoForge frontend uses a clean, unbloated state architecture based on React Hooks, pure Reducers, and WebSocket stream synchronization:

```
+-----------------------------------------------------------------------------------------+
|                                    App.tsx (Root State Hub)                             |
|                                                                                         |
|  - sessions: Session[] (Chat transcripts, messages, tool calls, patches)               |
|  - activeId: string (Active session ID)                                                 |
|  - files: VirtualFile[] (Virtual workspace files / applied diffs)                       |
|  - usage: UsageTotals & runs: UsageRun[] (Token & cost analytics)                       |
|  - connection: ConnectionState (API key, baseUrl, x402 quotes)                          |
|  - models: NanoModel[] & selectedModel: string                                          |
|                                                                                         |
|        │                                 │                               │              |
|        ▼                                 ▼                               ▼              |
|  useHostSession()                useArtifacts()                   Persist Layer         |
|  (src/lib/hostSession.ts)        (src/hooks/useArtifacts.ts)     (src/lib/persist.ts)   |
|  - plan: ExecutionPlan | null    - artifacts: ArtifactMetadata[]  - debounced saver      |
|  - toolRuns: ToolRun[]           - activeArtifactId               - localStorage         |
|  - routeDecision                 - addPatchArtifact()             - beforeunload flush   |
|  - integrations                  - handleFeedback()                                     |
|  - HostClient WebSocket                                                                 |
+-----------------------------------------------------------------------------------------+
```

### 5.2 Store & Reducer Inventory
1. `src/lib/sessionReducer.ts`:
   - Pure function `patchSessionMessage(sessions, sessionId, msgId, fn)` for immutable updates to message streaming deltas, tool calls, and patches.
2. `src/lib/persist.ts`:
   - Debounced persistence saving `{ sessions, usage, files, runs }` to `localStorage.getItem("nanoforge.v1")`.
3. `src/lib/hostSession.ts`:
   - Core React hook `useHostSession(options)`. Bridges `HostClient` WebSocket events to state (`plan`, `toolRuns`, `routeDecision`, `integrations`, `evidence`, `permissionPending`).
4. `src/lib/hostClient.ts`:
   - WebSocket client handling `ws://127.0.0.1:<port>/agent?token=<token>`, typed frames, and promise-based request/response correlation (`plan.submit`, `approval.grant`, `workspace.*`).
5. `src/hooks/useArtifacts.ts`:
   - Manages right-rail `ArtifactDock` state (multi-format artifacts, feedback loop, patch conversion).

---

## 6. Implementation Action Plan

To fulfill Requirements R1, R2, R3, R4:

1. **Phase 2 UI Upgrade**:
   - **`src/sections/PlanPanel.tsx`**: Update to render `PlanPhase` group accordions with collapsible phase sections, step approval counters, and phase-level batch approval (`onApprovePhase`).
   - **`src/sections/ChatComposer.tsx`**: Create standalone composer with floating slash command palette, caret positioning, keyboard navigation (`Up`/`Down`/`Enter`/`Escape`), and `@file` context mention autocomplete using workspace files.
   - **`src/sections/ChatPanel.tsx`**: Mount `ChatComposer` and wire slash command executions.
2. **Phase 3 Terminal & Headless Upgrade**:
   - **`packages/protocol/src/terminal.ts`**: Add Zod schemas and types for `terminal.*` frames.
   - **`apps/agent-host/src/terminal/ptyManager.ts`**: Implement PTY manager with `node-pty` / child stream, resize, and WebSocket streaming.
   - **`src/sections/TerminalDock.tsx`**: Implement multi-tab `@xterm/xterm` dock and integrate into `App.tsx`.
   - **`bin/nanoforge.ts` & `apps/agent-host/src/cli/`**: Implement headless CLI runner (`nanoforge run`, `nanoforge plan`) with NDJSON streaming.
3. **Verification**:
   - Maintain 100% test pass rate across `packages/protocol`, `apps/agent-host`, and `src/`, with 0 build errors.

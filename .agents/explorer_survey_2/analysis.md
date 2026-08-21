# NanoForge Phase 2 Architecture Survey & R2 Plan Control Plane Specification
**Agent:** Survey Explorer 2  
**Date:** 2026-08-15  
**Milestone:** Phase 2 Planning Mode & DAG Control Surface Architecture  
**Working Directory:** `.agents/explorer_survey_2`  

---

## 1. Executive Summary

This report delivers a thorough architectural survey of the NanoForge frontend UI subsystem, with an in-depth investigation of:
1. **Frontend UI Architecture**: Component hierarchy, layout organization, state management paradigms, and theme/styling system.
2. **Current PlanPanel Analysis**: State ingestion, approval ledger mechanics, status downgrade security invariants, and action dispatching.
3. **Antigravity-Grade Visual Plan Control Plane (R2 Specification)**: Multi-Phase DAG organization, interactive step timeline, dependency badges, manual step insertion/reordering/editing, dual approval gates (single-step, phase-batch, approve-all), cycle validation, and resource estimates.
4. **WebSocket Wire Protocol & Host Integration**: How the frontend interacts with `HostClient`, `useHostSession`, and protocol types across `packages/protocol` and `apps/agent-host`.
5. **Quality Gates & Test Suite Audit**: Baseline test status (204 frontend tests passing, 11 protocol tests passing, 158 host tests passing) and targeted testing strategy for Phase 2.

---

## 2. Frontend UI Architecture & Component Hierarchy

### 2.1 Directory Structure Overview

The frontend codebase resides in `src/` and is structured into modular, decoupled layers:

```
src/
├── App.tsx                        # Master layout, drawer orchestrator, host session wiring
├── index.css                      # Tailwind base, dark-mode CSS variables, custom utilities
├── main.tsx                       # React 19 entry point
├── components/
│   ├── RichText.tsx               # Markdown renderer with code highlighting
│   ├── artifacts/                 # Dedicated artifact rendering components
│   │   ├── ArtifactFeedbackBar.tsx# User approval/feedback bar for artifacts
│   │   ├── LiveSandbox.tsx        # Sandboxed HTML/React live preview iframe
│   │   ├── MarkdownArtifactViewer.tsx # GFM & interactive markdown viewer
│   │   ├── MermaidViewer.tsx      # Pan/zoom Mermaid diagram renderer
│   │   ├── MonacoDiffViewer.tsx   # Side-by-side / inline Monaco diff viewer
│   │   └── VisualEvidenceGallery.tsx # Pixelmatch screenshot comparison & gallery
│   └── ui/                        # Radix UI primitives with Tailwind styling (50+ components)
│       ├── accordion.tsx, alert.tsx, badge.tsx, button.tsx, card.tsx,
│       ├── checkbox.tsx, collapsible.tsx, command.tsx, dialog.tsx, popover.tsx,
│       ├── scroll-area.tsx, sheet.tsx, slider.tsx, tabs.tsx, etc.
├── hooks/
│   ├── use-media-query.ts         # Responsive breakpoint listener (e.g. lg: 1024px)
│   ├── use-mobile.ts              # Mobile detection hook
│   ├── use-task-timeline.ts       # Task timeline hook
│   ├── use-workspace.ts           # Workspace file tree / status hook
│   └── useArtifacts.ts            # Artifact dock manager hook
├── lib/
│   ├── catalog.ts                 # Fallback model catalog and system prompts
│   ├── context.ts                 # Token estimator and history packing
│   ├── demoAgent.ts               # Offline demo loop for simulated runs
│   ├── hostClient.ts              # WebSocket client for local agent-host
│   ├── hostSession.ts             # Host session hook, browser permission bridge, event bus
│   ├── nanogpt.ts                 # Direct NanoGPT API client and streaming chat
│   ├── patchParse.ts              # Unified diff parser for git-style diffs
│   ├── persist.ts                 # LocalStorage debounced snapshot persistence
│   ├── sessionReducer.ts          # Pure session message patching reducer
│   ├── syntax.ts                  # Code highlighter tokenizer
│   ├── usage.ts                   # Token pricing and usage aggregation
│   ├── usageLog.ts                # Per-run cost and execution logger
│   ├── utils.ts                   # Tailwind cn() merge utility
│   ├── vfs.ts                     # Virtual filesystem with apply/revert patch logic
│   └── x402.ts                    # HTTP 402 accountless payment handling
├── sections/
│   ├── ArtifactDock.tsx           # Right rail: Multi-format artifact viewer & feedback dock
│   ├── BrowserPermissionDialog.tsx# Two-tier browser origin/sensitive action modal
│   ├── ChatPanel.tsx              # Center console: transcript, message cards, composer
│   ├── ConnectDialog.tsx          # Settings, API key config, host integration triggers
│   ├── CostDashboard.tsx          # Aggregate spend, model usage breakdowns, charts
│   ├── ImagePanel.tsx             # Lazy-loaded text-to-image generator
│   ├── IntegrationsPanel.tsx      # Rules packs, skills, MCP servers toggle tabs
│   ├── McpManager.tsx             # MCP server registry and tool inspector
│   ├── ModelPanel.tsx             # Right rail: Model catalog and route decision card
│   ├── PlanPanel.tsx              # Right rail: Execution plan inspector & approval gates
│   ├── PluginManager.tsx          # Host plugins loader and manager
│   ├── RouteDecisionCard.tsx      # Smart router primary/fallback proposal card
│   ├── Sidebar.tsx                # Left rail: Session history and virtual files
│   ├── SkillStudio.tsx            # Skill creator and metadata editor
│   ├── TaskTimeline.tsx           # Execution step timeline with expandable output
│   ├── TopBar.tsx                 # Header: Connection status, tokens/cost counter, actions
│   ├── VisualEvidenceCard.tsx     # Visual verification assertions and diff card
│   ├── WorkspaceExplorer.tsx      # Host workspace tree, search, and git status
│   └── __tests__/                 # Comprehensive Vitest/RTL component test suites
└── types/
    ├── artifacts.ts               # Artifact metadata, mime types, feedback types
    ├── index.ts                   # Session, Message, Plan, ToolRun, Model core types
    ├── timeline.ts                # TaskStep, TaskTimeline interfaces
    └── workspace.ts               # FileTreeNode, SearchMatch, GitFileStatus
```

### 2.2 Component Layout Hierarchy in `src/App.tsx`

`App.tsx` orchestrates a responsive multi-rail layout:

```
+---------------------------------------------------------------------------------------------------------+
|                                                  TopBar                                                 |
+---------------------------------------------------------------------------------------------------------+
|  Sidebar (lg+)  |                     ChatPanel                     | [ArtifactDock] | [PlanPanel] | ModelPanel |
|  - Sessions     |  - Transcript (MessageView, ToolCard, PatchCard)  | (w-[440px])    | (w-80)      | (w-72)     |
|  - Files tree   |  - Composer (Textarea, Context meter, GenPrefs)   |                |             |            |
+---------------------------------------------------------------------------------------------------------+
| Modals & Overlays: Sheet (Sidebar/ModelPanel < lg), ConnectDialog, Integrations, BrowserPermission, CmdK|
+---------------------------------------------------------------------------------------------------------+
```

Key layout behaviors observed in `src/App.tsx:560-645`:
- **Responsive Adaptivity**: On viewports `< 1024px` (`useMediaQuery("(max-width: 1023px)")`), the inline left `Sidebar` and right `ModelPanel` are hidden and rendered via `<Sheet>` drawers.
- **Conditional Plan Rail**: Mounted at `App.tsx:617-635` **only when `host.plan` or `host.evidence` is present**:
  ```tsx
  {(host.plan || host.evidence) && (
    <aside data-testid="plan-rail" className="hidden min-h-0 w-80 shrink-0 flex-col lg:flex">
      {host.plan && (
        <PlanPanel
          plan={host.plan}
          className="min-h-0 flex-1"
          onApproveStep={host.approveStep}
          onRunApproved={host.runApproved}
          onPause={host.pause}
          onCancel={host.cancel}
        />
      )}
      {host.evidence && (
        <div className="scrollbar-thin max-h-[45%] shrink-0 overflow-y-auto border-l border-t border-border bg-card/40 p-2">
          <VisualEvidenceCard assertions={host.evidence.assertions} diff={host.evidence.diff} />
        </div>
      )}
    </aside>
  )}
  ```
- **Conditional Artifact Rail**: Mounted at `App.tsx:602-612` when `artifactsManager.isOpen && artifactsManager.artifacts.length > 0` (`w-[440px]`).

### 2.3 State Management & React Data Flow

1. **Host-Driven vs. Local UI State**:
   - `useHostSession(options)` (`src/lib/hostSession.ts`): Manages the single WebSocket client lifecycle, tracking `status`, `plan`, `toolRuns`, `routeDecision`, `integrations`, `evidence`, and `permissionPending`.
   - Local state hooks (`useState`, `useCallback`, `useMemo`, `useRef`) manage transient form states, active selections, modal visibility, and local ledgers.
2. **Immutability & Pure Reducer Discipline**:
   - `sessionReducer.ts`: Pure functional updates for session messages (`patchSessionMessage`).
   - `vfs.ts`: Pure transitions for applying/reverting diffs (`applyPatch`, `revertPatch`).
   - `persist.ts`: Debounced local storage persistence with automatic cleanups and flush on `beforeunload`.
3. **Theme & Styling System**:
   - **Tailwind CSS 3.4** configured in `tailwind.config.js` with HSL CSS variables (`--background`, `--foreground`, `--primary`, `--secondary`, `--card`, `--muted`, `--border`, `--radius`).
   - **Ember/Warm Palette**: Primary is warm orange/amber (`hsl(32 100% 55%)`), card backgrounds are deep obsidian (`hsl(30 9% 6%)`), accents are gold/amber (`hsl(32 100% 60%)`).
   - **Micro-Typography**: Custom utility `.micro-label` (`font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground`) applied across all badges and section indicators.
   - **Icon System**: `lucide-react` with standardized `h-3.5 w-3.5` / `h-4 w-4` sizes and semantic color mapping (`text-primary`, `text-emerald-400`, `text-amber-400`, `text-red-400`, `text-muted-foreground`).

---

## 3. Deep Dive: Current `PlanPanel.tsx` Architecture

### 3.1 Component Signature & Props

`PlanPanel.tsx` (`src/sections/PlanPanel.tsx:21-30`):
```typescript
export interface PlanPanelProps {
  plan: ExecutionPlan;
  className?: string;
  /** Fired only from the explicit Approve button of an approval-required step. */
  onApproveStep: (planId: string, stepId: string) => void;
  /** Start/resume execution; disabled until every required approval is granted. */
  onRunApproved: (planId: string) => void;
  onPause: (planId: string) => void;
  onCancel: (planId: string) => void;
}
```

### 3.2 State Ingestion & Approval Ledger Mechanics

1. **Isolated Approval Ledger** (`src/sections/PlanPanel.tsx:69-73`):
   ```typescript
   const [approvals, setApprovals] = useState<{ planId: string; stepIds: ReadonlySet<string> }>({
     planId: plan.id,
     stepIds: new Set<string>(),
   });
   const approvedSteps = approvals.planId === plan.id ? approvals.stepIds : new Set<string>();
   ```
   - Keyed to `plan.id` so resetting or loading a new plan initializes a clean approval state.
   - **Zero Natural Language Authority**: Props, chat text, or streaming messages never write to `approvedSteps`. Only explicit user clicks (`approve(stepId)`) write to this Set.

2. **Security Status Downgrade Invariant** (`src/sections/PlanPanel.tsx:78-84`):
   ```typescript
   const effectiveStatus = (step: PlanStep): PlanStepStatus => {
     if (step.approval === "required" && !approvedSteps.has(step.id)) {
       if (step.status === "running") return "blocked";
     }
     return step.status;
   };
   ```
   - If a host stream or model output marks an unapproved step as `running`, `PlanPanel` strictly overrides the rendered status to `"blocked"` and displays `"awaiting approval"`.

3. **Step Rendering Elements**:
   - **Step Icon & Status Badge**: `STEP_ICON` (`Circle`, `ChevronRight`, `Check`, `X`, `Ban`) with status-dependent color classes (`text-muted-foreground`, `pulse-dot text-primary`, `text-emerald-400`, `text-red-400`, `text-amber-400`).
   - **Dependency Badges** (`src/sections/PlanPanel.tsx:147-159`): Renders `"depends on"` label and gray badges for each dependent step ID.
   - **Affected Scopes** (`src/sections/PlanPanel.tsx:161-174`): Renders `"scopes"` label with primary-tinted badges for workspace paths or browser origins.
   - **Resource Estimates** (`src/sections/PlanPanel.tsx:176-178`): Renders token count (`~1,200 tok`), USD cost (`≈$0.0020`), and duration (`~8s`).
   - **Side-Effecting Alert** (`src/sections/PlanPanel.tsx:180-182`): Amber text badge for mutating operations.
   - **Interactive Step Approval Button**: Amber shield button (`ShieldCheck`) triggering `approve(step.id)`.

4. **Action Dispatching & Control Gates**:
   - `canRun = allApproved && plan.state !== "executing" && plan.state !== "completed"`
   - `canPause = plan.state === "executing"`
   - `canCancel = plan.state !== "completed"`
   - Clicking `"run"` invokes `onRunApproved(plan.id)`.

---

## 4. Architectural Gap Analysis & R2 Requirements

While the current `PlanPanel` provides a solid foundation for flat plan inspections, it lacks key Antigravity-grade visual planning features defined in `ORIGINAL_REQUEST.md` (R1 & R2) and `docs/PRD_PLANNING_ARTIFACTS_SLASH.md`:

| Feature Area | Current `PlanPanel.tsx` | Target Phase 2 (Antigravity-Grade R2) |
|---|---|---|
| **Phase Grouping** | Flat `steps: PlanStep[]` list | Hierarchical `PlanPhase[]` accordions with order, title, and aggregate progress |
| **Phase Approvals** | Single-step approvals only | Single-click `"Approve Phase"` batch approving all steps in a phase |
| **Global Approval** | Individual buttons per step | Top-level `"Approve All"` button in toolbar / footer |
| **Step Timeline & DAG** | Ordered list (`<ol>`) with text badges | Visual status timeline with connector lines, status halos, and ready states |
| **Step States** | 5 states (`pending`, `running`, `succeeded`, `failed`, `blocked`) | 7 states (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`) |
| **Interactive Authoring** | Read-only inspection from props | Dynamic step insertion (`+ Step`), phase addition (`+ Phase`), step deletion, inline editing |
| **Step Reordering** | Fixed server/prop order | Step reordering (drag handles / up-down controls) with dependency safety checks |
| **Dependency Validation** | Read-only badges | Clickable dependency pills, interactive dependency editor, real-time Tarjan cycle detection |
| **Plan Revisions** | Single plan object | Revision tracking (`revisionId`, forking from previous revisions) |
| **Resource Rollups** | Per-step estimates only | Plan-level and phase-level token/cost/time aggregate banners |

---

## 5. Architectural Blueprint for R2 Visual Plan Control Plane

### 5.1 Protocol Data Model (`packages/protocol/src/plan.ts` & `src/types/index.ts`)

To support Phase-grouped execution plans, the protocol schemas must be enhanced:

```typescript
export type StepStatus =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped";

export interface StepEstimate {
  tokens?: number;
  costUsd?: number;
  durationSec?: number;
}

export interface PlanStep {
  id: string;
  phaseId: string;
  title: string;
  description?: string;
  dependsOn: readonly string[];
  status: StepStatus;
  approval?: "required";
  sideEffecting?: boolean;
  affectedScopes?: readonly string[];
  estimate?: StepEstimate;
  artifacts?: readonly string[];
}

export interface PlanPhase {
  id: string;
  title: string;
  description?: string;
  order: number;
}

export type PlanUIState =
  | "draft"
  | "awaiting_approval"
  | "executing"
  | "paused"
  | "completed"
  | "failed";

export interface ExecutionPlan {
  id: string;
  goal: string;
  state: PlanUIState;
  phases: readonly PlanPhase[];
  steps: readonly PlanStep[];
  revision?: number;
}
```

### 5.2 Plan Composer State & Reducer (`src/lib/planComposerReducer.ts`)

A dedicated pure reducer manages interactive plan mutations, cycle validation, batch approvals, and undo/redo history:

```typescript
export interface PlanComposerState {
  plan: ExecutionPlan;
  approvedStepIds: ReadonlySet<string>;
  selectedStepId: string | null;
  expandedPhaseIds: ReadonlySet<string>;
  history: ExecutionPlan[];
  historyIndex: number;
  validationErrors: string[];
}

export type PlanComposerAction =
  | { type: "ADD_PHASE"; phase: Omit<PlanPhase, "id"> }
  | { type: "REMOVE_PHASE"; phaseId: string }
  | { type: "RENAME_PHASE"; phaseId: string; title: string }
  | { type: "TOGGLE_PHASE_EXPAND"; phaseId: string }
  | { type: "ADD_STEP"; phaseId: string; step: Omit<PlanStep, "id" | "phaseId"> }
  | { type: "UPDATE_STEP"; stepId: string; updates: Partial<PlanStep> }
  | { type: "REMOVE_STEP"; stepId: string }
  | { type: "REORDER_STEPS"; phaseId: string; sourceIndex: number; destinationIndex: number }
  | { type: "ADD_DEPENDENCY"; stepId: string; dependsOnStepId: string }
  | { type: "REMOVE_DEPENDENCY"; stepId: string; dependsOnStepId: string }
  | { type: "APPROVE_STEP"; stepId: string }
  | { type: "TOGGLE_STEP_APPROVAL"; stepId: string }
  | { type: "APPROVE_PHASE"; phaseId: string }
  | { type: "APPROVE_ALL" }
  | { type: "SET_PLAN_STATE"; state: PlanUIState }
  | { type: "LOAD_PLAN"; plan: ExecutionPlan }
  | { type: "UNDO" }
  | { type: "REDO" };
```

### 5.3 Cycle Detection & DAG Topo-Release Engine

Cycle detection is implemented using DFS / Tarjan's Strongly Connected Components algorithm:
1. **Cycle Prevention**: Before accepting an `ADD_DEPENDENCY` action, the reducer verifies that `dependsOnStepId` cannot reach `stepId` in the current graph.
2. **Visual Highlighting**: If an incoming plan has a cycle, `validatePlan` flags the cycle path (e.g. `A → B → C → A`) and displays a red warning banner.
3. **Topological Release**: The updated `readySteps` function evaluates both graph dependencies and approval gates:
   ```typescript
   export function readySteps(
     plan: ExecutionPlan,
     approvedStepIds?: ReadonlySet<string>
   ): PlanStep[] {
     return plan.steps.filter((step) => {
       if (step.status !== "pending") return false;
       const depsSatisfied = step.dependsOn.every((depId) =>
         plan.steps.some((s) => s.id === depId && s.status === "succeeded")
       );
       if (!depsSatisfied) return false;
       if (step.approval === "required" && approvedStepIds && !approvedStepIds.has(step.id)) {
         return false;
       }
       return true;
     });
   }
   ```

### 5.4 Modular Component Subsystem Design

To ensure maintainability, `PlanPanel.tsx` should be decomposed into clean sub-components:

```
src/sections/
├── PlanPanel.tsx                  # Master container & header / toolbar / execution footer
└── plan/
    ├── PhaseAccordion.tsx         # Collapsible phase section with batch approval header
    ├── StepTimelineItem.tsx       # Individual step card with timeline dot, status, scopes, approval checkbox
    ├── DependencyBadgeList.tsx    # Clickable dependency tags with parent navigation
    ├── StepEditorModal.tsx        # Step creation / editing dialog (title, scopes, estimates)
    ├── PlanResourceSummary.tsx    # Aggregate tokens, USD cost, and wall-clock duration rollups
    └── DAGCycleAlert.tsx          # Cycle detection alert banner
```

---

## 6. WebSocket Wire Protocol & Integration Flow

### 6.1 Message Exchange Sequence

```
Client (Web UI)                                Host (Fastify WebSocket)
      |                                                   |
      | ------------- plan.submit (ExecutionPlan) ------> | (RunCoordinator validates DAG)
      | <------------ run.state (state: "queued") ------- |
      | <------------ run.state (state: "running") ------ |
      |                                                   |
      | [User clicks "Approve Step" or "Approve Phase"]   |
      | ------------- approval.grant (runId, stepId) ---> |
      |                                                   |
      | <------------ run.event ("step.started") -------- |
      | <------------ run.state (stepStates: {...}) ----- |
      | <------------ run.event ("step.completed") ------ |
      |                                                   |
      | [User clicks "Pause Execution"]                   |
      | ------------- run.pause (runId) ----------------> |
      | <------------ run.state (state: "paused") ------- |
      |                                                   |
      | [User clicks "Run Approved Plan"]                 |
      | ------------- plan.submit (ExecutionPlan) ------> |
      | <------------ run.state (state: "running") ------ |
```

### 6.2 Browser Permission Handshake Interlock (Task 10)

Observed in `src/lib/hostSession.ts:527-542` and verified by test `App.hostWiring.test.tsx:203`:
1. When a user approves a step in `PlanPanel` whose `affectedScopes` contains `browser:<origin>`:
2. `hostSession.approveStep` intercepts the call and launches the `BrowserPermissionDialog`.
3. Only when the user grants permission (`allow once` or `allow for session`) is `client.grantApproval` sent to the host.
4. If the user clicks `deny`, `client.denyApproval` is dispatched, and the step remains blocked.

---

## 7. Chat Composer Integration & Slash Command Engine (R3)

The chat composer in `src/sections/ChatPanel.tsx` requires an extensible slash command engine and floating caret popover:

1. **Caret Triggering**:
   - When the user types `/` as the first character in the textarea, a floating popover opens directly above the input.
   - Keyboard navigation: `ArrowUp`, `ArrowDown` to highlight; `Enter` or `Tab` to select; `Escape` to dismiss.
2. **Built-in Commands**:
   - `/plan <goal>`: Transitions UI to Planning Mode and initializes a draft plan with the given goal.
   - `/goal <text>`: Sets active objective banner.
   - `/schedule <cron | duration>`: Configures scheduled recurring background tasks.
   - `/browse <url>`: Opens managed browser inspection on the specified URL.
   - `/learn <skill>`: Teaches or loads an agent skill.
   - `/cost`: Opens the Cost Dashboard dialog.
   - `/compact`: Triggers context window compaction.
   - `/clear`: Resets active session transcript.
3. **Context Mentions**:
   - Typing `@file:` opens fuzzy workspace file completion (using files from `WorkspaceExplorer` or VFS).
   - Typing `@rule:` opens rules packs autocomplete.

---

## 8. Test Suite Analysis & Verification Strategy

### 8.1 Current Baseline Verification

| Test Suite | Location | Tests Passing | Duration | Status |
|---|---|---|---|---|
| **Frontend UI Suite** | `src/sections/__tests__/`, `src/lib/__tests__/` | **204 / 204** | 11.57s | **100% PASS** |
| **Protocol Suite** | `packages/protocol/src/*.test.ts` | **11 / 11** | 1.15s | **100% PASS** |
| **Host Suite** | `apps/agent-host/src/**/*.test.ts` | **158 / 158** | 5.51s | **100% PASS** |
| **Build & Typecheck** | `tsc -b && vite build` | **0 errors** | 14.2s | **CLEAN BUILD** |

### 8.2 Targeted Test Plan for Phase 2 Implementation

1. **Protocol Tests (`packages/protocol/src/plan.test.ts`)**:
   - Test hierarchical phase validation (`phases` + `steps`).
   - Test cycle detection for complex cyclic graphs.
   - Test topological `readySteps` resolution with approval ledger gates.
2. **Reducer Tests (`src/lib/__tests__/planComposerReducer.test.ts`)**:
   - Test step addition, deletion, update, and reordering.
   - Test phase addition, deletion, and reordering.
   - Test batch phase approvals and global approve-all.
   - Test undo/redo state restoration.
   - Test cycle prevention on dependency addition.
3. **Component Tests (`src/sections/__tests__/PlanPanel.test.tsx`)**:
   - Test phase accordion collapse/expand behavior.
   - Test phase progress bars and estimate formatting.
   - Test "Approve Entire Phase" button batches approvals correctly.
   - Test "Approve All" button enables "Run" button when all required approvals are met.
   - Test step status icon transitions (`ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`).
   - Test dependency badge navigation and affected scopes chips.
4. **Wiring Tests (`src/sections/__tests__/App.hostWiring.test.tsx`)**:
   - Test end-to-end plan submission, step approval forwarding, and run coordination over fake WebSocket transport.

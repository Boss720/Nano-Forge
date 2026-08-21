# Comprehensive Survey & Architectural Analysis Report: Extensible Slash Command Engine, Caret Popover, Context Mentions & Planning Mode Integration

**Document Version:** 1.0.0  
**Agent:** Survey Explorer 3 (NanoForge Phase 2 Planning & Command Specialist)  
**Milestone:** Phase 2: Antigravity-Style Planning Mode, Dedicated Artifact Viewers & Extensible Slash Command Engine  
**Target Modules:** `packages/protocol`, `apps/agent-host`, `src/`  
**Date:** 2026-08-15  

---

## Executive Summary

This survey report provides the authoritative technical analysis, component specifications, state machine models, wire protocol designs, and test strategies for **Requirement 3 (Extensible Slash Command Engine & Caret Popover)** and its deep integrations into NanoForge's Chat Composer, Active Goal Banner, Planning Mode lifecycle, and WebSocket bus (`command.execute`).

The existing NanoForge chat composer (`src/sections/ChatPanel.tsx`, lines 90–152) employs a standard multiline `<textarea>` with simple `Enter` key handling. To achieve Antigravity-grade interactive ergonomics, Phase 2 introduces:
1. **A Floating Caret Autocomplete Palette** triggered by `/` (commands) and `@` (context mentions), featuring full WAI-ARIA keyboard navigation (`Up`, `Down`, `Enter`, `Tab`, `Escape`).
2. **Eight Built-in Slash Commands** (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`) with deterministic POSIX-style argument tokenization, flag parsing (`--flag=val`), and quoted string support.
3. **Context Mention Autocompletions** (`@file:<path>` with fuzzy workspace indexing, `@rule:<name>` with loaded rules indexing).
4. **An Active Goal Objective Banner** pinned in the UI reflecting global mission objectives set via `/goal <text>`.
5. **Seamless Planning Mode Transition** on `/plan <goal>`, which initializes a draft `ExecutionPlan`, focuses the `PlanPanel` control surface, and syncs over WebSocket via `command.execute`.
6. **Dual Host-Client Wire Dispatch Pipeline** enabling client-handled commands (e.g. `/cost`, `/clear`, `/goal`) to execute instantly with zero latency while routing daemon, browser, and host tasks (e.g. `/schedule`, `/browse`, `/learn`, `/plan`) across the authenticated WebSocket bus.

---

## 1. Investigation of Existing Codebase & System Architecture

### 1.1 Chat Composer & Keyboard Handling (`src/sections/ChatPanel.tsx`)

In the current implementation (`src/sections/ChatPanel.tsx`, lines 89–153):
- **Draft Management**: Local state `const [draft, setDraft] = useState("")`.
- **Keyboard Handling**:
  ```tsx
  // src/sections/ChatPanel.tsx:95-100
  onKeyDown={(e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }}
  ```
- **Context Meter**: Real-time token estimation in `ChatPanel.tsx:65-70` using `estimateTokens(draft) + estimateTokens(AGENT_SYSTEM_PROMPT) + messagesTokens`.
- **Shortcomings & Gaps**:
  - No caret position or selection range tracking (`selectionStart`, `selectionEnd`).
  - No prefix inspection for `/` or `@` tokens.
  - No keyboard trapping for `ArrowUp` / `ArrowDown` / `Escape` / `Tab` when an autocomplete palette should be open.
  - Textarea submits unconditionally on plain `Enter`, which would inadvertently send incomplete slash commands or dismiss palettes without selecting the highlighted entry.

### 1.2 Host Session, Plan Control & WebSocket Bus (`src/lib/hostClient.ts` & `src/lib/hostSession.ts`)

- **HostClient Wire Frame Transmission** (`src/lib/hostClient.ts:31-52`):
  Currently supports `plan.submit`, `approval.grant`, `approval.deny`, `run.pause`, `run.cancel`, `workspace.readDir`, `workspace.search`, `workspace.gitStatus`, `integration.toggle`.
- **Missing Wire Frames**:
  - `command.execute` (client -> host)
  - `command.result` (host -> client)
  - `plan.propose` / `plan.update_step` / `plan.approve` / `plan.run_approved`
- **Host Session Hook** (`src/lib/hostSession.ts:183-206`):
  Maintains `plan`, `toolRuns`, `routeDecision`, `integrations`, `evidence`, `permissionPending`. It provides the wiring seam `setPlan`, `approveStep`, `runApproved`, `pause`, `cancel`.
- **Host Server Session Loop** (`apps/agent-host/src/session.ts:211-260`):
  Decodes client frames using `decodeClientMessage`. It handles `workspace.*` and `plan.submit`, but lacks a handler for `command.execute`.

### 1.3 Workspace & Rules Indexing Architecture

- **Workspace File Indexing**:
  - In Live Host Mode: `handleReadDir` and `handleSearch` (`apps/agent-host/src/workspace/filesystem.ts:18-57`) provide recursive directory entries and ripgrep search results.
  - In Standalone / Demo Mode: `files: VirtualFile[]` (`src/App.tsx:160`, `src/lib/catalog.ts:VIRTUAL_PROJECT`) contains the loaded VFS file paths.
  - In `src/hooks/use-workspace.ts:18-47`: `useWorkspace` exposes `tree`, `loadDirectory`, and `searchFiles`.
- **Rules Indexing**:
  - In `apps/agent-host/src/rules/loadRules.ts:79-88`: Composed rules with YAML frontmatter from three tiers (run, project, global).
  - In `src/sections/IntegrationsPanel.tsx:63`: Rules packs exposed via `host.integrations.rulesPacks` with `{ id, name, enabled }`.

---

## 2. Requirement 3: Extensible Slash Command Engine & Caret Popover

### 2.1 Trigger Rules & Caret Tokenizer

The palette activation is evaluated on every change of `draft` or caret movement (`onKeyUp`, `onClick`, `onChange`):

```
Input Line: "Please review /pl"
Caret Position: 17 (end of "/pl")
Extracted Token: "/pl" -> Trigger: "/" (Command Mode, Query: "pl")

Input Line: "Check file @file:src/ser"
Caret Position: 24
Extracted Token: "@file:src/ser" -> Trigger: "@file" (File Mention Mode, Query: "src/ser")

Input Line: "Follow @rule:sec"
Caret Position: 16
Extracted Token: "@rule:sec" -> Trigger: "@rule" (Rule Mention Mode, Query: "sec")
```

#### Token Detection Algorithm:
1. Identify the word/token under or immediately preceding the cursor (`textarea.selectionStart`).
2. Search backward from `cursorPos` to the nearest whitespace or line start.
3. If token starts with `/` (at position 0 or following whitespace), set palette mode to `"slash"`, query = `token.slice(1)`.
4. If token starts with `@file:` or `@` followed by file query, set palette mode to `"file_mention"`, query = `token.slice(token.indexOf(':') + 1 || 1)`.
5. If token starts with `@rule:` or `@rule`, set palette mode to `"rule_mention"`, query = `token.slice(token.indexOf(':') + 1 || 5)`.
6. Otherwise, if no trigger active or user pressed `Escape`, close palette.

### 2.2 Built-in Slash Commands Specification Matrix

| Command | Signature | Description | Execution Category | Target Destination |
| :--- | :--- | :--- | :--- | :--- |
| `/plan` | `/plan [goal: string]` | Switch to Planning Mode, open Plan Composer, draft DAG plan | `planning` | Local Plan State + Host Sync |
| `/goal` | `/goal <description: string>` | Set or update the active mission objective banner | `planning` | App Header State + System Context |
| `/schedule` | `/schedule <duration\|cron> <prompt>` | Schedule background daemon task, timer, or cron job | `system` | Host Task Coordinator |
| `/browse` | `/browse <url: string> [--action=screenshot\|dom]` | Managed Playwright session with visual evidence capture | `workspace` | Host Browser Manager |
| `/learn` | `/learn [topic\|path: string]` | Synthesize YAML skill definition & open Skill Studio | `workspace` | Skill Studio / Host Skills |
| `/cost` | `/cost [--by-model] [--by-day]` | Open Token & Cost Analytics dashboard modal | `system` | Local CostDashboard Modal |
| `/compact` | `/compact [--keep=N]` | Compact transcript memory window & free token budget | `context` | Agent Context Compressor |
| `/clear` | `/clear` | Clear current session history & reset conversation | `system` | Local Session State (`handleClearHistory`) |

### 2.3 Command Argument Parser & Tokenizer

The parser in `src/lib/commands/parser.ts` handles complex CLI-grade inputs:
- Quoted strings with spaces: `/plan "Refactor auth middleware to RS256"`
- Key-value flags: `/compact --keep=6 --summary`
- Short flags: `-f`, `-v`
- Mention tags: `@file:src/server.ts`, `@rule:security-first`

```typescript
// Proposed Parser Signature
export interface ParsedSlashCommand {
  command: string;          // e.g. "/plan"
  rawInput: string;
  positional: string[];     // e.g. ["Refactor auth middleware"]
  flags: Record<string, string | number | boolean>;
  mentions: {
    files: string[];
    rules: string[];
    symbols: string[];
  };
}
```

### 2.4 Context Mention Autocompletions (`@file:<path>`, `@rule:<name>`)

#### 2.4.1 Workspace File Autocomplete (`@file`)
- **Data Source**: Unified workspace file list combining `useWorkspace` search/readDir with VFS files `files: VirtualFile[]`.
- **Fuzzy Ranking**: Matches substring and path segments (e.g. `@file:serv` matches `src/server.ts`, `apps/agent-host/src/server.ts`).
- **Insertion Format**: Inserts `@file:<path>` into the composer text, preserving surrounding tokens.
- **Rendering**: Chat message renderer transforms `@file:<path>` into interactive clickable file badge chips that open Monaco or file viewer.

#### 2.4.2 Rule Autocomplete (`@rule`)
- **Data Source**: Composed rules list from `host.integrations.rulesPacks` or `loadRules`.
- **Fuzzy Ranking**: Matches rule ID, title, and description (e.g. `@rule:sec` matches `security-standards`, `no-raw-sql`).
- **Insertion Format**: Inserts `@rule:<ruleId>`.
- **Rendering**: Chat renderer displays styled shield badge chips for referenced rules.

---

## 3. Active Goal Objective Banner & Planning Mode Transitions

### 3.1 Active Goal Objective Banner Component

```
+---------------------------------------------------------------------------------------------------------+
| [Target] ACTIVE OBJECTIVE: Implement Phase 2 Extensible Slash Command Engine          [✎ Edit] [✕ Clear] |
| Target Scopes: [src/sections/**, packages/protocol/**]  ·  Status: Planning Mode (Draft Plan Initialized) |
+---------------------------------------------------------------------------------------------------------+
```

- **Placement**: Mounted directly above the chat transcript inside `ChatPanel` (or globally below `TopBar`).
- **State Model**:
  - `activeGoal: string | null` managed in `App.tsx` and persisted in session snapshot.
  - Executing `/goal <text>` updates `activeGoal`.
  - Executing `/goal` without arguments prompts the user with an inline editor.
  - Clicking `[✕ Clear]` sets `activeGoal` to `null`.
- **Context Injection**: When `activeGoal` is set, `buildContext` injects the goal into the system prompt banner:
  `"## ACTIVE OBJECTIVE\n<activeGoal>\nAll steps and tool calls must strictly advance this objective."`

### 3.2 Transitions to Planning Mode upon `/plan <goal>`

When the user enters `/plan <goal>`:
1. **Goal Extraction**: Positional arguments are merged into `goalString`. If omitted, default to the current active goal or prompt.
2. **State Transition**:
   - `activeGoal` is updated to `goalString`.
   - `planState` is set to `"draft"`.
3. **Plan Initialization**:
   - If no plan exists, creates a fresh `ExecutionPlan` structure:
     ```typescript
     const draftPlan: ExecutionPlan = {
       id: crypto.randomUUID(),
       goal: goalString,
       state: "draft",
       phases: [
         { id: "phase-1", title: "Discovery & Analysis", order: 1 },
         { id: "phase-2", title: "Implementation", order: 2 },
         { id: "phase-3", title: "Verification & Testing", order: 3 },
       ],
       steps: [],
       currentRevision: {
         revisionId: 1,
         parentRevisionId: null,
         createdAt: new Date().toISOString(),
         author: "user",
       },
     };
     ```
   - Sets plan via `host.setPlan(draftPlan)`.
4. **UI Layout Activation**:
   - Ensures the Right-Side Plan Rail (`PlanPanel` / `PlanComposer`) is expanded and focused.
5. **WebSocket Synchronization**:
   - If connected to host, dispatches `command.execute` frame `{ command: "/plan", positional: [goalString] }`.
   - Host generates structured DAG steps and streams `plan.update` frames back to client.

---

## 4. WebSocket Command Dispatch Pipeline (`command.execute`)

### 4.1 Wire Protocol Schemas (`packages/protocol`)

```typescript
// packages/protocol/src/commands.ts
import { z } from "zod";

export const slashCommandWireSchema = z.object({
  command: z.string().regex(/^\/[a-z0-9_-]+$/),
  positional: z.array(z.string()).default([]),
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  rawInput: z.string(),
  mentions: z.object({
    files: z.array(z.string()).default([]),
    rules: z.array(z.string()).default([]),
    symbols: z.array(z.string()).default([]),
    agents: z.array(z.string()).default([]),
  }).default({ files: [], rules: [], symbols: [], agents: [] }),
});
export type SlashCommandWire = z.infer<typeof slashCommandWireSchema>;

export const clientSlashCommandFrameSchema = z.object({
  type: z.literal("command.execute"),
  requestId: z.string(),
  command: slashCommandWireSchema,
});
export type ClientSlashCommandFrame = z.infer<typeof clientSlashCommandFrameSchema>;

export const hostCommandResultFrameSchema = z.object({
  type: z.literal("command.result"),
  requestId: z.string(),
  success: z.boolean(),
  message: z.string().optional(),
  outputArtifactId: z.string().optional(),
});
export type HostCommandResultFrame = z.infer<typeof hostCommandResultFrameSchema>;
```

### 4.2 End-to-End Command Execution Flow

```
[User types "/schedule 10m Run vitest suites"]
                     │
                     ▼
             [parseSlashCommand]
                     │
    +----------------+----------------+
    │                                 │
    ▼                                 ▼
(Client-Handled Command)     (Host-Handled Command)
e.g. /cost, /clear, /goal    e.g. /schedule, /browse, /learn, /plan
    │                                 │
    ▼                                 ▼
Execute React Action         [HostClient.executeCommand]
(openModal, clearMessages)            │
                             WebSocket Frame:
                             {"type":"command.execute", "requestId":"req-1", ...}
                                      │
                                      ▼
                             [Agent Host: session.ts]
                                      │
                             [Coordinator / Subsystem]
                                      │
                             WebSocket Response:
                             {"type":"command.result", "requestId":"req-1", "success":true}
                                      │
                                      ▼
                             [Resolve Client Promise & Show Notice]
```

---

## 5. UI Component Architecture & State Management

### 5.1 Component Hierarchy

```
App (src/App.tsx)
│
├── TopBar (src/sections/TopBar.tsx)
│   └── (Optional Active Goal Chip / Indicator)
│
├── Main Content Rail (flex row)
│   ├── Sidebar (src/sections/Sidebar.tsx)
│   │
│   ├── Center Chat Column (flex-1 col)
│   │   ├── ActiveGoalBanner (src/components/ActiveGoalBanner.tsx) [NEW]
│   │   │   ├── GoalTargetIcon
│   │   │   ├── GoalTitleText
│   │   │   ├── GoalScopesBadges
│   │   │   └── GoalActionButtons (Edit / Clear)
│   │   │
│   │   ├── TranscriptArea (Messages, ToolRunCards, PatchCards)
│   │   │
│   │   └── ComposerContainer (src/sections/ChatPanel.tsx)
│   │       ├── SlashCommandPalette (src/components/SlashCommandPalette.tsx) [NEW]
│   │       │   ├── PaletteHeader (Category Tabs / Search Query)
│   │       │   ├── CommandList (Keyboard Navigable Items)
│   │       │   │   └── CommandItem (Icon, Name, Syntax, Description, Category Badge)
│   │       │   └── MentionList (For @file and @rule queries)
│   │       │       └── MentionItem (Path/Name, Metadata, Icon)
│   │       │
│   │       └── TextareaInput (with Keydown Interceptors & Caret Tracking)
│   │
│   ├── PlanPanel (src/sections/PlanPanel.tsx) (Expanded in Planning Mode)
│   └── ArtifactDock (src/sections/ArtifactDock.tsx)
│
└── Modals & Overlays (CostDashboard, ConnectDialog, IntegrationsPanel)
```

### 5.2 Pure State Reducer: `slashCommandReducer.ts`

```typescript
export interface SlashCommandState {
  isOpen: boolean;
  mode: "slash" | "file_mention" | "rule_mention";
  query: string;
  selectedIndex: number;
  triggerStartIndex: number;
}

export type SlashCommandAction =
  | { type: "OPEN"; mode: "slash" | "file_mention" | "rule_mention"; query: string; startIndex: number }
  | { type: "CLOSE" }
  | { type: "SET_QUERY"; query: string }
  | { type: "NAVIGATE"; direction: "up" | "down"; totalItems: number }
  | { type: "SET_INDEX"; index: number };

export function slashCommandReducer(
  state: SlashCommandState,
  action: SlashCommandAction
): SlashCommandState {
  switch (action.type) {
    case "OPEN":
      return {
        isOpen: true,
        mode: action.mode,
        query: action.query,
        selectedIndex: 0,
        triggerStartIndex: action.startIndex,
      };
    case "CLOSE":
      return {
        ...state,
        isOpen: false,
        query: "",
        selectedIndex: 0,
      };
    case "SET_QUERY":
      return {
        ...state,
        query: action.query,
        selectedIndex: 0,
      };
    case "NAVIGATE": {
      if (action.totalItems === 0) return state;
      const nextIndex =
        action.direction === "down"
          ? (state.selectedIndex + 1) % action.totalItems
          : (state.selectedIndex - 1 + action.totalItems) % action.totalItems;
      return { ...state, selectedIndex: nextIndex };
    }
    case "SET_INDEX":
      return { ...state, selectedIndex: action.index };
    default:
      return state;
  }
}
```

### 5.3 Keyboard Accessibility & Event Trapping

When `SlashCommandPalette` is open (`state.isOpen === true`):
- `ArrowDown`: Intercepted by `onKeyDown`, prevents textarea cursor move, dispatches `{ type: "NAVIGATE", direction: "down", totalItems }`.
- `ArrowUp`: Intercepted, prevents cursor move, dispatches `{ type: "NAVIGATE", direction: "up", totalItems }`.
- `Enter` or `Tab`: Prevents form submission / newline, executes autocomplete for selected item:
  - If slash command: inserts command template (e.g. `/plan ` or `/schedule `) or executes immediate commands without arguments.
  - If `@file` or `@rule`: replaces trigger prefix with `@file:<selectedPath> ` or `@rule:<selectedId> `.
  - Closes palette and refocuses textarea.
- `Escape`: Closes palette, retains current draft text, prevents any modal from closing.

---

## 6. Comprehensive Test Strategy & Verification Plan

### 6.1 Unit Tests (Vitest)

1. **`parseSlashCommand.test.ts`** (16+ test cases):
   - Plain commands (`/plan`, `/clear`, `/cost`).
   - Commands with positional arguments (`/plan Add OAuth2 login`).
   - Quoted arguments with internal spaces (`/goal "Build Phase 2 Control Surface"`).
   - Boolean and key-value flags (`/compact --keep=5 --summary`, `/browse https://site.com --action=dom`).
   - Mention token extraction (`@file:src/server.ts`, `@rule:security-rules`).
   - Malformed / non-command strings (returns `null` safely).

2. **`slashCommandReducer.test.ts`** (12+ test cases):
   - Opening in `slash`, `file_mention`, and `rule_mention` modes.
   - Cycling navigation with wrap-around on `NAVIGATE` up/down.
   - Query updates resetting `selectedIndex` to 0.
   - Closing and state resets.

3. **`ActiveGoalBanner.test.tsx`** (6+ test cases):
   - Renders active goal string with Target icon.
   - Shows "Edit" and "Clear" buttons with appropriate callbacks.
   - Hidden when `activeGoal` is null.

4. **`SlashCommandPalette.test.tsx`** (10+ test cases):
   - Renders filtered commands matching query.
   - Highlights active item via `aria-selected="true"`.
   - Responds to click events and keyboard selection.
   - Renders category grouping headers.

### 6.2 Integration & Interaction Tests (React Testing Library)

1. **`ChatPanel.composer.test.tsx`**:
   - Typing `/` pops up the command palette.
   - Typing `/pl` filters list down to `/plan`.
   - Pressing `ArrowDown` then `Enter` completes `/plan ` into the textarea.
   - Pressing `Escape` closes the palette without submitting.
   - Typing `@file` displays workspace file list and inserts mention pill on selection.

2. **`App.slashCommands.test.tsx`**:
   - Executing `/cost` opens `CostDashboard` dialog.
   - Executing `/clear` resets session messages.
   - Executing `/goal Build NanoForge` mounts `ActiveGoalBanner`.
   - Executing `/plan Refactor Backend` sets goal, transitions to Planning Mode, and expands `PlanPanel`.

3. **`apps/agent-host/src/session.test.ts`**:
   - Dispatching `command.execute` over WebSocket returns `command.result` or dispatches task.

---

## 7. Implementation Roadmap & Concrete Action Items for Worker Agents

1. **Protocol Expansion (`packages/protocol`)**:
   - Create `packages/protocol/src/commands.ts` (`slashCommandWireSchema`, `clientSlashCommandFrameSchema`, `hostCommandResultFrameSchema`).
   - Export new contracts in `packages/protocol/src/index.ts`.
   - Add unit tests in `packages/protocol/src/commands.test.ts`.

2. **Command Parsing & State Engine (`src/lib/commands/`)**:
   - Implement `src/lib/commands/types.ts` & `src/lib/commands/registry.ts` with all 8 built-in definitions.
   - Implement `src/lib/commands/parser.ts` (deterministic tokenizer).
   - Implement `src/lib/slashCommandReducer.ts`.

3. **UI Components (`src/components/` & `src/sections/`)**:
   - Build `src/components/ActiveGoalBanner.tsx`.
   - Build `src/components/SlashCommandPalette.tsx` with fuzzy matching.
   - Upgrade `src/sections/ChatPanel.tsx` with caret tracking, palette overlay, and mention autocompletion.
   - Integrate `ActiveGoalBanner` and `/plan` / `/goal` handlers in `src/App.tsx`.

4. **Host WebSocket Synchronization (`apps/agent-host` & `src/lib/hostClient.ts`)**:
   - Add `executeCommand` to `HostClient` (`src/lib/hostClient.ts`).
   - Add `command.execute` ingestion to `attachAgentSession` (`apps/agent-host/src/session.ts`).

5. **Test Suites & Verification**:
   - Execute `npm run test:protocol`, `npm run test:host`, `npm test`, and `npm run build`.
   - Verify 100% test pass rate and 0 build errors.

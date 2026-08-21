# Phase 6 Survey & Architecture Analysis: Live Swarm E2E Playground, Telemetry & Dynamic UI Palette

**Author**: Explorer 2 (Frontend & UI Architecture Specialist)  
**Date**: 2026-08-15  
**Working Directory**: `.agents/teamwork_preview_explorer_survey_2/`  
**Milestone**: Phase 6 Swarm Expansion & UI Enhancement Survey  

---

## 1. Executive Summary

This survey provides the frontend and integration architecture for Phase 6 of NanoForge, addressing:
1. **Requirement R1 (Live E2E Swarm Playground & Interactive Testing)**: Bridging the agent-host server with the visual control plane to enable live simulated and real subagent lifecycle turns, streaming tool inspections, mailbox exchanges with 5-component handoff reports, and background daemon task management over real-time WebSocket synchronization.
2. **Requirement R2 (Telemetry Display & Cross-Agent Shared Memory)**: Implementing detailed token consumption and runtime latency meters across swarm tree nodes, along with an interactive Shared Memory Visualizer for `memory.set`, `memory.get`, and `memory.query` across isolated namespaces.
3. **Requirement R3 (Dynamic UI Palette & Theme Customizer)**: Introducing a real-time theme and palette customizer in settings allowing users to switch preset themes, adjust accent colors and surface contrasts, and dynamically update CSS custom properties without page reload, with localStorage persistence.

---

## 2. Requirement R1: Live E2E Swarm Playground & Interactive Testing

### 2.1 Current State of Frontend Swarm Control Plane

The frontend currently possesses the foundations in `src/sections/SubagentsPanel.tsx` and `src/sections/subagents/`:
- `AgentSwarmTreeView.tsx`: Hierarchical tree rendering, state badges, archetype styling, uptime clock, basic token count, and recursive branch termination (`killSubagentTree`).
- `AgentToolInspector.tsx`: Streaming tool execution cards, parameters inspection with copy-to-clipboard, auto-scrolling log console (capped at 2MB ring buffer), and stop tool button.
- `AgentMailboxViewer.tsx`: Inter-agent messaging timeline, 5-component handoff report parser (Observation, Logic Chain, Caveats, Conclusion, Verification Method) with collapsible accordion sections, referenced artifacts chips, and quick-reply composer.
- `DaemonTaskManager.tsx`: Background process tracking with interactive STDIN input bar, logs dialog, scheduler for one-shot timers and cron expressions.
- `SpawnSubagentModal.tsx`: Modal for spawning autonomous child agents with supervisor parent selection, archetype presets, role tags, workspace isolation modes (`inherit`, `branch`, `share`), and tool permission gates.

### 2.2 Phase 6 Enhancements for Live E2E Playground

To elevate the control plane into a **Live E2E Swarm Playground**, the following additions are required:

#### A. Interactive Swarm Playground Tab (`AgentSwarmPlayground.tsx`)
Add a dedicated **Playground** tab to `SubagentsPanel.tsx`:
1. **Interactive Dispatch Console**:
   - Operator prompt input targeting any selected active subagent or root supervisor.
   - Preset benchmark scenarios (e.g. *Codebase Exploration*, *Test Suite Generation*, *Regression Repair*, *Security Audit*, *DAG Dependency Planning*).
2. **Simulated vs. Real Turn Runner**:
   - Toggle switch between **Live Host Execution** (real WebSocket RPC to `agent-host`) and **Simulated Playground Mode** (in-memory mock turns for offline testing, UI demo, and fast iteration).
3. **Step-by-Step Turn Stepper**:
   - Step through subagent reasoning cycles, tool approval requests, and mailbox exchanges turn-by-turn with pause/resume controls.
4. **Failure Injection & Supervision Strategy Testing**:
   - Interactive triggers to simulate subagent crashes, execution timeouts, stalled heartbeats (>180s), or out-of-budget events.
   - Visually observe supervisor restart strategies:
     - `one_for_one`: Child restarts in isolation.
     - `one_for_all`: All sibling children terminate and restart.
     - `rest_for_one`: Children spawned chronologically after the failed agent terminate and restart.

#### B. WebSocket Real-Time State Synchronization Protocol
Enhance `HostClient` (`src/lib/hostClient.ts`) and `hostSession.ts` to handle full bidirectional events:
- Inbound event streaming:
  - `subagent.turn_started`: Subagent turn initiation event with prompt preview.
  - `subagent.turn_completed`: Token usage delta, turn latency duration, output summary.
  - `subagent.state_changed`: Canonical 7-state transitions (`running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored`).
  - `subagent.heartbeat`: Liveness timestamp and progress summary updates.
  - `tool.approval_required` & `tool.output`: Real-time streaming chunks and exit codes.
  - `subagent.message_sent`: Inter-agent mailbox messages and handoff reports.

---

## 3. Requirement R2: Telemetry Display & Shared Memory Visualizer

### 3.1 Swarm Telemetry Display Architecture

Telemetry is displayed across two primary surfaces in `SubagentsPanel`:

#### A. Swarm Metrics Summary Bar (`SubagentsPanel.tsx`)
Expanded 5-metric overview:
1. **Active Agents**: Running / Total agents with state breakdown indicator (Running, Idle, Waiting, Errored).
2. **Token Consumption**: Total tokens formatted (e.g. `142.5k tok`), with prompt vs. completion breakdown in tooltip.
3. **Burn Rate & Latency**: Real-time consumption rate (`tok/sec`) and average turn round-trip latency (`ms/turn`).
4. **Shared Memory**: Total shared memory entries count and active namespace count.
5. **Daemons & Timers**: Count of running background tasks and active schedules.

#### B. Node-Level Telemetry in Swarm Tree (`AgentSwarmTreeView.tsx`)
Each subagent node card in the supervision tree displays:
- **Token Gauge & Budget Meter**:
  - Visual progress bar showing `tokensUsed` against `budgetTokens` (if budget is set).
  - Dynamic color thresholds:
    - Normal (<70% budget): Emerald (`bg-emerald-500`)
    - Warning (70% - 90% budget): Amber (`bg-amber-500`)
    - Critical / Exceeded (>90% or capped): Red (`bg-red-500`)
- **Turn Count & Average Latency**:
  - Badge displaying `Turn N` and average latency e.g. `1.1s avg/turn`.
  - Last turn execution duration badge e.g. `920ms`.
- **Liveness & Heartbeat Status Indicator**:
  - `Healthy` (<30s heartbeat): Pulsing green dot.
  - `Active` (30s - 180s heartbeat): Amber dot.
  - `STALLED >180s`: Flashing red badge indicating agent hang / dead worker.
- **Uptime Clock**: Continuous elapsed runtime formatted as `Xs`, `Xm Ys`, or `Xh Ym`.
- **Cost Meter**: Estimated cost in USD calculated from active model pricing tokens.

### 3.2 Cross-Agent Shared Memory Visualizer (`AgentMemoryViewer.tsx`)

To support Phase 6's cross-agent shared memory (`memory.set`, `memory.get`, `memory.query`):
- Add a new tab `Shared Memory` (`tab-memory`) to `SubagentsPanel`.
- **Key Features**:
  1. **Namespace Selector & Filter**: Filter entries by namespace (`global`, `session`, `scratch`, `agent:<id>`).
  2. **Key Search Bar**: Instant search across key names, string values, and metadata tags.
  3. **Key-Value Table / Inspector**:
     - Key Name & Namespace badge.
     - Value preview with format autodetection (JSON, string, number, array, boolean).
     - Byte size indicator (e.g. `240 B`, `1.4 KB`).
     - Last modified timestamp and author agent identifier.
     - Collapsible JSON formatting inspector with copy action.
  4. **Interactive Memory Controls**:
     - "Set Key" modal dialog to create or update shared memory entries directly from the UI.
     - "Delete Key" and "Flush Namespace" actions.
     - "Query" tool to test pattern/prefix queries against the shared memory store.

---

## 4. Requirement R3: Dynamic UI Palette & Theme Customizer

### 4.1 CSS Custom Property Token Architecture

The UI styling in `src/index.css` and `tailwind.config.js` is driven by CSS custom properties in HSL format (`<H> <S>% <L>%`):

| CSS Custom Property | Tailwind Token | Semantic Role |
|---|---|---|
| `--primary` | `primary.DEFAULT` | Brand / Accent color for buttons, active tabs, glowing indicators |
| `--primary-foreground` | `primary.foreground` | Text color overlaid on primary background |
| `--background` | `background` | Application canvas background (OLED black, charcoal, slate) |
| `--foreground` | `foreground` | Main high-contrast text color |
| `--card` | `card.DEFAULT` | Card, dock, modal, and panel background |
| `--card-foreground` | `card.foreground` | Text color within cards and panels |
| `--secondary` | `secondary.DEFAULT` | Secondary surface for toolbars, chips, inputs |
| `--muted` | `muted.DEFAULT` | Muted backgrounds for code blocks, inactive tabs |
| `--muted-foreground` | `muted.foreground` | Secondary helper text and subtitles |
| `--accent` | `accent.DEFAULT` | Hover highlights and badge accents |
| `--border` | `border` | Borders for cards, dividers, buttons |
| `--input` | `input` | Border and backgrounds for input fields |
| `--ring` | `ring` | Focus rings and active card selections |
| `--radius` | `rounded-*` | Border radius scaling (`0.5rem` default) |

### 4.2 Theme Preset Definitions (`src/lib/themePalette.ts`)

Seven meticulously calibrated presets are provided:

1. **Ember Forge (Default)**:
   - Primary: Amber Orange `32 100% 55%`
   - Background: Dark Charcoal `30 8% 4%`
   - Card: Warm Dark `30 9% 6%`
   - Border: Warm Slate `32 8% 14%`
2. **Cyberpunk Neon**:
   - Primary: Electric Cyan `185 100% 50%`
   - Background: Deep Dark Void `220 15% 4%`
   - Card: Neon Tinted `220 15% 7%`
   - Border: Cyber Blue `190 40% 16%`
3. **Emerald Matrix**:
   - Primary: High-Tech Emerald `155 100% 45%`
   - Background: Dark Forest Slate `160 12% 4%`
   - Card: Deep Emerald Dark `160 12% 6%`
   - Border: Emerald Border `155 25% 15%`
4. **Amethyst Velvet**:
   - Primary: Electric Violet `270 85% 65%`
   - Background: Deep Plum Dark `265 12% 4%`
   - Card: Violet Card `265 12% 7%`
   - Border: Violet Border `270 25% 16%`
5. **Solar Flare**:
   - Primary: Radiant Gold `45 100% 50%`
   - Background: Dark Bronze `35 12% 4%`
   - Card: Bronze Card `35 12% 6%`
   - Border: Bronze Border `40 25% 15%`
6. **Midnight Slate**:
   - Primary: Steel Sky Blue `210 100% 56%`
   - Background: Midnight Navy `222 15% 5%`
   - Card: Slate Card `222 15% 8%`
   - Border: Slate Border `215 20% 16%`
7. **Monochrome Obsidian**:
   - Primary: Pure Platinum White `0 0% 95%`
   - Background: Pure OLED Black `0 0% 2%`
   - Card: Obsidian Card `0 0% 5%`
   - Border: Crisp Grey Border `0 0% 15%`

### 4.3 Customization Controls & Instant Live Mutation

- **Component**: `ThemeCustomizer.tsx` (rendered within a dedicated "Theme" tab in Settings / `ConnectDialog.tsx`).
- **Interactive Controls**:
  - Preset Selector Cards with live mini color palettes.
  - Primary Color Hue Picker / Slider (0° - 360°) and Saturation/Lightness adjusters.
  - Surface Contrast Slider: OLED Pure Black (0%) -> Deep Charcoal (4%) -> Soft Slate (8%) -> Lightened Slate (12%).
  - Accent Color Hue Picker.
  - Border Radius Picker: Sharp (0px), Compact (4px), Standard (8px), Rounded (12px), Pill (16px).
  - "Reset to Default" button.
- **Zero-Reload Live Application**:
  - `applyThemePalette(palette)` immediately iterates through token key-value pairs and executes:
    ```ts
    document.documentElement.style.setProperty(`--${token}`, value);
    ```
  - Instantaneous visual update without DOM re-mounting or page refresh.
- **Persistence & Hydration**:
  - Saved to `localStorage.setItem('nanoforge.theme_palette', JSON.stringify(palette))`.
  - Initialized on boot via `initThemePalette()` in `src/main.tsx` before React mount to prevent any flash of default theme.

---

## 5. Concrete Component Structure & File Plan

### 5.1 Component Tree & File Map

```
src/
├── lib/
│   ├── themePalette.ts             # Theme presets, CSS variable applicator, localStorage persistence
│   ├── hostClient.ts               # Enhanced with shared memory & turn telemetry RPCs
│   ├── hostSession.ts              # Extended with shared memory state, turn events, telemetry
│   └── __tests__/
│       └── themePalette.test.ts    # Unit tests for theme customizer, HSL conversion, persistence
├── sections/
│   ├── ConnectDialog.tsx           # Enhanced with Theme Customizer tab
│   ├── SubagentsPanel.tsx          # Enhanced with Playground tab & Shared Memory tab
│   ├── subagents/
│   │   ├── AgentSwarmTreeView.tsx  # Enhanced with token meters, latency meters, budget gauges
│   │   ├── AgentToolInspector.tsx  # Streaming tool inspections
│   │   ├── AgentMailboxViewer.tsx  # 5-component handoffs & direct message exchanges
│   │   ├── DaemonTaskManager.tsx   # Daemon processes & cron scheduler
│   │   ├── AgentMemoryViewer.tsx   # [NEW] Cross-agent shared memory explorer & editor
│   │   ├── AgentSwarmPlayground.tsx# [NEW] Interactive E2E turn dispatcher & failure simulator
│   │   └── SpawnSubagentModal.tsx  # Subagent spawning dialog
│   ├── settings/
│   │   └── ThemeCustomizer.tsx     # [NEW] Dynamic theme selector & custom palette controls
│   └── __tests__/
│       ├── ThemeCustomizer.test.tsx# Tests for theme switching, live CSS mutation, sliders
│       ├── AgentMemoryViewer.test.tsx # Tests for shared memory CRUD, namespace filtering
│       ├── AgentSwarmPlayground.test.tsx # Tests for interactive dispatch & simulated turns
│       └── AgentSwarmTreeView.telemetry.test.tsx # Tests for token meters, latency badges
```

### 5.2 Extended `HostSession` Interface

```ts
export interface SharedMemoryEntry {
  key: string;
  namespace: string;
  value: unknown;
  sizeBytes: number;
  updatedAt: string;
  authorAgentId?: string;
  ttlSeconds?: number;
}

export interface SwarmTelemetry {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
  averageTurnLatencyMs: number;
  totalTurns: number;
  activeAgentsCount: number;
  stalledAgentsCount: number;
}

export interface HostSession {
  // ... existing fields ...
  sharedMemory: SharedMemoryEntry[];
  swarmTelemetry: SwarmTelemetry;
  
  // Shared Memory RPCs
  setSharedMemory: (key: string, value: unknown, namespace?: string, ttlSeconds?: number) => Promise<void>;
  getSharedMemory: (key: string, namespace?: string) => Promise<unknown>;
  querySharedMemory: (prefix?: string, namespace?: string) => Promise<SharedMemoryEntry[]>;
  deleteSharedMemory: (key: string, namespace?: string) => Promise<void>;
  
  // Playground & Simulation Dispatchers
  dispatchPlaygroundTurn: (subagentId: string, prompt: string) => Promise<void>;
  simulateAgentTurn: (subagentId: string, scenario: string) => Promise<void>;
  injectAgentFailure: (subagentId: string, failureType: "timeout" | "crash" | "stall") => Promise<void>;
}
```

---

## 6. Implementation & Verification Plan

### Phase Plan

1. **Step 1: Theme & Palette Engine (`src/lib/themePalette.ts`, `ThemeCustomizer.tsx`, `ConnectDialog.tsx`)**:
   - Implement HSL theme presets and dynamic property mutations.
   - Embed ThemeCustomizer into settings modal.
   - Add unit tests verifying instant CSS variable injection and localStorage persistence.

2. **Step 2: Shared Memory Protocol & Visualizer (`AgentMemoryViewer.tsx`, `hostClient.ts`, `hostSession.ts`)**:
   - Add shared memory wire requests and events in protocol client.
   - Implement `AgentMemoryViewer` component with namespace filters and JSON inspection.
   - Add unit tests for shared memory operations.

3. **Step 3: Swarm Telemetry & Latency Gauges (`AgentSwarmTreeView.tsx`, `SubagentsPanel.tsx`)**:
   - Add token budget progress bars, latency meters, and burn rate counters to tree nodes and summary bar.
   - Add tests for gauge threshold calculations and formatting.

4. **Step 4: Interactive Live Swarm Playground (`AgentSwarmPlayground.tsx`, `SubagentsPanel.tsx`)**:
   - Implement dispatch console, simulated turn runner, and failure injection tools.
   - Add tests for playground interaction, step execution, and supervision recovery.

5. **Step 5: Full E2E & Test Suite Verification**:
   - Run `npm run test:protocol` (100% pass).
   - Run `npm run test:host` (100% pass).
   - Run `npm test` (100% pass).
   - Run `npm run build` (0 TypeScript / Vite errors).

---

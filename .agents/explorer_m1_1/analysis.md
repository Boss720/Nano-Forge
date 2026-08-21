# Comprehensive Analysis: Milestone 1 — Planning Protocol & Command Contracts

**Document Version:** 1.0.0  
**Target Milestone:** Milestone 1 (M1)  
**Author:** Explorer M1.1 (`.agents/explorer_m1_1`)  
**Scope:** `packages/protocol/src/plan.ts`, `packages/protocol/src/commands.ts`, `packages/protocol/src/index.ts`, `packages/protocol/__tests__/` / `packages/protocol/src/*.test.ts`  
**Status:** Investigation Complete & Ready for Implementation  

---

## 1. Executive Summary & Problem Boundary

NanoForge Phase 2 requires an enterprise-grade isomorphic protocol foundation that underpins two primary subsystems:
1. **Antigravity-Style Planning Mode**: Multi-phase hierarchical DAG execution plans, interactive dual approval gates, topological step dependency resolution, deterministic cycle detection, and plan lifecycle state transitions.
2. **Extensible Slash Command Engine**: Inline composer palette (`/` trigger), POSIX-style argument parsing, contextual mentions (`@file:<path>`, `@rule:<name>`, `#symbol:<name>`, `@agent:<id>`), and bidirectional host-client WebSocket wire contracts (`command.execute` / `command.result`).

This analysis establishes the complete, production-ready TypeScript interfaces, Zod runtime schemas, deterministic DAG/topological algorithms, command parser specifications, and exhaustive unit test matrices required for `packages/protocol`.

---

## 2. Current Protocol Package State & Consumer Audit

### 2.1 Existing Protocol Surface

| File Path | Current Contents | Gaps & Deficiencies |
|-----------|------------------|---------------------|
| `packages/protocol/src/plan.ts` | Basic `StepStatus` (5 states), `StepEstimate`, `PlanStep`, `ExecutionPlan`, `readySteps(plan)` | Missing Zod schemas; missing `ready` and `skipped` step statuses; missing `PlanPhase` grouping; missing `PlanLifecycleState`; missing `approvedStepIds` dual gate in `readySteps`; missing DAG cycle detection. |
| `packages/protocol/src/commands.ts` | **Does not exist** | Needs full implementation: `SlashCommandWire`, `CommandMentions`, `SlashCommandDefinition`, wire schemas (`command.execute`, `command.result`), parser/formatter, and 8 built-in command contracts. |
| `packages/protocol/src/index.ts` | Re-exports `./plan`, `./routing`, `./artifacts` | Needs export for `./commands`. |
| `packages/protocol/src/artifacts.ts` | Zod schemas & types for artifacts, feedback responses, format detection | Complete and functional (baseline). |
| `packages/protocol/src/routing.ts` | Routing types, capability scoring, latency/cost formulas | Complete and functional (baseline). |
| `packages/protocol/src/plan.test.ts` | 6 unit tests for basic `readySteps` | Needs expansion for 7 step states, dual approvals, Zod schema validation, phase hierarchies, and DAG cycle validation. |
| `packages/protocol/vitest.config.ts` | Configured with `root: __dirname`, `include: ["src/**/*.test.ts"]` | Vitest looks for `src/**/*.test.ts`. Tests can reside co-located in `src/` or in `__tests__/` (with pattern adjusted or matched). |

### 2.2 Downstream Consumers & Compatibility Matrix

1. **Agent Host (`apps/agent-host`)**:
   - `apps/agent-host/src/protocol.ts`: Imports `ExecutionPlan` from `@protocol/plan`. Validates incoming `plan.submit` payloads.
   - `apps/agent-host/src/runs/coordinator.ts`: Imports `ExecutionPlan`, `PlanStep`, `StepStatus`, `readySteps` from `@protocol/plan`.
   - `apps/agent-host/src/planning/validatePlan.ts`: Validates plans for duplicate IDs, missing dependencies, cycles, and side-effect approvals.
   - `apps/agent-host/src/session.ts`: Stores active `plan: ExecutionPlan | null`.
2. **Frontend Control Plane (`src/`)**:
   - `src/types/index.ts`: Mirrors/re-exports plan types.
   - `src/lib/hostClient.ts`: Transmits plan mutations and command executions.
   - `src/lib/hostSession.ts`: Manages plan state, approvals, and WebSocket sync.
   - `src/sections/PlanPanel.tsx`: Renders visual plan control surface.
   - `src/sections/ChatPanel.tsx`: Renders chat and slash command popover.

**Strict Compatibility Invariant**: All additions to `ExecutionPlan`, `PlanStep`, and `readySteps` MUST be strictly backward compatible with existing legacy fixtures (such as `{ id: "p1", goal: "test", steps: [...] }`) to guarantee 0 regressions across existing test suites (`npm run test:protocol`, `npm run test:host`, and `npm test`).

---

## 3. Blueprint: `packages/protocol/src/plan.ts`

### 3.1 Exact TypeScript Types & Zod Schemas

```typescript
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Step Status & Lifecycle States                                  */
/* ------------------------------------------------------------------ */

/**
 * Canonical 7-state lifecycle of a single plan step:
 * - "pending": Upstream dependencies are not yet satisfied.
 * - "ready": Upstream dependencies are satisfied; awaiting approval or execution dispatch.
 * - "running": Currently executing in the agent host.
 * - "succeeded": Execution finished with exit code 0 / successful assertion.
 * - "failed": Execution failed or crashed; halts dependent execution branch.
 * - "blocked": Requires user approval or has an upstream failed dependency.
 * - "skipped": Intentionally bypassed by user action or conditional branch resolution.
 */
export const stepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/**
 * Canonical 6-state plan-level lifecycle state:
 * - "draft": Authoring in PlanComposer, AI proposal, manual editing.
 * - "awaiting_approval": Reviewing steps, diffs, and pending user approval gates.
 * - "executing": Active execution of ready steps by coordinator.
 * - "paused": Execution temporarily halted by user.
 * - "completed": All required steps in plan have succeeded or skipped.
 * - "failed": One or more unrecoverable step failures halted the plan.
 */
export const planLifecycleStateSchema = z.enum([
  "draft",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
]);
export type PlanLifecycleState = z.infer<typeof planLifecycleStateSchema>;

/** Legacy alias for UI components and backward compatibility. */
export const planUIStateSchema = planLifecycleStateSchema;
export type PlanUIState = PlanLifecycleState;

/* ------------------------------------------------------------------ */
/* 2. Step Resource Estimates & Phase Groupings                       */
/* ------------------------------------------------------------------ */

/** Resource estimates for UI display, cost analytics, and model routing. */
export const stepEstimateSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationSec: z.number().nonnegative().optional(),
});
export type StepEstimate = z.infer<typeof stepEstimateSchema>;

/**
 * Logical phase grouping for hierarchical DAG execution plans:
 * e.g. "Phase 1: Discovery", "Phase 2: Implementation", "Phase 3: Verification".
 */
export const planPhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
});
export type PlanPhase = z.infer<typeof planPhaseSchema>;

/* ------------------------------------------------------------------ */
/* 3. PlanStep & ExecutionPlan Contracts                              */
/* ------------------------------------------------------------------ */

/**
 * One unit of work inside an execution plan.
 */
export const planStepSchema = z.object({
  /** Unique identifier within the plan. */
  id: z.string().min(1),
  /** Human-readable title displayed in the plan inspector. */
  title: z.string().min(1),
  /** Optional detailed step description / instructions. */
  description: z.string().optional(),
  /** Optional phase reference for hierarchical grouping. */
  phaseId: z.string().min(1).optional(),
  /** Current step lifecycle status. */
  status: stepStatusSchema,
  /** Step IDs that must all reach "succeeded" before this step may run. */
  dependsOn: z.array(z.string()).default([]),
  /** When "required", execution pauses until explicit user approval. */
  approval: z.enum(["required", "auto"]).optional(),
  /** True when the step mutates filesystem, network, or external state. */
  sideEffecting: z.boolean().optional(),
  /** Exact workspace paths, origins, or MCP tool names touched. */
  affectedScopes: z.array(z.string()).optional(),
  /** Rough resource estimate for cost rollups and UI. */
  estimate: stepEstimateSchema.optional(),
  /** Relative paths or IDs of produced artifacts. */
  artifacts: z.array(z.string()).optional(),
});

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  phaseId?: string;
  status: StepStatus;
  dependsOn: readonly string[];
  approval?: "required" | "auto";
  sideEffecting?: boolean;
  affectedScopes?: readonly string[];
  estimate?: StepEstimate;
  artifacts?: readonly string[];
}

/**
 * An executable plan proposed by the agent, edited by the user,
 * and executed by the run coordinator.
 */
export const executionPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  /** Goal in natural language (backward compatibility with Phase 1). */
  goal: z.string().optional(),
  /** Hierarchical phase groupings. */
  phases: z.array(planPhaseSchema).optional(),
  /** Ordered list of plan steps. */
  steps: z.array(planStepSchema),
  /** Current plan lifecycle state. */
  state: planLifecycleStateSchema.optional(),
  /** Monotonically increasing revision number for plan forking/diffing. */
  revision: z.number().int().nonnegative().optional(),
  /** Unix millisecond creation timestamp. */
  createdAt: z.number().optional(),
  /** Unix millisecond last-update timestamp. */
  updatedAt: z.number().optional(),
});

export interface ExecutionPlan {
  id: string;
  title?: string;
  goal?: string;
  phases?: readonly PlanPhase[];
  steps: readonly PlanStep[];
  state?: PlanLifecycleState;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}
```

### 3.2 Topological `readySteps` Resolution Algorithm

```typescript
/**
 * Steps that may start executing right now:
 * 1. Step status is "pending" (or "ready").
 * 2. Every dependency in `step.dependsOn` exists in `plan.steps` and has reached status "succeeded".
 * 3. Dual Approval Gate: If `step.approval === "required"` and an `approvedStepIds` ledger is supplied,
 *    `approvedStepIds.has(step.id)` MUST be true.
 *
 * Steps with failed, blocked, running, skipped, or unknown dependencies are NOT released.
 */
export function readySteps(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>,
): PlanStep[] {
  return (plan.steps as PlanStep[]).filter((step) => {
    // Only pending or ready steps are eligible for release
    if (step.status !== "pending" && step.status !== "ready") {
      return false;
    }

    // Every dependency must be satisfied (status === "succeeded")
    const depsSatisfied = step.dependsOn.every((depId) =>
      plan.steps.some((d) => d.id === depId && d.status === "succeeded"),
    );
    if (!depsSatisfied) {
      return false;
    }

    // Dual approval gate: if approval is required and approval ledger provided, verify explicit authorization
    if (
      step.approval === "required" &&
      approvedStepIds !== undefined &&
      !approvedStepIds.has(step.id)
    ) {
      return false;
    }

    return true;
  });
}
```

### 3.3 Deterministic DAG Cycle & Integrity Validation

```typescript
export interface PlanValidationError {
  path: string;
  code:
    | "duplicate_step_id"
    | "unknown_dependency"
    | "dependency_cycle"
    | "missing_approval"
    | "unknown_phase";
  message: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationError[];
  cycle?: string[];
}

/**
 * Pure deterministic validation for execution plans:
 * - Detects duplicate step IDs.
 * - Detects unknown/dangling dependencies.
 * - Detects self-loops and multi-node cycles with exact cycle path reporting (e.g. A → B → C → A).
 * - Enforces zero-natural-language approval security invariant: all side-effecting steps require approval: "required".
 * - Validates phase references if phases are declared.
 */
export function validatePlanDAG(plan: ExecutionPlan): PlanValidationResult {
  const errors: PlanValidationError[] = [];
  const steps = plan.steps ?? [];
  const phases = plan.phases ?? [];

  // Phase lookup
  const phaseIds = new Set(phases.map((p) => p.id));
  steps.forEach((step, i) => {
    if (step.phaseId && phases.length > 0 && !phaseIds.has(step.phaseId)) {
      errors.push({
        path: `steps[${i}].phaseId`,
        code: "unknown_phase",
        message: `Step "${step.id}" references unknown phase id "${step.phaseId}".`,
      });
    }
  });

  // Duplicate step IDs
  const byId = new Map<string, { step: PlanStep; index: number }>();
  steps.forEach((step, i) => {
    const existing = byId.get(step.id);
    if (existing) {
      errors.push({
        path: `steps[${i}].id`,
        code: "duplicate_step_id",
        message: `Duplicate step id "${step.id}" (first occurrence at steps[${existing.index}]).`,
      });
    } else {
      byId.set(step.id, { step, index: i });
    }
  });

  // Unknown dependency IDs
  steps.forEach((step, i) => {
    (step.dependsOn ?? []).forEach((dep, j) => {
      if (!byId.has(dep)) {
        errors.push({
          path: `steps[${i}].dependsOn[${j}]`,
          code: "unknown_dependency",
          message: `Step "${step.id}" depends on unknown step id "${dep}".`,
        });
      }
    });
  });

  // Deterministic Cycle Detection (DFS 3-color)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  let firstDetectedCycle: string[] | undefined;

  const dfs = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    const entry = byId.get(id)!;
    for (const dep of entry.step.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep];
        const key = [...new Set(cycle)].sort().join("");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          if (!firstDetectedCycle) firstDetectedCycle = cycle;
          errors.push({
            path: `steps[${byId.get(dep)!.index}].dependsOn`,
            code: "dependency_cycle",
            message: `Dependency cycle detected: ${cycle.join(" → ")}.`,
          });
        }
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of byId.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      dfs(id);
    }
  }

  // Side-effecting steps must declare approval: "required"
  steps.forEach((step, i) => {
    if (step.sideEffecting && step.approval !== "required") {
      errors.push({
        path: `steps[${i}].approval`,
        code: "missing_approval",
        message: `Step "${step.id}" is side-effecting and must declare approval: "required".`,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    cycle: firstDetectedCycle,
  };
}
```

---

## 4. Blueprint: `packages/protocol/src/commands.ts`

### 4.1 Categories, Mentions & Wire Schemas

```typescript
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Slash Command Categories & Mentions                             */
/* ------------------------------------------------------------------ */

export const slashCommandCategorySchema = z.enum([
  "planning",
  "execution",
  "context",
  "system",
  "workspace",
  "custom",
]);
export type SlashCommandCategory = z.infer<typeof slashCommandCategorySchema>;

/** Context mentions extracted from command input: @file, @rule, #symbol, @agent. */
export const commandMentionsSchema = z.object({
  files: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
});
export type CommandMentions = z.infer<typeof commandMentionsSchema>;

/* ------------------------------------------------------------------ */
/* 2. SlashCommandWire Schema & Inferred Type                         */
/* ------------------------------------------------------------------ */

/**
 * Normalized wire representation of a parsed slash command.
 */
export const slashCommandWireSchema = z.object({
  /** Canonical command name including leading slash, e.g. "/plan", "/goal". */
  command: z.string().min(1),
  /** Positional arguments in lexical order. */
  positional: z.array(z.string()).default([]),
  /** Key-value flags, e.g. { keep: 5, action: "screenshot", dryRun: true }. */
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Verbatim raw text typed by user. */
  rawInput: z.string(),
  /** Extracted context mentions. */
  mentions: commandMentionsSchema.default({ files: [], rules: [], symbols: [], agents: [] }),
});
export type SlashCommandWire = z.infer<typeof slashCommandWireSchema>;

/* ------------------------------------------------------------------ */
/* 3. WebSocket Client/Host Wire Frames                               */
/* ------------------------------------------------------------------ */

/** Client -> Host frame requesting slash command execution. */
export const commandExecuteFrameSchema = z.object({
  type: z.literal("command.execute"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  rawText: z.string(),
  parsed: slashCommandWireSchema.optional(),
  requestId: z.string().optional(),
});
export type CommandExecuteFrame = z.infer<typeof commandExecuteFrameSchema>;

/** Host -> Client frame returning slash command execution outcome. */
export const commandResultFrameSchema = z.object({
  type: z.literal("command.result"),
  command: z.string().min(1),
  success: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
  data: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type CommandResultFrame = z.infer<typeof commandResultFrameSchema>;

/* ------------------------------------------------------------------ */
/* 4. Slash Command Definition Contracts                              */
/* ------------------------------------------------------------------ */

export interface SlashCommandParam {
  name: string;
  description: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "file" | "enum";
  enumValues?: string[];
  defaultValue?: unknown;
}

export interface SlashCommandDefinition {
  name: string; // e.g. "/plan"
  aliases?: string[];
  description: string;
  usage: string;
  category: SlashCommandCategory;
  params?: SlashCommandParam[];
  clientOnly?: boolean;
  requiresHost?: boolean;
}
```

### 4.2 Built-in Command Definitions (8 Commands)

```typescript
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    name: "/plan",
    aliases: ["/p"],
    description: "Switch to Planning Mode, open visual DAG composer, and initialize plan",
    usage: "/plan [goal description] [@file:<path>]",
    category: "planning",
    params: [
      {
        name: "goal",
        description: "Natural language goal for the execution plan",
        required: false,
        type: "string",
      },
    ],
  },
  {
    name: "/goal",
    aliases: ["/g"],
    description: "Set or update the active workspace objective banner",
    usage: "/goal <objective description>",
    category: "planning",
    params: [
      {
        name: "objective",
        description: "Active objective text displayed in header banner",
        required: true,
        type: "string",
      },
    ],
  },
  {
    name: "/schedule",
    aliases: ["/cron"],
    description: "Schedule a one-shot timer or recurring background cron daemon",
    usage: "/schedule <interval|cron> <prompt>",
    category: "system",
    params: [
      {
        name: "timeOrCron",
        description: "Duration (e.g. 300s, 10m) or 5-field cron expression",
        required: true,
        type: "string",
      },
      {
        name: "prompt",
        description: "Instruction prompt executed upon trigger",
        required: true,
        type: "string",
      },
    ],
    requiresHost: true,
  },
  {
    name: "/browse",
    aliases: ["/b"],
    description: "Launch managed Playwright browser session for visual inspection",
    usage: "/browse <url> [--action=screenshot|dom|crawl]",
    category: "execution",
    params: [
      {
        name: "url",
        description: "Target URL to navigate and inspect",
        required: true,
        type: "string",
      },
    ],
    requiresHost: true,
  },
  {
    name: "/learn",
    description: "Extract repository conventions and distill into reusable skill definition",
    usage: "/learn [topic or directory path]",
    category: "context",
    params: [
      {
        name: "topicOrPath",
        description: "Target workspace directory or concept to synthesize into a skill",
        required: false,
        type: "string",
      },
    ],
  },
  {
    name: "/cost",
    aliases: ["/usage"],
    description: "Open Token and Provider Cost Analytics modal dashboard",
    usage: "/cost [--by-model] [--by-day]",
    category: "system",
    clientOnly: true,
  },
  {
    name: "/compact",
    description: "Compress conversation context memory window preserving critical state",
    usage: "/compact [--keep=N] [--summary]",
    category: "context",
    params: [
      {
        name: "keep",
        description: "Number of most recent turns to preserve uncompressed (default: 4)",
        required: false,
        type: "number",
        defaultValue: 4,
      },
    ],
  },
  {
    name: "/clear",
    aliases: ["/reset"],
    description: "Clear active chat transcript and reset scratch state",
    usage: "/clear",
    category: "system",
    clientOnly: true,
  },
] as const;
```

### 4.3 POSIX Tokenizer & Slash Command Lexer

```typescript
/**
 * Parse raw user input into a structured SlashCommandWire object.
 * Returns null if the input is not a slash command (does not start with '/').
 */
export function parseSlashCommand(input: string): SlashCommandWire | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  // POSIX argument lexer with quote handling
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(trimmed)) !== null) {
    if (match[1] !== undefined) {
      // Unescape escaped quotes
      tokens.push(match[1].replace(/\\"/g, '"'));
    } else if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\'/g, "'"));
    } else {
      tokens.push(match[0]);
    }
  }

  if (tokens.length === 0) {
    return null;
  }

  const command = tokens[0].toLowerCase();
  const positional: string[] = [];
  const flags: Record<string, string | number | boolean> = {};
  const mentions: CommandMentions = {
    files: [],
    rules: [],
    symbols: [],
    agents: [],
  };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Long flag: --key=val or --flag
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const rawVal = token.slice(eqIdx + 1);
        flags[key] = parseFlagValue(rawVal);
      } else {
        flags[token.slice(2)] = true;
      }
    }
    // Short flag: -f
    else if (token.startsWith("-") && token.length === 2) {
      flags[token.slice(1)] = true;
    }
    // Context mention: @file:<path> or @file <path>
    else if (token.startsWith("@file:")) {
      mentions.files.push(token.slice(6));
    }
    // Context mention: @rule:<name>
    else if (token.startsWith("@rule:")) {
      mentions.rules.push(token.slice(6));
    }
    // Symbol mention: #symbol:<name> or #<name>
    else if (token.startsWith("#symbol:")) {
      mentions.symbols.push(token.slice(8));
    } else if (token.startsWith("#") && token.length > 1) {
      mentions.symbols.push(token.slice(1));
    }
    // Agent mention: @agent:<id>
    else if (token.startsWith("@agent:")) {
      mentions.agents.push(token.slice(7));
    }
    // Positional argument
    else {
      positional.push(token);
    }
  }

  return {
    command,
    positional,
    flags,
    rawInput: trimmed,
    mentions,
  };
}

function parseFlagValue(val: string): string | number | boolean {
  if (val.toLowerCase() === "true") return true;
  if (val.toLowerCase() === "false") return false;
  const num = Number(val);
  return isNaN(num) ? val : num;
}

/**
 * Format a SlashCommandWire back into a canonical invocation string.
 */
export function formatSlashCommand(wire: SlashCommandWire): string {
  const parts: string[] = [wire.command];

  for (const pos of wire.positional) {
    if (pos.includes(" ") || pos.includes('"')) {
      parts.push(`"${pos.replace(/"/g, '\\"')}"`);
    } else {
      parts.push(pos);
    }
  }

  for (const [k, v] of Object.entries(wire.flags)) {
    if (typeof v === "boolean") {
      if (v) parts.push(`--${k}`);
    } else {
      parts.push(`--${k}=${v}`);
    }
  }

  for (const file of wire.mentions.files) parts.push(`@file:${file}`);
  for (const rule of wire.mentions.rules) parts.push(`@rule:${rule}`);
  for (const sym of wire.mentions.symbols) parts.push(`#symbol:${sym}`);
  for (const ag of wire.mentions.agents) parts.push(`@agent:${ag}`);

  return parts.join(" ");
}
```

---

## 5. Blueprint: `packages/protocol/src/index.ts`

```typescript
/**
 * Public protocol surface shared between the web control plane and the
 * agent host. Pure types + pure functions only — zero Node.js runtime APIs.
 */
export * from "./plan";
export * from "./commands";
export * from "./routing";
export * from "./artifacts";
```

---

## 6. Comprehensive Unit Test Specifications (`packages/protocol/__tests__/`)

To guarantee 100% test pass rate, 100% branch coverage, and complete backward compatibility, two test files are specified:

### 6.1 `packages/protocol/src/plan.test.ts` Matrix

| # | Test Case Description | Verification Method |
|---|-----------------------|---------------------|
| 1 | **Legacy Fixture Backward Compatibility**: Verifies plans with `{ id, goal, steps }` and no `title`/`phases`/`state` parse and pass `readySteps`. | `expect(readySteps(legacyPlan)).toEqual(...)` |
| 2 | **Full Schema Validation**: Validates `executionPlanSchema` with all optional fields (`phases`, `revision`, `createdAt`, `updatedAt`, `title`, `state`). | `executionPlanSchema.parse(...)` succeeds |
| 3 | **Step Status Enum Completeness**: Tests all 7 statuses (`pending`, `ready`, `running`, `succeeded`, `failed`, `blocked`, `skipped`). | `stepStatusSchema.parse(s)` succeeds for all 7 |
| 4 | **Plan Lifecycle State Completeness**: Tests all 6 states (`draft`, `awaiting_approval`, `executing`, `paused`, `completed`, `failed`). | `planLifecycleStateSchema.parse(st)` succeeds for all 6 |
| 5 | **Dual Approval Gate (No Ledger)**: When `approvedStepIds` is undefined, `approval: "required"` steps are released if deps succeed. | `readySteps(plan)` releases step |
| 6 | **Dual Approval Gate (With Ledger - Blocked)**: When `approvedStepIds` is provided but step ID is not in ledger, step is BLOCKED. | `readySteps(plan, new Set())` returns `[]` |
| 7 | **Dual Approval Gate (With Ledger - Approved)**: When step ID is in `approvedStepIds`, step is released. | `readySteps(plan, new Set(["step-1"]))` returns `[step1]` |
| 8 | **Deterministic Cycle Detection (Self-Loop)**: Identifies `A -> A` cycle and returns `valid: false`. | `validatePlanDAG(plan).valid === false` and `cycle` contains `["a", "a"]` |
| 9 | **Deterministic Cycle Detection (Multi-Node)**: Identifies `A -> B -> C -> A` cycle with exact path string `A → B → C → A`. | `validatePlanDAG(plan).errors[0].message` contains path |
| 10 | **Dangling / Unknown Dependency**: Detects step referencing non-existent step id `ghost`. | `validatePlanDAG(plan).errors[0].code === "unknown_dependency"` |
| 11 | **Duplicate Step IDs**: Detects repeated step IDs across phases. | `validatePlanDAG(plan).errors[0].code === "duplicate_step_id"` |
| 12 | **Side-Effecting Approval Invariant**: Detects `sideEffecting: true` without `approval: "required"`. | `validatePlanDAG(plan).errors[0].code === "missing_approval"` |
| 13 | **Phase Reference Validation**: Detects step referencing a `phaseId` not defined in `phases`. | `validatePlanDAG(plan).errors[0].code === "unknown_phase"` |

### 6.2 `packages/protocol/src/commands.test.ts` Matrix

| # | Test Case Description | Verification Method |
|---|-----------------------|---------------------|
| 1 | **Basic Slash Command Parsing**: Parses `/plan` and extracts command. | `parseSlashCommand("/plan")?.command === "/plan"` |
| 2 | **Positional Arguments & Quoted Strings**: Parses `/plan "Refactor auth" --verbose` into positional `["Refactor auth"]` and flag `verbose: true`. | `parsed.positional` and `parsed.flags` matched |
| 3 | **Single and Double Quote Escaping**: Parses escaped quotes `\"` and `\'`. | Verifies unescaped string values |
| 4 | **Named Flags with Types**: Parses `--keep=10 --ratio=0.5 --debug=false --name=prod`. | Verifies numbers, booleans, and strings in `flags` |
| 5 | **Context Mentions Extraction**: Parses `@file:src/auth.ts @rule:no-secrets #symbol:verifyToken @agent:sub-1`. | Verifies `mentions.files`, `mentions.rules`, `mentions.symbols`, `mentions.agents` |
| 6 | **Non-Command Strings**: Returns `null` for regular chat text e.g. `"Hello world"`, `"Check this out /plan"`. | `expect(parseSlashCommand(text)).toBeNull()` |
| 7 | **Wire Frame Validation (`command.execute`)**: Validates `commandExecuteFrameSchema` on client payload. | `commandExecuteFrameSchema.parse(payload)` succeeds |
| 8 | **Wire Frame Validation (`command.result`)**: Validates `commandResultFrameSchema` on host result payload. | `commandResultFrameSchema.parse(result)` succeeds |
| 9 | **Built-in Command Registry**: Verifies all 8 built-in commands exist with valid schemas and categories. | `BUILTIN_SLASH_COMMANDS.length === 8` |
| 10 | **Roundtrip Command Formatting**: `formatSlashCommand(parseSlashCommand(input))` preserves command semantics. | String roundtrip matched |

---

## 7. Downstream Implementation Dependencies (Milestones M2–M5)

1. **Milestone 2 (Slash Command Engine & UI Palette)**:
   - Imports `SlashCommandWire`, `SlashCommandDefinition`, `parseSlashCommand`, `formatSlashCommand`, and `BUILTIN_SLASH_COMMANDS` from `@protocol/commands`.
   - Uses `commandMentionsSchema` to render mention chips (`@file`, `@rule`) in `src/sections/ChatPanel.tsx` and `src/components/SlashCommandPalette.tsx`.
2. **Milestone 3 (Visual Plan Composer & DAG Surface)**:
   - Imports `PlanPhase`, `PlanStep`, `ExecutionPlan`, `validatePlanDAG`, and `readySteps` from `@protocol/plan`.
   - Renders phase accordions and dependency badges in `src/sections/PlanPanel.tsx` and `src/components/plan/`.
3. **Milestone 4 (Wire Protocol Synchronization & Agent Host)**:
   - Synchronizes `command.execute` and `command.result` frames over the WebSocket bus.
   - Synchronizes `plan.propose`, `plan.update_step`, and `plan.approve` frames enforcing cryptographic approval tokens and the zero-natural-language approval security invariant.
4. **Milestone 5 (E2E Integration & Verification)**:
   - Automated quality gates running `npm run test:protocol`, `npm run test:host`, `npm test`, and `npm run build`.

---

## 8. Summary of Findings & Next Steps

- The protocol design provides 100% backward compatibility with all Phase 1 fixtures and host systems while fully fulfilling all Phase 2 requirements.
- The blueprint is ready for implementation by the builder agents.

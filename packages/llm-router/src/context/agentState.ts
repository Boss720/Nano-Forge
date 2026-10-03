import { z } from "zod";

export interface PlanTask {
  id: string;
  title: string;
  description?: string;
  assignedModel?: string;
}

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  assignedModel: z.string().optional(),
});

export interface AgentDecision {
  id: string;
  decision: string;
  rationale: string;
  at: string;
}

export const AgentDecisionSchema = z.object({
  id: z.string(),
  decision: z.string(),
  rationale: z.string(),
  at: z.string(),
});

export interface FileChange {
  path: string;
  action: "created" | "modified" | "deleted";
  sha256?: string;
  notes?: string;
}

export const FileChangeSchema = z.object({
  path: z.string(),
  action: z.enum(["created", "modified", "deleted"]),
  sha256: z.string().optional(),
  notes: z.string().optional(),
});

export interface ToolExecutionSummary {
  toolId: string;
  status: "success" | "error";
  summary: string;
  timestamp: number;
}

export interface TestExecutionSummary {
  suite: string;
  passed: number;
  failed: number;
  errors?: string[];
}

export interface AgentState {
  objective: string;
  requirements: string[];
  constraints: string[];
  repositorySummary: string;
  plan: {
    pending: PlanTask[];
    active: PlanTask[];
    completed: PlanTask[];
    failed: PlanTask[];
  };
  decisions: AgentDecision[];
  relevantFiles: string[];
  changes: FileChange[];
  toolResults: ToolExecutionSummary[];
  tests: TestExecutionSummary[];
  errors: Array<{ code: string; message: string; fatal: boolean }>;
  modelHistory: Array<{ modelId: string; tokensUsed: number; costUsd: number }>;
}

export const AgentStateSchema = z.object({
  objective: z.string(),
  requirements: z.array(z.string()),
  constraints: z.array(z.string()),
  repositorySummary: z.string(),
  plan: z.object({
    pending: z.array(PlanTaskSchema),
    active: z.array(PlanTaskSchema),
    completed: z.array(PlanTaskSchema),
    failed: z.array(PlanTaskSchema),
  }),
  decisions: z.array(AgentDecisionSchema),
  relevantFiles: z.array(z.string()),
  changes: z.array(FileChangeSchema),
  toolResults: z.array(
    z.object({
      toolId: z.string(),
      status: z.enum(["success", "error"]),
      summary: z.string(),
      timestamp: z.number(),
    })
  ),
  tests: z.array(
    z.object({
      suite: z.string(),
      passed: z.number(),
      failed: z.number(),
      errors: z.array(z.string()).optional(),
    })
  ),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      fatal: z.boolean(),
    })
  ),
  modelHistory: z.array(
    z.object({
      modelId: z.string(),
      tokensUsed: z.number(),
      costUsd: z.number(),
    })
  ),
});

export class AgentStateManager {
  private state: AgentState;

  constructor(objective: string, initialOverrides: Partial<AgentState> = {}) {
    this.state = {
      objective,
      requirements: initialOverrides.requirements || [],
      constraints: initialOverrides.constraints || [],
      repositorySummary: initialOverrides.repositorySummary || "",
      plan: initialOverrides.plan || {
        pending: [],
        active: [],
        completed: [],
        failed: [],
      },
      decisions: initialOverrides.decisions || [],
      relevantFiles: initialOverrides.relevantFiles || [],
      changes: initialOverrides.changes || [],
      toolResults: initialOverrides.toolResults || [],
      tests: initialOverrides.tests || [],
      errors: initialOverrides.errors || [],
      modelHistory: initialOverrides.modelHistory || [],
    };
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }

  addPlanTask(task: PlanTask, status: "pending" | "active" = "pending"): void {
    this.state.plan[status].push(task);
  }

  completeTask(taskId: string): void {
    const activeIdx = this.state.plan.active.findIndex((t) => t.id === taskId);
    if (activeIdx !== -1) {
      const [task] = this.state.plan.active.splice(activeIdx, 1);
      this.state.plan.completed.push(task);
      return;
    }
    const pendingIdx = this.state.plan.pending.findIndex((t) => t.id === taskId);
    if (pendingIdx !== -1) {
      const [task] = this.state.plan.pending.splice(pendingIdx, 1);
      this.state.plan.completed.push(task);
    }
  }

  activateTask(taskId: string): void {
    const pendingIdx = this.state.plan.pending.findIndex((t) => t.id === taskId);
    if (pendingIdx !== -1) {
      const [task] = this.state.plan.pending.splice(pendingIdx, 1);
      this.state.plan.active.push(task);
    }
  }

  recordDecision(decision: string, rationale: string): void {
    this.state.decisions.push({
      id: `dec_${Date.now()}_${this.state.decisions.length + 1}`,
      decision,
      rationale,
      at: new Date().toISOString(),
    });
  }

  recordChange(change: FileChange): void {
    this.state.changes.push(change);
    if (!this.state.relevantFiles.includes(change.path)) {
      this.state.relevantFiles.push(change.path);
    }
  }

  recordModelUsage(modelId: string, tokensUsed: number, costUsd = 0): void {
    const existing = this.state.modelHistory.find((m) => m.modelId === modelId);
    if (existing) {
      existing.tokensUsed += tokensUsed;
      existing.costUsd += costUsd;
    } else {
      this.state.modelHistory.push({ modelId, tokensUsed, costUsd });
    }
  }

  recordError(code: string, message: string, fatal = false): void {
    this.state.errors.push({ code, message, fatal });
  }
}

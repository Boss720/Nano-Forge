import { useState } from "react";
import {
  Ban, Check, ChevronRight, Circle, FileCode2, ListChecks, Pause, ShieldAlert,
  ShieldCheck, Square, X,
} from "lucide-react";
import type { ExecutionPlan, PlanStep, PlanStepStatus, PlanUIState } from "@/types";

/**
 * Module 1 Task 3: plan inspector.
 *
 * Controlled component: the plan itself comes from props and every mutation
 * is a callback so the wiring pass can mount it in App.tsx unchanged.
 *
 * Approval gate: a step marked `approval: "required"` can NEVER be treated as
 * runnable from props or chat text alone — the panel records approvals in its
 * own state and only the explicit Approve click sets them. If the parent
 * (or a compromised host stream) marks such a step "running" before the
 * click, the panel downgrades the display back to a blocked/awaiting state
 * instead of rendering it as running.
 */
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

const STEP_ICON: Record<PlanStepStatus, typeof Circle> = {
  pending: Circle,
  running: ChevronRight,
  succeeded: Check,
  failed: X,
  blocked: Ban,
};

const STEP_ICON_CLASS: Record<PlanStepStatus, string> = {
  pending: "text-muted-foreground",
  running: "pulse-dot text-primary",
  succeeded: "text-emerald-400",
  failed: "text-red-400",
  blocked: "text-amber-400",
};

const STATE_LABEL: Record<PlanUIState, string> = {
  draft: "draft",
  awaiting_approval: "awaiting approval",
  executing: "executing",
  paused: "paused",
  completed: "completed",
};

function fmtEstimate(step: PlanStep): string | null {
  const e = step.estimate;
  if (!e) return null;
  const parts: string[] = [];
  if (e.tokens != null) parts.push(`~${e.tokens.toLocaleString()} tok`);
  if (e.costUsd != null) parts.push(`≈$${e.costUsd.toFixed(4)}`);
  if (e.durationSec != null) parts.push(`~${e.durationSec}s`);
  return parts.length ? parts.join(" · ") : null;
}

export function PlanPanel({ plan, className, onApproveStep, onRunApproved, onPause, onCancel }: PlanPanelProps) {
  // Local approval ledger, keyed to the plan id so a new plan starts clean.
  // Only an explicit button click writes here — never props, never chat text.
  const [approvals, setApprovals] = useState<{ planId: string; stepIds: ReadonlySet<string> }>({
    planId: plan.id,
    stepIds: new Set<string>(),
  });
  const approvedSteps = approvals.planId === plan.id ? approvals.stepIds : new Set<string>();

  const isApprovalSatisfied = (step: PlanStep) =>
    step.approval !== "required" || approvedSteps.has(step.id);

  /** Displayed status: unapproved required steps are never shown as running. */
  const effectiveStatus = (step: PlanStep): PlanStepStatus => {
    if (step.approval === "required" && !approvedSteps.has(step.id)) {
      if (step.status === "running") return "blocked";
    }
    return step.status;
  };

  const approve = (stepId: string) => {
    setApprovals((prev) => {
      const base = prev.planId === plan.id ? prev.stepIds : new Set<string>();
      return { planId: plan.id, stepIds: new Set(base).add(stepId) };
    });
    onApproveStep(plan.id, stepId);
  };

  const pendingApprovals = plan.steps.filter((s) => !isApprovalSatisfied(s));
  const allApproved = pendingApprovals.length === 0;
  const canRun = allApproved && plan.state !== "executing" && plan.state !== "completed";
  const canPause = plan.state === "executing";
  const canCancel = plan.state !== "completed";

  return (
    <section
      aria-label="Execution plan"
      className={`flex min-h-0 flex-col border-l border-border bg-card/40 ${className ?? ""}`}
    >
      {/* header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 text-primary" />
          <span className="micro-label">plan</span>
          <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {STATE_LABEL[plan.state]}
          </span>
        </div>
        <h2 className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">{plan.goal}</h2>
        {!allApproved && (
          <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-amber-400">
            <ShieldAlert className="h-3 w-3" />
            {pendingApprovals.length} approval{pendingApprovals.length === 1 ? "" : "s"} required — chat text never counts
          </p>
        )}
      </div>

      {/* steps */}
      <ol className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {plan.steps.map((step, i) => {
          const status = effectiveStatus(step);
          const Icon = STEP_ICON[status];
          const needsApproval = step.approval === "required" && !approvedSteps.has(step.id);
          const estimate = fmtEstimate(step);
          return (
            <li
              key={step.id}
              data-testid={`plan-step-${step.id}`}
              data-status={status}
              className="rounded-md border border-border bg-card/70 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground/60">{i + 1}.</span>
                <Icon className={`h-3.5 w-3.5 ${STEP_ICON_CLASS[status]}`} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90">{step.title}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  {needsApproval && status === "blocked" ? "awaiting approval" : status}
                </span>
              </div>

              {/* dependency edges (badge form) */}
              {step.dependsOn.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
                  <span className="micro-label normal-case tracking-normal">depends on</span>
                  {step.dependsOn.map((dep) => (
                    <span
                      key={dep}
                      className="rounded border border-border bg-secondary/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              )}

              {/* exact affected scopes */}
              {step.affectedScopes && step.affectedScopes.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
                  <span className="micro-label normal-case tracking-normal">scopes</span>
                  {step.affectedScopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded border border-primary/25 bg-primary/5 px-1.5 py-px font-mono text-[10px] text-primary/90"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              )}

              {estimate && (
                <div className="mt-1.5 pl-7 font-mono text-[10px] text-muted-foreground">{estimate}</div>
              )}

              {step.sideEffecting && (
                <div className="mt-1 pl-7 font-mono text-[10px] text-amber-400/90">side-effecting</div>
              )}

              {needsApproval && (
                <div className="mt-2 pl-7">
                  <button
                    onClick={() => approve(step.id)}
                    aria-label={`Approve step ${step.title}`}
                    className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10.5px] text-amber-300 transition-colors hover:bg-amber-500/20"
                  >
                    <ShieldCheck className="h-3 w-3" /> approve
                  </button>
                </div>
              )}
              {step.approval === "required" && approvedSteps.has(step.id) && (
                <div className="mt-1.5 flex items-center gap-1 pl-7 font-mono text-[10px] text-emerald-400">
                  <ShieldCheck className="h-3 w-3" /> approved
                </div>
              )}

              {step.artifacts && step.artifacts.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 pl-7">
                  {step.artifacts.map((a) => (
                    <li key={a} className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                      <FileCode2 className="h-3 w-3" />
                      {a}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {/* controls */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5">
        <button
          onClick={() => onRunApproved(plan.id)}
          disabled={!canRun}
          title={allApproved ? "Run the approved plan" : "Approve every required step first"}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          <ChevronRight className="h-3 w-3" /> run
        </button>
        <button
          onClick={() => onPause(plan.id)}
          disabled={!canPause}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] text-foreground/80 transition-colors hover:border-primary/40 disabled:opacity-30"
        >
          <Pause className="h-3 w-3" /> pause
        </button>
        <button
          onClick={() => onCancel(plan.id)}
          disabled={!canCancel}
          className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-1.5 font-mono text-[11px] text-red-300 transition-colors hover:bg-destructive/25 disabled:opacity-30"
        >
          <Square className="h-3 w-3" /> cancel
        </button>
      </div>
    </section>
  );
}

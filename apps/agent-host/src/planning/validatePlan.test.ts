import { describe, expect, it } from "vitest";
import type { ExecutionPlan, PlanStep } from "@protocol/plan";
import {
  canRunPlan,
  nextPlanState,
  validatePlan,
  type PlanUIState,
} from "./validatePlan";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: partial.id, dependsOn: [], status: "pending", ...partial };
}

function plan(steps: PlanStep[]): ExecutionPlan {
  return { id: "p1", goal: "test goal", steps };
}

describe("validatePlan", () => {
  it("accepts a valid plan", () => {
    const p = plan([
      step({ id: "a" }),
      step({ id: "b", dependsOn: ["a"] }),
      step({ id: "c", dependsOn: ["b"], sideEffecting: true, approval: "required" }),
    ]);
    expect(validatePlan(p)).toEqual({ ok: true });
  });

  it("rejects duplicate step IDs", () => {
    const res = validatePlan(plan([step({ id: "a" }), step({ id: "a" })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatchObject({ code: "duplicate_step_id", path: "steps[1].id" });
    }
  });

  it("rejects unknown dependency IDs", () => {
    const res = validatePlan(plan([step({ id: "a", dependsOn: ["ghost"] })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({
        code: "unknown_dependency",
        path: "steps[0].dependsOn[0]",
      });
      expect(res.errors[0].message).toContain("ghost");
    }
  });

  it("detects dependency cycles and reports the cycle path", () => {
    const res = validatePlan(
      plan([
        step({ id: "a", dependsOn: ["c"] }),
        step({ id: "b", dependsOn: ["a"] }),
        step({ id: "c", dependsOn: ["b"] }),
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const cycles = res.errors.filter((e) => e.code === "dependency_cycle");
      expect(cycles).toHaveLength(1);
      // Cycle path follows dependsOn edges: a depends on c, c on b, b on a.
      expect(cycles[0].message).toMatch(/a → c → b → a|c → b → a → c|b → a → c → b/);
    }
  });

  it("detects a self-dependency cycle", () => {
    const res = validatePlan(plan([step({ id: "a", dependsOn: ["a"] })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({ code: "dependency_cycle" });
      expect(res.errors[0].message).toContain("a → a");
    }
  });

  it("requires approval for side-effecting steps", () => {
    const res = validatePlan(plan([step({ id: "x", sideEffecting: true })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatchObject({ code: "missing_approval", path: "steps[0].approval" });
    }
  });

  it("reports multiple error classes together", () => {
    const res = validatePlan(
      plan([
        step({ id: "a", dependsOn: ["b"] }),
        step({ id: "b", dependsOn: ["a"] }),
        step({ id: "b", dependsOn: ["ghost"], sideEffecting: true }),
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const codes = res.errors.map((e) => e.code).sort();
      expect(codes).toEqual(
        ["dependency_cycle", "duplicate_step_id", "missing_approval", "unknown_dependency"].sort(),
      );
    }
  });
});

describe("plan UI state machine", () => {
  it("draft → awaiting_approval on execute, and only approve starts executing", () => {
    let state: PlanUIState = "draft";
    expect(canRunPlan(state)).toBe(false);

    state = nextPlanState(state, "execute");
    expect(state).toBe("awaiting_approval");
    // Guard: run stays disabled until explicit approval — no other event,
    // and certainly not natural language, can move the plan forward.
    expect(canRunPlan(state)).toBe(false);
    expect(nextPlanState(state, "execute")).toBe("awaiting_approval");
    expect(nextPlanState(state, "resume")).toBe("awaiting_approval");
    expect(nextPlanState(state, "complete")).toBe("awaiting_approval");

    state = nextPlanState(state, "approve");
    expect(state).toBe("executing");
    expect(canRunPlan(state)).toBe(true);
  });

  it("pause/resume/complete/cancel transitions", () => {
    let state: PlanUIState = nextPlanState("draft", "execute");
    state = nextPlanState(state, "approve");
    expect(nextPlanState(state, "pause")).toBe("paused");
    expect(nextPlanState("paused", "resume")).toBe("executing");
    expect(nextPlanState(state, "complete")).toBe("completed");
    expect(canRunPlan("completed")).toBe(false);
    // cancel returns to draft from any active state
    expect(nextPlanState("awaiting_approval", "cancel")).toBe("draft");
    expect(nextPlanState("executing", "cancel")).toBe("draft");
    expect(nextPlanState("paused", "cancel")).toBe("draft");
    // approve is a no-op outside awaiting_approval
    expect(nextPlanState("draft", "approve")).toBe("draft");
    expect(nextPlanState("executing", "approve")).toBe("executing");
  });
});

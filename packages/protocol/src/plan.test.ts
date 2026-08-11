import { describe, expect, it } from "vitest";
import { readySteps, type ExecutionPlan } from "./plan";

describe("readySteps", () => {
  it("releases a step only after every dependency succeeds", () => {
    const plan = { id: "p1", goal: "test", steps: [
      { id: "inspect", title: "Inspect", dependsOn: [], status: "succeeded" },
      { id: "edit", title: "Edit", dependsOn: ["inspect"], status: "pending" },
    ] } as const;
    expect(readySteps(plan).map((s) => s.id)).toEqual(["edit"]);
  });

  it("does not release a step whose dependency is still pending", () => {
    const plan: ExecutionPlan = {
      id: "p2",
      goal: "chain",
      steps: [
        { id: "a", title: "A", dependsOn: [], status: "pending" },
        { id: "b", title: "B", dependsOn: ["a"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["a"]);
  });

  it("blocks a step when any dependency has failed", () => {
    const plan: ExecutionPlan = {
      id: "p3",
      goal: "chain",
      steps: [
        { id: "a", title: "A", dependsOn: [], status: "failed" },
        { id: "b", title: "B", dependsOn: ["a"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("does not re-release running, succeeded, failed, or blocked steps", () => {
    const plan: ExecutionPlan = {
      id: "p4",
      goal: "statuses",
      steps: [
        { id: "a", title: "A", dependsOn: [], status: "running" },
        { id: "b", title: "B", dependsOn: [], status: "succeeded" },
        { id: "c", title: "C", dependsOn: [], status: "failed" },
        { id: "d", title: "D", dependsOn: [], status: "blocked" },
        { id: "e", title: "E", dependsOn: ["b"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["e"]);
  });

  it("requires every dependency to succeed, not just one", () => {
    const plan: ExecutionPlan = {
      id: "p5",
      goal: "multi-dep",
      steps: [
        { id: "a", title: "A", dependsOn: [], status: "succeeded" },
        { id: "b", title: "B", dependsOn: [], status: "running" },
        { id: "c", title: "C", dependsOn: ["a", "b"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("treats an unknown dependency as unsatisfied", () => {
    const plan: ExecutionPlan = {
      id: "p6",
      goal: "dangling",
      steps: [{ id: "a", title: "A", dependsOn: ["ghost"], status: "pending" }],
    };
    expect(readySteps(plan)).toEqual([]);
  });
});

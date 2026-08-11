// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanPanel } from "@/sections/PlanPanel";
import type { ExecutionPlan } from "@/types";

afterEach(cleanup);

const basePlan: ExecutionPlan = {
  id: "plan-1",
  goal: "Add rate limiting to the server",
  state: "awaiting_approval",
  steps: [
    {
      id: "inspect",
      title: "Inspect server entrypoint",
      dependsOn: [],
      status: "succeeded",
      affectedScopes: ["src/server.ts"],
      estimate: { tokens: 1200, costUsd: 0.002, durationSec: 8 },
      artifacts: ["notes/inspect.md"],
    },
    {
      id: "edit",
      title: "Add rate limit middleware",
      dependsOn: ["inspect"],
      status: "pending",
      approval: "required",
      sideEffecting: true,
      affectedScopes: ["src/server.ts", "src/middleware/rateLimit.ts"],
      estimate: { tokens: 3400, costUsd: 0.006 },
    },
    {
      id: "verify",
      title: "Run the test suite",
      dependsOn: ["edit"],
      status: "pending",
    },
  ],
};

function renderPanel(plan: ExecutionPlan = basePlan) {
  const callbacks = {
    onApproveStep: vi.fn(),
    onRunApproved: vi.fn(),
    onPause: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<PlanPanel plan={plan} {...callbacks} />);
  return callbacks;
}

describe("PlanPanel rendering", () => {
  it("renders the goal, plan state, and every step with its status", () => {
    renderPanel();
    expect(screen.getByText("Add rate limiting to the server")).toBeTruthy();
    expect(screen.getByText("awaiting approval")).toBeTruthy();
    expect(screen.getByText("Inspect server entrypoint")).toBeTruthy();
    expect(screen.getByText("Add rate limit middleware")).toBeTruthy();
    expect(screen.getByText("Run the test suite")).toBeTruthy();
  });

  it("renders dependency edges as badges", () => {
    renderPanel();
    expect(screen.getAllByText("depends on")).toHaveLength(2);
    const editStep = screen.getByTestId("plan-step-edit");
    expect(editStep.textContent).toContain("inspect");
    const verifyStep = screen.getByTestId("plan-step-verify");
    expect(verifyStep.textContent).toContain("edit");
  });

  it("renders exact affected scopes, estimates, and artifacts", () => {
    renderPanel();
    expect(screen.getByText("src/middleware/rateLimit.ts")).toBeTruthy();
    expect(screen.getAllByText("src/server.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/~1,200 tok/)).toBeTruthy();
    expect(screen.getByText(/≈\$0\.0060/)).toBeTruthy();
    expect(screen.getByText("notes/inspect.md")).toBeTruthy();
  });

  it("marks approval-required steps and flags that chat text never counts", () => {
    renderPanel();
    expect(screen.getByText(/chat text never counts/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i })).toBeTruthy();
  });
});

describe("PlanPanel approval gate", () => {
  it("disables Run until every required approval is granted by an explicit click", async () => {
    const user = userEvent.setup();
    const cb = renderPanel();
    const run = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i }));
    expect(cb.onApproveStep).toHaveBeenCalledWith("plan-1", "edit");
    expect((screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("approved")).toBeTruthy();
  });

  it("never shows an approval-required step as running before the explicit click, even if props say running", () => {
    // A compromised/buggy parent or host stream marks the step running; the
    // panel's own state machine must downgrade it to a blocked display.
    const roguePlan: ExecutionPlan = {
      ...basePlan,
      state: "executing",
      steps: basePlan.steps.map((s) =>
        s.id === "edit" ? { ...s, status: "running" as const } : s,
      ),
    };
    renderPanel(roguePlan);
    const step = screen.getByTestId("plan-step-edit");
    expect(step.getAttribute("data-status")).toBe("blocked");
    expect(step.textContent).toContain("awaiting approval");
    expect(step.textContent).not.toContain("running");
  });

  it("keeps the gate when approvals arrive out of band — only the button satisfies them", () => {
    // same plan re-rendered with state changes but no click: still gated
    const cb = renderPanel({ ...basePlan, state: "paused" });
    const run = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(cb.onApproveStep).not.toHaveBeenCalled();
  });
});

describe("PlanPanel controls", () => {
  it("fires onRunApproved with the plan id once approvals are complete", async () => {
    const user = userEvent.setup();
    const cb = renderPanel();
    await user.click(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i }));
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    expect(cb.onRunApproved).toHaveBeenCalledWith("plan-1");
  });

  it("fires onPause only while executing", async () => {
    const user = userEvent.setup();
    const cb = renderPanel({ ...basePlan, state: "executing" });
    await user.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(cb.onPause).toHaveBeenCalledWith("plan-1");
  });

  it("disables Pause when the plan is not executing", () => {
    renderPanel();
    expect((screen.getByRole("button", { name: /^pause$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires onCancel and disables it for completed plans", async () => {
    const user = userEvent.setup();
    const cb = renderPanel();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(cb.onCancel).toHaveBeenCalledWith("plan-1");
  });

  it("disables Cancel when the plan is completed", () => {
    renderPanel({ ...basePlan, state: "completed" });
    expect((screen.getByRole("button", { name: /^cancel$/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

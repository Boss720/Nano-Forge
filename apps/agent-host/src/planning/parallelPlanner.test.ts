import { describe, it, expect } from "vitest";
import type { ExecutionPlan } from "@protocol/plan";
import {
  classifyStepModelTier,
  planParallelExecution,
} from "./parallelPlanner.js";

describe("Parallel DAG Planner & Economical Model Assignment", () => {
  describe("classifyStepModelTier", () => {
    it("assigns flash_lite for read-only or inspection steps", () => {
      const tier = classifyStepModelTier({
        id: "step-1",
        title: "Inspect repository dependencies",
        status: "ready",
        dependsOn: [],
        sideEffecting: false,
      });
      expect(tier).toBe("flash_lite");
    });

    it("assigns flash for standard implementation and coding", () => {
      const tier = classifyStepModelTier({
        id: "step-2",
        title: "Implement Groq provider adapter",
        status: "ready",
        dependsOn: [],
        sideEffecting: true,
      });
      expect(tier).toBe("flash");
    });

    it("assigns pro for complex architecture or decomposition", () => {
      const tier = classifyStepModelTier({
        id: "step-3",
        title: "Decompose multi-agent architecture and resolve race condition",
        status: "ready",
        dependsOn: [],
        sideEffecting: true,
      });
      expect(tier).toBe("pro");
    });
  });

  describe("planParallelExecution", () => {
    it("schedules independent disjoint steps into the same wave in inherit mode", () => {
      const plan: ExecutionPlan = {
        id: "plan-1",
        steps: [
          {
            id: "step-adapters",
            title: "Implement adapters",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["packages/llm-router/src/providers/**"],
          },
          {
            id: "step-protocol",
            title: "Extend protocol schemas",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["packages/protocol/**"],
          },
          {
            id: "step-ui",
            title: "Update frontend model view",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["src/sections/models/**"],
          },
        ],
      };

      const result = planParallelExecution(plan);
      expect(result.totalWaves).toBe(1);
      expect(result.conflictsDetected).toBe(0);
      expect(result.waves[0].stepIds).toEqual(["step-adapters", "step-protocol", "step-ui"]);

      for (const stepId of ["step-adapters", "step-protocol", "step-ui"]) {
        const alloc = result.allocations.get(stepId);
        expect(alloc?.workspaceIsolation).toBe("inherit");
      }
    });

    it("serializes overlapping steps across waves when conflictResolutionStrategy is serialize", () => {
      const plan: ExecutionPlan = {
        id: "plan-conflict",
        steps: [
          {
            id: "step-router-a",
            title: "Refactor router algorithm",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["packages/llm-router/src/routing/**"],
          },
          {
            id: "step-router-b",
            title: "Add scoring rules to router",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["packages/llm-router/src/routing/scorer.ts"],
          },
        ],
      };

      const result = planParallelExecution(plan, { conflictResolutionStrategy: "serialize" });
      expect(result.totalWaves).toBe(2);
      expect(result.conflictsDetected).toBe(1);

      // Step A in Wave 0, Step B deferred to Wave 1
      expect(result.waves[0].stepIds).toEqual(["step-router-a"]);
      expect(result.waves[1].stepIds).toEqual(["step-router-b"]);

      const allocB = result.allocations.get("step-router-b");
      expect(allocB?.waveIndex).toBe(1);
      expect(allocB?.dependsOn).toContain("step-router-a");
    });

    it("isolates overlapping steps via Git worktrees when strategy is isolate_branch", () => {
      const plan: ExecutionPlan = {
        id: "plan-branch-iso",
        steps: [
          {
            id: "step-router-1",
            title: "Task 1 on router",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["packages/llm-router/src/routing/**"],
          },
          {
            id: "step-router-2",
            title: "Task 2 on router",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["packages/llm-router/src/routing/router.ts"],
          },
        ],
      };

      const result = planParallelExecution(plan, { conflictResolutionStrategy: "isolate_branch" });
      expect(result.totalWaves).toBe(1);
      expect(result.conflictsDetected).toBe(1);
      expect(result.waves[0].stepIds).toEqual(["step-router-1", "step-router-2"]);

      const alloc1 = result.allocations.get("step-router-1");
      const alloc2 = result.allocations.get("step-router-2");
      expect(alloc1?.workspaceIsolation).toBe("inherit");
      expect(alloc2?.workspaceIsolation).toBe("branch");
      expect(alloc2?.conflictResolved).toBe("isolated_branch");
    });

    it("enforces pro concurrency limit of 2 within a single wave", () => {
      const plan: ExecutionPlan = {
        id: "plan-pro-gate",
        steps: [
          {
            id: "arch-1",
            title: "Architecture design for auth",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["src/auth/**"],
          },
          {
            id: "arch-2",
            title: "Architecture design for database",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["src/db/**"],
          },
          {
            id: "arch-3",
            title: "Architecture design for network",
            status: "ready",
            dependsOn: [],
            affectedScopes: ["src/net/**"],
          },
        ],
      };

      const result = planParallelExecution(plan);
      expect(result.totalWaves).toBe(1);

      const alloc1 = result.allocations.get("arch-1");
      const alloc2 = result.allocations.get("arch-2");
      const alloc3 = result.allocations.get("arch-3");

      const proCount = [alloc1, alloc2, alloc3].filter((a) => a?.modelTier === "pro").length;
      expect(proCount).toBe(2); // Max 2 pro subagents allowed

      const flashCount = [alloc1, alloc2, alloc3].filter((a) => a?.modelTier === "flash").length;
      expect(flashCount).toBe(1); // 3rd downgraded to flash
    });
  });
});

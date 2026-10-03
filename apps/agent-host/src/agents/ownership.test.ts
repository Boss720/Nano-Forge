import { describe, it, expect, beforeEach } from "vitest";
import {
  FileOwnershipManager,
  normalizePattern,
  patternsOverlap,
} from "./ownership.js";

describe("FileOwnershipManager & Collision Detection", () => {
  let manager: FileOwnershipManager;

  beforeEach(() => {
    manager = new FileOwnershipManager();
  });

  describe("pattern normalization and overlap detection", () => {
    it("normalizes path formatting", () => {
      expect(normalizePattern("src\\index.ts")).toBe("src/index.ts");
      expect(normalizePattern("./src/utils.ts")).toBe("src/utils.ts");
      expect(normalizePattern("/packages/router/")).toBe("packages/router");
    });

    it("detects exact matches", () => {
      expect(patternsOverlap("src/index.ts", "src/index.ts")).toBe(true);
      expect(patternsOverlap("src/a.ts", "src/b.ts")).toBe(false);
    });

    it("detects directory prefix and recursive glob overlap", () => {
      expect(patternsOverlap("packages/llm-router/**", "packages/llm-router/src/index.ts")).toBe(true);
      expect(patternsOverlap("packages/llm-router/src/index.ts", "packages/llm-router/**")).toBe(true);
      expect(patternsOverlap("packages/llm-router/**", "packages/protocol/**")).toBe(false);
    });

    it("detects parent-child directory overlap", () => {
      expect(patternsOverlap("src", "src/components/Button.tsx")).toBe(true);
      expect(patternsOverlap("src/components/Button.tsx", "src")).toBe(true);
      expect(patternsOverlap("apps/agent-host", "packages/llm-router")).toBe(false);
    });

    it("handles wildcard globs", () => {
      expect(patternsOverlap("src/*.ts", "src/utils.ts")).toBe(true);
      expect(patternsOverlap("src/*.ts", "src/components/Button.tsx")).toBe(false);
      expect(patternsOverlap("**", "any/path/file.txt")).toBe(true);
    });
  });

  describe("FileOwnershipManager collision rules", () => {
    it("allows disjoint file ownership in inherit mode", () => {
      manager.register("agent-1", ["packages/protocol/**"], "inherit");

      const check = manager.checkCollision("agent-2", ["packages/llm-router/**"], "inherit");
      expect(check.hasCollision).toBe(false);

      manager.register("agent-2", ["packages/llm-router/**"], "inherit");
      expect(manager.getActiveOwnership().length).toBe(2);
    });

    it("detects collision when two agents in inherit mode claim overlapping files", () => {
      manager.register("agent-1", ["packages/llm-router/**"], "inherit");

      const check = manager.checkCollision(
        "agent-2",
        ["packages/llm-router/src/routing/router.ts"],
        "inherit"
      );
      expect(check.hasCollision).toBe(true);
      expect(check.collidingSubagentId).toBe("agent-1");
      expect(check.conflictingPattern).toBe("packages/llm-router/**");
      expect(check.requestedPattern).toBe("packages/llm-router/src/routing/router.ts");
    });

    it("permits concurrent execution of overlapping files when using branch isolation mode", () => {
      manager.register("agent-1", ["packages/llm-router/**"], "inherit");

      // Agent-2 uses branch isolation (dedicated git worktree) -> no disk collision on root
      const check = manager.checkCollision(
        "agent-2",
        ["packages/llm-router/src/routing/router.ts"],
        "branch"
      );
      expect(check.hasCollision).toBe(false);

      manager.register("agent-2", ["packages/llm-router/src/routing/router.ts"], "branch");
      expect(manager.getActiveOwnership().length).toBe(2);
    });

    it("releases file ownership upon agent completion or termination", () => {
      manager.register("agent-1", ["src/index.ts"], "inherit");
      expect(manager.getActiveOwnership().length).toBe(1);

      // Collides while active
      expect(manager.checkCollision("agent-2", ["src/index.ts"], "inherit").hasCollision).toBe(true);

      // Release agent-1
      const released = manager.release("agent-1");
      expect(released).toBe(true);
      expect(manager.getActiveOwnership().length).toBe(0);

      // Now agent-2 can register
      expect(manager.checkCollision("agent-2", ["src/index.ts"], "inherit").hasCollision).toBe(false);
    });

    it("ignores self-collision", () => {
      manager.register("agent-1", ["src/index.ts"], "inherit");
      const check = manager.checkCollision("agent-1", ["src/index.ts"], "inherit");
      expect(check.hasCollision).toBe(false);
    });
  });
});

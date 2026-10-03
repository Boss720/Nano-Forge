import { describe, it, expect, beforeEach } from "vitest";
import {
  SlidingTokenBudget,
  estimateTokens,
} from "../budget.js";
import {
  ToolOutputPruner,
  StepSummarizer,
  ContextCompactor,
} from "../compaction.js";

describe("Context Compaction & Token Budgeting Suite", () => {
  describe("SlidingTokenBudget", () => {
    let budget: SlidingTokenBudget;

    beforeEach(() => {
      budget = new SlidingTokenBudget({
        maxContextTokens: 10000,
        reservedOutputTokens: 2000,
        compactionWatermarkRatio: 0.75, // Watermark at 6000 tokens (75% of 8000)
      });
    });

    it("calculates budget headroom and watermark thresholds", () => {
      expect(budget.maxPromptBudget).toBe(8000);
      expect(budget.getTotalPromptTokens()).toBe(0);
      expect(budget.isCompactionNeeded()).toBe(false);

      // Add tokens under watermark
      budget.setZone("systemPrompt", 1000);
      budget.setZone("activeStep", 2000);
      expect(budget.getTotalPromptTokens()).toBe(3000);
      expect(budget.isCompactionNeeded()).toBe(false);
      expect(budget.getRemainingHeadroom()).toBe(5000);

      // Add tokens exceeding watermark (6000)
      budget.setZone("toolOutputs", 3500);
      expect(budget.getTotalPromptTokens()).toBe(6500);
      expect(budget.isCompactionNeeded()).toBe(true);

      const summary = budget.getUsageSummary();
      expect(summary.isCompactionNeeded).toBe(true);
      expect(summary.tokensToReclaim).toBe(500); // 6500 - 6000
    });

    it("estimates tokens from text length", () => {
      const tokens = estimateTokens("a".repeat(350));
      expect(tokens).toBe(100);
    });
  });

  describe("ToolOutputPruner", () => {
    let pruner: ToolOutputPruner;

    beforeEach(() => {
      pruner = new ToolOutputPruner();
    });

    it("preserves short tool outputs unmodified", () => {
      const output = "File written successfully: src/index.ts";
      const result = pruner.prune(output, { maxTokens: 200 });

      expect(result.content).toBe(output);
      expect(result.isTruncated).toBe(false);
      expect(result.tokensSaved).toBe(0);
    });

    it("strips ANSI color and styling escape sequences", () => {
      const colored = "\u001b[32mPASS\u001b[39m \u001b[2msrc/\u001b[22mindex.test.ts";
      const result = pruner.prune(colored, { maxTokens: 200 });

      expect(result.content).toBe("PASS src/index.test.ts");
      expect(result.content).not.toContain("\u001b");
    });

    it("deduplicates runs of consecutive identical log lines", () => {
      const repeating = [
        "polling job status: RUNNING",
        "polling job status: RUNNING",
        "polling job status: RUNNING",
        "job finished: SUCCESS",
      ].join("\n");

      const result = pruner.prune(repeating, { maxTokens: 50 });
      expect(result.content).toContain("polling job status: RUNNING (repeated 3 times)");
      expect(result.content).toContain("job finished: SUCCESS");
    });

    it("truncates massive output with head/tail preservation and omission marker", () => {
      const lines: string[] = [];
      for (let i = 1; i <= 200; i++) {
        lines.push(`Log entry line #${i}: transaction processed successfully with id ${i * 100}`);
      }
      const massiveOutput = lines.join("\n");

      const result = pruner.prune(massiveOutput, {
        maxTokens: 100,
        headLines: 5,
        tailLines: 5,
      });

      expect(result.isTruncated).toBe(true);
      expect(result.tokensSaved).toBeGreaterThan(0);
      expect(result.content).toContain("Log entry line #1");
      expect(result.content).toContain("Log entry line #5");
      expect(result.content).toContain("Log entry line #200");
      expect(result.content).toContain("lines omitted / compressed");
    });
  });

  describe("StepSummarizer", () => {
    let summarizer: StepSummarizer;

    beforeEach(() => {
      summarizer = new StepSummarizer();
    });

    it("summarizes completed tasks while strictly retaining decisions, changes, and errors", () => {
      const summary = summarizer.summarize(
        [
          { id: "task-1", title: "Setup workspace" },
          { id: "task-2", title: "Implement provider contract" },
        ],
        [
          {
            id: "dec-1",
            decision: "Free-First Routing",
            rationale: "Prioritize local models to conserve quota",
            at: "2026-08-15T00:00:00Z",
          },
        ],
        [
          {
            path: "packages/llm-router/src/index.ts",
            action: "modified",
            notes: "exported provider interfaces",
          },
        ],
        [
          {
            code: "ERR_RATE_LIMIT",
            message: "Groq TPM limit reached",
            fatal: false,
          },
        ]
      );

      // Verify all invariants are preserved in the distilled output
      expect(summary).toContain("Completed Tasks:");
      expect(summary).toContain("- [x] Setup workspace");
      expect(summary).toContain("- [x] Implement provider contract");

      expect(summary).toContain("Critical Architectural Decisions:");
      expect(summary).toContain("Free-First Routing");
      expect(summary).toContain("Prioritize local models to conserve quota");

      expect(summary).toContain("Modified Files:");
      expect(summary).toContain("MODIFIED: `packages/llm-router/src/index.ts`");

      expect(summary).toContain("Known Diagnostic Context & Recovered Errors:");
      expect(summary).toContain("[ERR_RATE_LIMIT] Groq TPM limit reached");
    });
  });

  describe("ContextCompactor", () => {
    let compactor: ContextCompactor;
    let budget: SlidingTokenBudget;

    beforeEach(() => {
      compactor = new ContextCompactor();
      budget = new SlidingTokenBudget({
        maxContextTokens: 8000,
        reservedOutputTokens: 2000,
        compactionWatermarkRatio: 0.75,
      });
    });

    it("assembles context adhering to the 10-tier priority ladder", () => {
      const result = compactor.compact(
        {
          systemPrompt: "You are the NanoForge Lead Architect.",
          objective: "Implement LLM Orchestrator",
          requirements: ["Zero regressions", "Free first"],
          activeStep: {
            id: "step-9",
            title: "Context Compaction Engine",
            description: "Build token sliding budget and pruning",
          },
          relevantFiles: [
            {
              path: "packages/llm-router/src/index.ts",
              content: "export * from './types.js';",
            },
          ],
          recentChanges: [
            { path: "packages/llm-router/src/context/budget.ts", action: "created" },
          ],
          toolResults: [
            {
              toolId: "npm_test",
              status: "success",
              summary: "PASS 10 tests across all suites\nAll passed",
              timestamp: Date.now(),
            },
          ],
          repoMap: "## REPOSITORY MAP\nMonorepo with 3 packages",
          completedTasks: [{ id: "step-8", title: "Parallel subagents" }],
        },
        budget
      );

      expect(result.renderedContext).toContain("You are the NanoForge Lead Architect.");
      expect(result.renderedContext).toContain("OBJECTIVE\nImplement LLM Orchestrator");
      expect(result.renderedContext).toContain("ACTIVE PLAN STEP\n**Context Compaction Engine**");
      expect(result.renderedContext).toContain("RELEVANT FILE CONTEXT");
      expect(result.renderedContext).toContain("RECENT CHANGES");
      expect(result.renderedContext).toContain("RECENT TOOL EXECUTIONS");
      expect(result.renderedContext).toContain("REPOSITORY MAP");
      expect(result.renderedContext).toContain("HISTORICAL PROGRESS & CONTEXT");

      expect(result.sectionsIncluded).toContain("systemPrompt");
      expect(result.sectionsIncluded).toContain("objective");
      expect(result.sectionsIncluded).toContain("activeStep");
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });
});

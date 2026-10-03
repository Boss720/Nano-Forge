import { describe, expect, it } from "vitest";
import { AgentStateManager } from "../agentState.js";
import { CompactHandoffEngine } from "../handoff.js";

describe("CompactHandoffEngine", () => {
  const engine = new CompactHandoffEngine();

  it("generates structured and compact markdown handoffs", () => {
    const manager = new AgentStateManager("Implement provider-independent LLM router", {
      requirements: ["Normalize LLM provider contracts", "Capability floor routing"],
    });

    manager.addPlanTask({ id: "t1", title: "Author provider interface" });
    manager.addPlanTask({ id: "t2", title: "Implement Ollama adapter" });
    manager.addPlanTask({ id: "t3", title: "Implement Gemini adapter" });

    manager.completeTask("t1");
    manager.completeTask("t2");
    manager.activateTask("t3");

    manager.recordChange({
      path: "packages/llm-router/src/providers/types.ts",
      action: "created",
      notes: "Normalized provider contracts",
    });
    manager.recordChange({
      path: "packages/llm-router/src/providers/ollama.ts",
      action: "created",
      notes: "Ollama NDJSON parser and tool calls",
    });

    manager.recordDecision("NDJSON streaming", "Prevents memory bloat during high-throughput completions");
    manager.recordError("RATE_LIMIT", "Gemini free tier hit 429 quota exhaustion (15s cooldown)");

    const handoff = engine.generateHandoff(manager.getState(), "Resume Gemini adapter implementation with fallback");

    expect(handoff).toContain("# TASK HANDOFF REPORT");
    expect(handoff).toContain("## OBJECTIVE");
    expect(handoff).toContain("## COMPLETED");
    expect(handoff).toContain("## CURRENT TASK");
    expect(handoff).toContain("## RELEVANT FILES");
    expect(handoff).toContain("## DECISIONS MADE");
    expect(handoff).toContain("## KNOWN FAILURES & COOLDOWNS");
    expect(handoff).toContain("## NEXT ACTION");

    expect(handoff).toContain("Author provider interface");
    expect(handoff).toContain("Implement Gemini adapter");
    expect(handoff).toContain("NDJSON streaming");
    expect(handoff).toContain("RATE_LIMIT");

    // Word count / compactness check (< 250 words)
    const wordCount = handoff.split(/\s+/).length;
    expect(wordCount).toBeLessThan(250);
  });

  it("round-trip parses handoff markdown back into structured summary", () => {
    const manager = new AgentStateManager("Refactor WebSocket session transport");
    manager.addPlanTask({ id: "task_1", title: "Migrate token auth to headers" });
    manager.completeTask("task_1");
    manager.recordDecision("Header auth", "Stops token leakage in query strings");

    const markdown = engine.generateHandoff(manager.getState(), "Test token validation");
    const parsed = engine.parseHandoff(markdown);

    expect(parsed.objective).toContain("Refactor WebSocket session transport");
    expect(parsed.completedTasks[0]).toContain("Migrate token auth to headers");
    expect(parsed.decisions[0]).toContain("Header auth");
    expect(parsed.nextAction).toContain("Test token validation");
  });

  it("simulates seamless failover across models without state loss", () => {
    // 1. Initial agent run on Model A
    const manager = new AgentStateManager("Add dark mode support across UI sections");
    manager.addPlanTask({ id: "step_1", title: "Audit Tailwind theme customizer" });
    manager.addPlanTask({ id: "step_2", title: "Implement DarkModeToggle component" });
    manager.addPlanTask({ id: "step_3", title: "Wire dark mode to AppLayout" });

    manager.activateTask("step_1");
    manager.recordChange({ path: "src/sections/ThemeCustomizer.tsx", action: "modified" });
    manager.completeTask("step_1");

    // 2. Model A encounters HTTP 429
    manager.activateTask("step_2");
    manager.recordError("RATE_LIMIT", "Model A throttled by provider. Cooldown 30s.", false);

    // 3. Compact handoff generated
    const handoffPacket = engine.generateHandoff(manager.getState(), "Implement DarkModeToggle component on Model B");

    // 4. Model B resumes from handoff packet
    const handoffSummary = engine.parseHandoff(handoffPacket);
    expect(handoffSummary.completedTasks).toContain("Audit Tailwind theme customizer");
    expect(handoffSummary.currentTask).toContain("Implement DarkModeToggle component");
    expect(handoffSummary.relevantFiles).toContain("src/sections/ThemeCustomizer.tsx (MODIFIED)");

    // Model B finishes the task
    manager.recordChange({ path: "src/components/ui/DarkModeToggle.tsx", action: "created" });
    manager.completeTask("step_2");
    manager.recordModelUsage("model-b", 450);

    const finalState = manager.getState();
    expect(finalState.plan.completed).toHaveLength(2);
    expect(finalState.changes).toHaveLength(2);
    expect(finalState.modelHistory[0].modelId).toBe("model-b");
  });
});

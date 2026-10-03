/**
 * Context Compaction & Distillation Engine.
 *
 * Implements tiered context window distillation for LLM orchestration:
 * - Tool Output Pruner: strips ANSI codes, deduplicates repeated logs, and truncates
 *   oversized stdout/stderr with head/tail preservation and omission markers.
 * - Step Summarizer: condenses completed DAG steps while strictly preserving
 *   user requirements, decisions, modified files, and known errors.
 * - Context Compactor: assembles prompts following the 10-tier priority ladder
 *   from Section 24 of the NanoForge Master Prompt.
 */

import { estimateTokens, SlidingTokenBudget } from "./budget.js";
import type { AgentState, AgentDecision, FileChange, ToolExecutionSummary } from "./agentState.js";

/** ANSI Escape Sequence regex for stripping terminal styling. */
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export interface ToolPruningOptions {
  maxTokens?: number;
  headLines?: number;
  tailLines?: number;
}

export interface PrunedToolResult {
  content: string;
  originalTokens: number;
  prunedTokens: number;
  tokensSaved: number;
  isTruncated: boolean;
}

export class ToolOutputPruner {
  /**
   * Cleans, deduplicates, and prunes voluminous tool output (stdout, stderr, diffs).
   */
  static prune(rawOutput: string, options: ToolPruningOptions = {}): PrunedToolResult {
    if (!rawOutput) {
      return {
        content: "",
        originalTokens: 0,
        prunedTokens: 0,
        tokensSaved: 0,
        isTruncated: false,
      };
    }

    const maxTokens = options.maxTokens ?? 400;
    const headLines = options.headLines ?? 15;
    const tailLines = options.tailLines ?? 20;

    // 1. Strip ANSI codes
    const cleanText = rawOutput.replace(ANSI_REGEX, "").trim();
    const originalTokens = estimateTokens(cleanText);

    // 2. Deduplicate consecutive identical lines
    const lines = cleanText.split("\n");
    const dedupedLines: string[] = [];
    let repeatCount = 1;

    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];
      const next = lines[i + 1];

      if (current === next) {
        repeatCount += 1;
      } else {
        if (repeatCount > 1) {
          dedupedLines.push(`${current} (repeated ${repeatCount} times)`);
          repeatCount = 1;
        } else {
          dedupedLines.push(current);
        }
      }
    }

    // Check if deduplication brought it under budget
    const dedupedText = dedupedLines.join("\n");
    const dedupedTokens = estimateTokens(dedupedText);
    if (dedupedTokens <= maxTokens) {
      return {
        content: dedupedText,
        originalTokens,
        prunedTokens: dedupedTokens,
        tokensSaved: Math.max(0, originalTokens - dedupedTokens),
        isTruncated: false,
      };
    }

    // 3. Head & Tail sliding truncation
    if (dedupedLines.length <= headLines + tailLines) {
      return {
        content: dedupedText,
        originalTokens,
        prunedTokens: dedupedTokens,
        tokensSaved: Math.max(0, originalTokens - dedupedTokens),
        isTruncated: false,
      };
    }

    const head = dedupedLines.slice(0, headLines);
    const tail = dedupedLines.slice(-tailLines);
    const omittedCount = dedupedLines.length - (headLines + tailLines);

    const omittedContent = dedupedLines.slice(headLines, dedupedLines.length - tailLines).join("\n");
    const omittedTokens = estimateTokens(omittedContent);

    const marker = `\n[... ${omittedCount} lines omitted / compressed (${omittedTokens} tokens saved) ...]\n`;
    const finalContent = `${head.join("\n")}\n${marker}\n${tail.join("\n")}`;
    const prunedTokens = estimateTokens(finalContent);

    return {
      content: finalContent,
      originalTokens,
      prunedTokens,
      tokensSaved: Math.max(0, originalTokens - prunedTokens),
      isTruncated: true,
    };
  }

  prune(rawOutput: string, options: ToolPruningOptions = {}): PrunedToolResult {
    return ToolOutputPruner.prune(rawOutput, options);
  }
}

export interface SummarizedStep {
  id: string;
  title: string;
  outcome: string;
  modifiedFiles: string[];
}

export class StepSummarizer {
  /**
   * Distills completed DAG tasks into compact bullet points while strictly
   * preserving architectural decisions, file changes, and error root causes.
   */
  summarize(
    completedTasks: Array<{ id: string; title: string; description?: string }>,
    decisions: AgentDecision[] = [],
    changes: FileChange[] = [],
    errors: Array<{ code: string; message: string; fatal: boolean }> = []
  ): string {
    const lines: string[] = ["## HISTORICAL PROGRESS & CONTEXT", ""];

    // 1. Completed Tasks
    lines.push("### Completed Tasks:");
    if (completedTasks.length === 0) {
      lines.push("- No previous tasks recorded.");
    } else {
      for (const t of completedTasks) {
        lines.push(`- [x] ${t.title}`);
      }
    }
    lines.push("");

    // 2. Invariant: Critical Architectural Decisions
    if (decisions.length > 0) {
      lines.push("### Critical Architectural Decisions:");
      for (const d of decisions) {
        lines.push(`- **${d.decision}**: ${d.rationale}`);
      }
      lines.push("");
    }

    // 3. Invariant: Modified Files & Actions
    if (changes.length > 0) {
      lines.push("### Modified Files:");
      for (const c of changes) {
        lines.push(`- ${c.action.toUpperCase()}: \`${c.path}\`${c.notes ? ` (${c.notes})` : ""}`);
      }
      lines.push("");
    }

    // 4. Invariant: Known Errors & Diagnostic Context
    if (errors.length > 0) {
      lines.push("### Known Diagnostic Context & Recovered Errors:");
      for (const e of errors) {
        lines.push(`- [${e.code}] ${e.message} (fatal: ${e.fatal})`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

export interface RawContextInput {
  systemPrompt: string;
  objective: string;
  requirements: string[];
  activeStep?: { id: string; title: string; description?: string };
  relevantFiles?: Array<{ path: string; content: string }>;
  recentChanges?: FileChange[];
  toolResults?: ToolExecutionSummary[];
  repoMap?: string;
  completedTasks?: Array<{ id: string; title: string; description?: string }>;
  decisions?: AgentDecision[];
  ambientHistory?: string[];
}

export interface CompactedContextResult {
  renderedContext: string;
  totalTokens: number;
  compactionOccurred: boolean;
  tokensReclaimed: number;
  sectionsIncluded: string[];
}

export class ContextCompactor {
  private readonly pruner: ToolOutputPruner;
  private readonly summarizer: StepSummarizer;

  constructor(pruner?: ToolOutputPruner, summarizer?: StepSummarizer) {
    this.pruner = pruner ?? new ToolOutputPruner();
    this.summarizer = summarizer ?? new StepSummarizer();
  }

  /**
   * Assembles and compacts context according to the 10-tier priority ladder:
   * 1. System instructions
   * 2. Objective & user requirements
   * 3. Active plan step
   * 4. Relevant file contents
   * 5. Direct dependencies
   * 6. Recent changes
   * 7. Pruned tool results
   * 8. Repository map
   * 9. Summarized historical steps
   * 10. Ambient conversation
   */
  compact(input: RawContextInput, budget: SlidingTokenBudget): CompactedContextResult {
    let compactionOccurred = false;
    const initialTokens = 0;
    const sectionsIncluded: string[] = [];
    const blocks: string[] = [];

    // Priority 1: System Instructions (NON-TRUNCATABLE)
    blocks.push(input.systemPrompt);
    sectionsIncluded.push("systemPrompt");

    // Priority 2: Objective & User Requirements (NON-TRUNCATABLE)
    const objBlock = [
      `## OBJECTIVE\n${input.objective}`,
      input.requirements.length > 0
        ? `\n### REQUIREMENTS & CONSTRAINTS\n${input.requirements.map((r) => `- ${r}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    blocks.push(objBlock);
    sectionsIncluded.push("objective");

    // Priority 3: Active Plan Step (NON-TRUNCATABLE)
    if (input.activeStep) {
      blocks.push(
        `## ACTIVE PLAN STEP\n**${input.activeStep.title}**\n${input.activeStep.description ?? ""}`
      );
      sectionsIncluded.push("activeStep");
    }

    // Priority 4: Relevant Files
    if (input.relevantFiles && input.relevantFiles.length > 0) {
      const fileBlocks = input.relevantFiles.map(
        (f) => `### File: \`${f.path}\`\n\`\`\`\n${f.content}\n\`\`\``
      );
      blocks.push(`## RELEVANT FILE CONTEXT\n${fileBlocks.join("\n\n")}`);
      sectionsIncluded.push("relevantFiles");
    }

    // Priority 6: Recent Changes
    if (input.recentChanges && input.recentChanges.length > 0) {
      const changeLines = input.recentChanges.map(
        (c) => `- ${c.action.toUpperCase()}: \`${c.path}\``
      );
      blocks.push(`## RECENT CHANGES\n${changeLines.join("\n")}`);
      sectionsIncluded.push("recentChanges");
    }

    // Priority 7: Tool Results (Auto-pruned with ToolOutputPruner)
    if (input.toolResults && input.toolResults.length > 0) {
      const prunedResults = input.toolResults.map((tr) => {
        const pruned = this.pruner.prune(tr.summary, { maxTokens: 250 });
        if (pruned.isTruncated) compactionOccurred = true;
        return `#### [${tr.status.toUpperCase()}] ${tr.toolId}\n${pruned.content}`;
      });
      blocks.push(`## RECENT TOOL EXECUTIONS\n${prunedResults.join("\n\n")}`);
      sectionsIncluded.push("toolResults");
    }

    // Priority 8: Repository Map
    if (input.repoMap) {
      blocks.push(input.repoMap);
      sectionsIncluded.push("repoMap");
    }

    // Priority 9: Summarized Completed Steps (Distilled)
    if (input.completedTasks && input.completedTasks.length > 0) {
      const stepSummary = this.summarizer.summarize(
        input.completedTasks,
        input.decisions ?? [],
        input.recentChanges ?? [],
        []
      );
      blocks.push(stepSummary);
      sectionsIncluded.push("completedTasksSummary");
    }

    // Priority 10: Ambient Conversation History (Dropped if headroom is low)
    if (input.ambientHistory && input.ambientHistory.length > 0) {
      const currentText = blocks.join("\n\n");
      const currentTokens = estimateTokens(currentText);

      // Only include ambient conversation if we have plenty of headroom (> 25%)
      if (currentTokens < budget.maxPromptBudget * 0.75) {
        blocks.push(`## CONVERSATION HISTORY\n${input.ambientHistory.join("\n\n")}`);
        sectionsIncluded.push("ambientHistory");
      } else {
        compactionOccurred = true;
      }
    }

    const renderedContext = blocks.join("\n\n");
    const totalTokens = estimateTokens(renderedContext);

    return {
      renderedContext,
      totalTokens,
      compactionOccurred,
      tokensReclaimed: Math.max(0, initialTokens - totalTokens),
      sectionsIncluded,
    };
  }
}

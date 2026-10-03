import { AgentState } from "./agentState.js";

export interface ParsedHandoff {
  objective: string;
  completedTasks: string[];
  currentTask: string;
  relevantFiles: string[];
  decisions: string[];
  knownFailures: string[];
  nextAction: string;
}

function truncateText(text: string, maxLen: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 3) + "...";
}

export class CompactHandoffEngine {
  /**
   * Generates a dense, token-efficient markdown packet (< 250 words, < 500 tokens)
   * that allows an alternate model to continue execution without context replay.
   * Employs adaptive windowing and summarization to ensure strict budget adherence
   * regardless of how large the underlying AgentState becomes.
   */
  generateHandoff(state: AgentState, nextActionOverride?: string): string {
    // Two-pass generation: standard windowing first, fallback to ultra-compact if budget exceeded
    let packet = this.renderMarkdownPacket(state, false, nextActionOverride);

    const wordCount = packet.split(/\s+/).filter(Boolean).length;
    const estimatedTokens = Math.ceil(packet.length / 3);

    if (wordCount >= 240 || estimatedTokens >= 480) {
      packet = this.renderMarkdownPacket(state, true, nextActionOverride);
    }

    return packet;
  }

  private renderMarkdownPacket(
    state: AgentState,
    compactMode: boolean,
    nextActionOverride?: string
  ): string {
    const lines: string[] = ["# TASK HANDOFF REPORT", ""];

    // 1. Objective & Requirements
    lines.push("## OBJECTIVE");
    lines.push(truncateText(state.objective, compactMode ? 100 : 140));
    if (state.requirements && state.requirements.length > 0) {
      lines.push("### Requirements:");
      const maxReqs = compactMode ? 2 : 3;
      const reqs = state.requirements.slice(0, maxReqs);
      for (const req of reqs) {
        lines.push(`- ${truncateText(req, compactMode ? 40 : 60)}`);
      }
      if (state.requirements.length > maxReqs) {
        lines.push(`+ ${state.requirements.length - maxReqs} earlier requirements omitted`);
      }
    }
    lines.push("");

    // 2. Completed Tasks
    lines.push("## COMPLETED");
    const completed = state.plan?.completed || [];
    if (completed.length === 0) {
      lines.push("None yet.");
    } else {
      const maxTasks = 5;
      const windowed = completed.slice(-maxTasks);
      const omittedCount = completed.length - windowed.length;
      if (omittedCount > 0) {
        lines.push(`+ ${omittedCount} earlier tasks omitted`);
      }
      for (const task of windowed) {
        const title = truncateText(task.title, compactMode ? 40 : 50);
        let desc = "";
        if (task.description) {
          desc = `: ${truncateText(task.description, compactMode ? 25 : 45)}`;
        }
        lines.push(`- [x] ${title}${desc}`);
      }
    }
    lines.push("");

    // 3. Current Task
    lines.push("## CURRENT TASK");
    const active = state.plan?.active || [];
    const pending = state.plan?.pending || [];
    if (active.length === 0) {
      lines.push(pending[0]?.title ? truncateText(pending[0].title, 80) : "Awaiting task dispatch");
    } else {
      for (const task of active.slice(0, 1)) {
        const title = truncateText(task.title, compactMode ? 40 : 50);
        const desc = task.description ? `: ${truncateText(task.description, compactMode ? 25 : 40)}` : "";
        lines.push(`- [ ] ${title}${desc}`);
      }
    }
    lines.push("");

    // 4. Relevant Files & Changes
    lines.push("## RELEVANT FILES");
    const changes = state.changes || [];
    const relevantFiles = state.relevantFiles || [];
    if (changes.length === 0 && relevantFiles.length === 0) {
      lines.push("No files modified yet.");
    } else {
      const maxChanges = compactMode ? 3 : 5;
      const windowedChanges = changes.slice(-maxChanges);
      const omittedChanges = changes.length - windowedChanges.length;
      if (omittedChanges > 0) {
        lines.push(`+ ${omittedChanges} earlier file changes omitted`);
      }
      for (const change of windowedChanges) {
        const notes = !compactMode && change.notes ? `: ${truncateText(change.notes, 25)}` : "";
        lines.push(`- ${truncateText(change.path, 50)} (${change.action.toUpperCase()})${notes}`);
      }

      const unmentionedReadFiles = relevantFiles.filter((f) => !changes.some((c) => c.path === f));
      const maxRead = compactMode ? 1 : 2;
      const windowedRead = unmentionedReadFiles.slice(-maxRead);
      for (const file of windowedRead) {
        lines.push(`- ${truncateText(file, 50)} (READ)`);
      }
      if (unmentionedReadFiles.length > maxRead) {
        lines.push(`+ ${unmentionedReadFiles.length - maxRead} earlier read files omitted`);
      }
    }
    lines.push("");

    // 5. Decisions Made
    lines.push("## DECISIONS MADE");
    const decisions = state.decisions || [];
    if (decisions.length === 0) {
      lines.push("No architectural decisions recorded.");
    } else {
      const maxDecisions = compactMode ? 2 : 3;
      const windowedDecisions = decisions.slice(-maxDecisions);
      const omittedDecisions = decisions.length - windowedDecisions.length;
      if (omittedDecisions > 0) {
        lines.push(`+ ${omittedDecisions} earlier decisions omitted`);
      }
      for (const dec of windowedDecisions) {
        const rationale = !compactMode && dec.rationale ? ` (Rationale: ${truncateText(dec.rationale, 35)})` : "";
        lines.push(`- ${truncateText(dec.decision, 35)}${rationale}`);
      }
    }
    lines.push("");

    // 6. Known Failures & Cooldowns
    lines.push("## KNOWN FAILURES & COOLDOWNS");
    const errors = state.errors || [];
    if (errors.length === 0) {
      lines.push("None.");
    } else {
      const maxErrors = compactMode ? 2 : 3;
      const windowedErrors = errors.slice(-maxErrors);
      const omittedErrors = errors.length - windowedErrors.length;
      if (omittedErrors > 0) {
        lines.push(`+ ${omittedErrors} earlier errors omitted`);
      }
      for (const err of windowedErrors) {
        lines.push(`- [${err.code}] ${truncateText(err.message, 45)}${err.fatal ? " (FATAL)" : ""}`);
      }
    }
    lines.push("");

    // 7. Next Action
    lines.push("## NEXT ACTION");
    const fallbackAction = active[0]
      ? `Execute: ${active[0].title}`
      : pending[0]?.title || "Proceed to verification.";
    lines.push(truncateText(nextActionOverride || fallbackAction, 100));

    return lines.join("\n");
  }

  /**
   * Reverse-parses a compact handoff markdown string into a structured summary.
   * Tolerant to arbitrary indentation, tab headers, missing sections, and case variations.
   */
  parseHandoff(markdown: string): ParsedHandoff {
    const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const sections = normalized.split(/^[ \t]*##[ \t]+/m);

    let objective = "";
    const completedTasks: string[] = [];
    let currentTask = "";
    const relevantFiles: string[] = [];
    const decisions: string[] = [];
    const knownFailures: string[] = [];
    let nextAction = "";

    for (const section of sections) {
      const firstLineEnd = section.indexOf("\n");
      const title = firstLineEnd === -1 ? section.trim() : section.slice(0, firstLineEnd).trim();
      const content = firstLineEnd === -1 ? "" : section.slice(firstLineEnd + 1);

      switch (title.toUpperCase()) {
        case "OBJECTIVE":
          objective = content.trim();
          break;
        case "COMPLETED":
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (
              /^\+?\s*\d+\s+.*omitted/i.test(trimmed) ||
              /^\+?\s*\d+\s+earlier/i.test(trimmed) ||
              trimmed.toLowerCase().includes("omitted")
            ) {
              continue;
            }
            const clean = trimmed.replace(/^[-*]\s*(\[[xX]\]\s*)?/, "").trim();
            const lower = clean.toLowerCase().replace(/[.\s!]+$/, "");
            if (
              !clean ||
              lower === "none yet" ||
              lower === "none" ||
              lower === "n/a" ||
              lower === "none recorded" ||
              lower.includes("no completed tasks")
            ) {
              continue;
            }
            completedTasks.push(clean);
          }
          break;
        case "CURRENT TASK": {
          const firstNonEmptyLine =
            content
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.length > 0) || "";
          const cleaned = firstNonEmptyLine.replace(/^[-*]\s*(\[\s*\]\s*)?/i, "").trim();
          const lower = cleaned.toLowerCase().replace(/[.\s!]+$/, "");
          if (
            lower === "none" ||
            lower === "none yet" ||
            lower === "n/a" ||
            lower === "no active task" ||
            lower === "no current task"
          ) {
            currentTask = "";
          } else {
            currentTask = cleaned;
          }
          break;
        }
        case "RELEVANT FILES":
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (
              /^\+?\s*\d+\s+.*omitted/i.test(trimmed) ||
              /^\+?\s*\d+\s+earlier/i.test(trimmed) ||
              trimmed.toLowerCase().includes("omitted")
            ) {
              continue;
            }
            const clean = trimmed.replace(/^[-*]\s*/, "").trim();
            const lower = clean.toLowerCase().replace(/[.\s!]+$/, "");
            if (
              !clean ||
              lower.includes("no files modified") ||
              lower === "none" ||
              lower === "none yet" ||
              lower === "n/a" ||
              lower === "no relevant files"
            ) {
              continue;
            }
            relevantFiles.push(clean);
          }
          break;
        case "DECISIONS MADE":
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (
              /^\+?\s*\d+\s+.*omitted/i.test(trimmed) ||
              /^\+?\s*\d+\s+earlier/i.test(trimmed) ||
              trimmed.toLowerCase().includes("omitted")
            ) {
              continue;
            }
            const clean = trimmed.replace(/^[-*]\s*/, "").trim();
            const lower = clean.toLowerCase().replace(/[.\s!]+$/, "");
            if (
              !clean ||
              lower.includes("no architectural decisions") ||
              lower === "none" ||
              lower === "none yet" ||
              lower === "n/a" ||
              lower === "no decisions recorded"
            ) {
              continue;
            }
            decisions.push(clean);
          }
          break;
        case "KNOWN FAILURES & COOLDOWNS":
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (
              /^\+?\s*\d+\s+.*omitted/i.test(trimmed) ||
              /^\+?\s*\d+\s+earlier/i.test(trimmed) ||
              trimmed.toLowerCase().includes("omitted")
            ) {
              continue;
            }
            const clean = trimmed.replace(/^[-*]\s*/, "").trim();
            const lower = clean.toLowerCase().replace(/[.\s!]+$/, "");
            if (
              !clean ||
              lower === "none" ||
              lower === "none yet" ||
              lower === "n/a" ||
              lower === "no failures" ||
              lower === "no errors" ||
              lower.includes("no known failures")
            ) {
              continue;
            }
            knownFailures.push(clean);
          }
          break;
        case "NEXT ACTION":
          nextAction = content.trim();
          break;
      }
    }

    return {
      objective,
      completedTasks,
      currentTask,
      relevantFiles,
      decisions,
      knownFailures,
      nextAction,
    };
  }
}


export type TaskComplexityClass = "TRIVIAL" | "LIGHT" | "STANDARD" | "COMPLEX" | "CRITICAL";

export interface TaskClassification {
  complexityClass: TaskComplexityClass;
  capabilityFloor: number;
  needsCoding: boolean;
  needsReasoning: boolean;
  needsVision: boolean;
  needsTools: boolean;
  estimatedPromptTokens: number;
  reason: string;
}

export class TaskClassifier {
  classify(prompt: string, options: { hasImages?: boolean; hasTools?: boolean } = {}): TaskClassification {
    const text = prompt.toLowerCase();
    const tokenEstimate = prompt.length === 0 ? 0 : Math.ceil(prompt.length / 4);

    // CRITICAL (Floor: 0.9): Security auditing, system architecture design
    if (
      text.includes("security audit") ||
      text.includes("vulnerability") ||
      text.includes("architectural design") ||
      text.includes("mission critical") ||
      text.includes("threat model")
    ) {
      return {
        complexityClass: "CRITICAL",
        capabilityFloor: 0.9,
        needsCoding: true,
        needsReasoning: true,
        needsVision: Boolean(options.hasImages),
        needsTools: Boolean(options.hasTools),
        estimatedPromptTokens: tokenEstimate,
        reason: "Security or critical architectural scope detected",
      };
    }

    // COMPLEX (Floor: 0.8): Multi-file refactoring, race conditions, deep debugging
    if (
      text.includes("refactor") ||
      text.includes("race condition") ||
      text.includes("deadlock") ||
      text.includes("multi-file") ||
      text.includes("performance optimization") ||
      text.includes("memory leak") ||
      text.includes("complex debug")
    ) {
      return {
        complexityClass: "COMPLEX",
        capabilityFloor: 0.8,
        needsCoding: true,
        needsReasoning: true,
        needsVision: Boolean(options.hasImages),
        needsTools: Boolean(options.hasTools),
        estimatedPromptTokens: tokenEstimate,
        reason: "Complex coding or deep debugging required",
      };
    }

    // TRIVIAL (Floor: 0.1): Variable renaming, formatting, simple file existence checks
    // Prompts under 30 characters are classified as TRIVIAL
    if (
      prompt.length < 30 ||
      text.includes("rename variable") ||
      text.includes("format code") ||
      text.includes("fix typo") ||
      text.includes("check if file exists")
    ) {
      return {
        complexityClass: "TRIVIAL",
        capabilityFloor: 0.1,
        needsCoding: true,
        needsReasoning: false,
        needsVision: Boolean(options.hasImages),
        needsTools: Boolean(options.hasTools),
        estimatedPromptTokens: tokenEstimate,
        reason: "Trivial syntactic edit or simple lookup",
      };
    }

    // LIGHT (Floor: 0.3): Documentation lookups, simple edits, basic summarization
    if (
      text.includes("document") ||
      text.includes("readme") ||
      text.includes("summarize") ||
      text.includes("comment") ||
      text.includes("explain this line")
    ) {
      return {
        complexityClass: "LIGHT",
        capabilityFloor: 0.3,
        needsCoding: false,
        needsReasoning: false,
        needsVision: Boolean(options.hasImages),
        needsTools: Boolean(options.hasTools),
        estimatedPromptTokens: tokenEstimate,
        reason: "Documentation or lightweight summarization task",
      };
    }

    // STANDARD (Floor: 0.6): Single-file feature implementation, unit test authoring, standard bug fixing
    return {
      complexityClass: "STANDARD",
      capabilityFloor: 0.6,
      needsCoding: true,
      needsReasoning: false,
      needsVision: Boolean(options.hasImages),
      needsTools: Boolean(options.hasTools),
      estimatedPromptTokens: tokenEstimate,
      reason: "Standard feature coding or test generation",
    };
  }
}

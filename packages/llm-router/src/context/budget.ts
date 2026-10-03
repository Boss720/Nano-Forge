/**
 * Sliding Token Budget Manager.
 *
 * Tracks multi-zone token consumption across:
 * - System prompt & instructions
 * - Objective & active plan step
 * - Directly relevant files & recent diffs
 * - Accumulated tool outputs (stdout / stderr)
 * - Summarized step history & ambient context
 * - Reserved generation headroom for model completions
 *
 * Detects when context utilization crosses the compaction watermark (default: 75%)
 * and calculates exact token surplus to guide compaction algorithms.
 */

export interface BudgetConfig {
  /** Maximum context window allowed for the prompt (e.g. 32768, 128000) */
  maxContextTokens: number;
  /** Reserved token headroom for model generation/output (defaults to 2048) */
  reservedOutputTokens?: number;
  /** Utilization ratio (0.0 to 1.0) above which compaction is triggered (defaults to 0.75) */
  compactionWatermarkRatio?: number;
}

export interface ZoneTokenCounts {
  systemPrompt: number;
  activeStep: number;
  relevantFiles: number;
  toolOutputs: number;
  history: number;
}

export interface BudgetUsageSummary {
  maxContextTokens: number;
  reservedOutputTokens: number;
  maxPromptBudget: number;
  totalPromptTokens: number;
  utilizationRatio: number;
  isCompactionNeeded: boolean;
  tokensToReclaim: number;
  remainingHeadroom: number;
  breakdown: ZoneTokenCounts;
}

/**
 * Fast, conservative token count heuristic (~3.5 characters per token).
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export class SlidingTokenBudget {
  readonly maxContextTokens: number;
  readonly reservedOutputTokens: number;
  readonly maxPromptBudget: number;
  readonly compactionWatermarkRatio: number;

  private counts: ZoneTokenCounts = {
    systemPrompt: 0,
    activeStep: 0,
    relevantFiles: 0,
    toolOutputs: 0,
    history: 0,
  };

  constructor(config: BudgetConfig) {
    this.maxContextTokens = config.maxContextTokens;
    this.reservedOutputTokens = config.reservedOutputTokens ?? 2048;
    this.compactionWatermarkRatio = config.compactionWatermarkRatio ?? 0.75;
    this.maxPromptBudget = Math.max(0, this.maxContextTokens - this.reservedOutputTokens);
  }

  /**
   * Sets the token count for a specific context zone.
   */
  setZone(zone: keyof ZoneTokenCounts, tokens: number): void {
    this.counts[zone] = Math.max(0, tokens);
  }

  /**
   * Sets the token count for a zone by estimating string length.
   */
  setZoneText(zone: keyof ZoneTokenCounts, text: string): void {
    this.setZone(zone, estimateTokens(text));
  }

  /**
   * Resets all zone counts.
   */
  reset(): void {
    this.counts = {
      systemPrompt: 0,
      activeStep: 0,
      relevantFiles: 0,
      toolOutputs: 0,
      history: 0,
    };
  }

  /**
   * Computes current prompt token total.
   */
  getTotalPromptTokens(): number {
    return (
      this.counts.systemPrompt +
      this.counts.activeStep +
      this.counts.relevantFiles +
      this.counts.toolOutputs +
      this.counts.history
    );
  }

  /**
   * Evaluates whether compaction is required based on the watermark threshold.
   */
  isCompactionNeeded(): boolean {
    const total = this.getTotalPromptTokens();
    const watermark = this.maxPromptBudget * this.compactionWatermarkRatio;
    return total >= watermark;
  }

  /**
   * Calculates remaining generation and prompt headroom.
   */
  getRemainingHeadroom(): number {
    return Math.max(0, this.maxPromptBudget - this.getTotalPromptTokens());
  }

  /**
   * Returns a complete budget snapshot.
   */
  getUsageSummary(): BudgetUsageSummary {
    const totalPromptTokens = this.getTotalPromptTokens();
    const utilizationRatio =
      this.maxPromptBudget > 0 ? totalPromptTokens / this.maxPromptBudget : 1.0;
    const watermarkTokens = this.maxPromptBudget * this.compactionWatermarkRatio;
    const isCompactionNeeded = totalPromptTokens >= watermarkTokens;
    const tokensToReclaim = isCompactionNeeded ? Math.max(0, totalPromptTokens - watermarkTokens) : 0;

    return {
      maxContextTokens: this.maxContextTokens,
      reservedOutputTokens: this.reservedOutputTokens,
      maxPromptBudget: this.maxPromptBudget,
      totalPromptTokens,
      utilizationRatio,
      isCompactionNeeded,
      tokensToReclaim,
      remainingHeadroom: this.getRemainingHeadroom(),
      breakdown: { ...this.counts },
    };
  }
}

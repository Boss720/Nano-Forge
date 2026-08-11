import type { Message } from "@/types";

/**
 * Context-window budgeting (roadmap Task 1.2).
 *
 * Token estimation is a cheap heuristic — ceil(chars / 4) — good enough for
 * gating how much transcript history we ship to the API. `buildContext`
 * reserves 25% of the model's budget for the completion and greedily packs
 * history from newest to oldest into the rest.
 */

export interface ContextMessage {
  role: string;
  content: string;
}

/** Fraction of the token budget reserved for the model's output. */
const OUTPUT_RESERVE = 0.25;

/** Rough token estimate: ~4 characters per token, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Builds the OpenAI-style message list for a request:
 *   1. The system message is always first and is never dropped.
 *   2. 25% of `budgetTokens` is reserved for output; the system prompt and
 *      history share the remaining 75%.
 *   3. Messages are included greedily from newest to oldest while they fit;
 *      the first message that does not fit stops the scan.
 *   4. The result is chronological: system first, then oldest → newest of
 *      the messages that fit.
 */
export function buildContext(msgs: Message[], system: string, budgetTokens: number): ContextMessage[] {
  const usable = Math.floor(budgetTokens * (1 - OUTPUT_RESERVE));
  let used = estimateTokens(system);

  const picked: ContextMessage[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const cost = estimateTokens(m.content);
    if (used + cost > usable) break;
    picked.push({ role: m.role, content: m.content });
    used += cost;
  }
  picked.reverse();

  return [{ role: "system", content: system }, ...picked];
}

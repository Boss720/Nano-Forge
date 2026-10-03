/**
 * File Ownership & Collision Detection Engine.
 *
 * Enforces file boundary discipline for parallel subagents:
 * - Tracks declared file scopes and globs owned by active subagents.
 * - Detects concurrent mutation overlaps across exact paths, directory trees, and wildcards.
 * - Enforces the invariant: concurrent subagents mutating the same files in shared
 *   workspace mode (`inherit`) are rejected with `ERR_SUBAGENT_FILE_COLLISION`.
 * - Permits parallel execution when subagents are sandboxed in isolated Git worktrees (`branch`).
 * - Automatically releases ownership locks upon subagent termination or cancellation.
 */

import type { WorkspaceIsolationMode } from "@protocol/subagents";

export interface OwnershipRecord {
  subagentId: string;
  patterns: string[];
  isolationMode: WorkspaceIsolationMode;
  registeredAt: string;
}

export interface CollisionCheckResult {
  hasCollision: boolean;
  collidingSubagentId?: string;
  conflictingPattern?: string;
  requestedPattern?: string;
  reason?: string;
}

/**
 * Normalizes a path or glob string to a canonical posix representation:
 * - Replaces backslashes with slashes
 * - Strips leading `./` or `/`
 * - Removes trailing slash unless it's a directory wild-card
 */
export function normalizePattern(pattern: string): string {
  let cleaned = pattern.trim().replace(/\\/g, "/");
  while (cleaned.startsWith("./")) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.startsWith("/")) {
    cleaned = cleaned.slice(1);
  }
  while (cleaned.length > 1 && cleaned.endsWith("/") && !cleaned.endsWith("/**") && !cleaned.endsWith("/*")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Converts a glob pattern into a regular expression.
 */
function globToRegex(glob: string): RegExp {
  const normalized = normalizePattern(glob);
  let regexStr = "^";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "*" && normalized[i + 1] === "*") {
      // "**" matches any characters including slashes
      if (normalized[i + 2] === "/") {
        regexStr += "(?:.*\\/)?";
        i += 2;
      } else {
        regexStr += ".*";
        i += 1;
      }
    } else if (char === "*") {
      // "*" matches any character except slash
      regexStr += "[^/]*";
    } else if (char === "?") {
      regexStr += "[^/]";
    } else if (["[", "]", "(", ")", "{", "}", "+", ".", "^", "$", "|"].includes(char)) {
      regexStr += `\\${char}`;
    } else {
      regexStr += char;
    }
  }

  regexStr += "$";
  return new RegExp(regexStr);
}

/**
 * Determines whether two normalized path or glob patterns overlap.
 */
export function patternsOverlap(patternA: string, patternB: string): boolean {
  const normA = normalizePattern(patternA);
  const normB = normalizePattern(patternB);

  // 1. Identical patterns
  if (normA === normB) {
    return true;
  }

  // 2. Global wildcard matches everything
  if (normA === "**" || normA === "*" || normB === "**" || normB === "*") {
    return true;
  }

  // 3. Directory prefix overlap (e.g. "packages/llm-router/**" vs "packages/llm-router/src/index.ts")
  const prefixA = normA.endsWith("/**") ? normA.slice(0, -3) : normA.endsWith("/*") ? normA.slice(0, -2) : null;
  const prefixB = normB.endsWith("/**") ? normB.slice(0, -3) : normB.endsWith("/*") ? normB.slice(0, -2) : null;

  if (prefixA !== null) {
    if (normB === prefixA || normB.startsWith(`${prefixA}/`)) {
      return true;
    }
  }

  if (prefixB !== null) {
    if (normA === prefixB || normA.startsWith(`${prefixB}/`)) {
      return true;
    }
  }

  // 4. One pattern is a directory and the other is inside it
  if (normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`)) {
    return true;
  }

  // 5. Glob matching against literal paths
  try {
    const regexA = globToRegex(normA);
    const regexB = globToRegex(normB);

    if (regexA.test(normB) || regexB.test(normA)) {
      return true;
    }
  } catch {
    // Fall back to prefix matching on regex error
  }

  return false;
}

export class FileOwnershipManager {
  private readonly records = new Map<string, OwnershipRecord>();

  /**
   * Checks whether the proposed patterns for a subagent collide with any active subagent's patterns.
   *
   * Rules:
   * 1. Subagents running in "branch" mode have isolated worktrees, so concurrent disk
   *    writes do not collide on the root workspace.
   * 2. If the incoming subagent or any existing overlapping subagent runs in "inherit" mode,
   *    an overlap on shared files is a collision.
   */
  checkCollision(
    subagentId: string,
    proposedPatterns: string[],
    isolationMode: WorkspaceIsolationMode
  ): CollisionCheckResult {
    if (!proposedPatterns || proposedPatterns.length === 0) {
      return { hasCollision: false };
    }

    // Branch isolation protects against disk collisions during execution
    if (isolationMode === "branch") {
      return { hasCollision: false };
    }

    const normalizedProposed = proposedPatterns.map(normalizePattern).filter(Boolean);

    for (const [activeId, record] of this.records.entries()) {
      if (activeId === subagentId) continue;

      // Only check collision against agents that mutate the shared workspace ("inherit")
      if (record.isolationMode !== "inherit") continue;

      for (const proposed of normalizedProposed) {
        for (const existing of record.patterns) {
          if (patternsOverlap(proposed, existing)) {
            return {
              hasCollision: true,
              collidingSubagentId: activeId,
              conflictingPattern: existing,
              requestedPattern: proposed,
              reason: `File ownership conflict: pattern '${proposed}' overlaps with '${existing}' owned by active subagent '${activeId}' in shared workspace mode.`,
            };
          }
        }
      }
    }

    return { hasCollision: false };
  }

  /**
   * Registers file ownership for a subagent.
   */
  register(
    subagentId: string,
    patterns: string[],
    isolationMode: WorkspaceIsolationMode
  ): void {
    if (!patterns || patterns.length === 0) {
      return;
    }

    const normalized = patterns.map(normalizePattern).filter(Boolean);
    if (normalized.length === 0) return;

    this.records.set(subagentId, {
      subagentId,
      patterns: normalized,
      isolationMode,
      registeredAt: new Date().toISOString(),
    });
  }

  /**
   * Releases file ownership when a subagent finishes or terminates.
   */
  release(subagentId: string): boolean {
    return this.records.delete(subagentId);
  }

  /**
   * Retrieves active ownership record for a subagent.
   */
  getOwnership(subagentId: string): OwnershipRecord | undefined {
    return this.records.get(subagentId);
  }

  /**
   * Returns all active ownership records.
   */
  getActiveOwnership(): OwnershipRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Clears all registered records.
   */
  clear(): void {
    this.records.clear();
  }
}

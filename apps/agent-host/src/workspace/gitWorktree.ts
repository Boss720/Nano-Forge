/**
 * Git Worktree Isolation & Sandboxing Manager.
 *
 * Implements isolated Git worktrees for subagents running in "branch" mode:
 * - createWorktree: creates a new worktree on a dedicated branch (e.g. nano/<subagentId>)
 * - pruneWorktree: forces removal of the worktree and cleans up stale git references
 * - listWorktrees: inspects active worktrees in the repository
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export interface CreateWorktreeResult {
  success: boolean;
  worktreePath: string;
  branch: string;
  error?: string;
}

export interface PruneWorktreeResult {
  success: boolean;
  error?: string;
}

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
}

/**
 * Creates an isolated Git worktree at `worktreePath` checkout on `branchName`.
 * If the branch doesn't exist, `-B` creates/resets it based on HEAD.
 */
export async function createWorktree(
  workspaceRoot: string,
  worktreePath: string,
  branchName: string
): Promise<CreateWorktreeResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedWorktree = path.resolve(resolvedRoot, worktreePath);

  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolvedWorktree), { recursive: true });

    // Execute git worktree add
    const { exitCode, stderr } = await execa(
      "git",
      ["-C", resolvedRoot, "worktree", "add", "-B", branchName, resolvedWorktree, "HEAD"],
      { reject: false }
    );

    if (exitCode !== 0) {
      return {
        success: false,
        worktreePath: resolvedWorktree,
        branch: branchName,
        error: stderr || `git worktree add failed with exit code ${exitCode}`,
      };
    }

    return {
      success: true,
      worktreePath: resolvedWorktree,
      branch: branchName,
    };
  } catch (err) {
    return {
      success: false,
      worktreePath: resolvedWorktree,
      branch: branchName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Forcefully removes a Git worktree, prunes git worktree records, and optionally removes the branch.
 */
export async function pruneWorktree(
  workspaceRoot: string,
  worktreePath: string,
  options?: { deleteBranch?: boolean; branchName?: string }
): Promise<PruneWorktreeResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedWorktree = path.resolve(resolvedRoot, worktreePath);

  try {
    const { exitCode, stderr } = await execa(
      "git",
      ["-C", resolvedRoot, "worktree", "remove", "--force", resolvedWorktree],
      { reject: false }
    );

    // Also run prune to clean up metadata
    await execa("git", ["-C", resolvedRoot, "worktree", "prune"], { reject: false });

    // If directory still exists on disk, forcefully remove it
    try {
      await fs.rm(resolvedWorktree, { recursive: true, force: true });
    } catch {
      // Ignore if already deleted
    }

    // Optionally delete the local branch
    if (options?.deleteBranch && options.branchName) {
      await execa(
        "git",
        ["-C", resolvedRoot, "branch", "-D", options.branchName],
        { reject: false }
      );
    }

    if (exitCode !== 0) {
      return {
        success: false,
        error: stderr || `git worktree remove failed with exit code ${exitCode}`,
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Lists all active git worktrees in the repository.
 */
export async function listWorktrees(workspaceRoot: string): Promise<WorktreeEntry[]> {
  const resolvedRoot = path.resolve(workspaceRoot);
  try {
    const { stdout, exitCode } = await execa(
      "git",
      ["-C", resolvedRoot, "worktree", "list", "--porcelain"],
      { reject: false }
    );

    if (exitCode !== 0 || !stdout) return [];

    const entries: WorktreeEntry[] = [];
    const blocks = stdout.split("\n\n");

    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.trim().split("\n");
      let worktree = "";
      let head = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktree = line.slice("worktree ".length).trim();
        } else if (line.startsWith("HEAD ")) {
          head = line.slice("HEAD ".length).trim();
        } else if (line.startsWith("branch ")) {
          branch = line.slice("branch ".length).trim();
        }
      }

      if (worktree) {
        entries.push({ path: worktree, head, branch });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export interface WorktreeDiffResult {
  success: boolean;
  diff: string;
  filesChanged: string[];
  untrackedFiles: string[];
  error?: string;
}

/**
 * Extracts the git diff, modified files, and untracked files from an active worktree.
 */
export async function getWorktreeDiff(
  workspaceRoot: string,
  worktreePath: string,
  baseRef: string = "HEAD"
): Promise<WorktreeDiffResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedWorktree = path.resolve(resolvedRoot, worktreePath);

  try {
    // 1. Get git diff against baseRef
    const { stdout: diffOut, exitCode: diffExit, stderr: diffErr } = await execa(
      "git",
      ["-C", resolvedWorktree, "diff", baseRef],
      { reject: false }
    );
    if (diffExit !== 0) {
      return {
        success: false,
        diff: "",
        filesChanged: [],
        untrackedFiles: [],
        error: diffErr || `git diff failed with exit code ${diffExit}`,
      };
    }

    // 2. Get status --porcelain for modified & untracked files
    const { stdout: statusOut } = await execa(
      "git",
      ["-C", resolvedWorktree, "status", "--porcelain"],
      { reject: false }
    );

    const filesChanged: string[] = [];
    const untrackedFiles: string[] = [];

    if (statusOut) {
      const lines = statusOut.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const code = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (code === "??") {
          untrackedFiles.push(file);
        } else {
          filesChanged.push(file);
        }
      }
    }

    return {
      success: true,
      diff: diffOut ?? "",
      filesChanged,
      untrackedFiles,
    };
  } catch (err) {
    return {
      success: false,
      diff: "",
      filesChanged: [],
      untrackedFiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ValidateMergeResult {
  canMerge: boolean;
  conflicts: string[];
  tree?: string;
  error?: string;
}

/**
 * Tests whether a subagent's branch can be cleanly merged into the target branch without conflicts.
 */
export async function validateWorktreeMerge(
  workspaceRoot: string,
  branchName: string,
  targetBranch: string = "HEAD"
): Promise<ValidateMergeResult> {
  const resolvedRoot = path.resolve(workspaceRoot);

  try {
    const { stdout, stderr, exitCode } = await execa(
      "git",
      ["-C", resolvedRoot, "merge-tree", "--write-tree", targetBranch, branchName],
      { reject: false }
    );

    if (exitCode === 0) {
      return {
        canMerge: true,
        conflicts: [],
        tree: stdout.trim(),
      };
    }

    // Parse conflict output
    const conflicts: string[] = [];
    const lines = (stdout + "\n" + stderr).split("\n");
    for (const line of lines) {
      if (line.includes("CONFLICT") || line.includes("conflict")) {
        conflicts.push(line.trim());
      }
    }

    return {
      canMerge: false,
      conflicts: conflicts.length > 0 ? conflicts : ["Merge conflict detected between branches"],
      error: stderr || undefined,
    };
  } catch (err) {
    return {
      canMerge: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface MergeWorktreeResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

/**
 * Merges a validated worktree branch into the repository workspace.
 */
export async function mergeWorktree(
  workspaceRoot: string,
  branchName: string,
  options?: { commitMessage?: string; squash?: boolean }
): Promise<MergeWorktreeResult> {
  const resolvedRoot = path.resolve(workspaceRoot);

  // Pre-validate merge
  const val = await validateWorktreeMerge(workspaceRoot, branchName, "HEAD");
  if (!val.canMerge) {
    return {
      success: false,
      error: `Cannot merge branch '${branchName}' due to conflicts: ${val.conflicts.join("; ")}`,
    };
  }

  try {
    const args = ["-C", resolvedRoot, "merge"];
    if (options?.squash) {
      args.push("--squash");
    } else {
      args.push("--no-ff");
    }
    if (options?.commitMessage) {
      args.push("-m", options.commitMessage);
    }
    args.push(branchName);

    const { exitCode, stderr } = await execa("git", args, { reject: false });
    if (exitCode !== 0) {
      return {
        success: false,
        error: stderr || `git merge failed with exit code ${exitCode}`,
      };
    }

    // Get merge commit SHA
    const { stdout: headSha } = await execa("git", ["-C", resolvedRoot, "rev-parse", "HEAD"], {
      reject: false,
    });

    return {
      success: true,
      commitHash: headSha?.trim(),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

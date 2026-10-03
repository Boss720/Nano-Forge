import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import {
  createWorktree,
  pruneWorktree,
  listWorktrees,
  getWorktreeDiff,
  validateWorktreeMerge,
  mergeWorktree,
} from "./gitWorktree.js";

describe("gitWorktree isolation manager", () => {
  let tmpRepo: string;

  beforeEach(async () => {
    tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-worktree-test-"));
    // Initialize a real git repo
    await execa("git", ["init", "-b", "main"], { cwd: tmpRepo });
    await execa("git", ["config", "user.name", "Test Runner"], { cwd: tmpRepo });
    await execa("git", ["config", "user.email", "test@nanoforge.local"], { cwd: tmpRepo });
    await fs.writeFile(path.join(tmpRepo, "README.md"), "# Test Workspace\n", "utf8");
    await execa("git", ["add", "README.md"], { cwd: tmpRepo });
    await execa("git", ["commit", "-m", "Initial commit"], { cwd: tmpRepo });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRepo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("creates an isolated git worktree on a dedicated branch", async () => {
    const relWorktree = ".agents/worktrees/agent-1";
    const branchName = "nano/agent-1";

    const result = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(result.success).toBe(true);
    expect(result.branch).toBe(branchName);

    const exists = await fs.stat(result.worktreePath).then((s) => s.isDirectory()).catch(() => false);
    expect(exists).toBe(true);

    const fileInWorktree = path.join(result.worktreePath, "README.md");
    const content = await fs.readFile(fileInWorktree, "utf8");
    expect(content).toContain("# Test Workspace");
  });

  it("lists active worktrees", async () => {
    const relWorktree = ".agents/worktrees/agent-list";
    const branchName = "nano/agent-list";

    await createWorktree(tmpRepo, relWorktree, branchName);
    const worktrees = await listWorktrees(tmpRepo);

    expect(worktrees.length).toBeGreaterThanOrEqual(2); // main + new worktree
    const found = worktrees.some((w) => w.branch.includes("nano/agent-list"));
    expect(found).toBe(true);
  });

  it("forcefully prunes and removes a worktree", async () => {
    const relWorktree = ".agents/worktrees/agent-prune";
    const branchName = "nano/agent-prune";

    const createRes = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(createRes.success).toBe(true);

    const pruneRes = await pruneWorktree(tmpRepo, relWorktree);
    expect(pruneRes.success).toBe(true);

    const exists = await fs.stat(createRes.worktreePath).catch(() => null);
    expect(exists).toBeNull();
  });

  it("extracts worktree diff and detects modified/untracked files", async () => {
    const relWorktree = ".agents/worktrees/agent-diff";
    const branchName = "nano/agent-diff";

    const createRes = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(createRes.success).toBe(true);

    // Modify existing file
    await fs.appendFile(path.join(createRes.worktreePath, "README.md"), "Added line in branch\n", "utf8");

    // Add untracked new file
    await fs.writeFile(path.join(createRes.worktreePath, "FEATURE.md"), "# New Feature\n", "utf8");

    const diffRes = await getWorktreeDiff(tmpRepo, relWorktree);
    expect(diffRes.success).toBe(true);
    expect(diffRes.diff).toContain("Added line in branch");
    expect(diffRes.filesChanged).toContain("README.md");
    expect(diffRes.untrackedFiles).toContain("FEATURE.md");
  });

  it("validates mergeability and merges worktree branch into main", async () => {
    const relWorktree = ".agents/worktrees/agent-merge";
    const branchName = "nano/agent-merge";

    const createRes = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(createRes.success).toBe(true);

    // Commit a new file in worktree branch
    await fs.writeFile(path.join(createRes.worktreePath, "CONFIG.md"), "# Config\n", "utf8");
    await execa("git", ["-C", createRes.worktreePath, "add", "CONFIG.md"]);
    await execa("git", ["-C", createRes.worktreePath, "commit", "-m", "Add config from worktree"]);

    // Validate merge
    const valRes = await validateWorktreeMerge(tmpRepo, branchName, "HEAD");
    expect(valRes.canMerge).toBe(true);
    expect(valRes.conflicts).toEqual([]);

    // Merge into main
    const mergeRes = await mergeWorktree(tmpRepo, branchName, {
      commitMessage: "Merge branch from subagent",
    });
    expect(mergeRes.success).toBe(true);
    expect(mergeRes.commitHash).toBeDefined();

    // Verify file is now on main
    const mainFileContent = await fs.readFile(path.join(tmpRepo, "CONFIG.md"), "utf8");
    expect(mainFileContent.replace(/\r\n/g, "\n")).toBe("# Config\n");
  });

  it("prunes worktree and deletes the local branch when requested", async () => {
    const relWorktree = ".agents/worktrees/agent-delbranch";
    const branchName = "nano/agent-delbranch";

    const createRes = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(createRes.success).toBe(true);

    const pruneRes = await pruneWorktree(tmpRepo, relWorktree, {
      deleteBranch: true,
      branchName,
    });
    expect(pruneRes.success).toBe(true);

    // Check branch no longer exists
    const { stdout: branchList } = await execa("git", ["-C", tmpRepo, "branch", "--list", branchName]);
    expect(branchList.trim()).toBe("");
  });
});

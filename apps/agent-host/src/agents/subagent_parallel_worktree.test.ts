import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { SubagentSupervisor } from "./supervisor.js";
import { SUBAGENT_ERROR_CODES } from "@protocol/subagents";

describe("Subagent Parallel Execution & File Ownership Collision", () => {
  let tmpWorkspace: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-parallel-test-"));
    // Init git repo so branch isolation can create worktrees
    await execa("git", ["init", "-b", "main"], { cwd: tmpWorkspace });
    await execa("git", ["config", "user.name", "Test Runner"], { cwd: tmpWorkspace });
    await execa("git", ["config", "user.email", "test@nanoforge.local"], { cwd: tmpWorkspace });
    await fs.writeFile(path.join(tmpWorkspace, "README.md"), "# Test Repo\n", "utf8");
    await execa("git", ["add", "README.md"], { cwd: tmpWorkspace });
    await execa("git", ["commit", "-m", "initial commit"], { cwd: tmpWorkspace });

    supervisor = new SubagentSupervisor({ workspaceRoot: tmpWorkspace });
  });

  afterEach(async () => {
    await supervisor.dispose();
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("permits concurrent subagents with disjoint file ownership in inherit mode", async () => {
    const agentA = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_router",
      prompt: "Work on llm-router",
      fileOwnership: ["packages/llm-router/**"],
      workspaceIsolation: "inherit",
    });

    const agentB = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_protocol",
      prompt: "Work on protocol",
      fileOwnership: ["packages/protocol/**"],
      workspaceIsolation: "inherit",
    });

    expect(agentA.subagentId).toBeDefined();
    expect(agentB.subagentId).toBeDefined();

    const summaryA = supervisor.registry.getSummary(agentA.subagentId);
    const summaryB = supervisor.registry.getSummary(agentB.subagentId);
    expect(summaryA?.fileOwnership).toEqual(["packages/llm-router/**"]);
    expect(summaryB?.fileOwnership).toEqual(["packages/protocol/**"]);
  });

  it("rejects concurrent subagents with overlapping file ownership in inherit mode with ERR_SUBAGENT_FILE_COLLISION", async () => {
    await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_first",
      prompt: "Work on router",
      fileOwnership: ["packages/llm-router/**"],
      workspaceIsolation: "inherit",
    });

    await expect(
      supervisor.spawnSubagent({
        archetype: "implementer",
        name: "agent_second",
        prompt: "Touch same router file",
        fileOwnership: ["packages/llm-router/src/routing/router.ts"],
        workspaceIsolation: "inherit",
      })
    ).rejects.toThrow(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_FILE_COLLISION);
  });

  it("permits concurrent subagents with overlapping file ownership when sandboxed in branch isolation (worktree)", async () => {
    const agentA = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_main_root",
      prompt: "Work on router in inherit mode",
      fileOwnership: ["packages/llm-router/**"],
      workspaceIsolation: "inherit",
    });

    // agentB touches overlapping path, but uses branch isolation mode (dedicated worktree)
    const agentB = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_worktree",
      prompt: "Work on router in isolated worktree",
      fileOwnership: ["packages/llm-router/src/routing/router.ts"],
      workspaceIsolation: "branch",
    });

    expect(agentA.subagentId).toBeDefined();
    expect(agentB.subagentId).toBeDefined();

    const nodeB = supervisor.registry.get(agentB.subagentId);
    expect(nodeB?.isolationMode).toBe("branch");
    expect(nodeB?.worktreePath).toBeDefined();

    // Verify worktree exists on disk
    const worktreeStat = await fs.stat(path.resolve(tmpWorkspace, nodeB!.worktreePath!));
    expect(worktreeStat.isDirectory()).toBe(true);
  });

  it("releases file ownership when a subagent is killed", async () => {
    const agentA = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_temporary",
      prompt: "Short task",
      fileOwnership: ["src/index.ts"],
      workspaceIsolation: "inherit",
    });

    // Confirms collision while active
    await expect(
      supervisor.spawnSubagent({
        archetype: "implementer",
        name: "agent_colliding",
        prompt: "Touch index.ts",
        fileOwnership: ["src/index.ts"],
        workspaceIsolation: "inherit",
      })
    ).rejects.toThrow(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_FILE_COLLISION);

    // Kill agentA
    await supervisor.manageSubagents({
      action: "kill",
      subagentId: agentA.subagentId,
    });

    // Now second agent can be spawned without error
    const agentB = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "agent_successor",
      prompt: "Touch index.ts after release",
      fileOwnership: ["src/index.ts"],
      workspaceIsolation: "inherit",
    });

    expect(agentB.subagentId).toBeDefined();
  });
});

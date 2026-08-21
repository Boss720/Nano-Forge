import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DaemonManager } from "./manager.js";
import { executeManageTaskTool, executeScheduleTool } from "./tools.js";

describe("DaemonManager & Tool Execution", () => {
  let manager: DaemonManager;

  beforeEach(() => {
    manager = new DaemonManager();
  });

  afterEach(async () => {
    await manager.dispose();
  });

  it("manages tasks via manageTask and tool handlers", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd" : "node";
    const args = isWindows ? ["/c", "echo hello"] : ["-e", "console.log('hello')"];

    const task = await manager.supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
    });

    // 1. List
    const listRes = await executeManageTaskTool(manager, { action: "list" });
    expect(listRes.success).toBe(true);
    expect(listRes.tasks?.length).toBeGreaterThanOrEqual(1);

    // 2. Status
    const statusRes = await executeManageTaskTool(manager, {
      action: "status",
      taskId: task.taskId,
    });
    expect(statusRes.success).toBe(true);
    expect(statusRes.task?.taskId).toBe(task.taskId);

    // 3. Kill
    const killRes = await executeManageTaskTool(manager, {
      action: "kill",
      taskId: task.taskId,
    });
    expect(killRes.success).toBe(true);
  });

  it("handles schedule tool executions", async () => {
    const result = await executeScheduleTool(manager, {
      prompt: "Notify user of progress",
      durationSeconds: 120,
      timerCondition: "never",
    });

    expect(result.scheduleId).toBeDefined();
    expect(result.type).toBe("one_shot");
    expect(result.status).toBe("active");
  });
});

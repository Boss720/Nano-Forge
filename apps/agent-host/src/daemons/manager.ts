/**
 * Daemon Manager Controller.
 *
 * Implements high-level action handlers for `manage_task` and `schedule`:
 * - manage_task: list, kill, status, send_input
 * - schedule: duration-based timers & 5-field cron schedules
 */
import type {
  ManageTaskParams,
  ManageTaskResult,
  ScheduleParams,
  ScheduleResult,
} from "@protocol/tasks";
import { DaemonSupervisor } from "./supervisor.js";
import { TaskScheduler } from "./scheduler.js";

export class DaemonManager {
  readonly supervisor: DaemonSupervisor;
  readonly scheduler: TaskScheduler;
  readonly workspaceRoot?: string;

  constructor(supervisor?: DaemonSupervisor, scheduler?: TaskScheduler, workspaceRoot?: string) {
    this.supervisor = supervisor ?? new DaemonSupervisor(workspaceRoot);
    this.scheduler = scheduler ?? new TaskScheduler();
    this.workspaceRoot = this.supervisor.workspaceRoot;
  }

  /**
   * Executes `manage_task` actions.
   */
  async manageTask(params: ManageTaskParams): Promise<ManageTaskResult> {
    switch (params.action) {
      case "list": {
        const tasks = this.supervisor.listTasks();
        return {
          action: "list",
          tasks,
          success: true,
          message: `Retrieved ${tasks.length} tasks`,
        };
      }

      case "status": {
        if (!params.taskId) {
          return {
            action: "status",
            success: false,
            message: "Missing required parameter: taskId",
          };
        }
        const task = this.supervisor.getTask(params.taskId);
        if (!task) {
          return {
            action: "status",
            success: false,
            message: `Task not found: ${params.taskId}`,
          };
        }
        return {
          action: "status",
          task,
          success: true,
        };
      }

      case "kill": {
        if (!params.taskId) {
          return {
            action: "kill",
            success: false,
            message: "Missing required parameter: taskId",
          };
        }
        const killResult = await this.supervisor.killTask(params.taskId);
        const task = this.supervisor.getTask(params.taskId);
        return {
          action: "kill",
          task,
          success: killResult.success,
          message: killResult.message ?? (killResult.success ? `Task ${params.taskId} terminated` : "Kill failed"),
        };
      }

      case "send_input": {
        if (!params.taskId) {
          return {
            action: "send_input",
            success: false,
            message: "Missing required parameter: taskId",
          };
        }
        if (params.input === undefined) {
          return {
            action: "send_input",
            success: false,
            message: "Missing required parameter: input",
          };
        }
        const inputResult = await this.supervisor.sendInput(params.taskId, params.input);
        const task = this.supervisor.getTask(params.taskId);
        return {
          action: "send_input",
          task,
          success: inputResult.success,
          message: inputResult.message ?? (inputResult.success ? "Input sent to stdin" : "Failed to send input"),
        };
      }

      default:
        return {
          action: params.action,
          success: false,
          message: `Unsupported action: ${String(params.action)}`,
        };
    }
  }

  /**
   * Executes `schedule` operations.
   */
  async scheduleTask(params: ScheduleParams, creatorSubagentId?: string): Promise<ScheduleResult> {
    return this.scheduler.schedule(params, creatorSubagentId);
  }

  /**
   * Cleans up all managed resources.
   */
  async dispose(): Promise<void> {
    await this.supervisor.killAll();
    this.scheduler.dispose();
  }
}

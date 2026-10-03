/**
 * Tool Execution Sandbox & Security Policy Enforcer.
 *
 * Confines filesystem operations, command executions, and subagent interactions
 * within authorized workspace boundaries, prevents access to sensitive credential
 * files, enforces command risk classifications, and manages tool telemetry.
 */

import path from "node:path";
import {
  type CommandSafetyCategory,
  classifyCommandSafety,
  createToolExecutionResult,
  type ToolExecutionResult,
  type ToolRiskTier,
  classifyToolRisk,
} from "@nanoforge/protocol";
import { ToolOutputPruner } from "@nanoforge/llm-router";
import { resolveWithinWorkspace } from "../policy/policy.js";
import { isSensitiveWorkspacePath } from "../workspace/sensitivePath.js";
import type { CapabilityBroker, CapabilityBinding } from "../capabilities/broker.js";
import type { ApprovalGate, ApprovalRequest } from "../runs/coordinator.js";

export class SecuritySandboxError extends Error {
  constructor(
    readonly code: "OUTSIDE_WORKSPACE" | "SENSITIVE_PATH" | "DANGEROUS_COMMAND" | "UNAUTHORIZED",
    message: string
  ) {
    super(message);
    this.name = "SecuritySandboxError";
  }
}

export interface ToolExecutionSandboxOptions {
  workspaceRoot: string;
  capabilityBroker?: CapabilityBroker;
  approvalGate?: ApprovalGate;
  maxOutputTokens?: number;
  autoApproveSafeCommands?: boolean;
}

export class ToolExecutionSandbox {
  private readonly workspaceRoot: string;
  private readonly capabilityBroker?: CapabilityBroker;
  private readonly approvalGate?: ApprovalGate;
  private readonly maxOutputTokens: number;
  private readonly autoApproveSafeCommands: boolean;

  constructor(options: ToolExecutionSandboxOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.capabilityBroker = options.capabilityBroker;
    this.approvalGate = options.approvalGate;
    this.maxOutputTokens = options.maxOutputTokens ?? 2000;
    this.autoApproveSafeCommands = options.autoApproveSafeCommands ?? true;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Confines and validates a workspace relative path.
   * Rejects path traversal, escapes, and sensitive files.
   */
  confinePath(candidatePath: string): string {
    const fullPath = resolveWithinWorkspace(this.workspaceRoot, candidatePath);
    if (!fullPath) {
      throw new SecuritySandboxError(
        "OUTSIDE_WORKSPACE",
        `Path "${candidatePath}" resolves outside workspace root: ${this.workspaceRoot}`
      );
    }
    const relativeToRoot = path.relative(this.workspaceRoot, fullPath);
    if (isSensitiveWorkspacePath(relativeToRoot)) {
      throw new SecuritySandboxError(
        "SENSITIVE_PATH",
        `Access to sensitive workspace path "${relativeToRoot}" is prohibited`
      );
    }
    return fullPath;
  }

  /**
   * Evaluates command safety against safety heuristics and rules.
   */
  evaluateCommand(
    executable: string,
    args: string[] = []
  ): {
    category: CommandSafetyCategory;
    isAllowed: boolean;
    requiresApproval: boolean;
    reason?: string;
  } {
    const category = classifyCommandSafety(executable, args);
    if (category === "DANGEROUS") {
      return {
        category,
        isAllowed: false,
        requiresApproval: true,
        reason: `Command "${executable} ${args.join(" ")}" contains dangerous patterns or privilege operations`,
      };
    }
    if (category === "MODIFYING") {
      return {
        category,
        isAllowed: this.autoApproveSafeCommands,
        requiresApproval: !this.autoApproveSafeCommands,
        reason: `Command modifies system or repository state`,
      };
    }
    return {
      category: "SAFE",
      isAllowed: true,
      requiresApproval: false,
    };
  }

  /**
   * Consumes a capability grant token if a capability broker is configured.
   */
  async verifyCapabilityGrant(
    token: string,
    binding: CapabilityBinding
  ): Promise<boolean> {
    if (!this.capabilityBroker) return true;
    const result = this.capabilityBroker.consume(token, binding);
    return result.allowed;
  }

  /**
   * Prunes and records output from a tool execution, calculating execution metadata.
   */
  formatResult(params: {
    callId: string;
    toolName: string;
    rawOutput: string;
    status?: "SUCCESS" | "PERMISSION_DENIED" | "EXECUTION_ERROR" | "TIMEOUT" | "CANCELLED";
    durationMs: number;
    exitCode?: number;
    error?: string;
    bytesWritten?: number;
  }): ToolExecutionResult {
    const status = params.status ?? (params.error ? "EXECUTION_ERROR" : "SUCCESS");
    const pruned = ToolOutputPruner.prune(params.rawOutput || "", {
      maxTokens: this.maxOutputTokens,
      headLines: 15,
      tailLines: 15,
    });

    return createToolExecutionResult(
      params.callId,
      params.toolName,
      status,
      pruned.content,
      {
        durationMs: params.durationMs,
        exitCode: params.exitCode ?? (status === "SUCCESS" ? 0 : 1),
        truncated: pruned.isTruncated,
        bytesWritten: params.bytesWritten,
      },
      params.error
    );
  }
}

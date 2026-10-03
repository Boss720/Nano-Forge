/**
 * 4-Tier Risk Matrix, Tool Governance & Execution Result Schemas.
 *
 * Defines the risk classification model, tool proposals, interactive user
 * approval gates, permission evaluation verdicts, and structured tool outcomes.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";
import { type JsonValue, jsonValueSchema } from "./json";

/* ------------------------------------------------------------------ */
/* 1. 4-Tier Risk Matrix                                              */
/* ------------------------------------------------------------------ */

/**
 * 4-tier risk classification:
 * - "T0_READ_ONLY": Non-mutating read operations (view_file, list_dir, grep_search, memory.get).
 * - "T1_WORKSPACE_WRITE": Workspace file mutations inside boundary (write_to_file, replace_file_content).
 * - "T2_SIDE_EFFECT_GUARDED": Process execution or external network calls (terminal.exec, pty.spawn).
 * - "T3_DESTRUCTIVE_ADMIN": Destructive operations, root access, or actions outside workspace.
 */
export const toolRiskTierSchema = z.enum([
  "T0_READ_ONLY",
  "T1_WORKSPACE_WRITE",
  "T2_SIDE_EFFECT_GUARDED",
  "T3_DESTRUCTIVE_ADMIN",
]);
export type ToolRiskTier = z.infer<typeof toolRiskTierSchema>;

export const RISK_TIER_RANK: Readonly<Record<ToolRiskTier, number>> = {
  T0_READ_ONLY: 0,
  T1_WORKSPACE_WRITE: 1,
  T2_SIDE_EFFECT_GUARDED: 2,
  T3_DESTRUCTIVE_ADMIN: 3,
};

/* ------------------------------------------------------------------ */
/* 2. Proposed Tool Call Schema                                       */
/* ------------------------------------------------------------------ */

export const proposedToolCallSchema = z.object({
  callId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  riskTier: toolRiskTierSchema.default("T2_SIDE_EFFECT_GUARDED"),
  params: z.record(z.string(), jsonValueSchema),
  justification: z.string().max(4096).optional(),
  checkpointRequired: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
});
export type ProposedToolCall = z.infer<typeof proposedToolCallSchema>;

/* ------------------------------------------------------------------ */
/* 3. Permission Decisions & Approval Gates                           */
/* ------------------------------------------------------------------ */

export const permissionVerdictSchema = z.enum([
  "ALLOW_ALWAYS",
  "ALLOW_ONCE",
  "DENY",
  "PROMPT_USER",
]);
export type PermissionVerdict = z.infer<typeof permissionVerdictSchema>;

export const permissionDecisionSchema = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("ALLOW_ALWAYS"),
    reason: z.string().max(4096),
    matchedRule: z.string().optional(),
  }),
  z.object({
    verdict: z.literal("ALLOW_ONCE"),
    reason: z.string().max(4096),
  }),
  z.object({
    verdict: z.literal("DENY"),
    reason: z.string().max(4096),
  }),
  z.object({
    verdict: z.literal("PROMPT_USER"),
    promptMessage: z.string().max(4096),
    defaultAction: z.enum(["ALLOW", "DENY"]).default("DENY"),
    suggestedScope: z.string().optional(),
  }),
]);
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

export const approvalRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  toolCall: proposedToolCallSchema,
  reason: z.string().max(4096),
  at: z.string().datetime(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const approvalResponseSchema = z.object({
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128).optional(),
  approved: z.boolean(),
  reason: z.string().max(4096).optional(),
  at: z.string().datetime().optional(),
});
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

/* ------------------------------------------------------------------ */
/* 4. Tool Execution Results & Outcomes                               */
/* ------------------------------------------------------------------ */

export const toolExecutionStatusSchema = z.enum([
  "SUCCESS",
  "PERMISSION_DENIED",
  "EXECUTION_ERROR",
  "TIMEOUT",
  "CANCELLED",
]);
export type ToolExecutionStatus = z.infer<typeof toolExecutionStatusSchema>;

export const toolExecutionMetadataSchema = z.object({
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().nonnegative(),
  bytesWritten: z.number().int().nonnegative().optional(),
  sha256Digest: z.string().optional(),
  truncated: z.boolean().default(false),
  checkpointId: z.string().optional(),
});
export type ToolExecutionMetadata = z.infer<typeof toolExecutionMetadataSchema>;

export const toolExecutionResultSchema = z.object({
  callId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  status: toolExecutionStatusSchema,
  output: z.string(),
  error: z.string().optional(),
  metadata: toolExecutionMetadataSchema,
  timestamp: z.string().datetime(),
});
export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;

/* ------------------------------------------------------------------ */
/* 5. Pure Helper Utilities                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_TOOL_RISK_MAP: Readonly<Record<string, ToolRiskTier>> = {
  view_file: "T0_READ_ONLY",
  list_dir: "T0_READ_ONLY",
  grep_search: "T0_READ_ONLY",
  find_by_name: "T0_READ_ONLY",
  read_url_content: "T0_READ_ONLY",
  search_web: "T0_READ_ONLY",
  "memory.get": "T0_READ_ONLY",
  "memory.query": "T0_READ_ONLY",
  write_to_file: "T1_WORKSPACE_WRITE",
  replace_file_content: "T1_WORKSPACE_WRITE",
  notebook_edit: "T1_WORKSPACE_WRITE",
  generate_image: "T1_WORKSPACE_WRITE",
  "memory.set": "T1_WORKSPACE_WRITE",
  "memory.delete": "T1_WORKSPACE_WRITE",
  run_command: "T2_SIDE_EFFECT_GUARDED",
  "terminal.exec": "T2_SIDE_EFFECT_GUARDED",
  "terminal.create": "T2_SIDE_EFFECT_GUARDED",
  schedule: "T2_SIDE_EFFECT_GUARDED",
  manage_task: "T2_SIDE_EFFECT_GUARDED",
  send_message: "T2_SIDE_EFFECT_GUARDED",
  invoke_subagent: "T2_SIDE_EFFECT_GUARDED",
  system_admin: "T3_DESTRUCTIVE_ADMIN",
  delete_root: "T3_DESTRUCTIVE_ADMIN",
};

export function classifyToolRisk(
  toolName: string,
  defaultTier: ToolRiskTier = "T2_SIDE_EFFECT_GUARDED"
): ToolRiskTier {
  if (Object.prototype.hasOwnProperty.call(DEFAULT_TOOL_RISK_MAP, toolName)) {
    return DEFAULT_TOOL_RISK_MAP[toolName];
  }
  return defaultTier;
}

export function requiresHumanApproval(
  tier: ToolRiskTier,
  autoApproveUpTo: ToolRiskTier = "T0_READ_ONLY"
): boolean {
  return RISK_TIER_RANK[tier] > RISK_TIER_RANK[autoApproveUpTo];
}

export function createProposedToolCall(
  callId: string,
  toolName: string,
  params: Record<string, JsonValue>,
  options?: Partial<Omit<ProposedToolCall, "callId" | "toolName" | "params">>
): ProposedToolCall {
  return {
    callId,
    toolName,
    riskTier: options?.riskTier ?? classifyToolRisk(toolName),
    params,
    justification: options?.justification,
    checkpointRequired: options?.checkpointRequired ?? false,
    timeoutMs: options?.timeoutMs,
  };
}

export function createToolExecutionResult(
  callId: string,
  toolName: string,
  status: ToolExecutionStatus,
  output: string,
  metadata?: Partial<ToolExecutionMetadata>,
  error?: string,
  timestamp = new Date().toISOString()
): ToolExecutionResult {
  return {
    callId,
    toolName,
    status,
    output,
    error,
    metadata: {
      exitCode: metadata?.exitCode !== undefined ? metadata.exitCode : (status === "SUCCESS" ? 0 : 1),
      durationMs: metadata?.durationMs ?? 0,
      bytesWritten: metadata?.bytesWritten,
      sha256Digest: metadata?.sha256Digest,
      truncated: metadata?.truncated ?? false,
      checkpointId: metadata?.checkpointId,
    },
    timestamp,
  };
}

export function isToolExecutionSuccessful(result: ToolExecutionResult): boolean {
  return result.status === "SUCCESS";
}

/* ------------------------------------------------------------------ */
/* 6. Model Context Protocol (MCP) Normalized Schemas & Tools         */
/* ------------------------------------------------------------------ */

export const mcpToolDefinitionSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(4096),
  inputSchema: z.record(z.string(), z.unknown()),
});
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export const mcpToolCallParamsSchema = z.object({
  name: z.string().min(1).max(128),
  arguments: z.record(z.string(), jsonValueSchema).default({}),
});
export type McpToolCallParams = z.infer<typeof mcpToolCallParamsSchema>;

export const mcpToolCallResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
  isError: z.boolean().optional(),
});
export type McpToolCallResult = z.infer<typeof mcpToolCallResultSchema>;

/* ------------------------------------------------------------------ */
/* 7. Terminal Command Safety Classification                          */
/* ------------------------------------------------------------------ */

export const commandSafetyCategorySchema = z.enum([
  "SAFE",
  "MODIFYING",
  "DANGEROUS",
]);
export type CommandSafetyCategory = z.infer<typeof commandSafetyCategorySchema>;

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f*|-rf|-fr)\b/i,
  /\bdel\s+\/[sfq]/i,
  /\bformat\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bsudo\b/i,
  /\bcurl\b.*\|\s*(bash|sh|powershell|cmd)/i,
  /\bwget\b.*\|\s*(bash|sh|powershell|cmd)/i,
  /(^|[\s/\\"'`])(id_rsa|\.ssh|\.gnupg|\.aws|\.env[._a-zA-Z0-9-]*)/i,
  /\b(mkfs|dd\s+if=)/i,
  /\bdrop\s+database\b/i,
];

const MODIFYING_COMMANDS = [
  "npm install", "npm i", "npm add", "npm remove", "npm uninstall", "npm update",
  "pnpm install", "pnpm i", "pnpm add", "pnpm remove", "pnpm uninstall", "pnpm update",
  "yarn add", "yarn remove", "yarn install",
  "git checkout", "git switch", "git commit", "git merge", "git rebase", "git reset",
  "git pull", "git push", "git stash", "git apply", "git cherry-pick",
];

export function classifyCommandSafety(executable: string, args: string[] = []): CommandSafetyCategory {
  const fullCommand = [executable, ...args].join(" ").trim();
  const exeBase = executable.toLowerCase().replace(/\\/g, "/").split("/").pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, "") || "";

  // 1. Dangerous pattern check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(fullCommand)) {
      return "DANGEROUS";
    }
  }

  // 2. Modifying command check
  for (const mod of MODIFYING_COMMANDS) {
    if (fullCommand.toLowerCase().startsWith(mod) || fullCommand.toLowerCase().includes(` ${mod} `)) {
      return "MODIFYING";
    }
  }

  // Git specific checks
  if (exeBase === "git") {
    const sub = (args[0] || "").toLowerCase();
    if (["status", "diff", "log", "show", "branch", "rev-parse", "describe", "tag", "help"].includes(sub)) {
      return "SAFE";
    }
    if (["checkout", "switch", "commit", "merge", "rebase", "reset", "stash", "clean", "cherry-pick"].includes(sub)) {
      return "MODIFYING";
    }
    if (["push", "filter-branch"].includes(sub)) {
      return "DANGEROUS";
    }
  }

  // Node/npm/pnpm/npx specific checks
  if (exeBase === "npm" || exeBase === "pnpm" || exeBase === "npx") {
    const sub = (args[0] || "").toLowerCase();
    const second = (args[1] || "").toLowerCase();
    if (sub === "test" || sub === "--version" || sub === "-v") {
      return "SAFE";
    }
    if (sub === "run" && ["test", "lint", "typecheck", "build", "check"].includes(second)) {
      return "SAFE";
    }
    if (["install", "i", "add", "update", "remove", "uninstall", "audit"].includes(sub)) {
      return "MODIFYING";
    }
  }

  if (exeBase === "tsc" || exeBase === "vitest" || exeBase === "eslint") {
    return "SAFE";
  }

  if (["ls", "dir", "pwd", "echo", "cat", "type", "head", "tail", "wc"].includes(exeBase)) {
    return "SAFE";
  }

  // Default for unrecognized commands
  return "MODIFYING";
}

/* ------------------------------------------------------------------ */
/* 8. Builtin MCP Tool Catalog Definition                             */
/* ------------------------------------------------------------------ */

export const BUILTIN_MCP_TOOLS: readonly McpToolDefinition[] = Object.freeze([
  {
    name: "read_file",
    description: "Read the textual content of a file within the workspace boundary with optional line ranges.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative workspace path to read" },
        startLine: { type: "integer", description: "1-indexed starting line number" },
        endLine: { type: "integer", description: "1-indexed ending line number (inclusive)" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite the content of a file within the workspace boundary.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative workspace path to write" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "replace_file_content",
    description: "Replace a targeted substring or block of lines within an existing file in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative workspace path to edit" },
        targetContent: { type: "string", description: "Exact character sequence to match and replace" },
        replacementContent: { type: "string", description: "New replacement content" },
        startLine: { type: "integer", description: "Optional starting line boundary for search window" },
        endLine: { type: "integer", description: "Optional ending line boundary for search window" },
      },
      required: ["path", "targetContent", "replacementContent"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file in the workspace. Fails if the file already exists unless overwrite is true.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative workspace path to create" },
        content: { type: "string", description: "Content for the new file" },
        overwrite: { type: "boolean", description: "Whether to overwrite if existing", default: false },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and subdirectories within a workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative workspace directory path", default: "." },
      },
    },
  },
  {
    name: "search_files",
    description: "Search for files within the workspace by glob or filename pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob or filename pattern to search for" },
        path: { type: "string", description: "Base directory path to search from", default: "." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_text",
    description: "Search file contents across the workspace using ripgrep with optional path filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or pattern to search for" },
        path: { type: "string", description: "Base directory to search within", default: "." },
        caseSensitive: { type: "boolean", description: "Case-sensitive search", default: false },
        includes: { type: "array", items: { type: "string" }, description: "Glob patterns of files to include" },
      },
      required: ["query"],
    },
  },
  {
    name: "git_status",
    description: "Inspect git working tree status and pending modifications.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "git_diff",
    description: "Inspect git diff for unstaged or staged changes within the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional specific file or directory path" },
        staged: { type: "boolean", description: "Whether to view staged changes", default: false },
      },
    },
  },
  {
    name: "run_command",
    description: "Execute a shell or terminal command confined to the workspace. Subject to command safety policy.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command executable to invoke" },
        args: { type: "array", items: { type: "string" }, description: "Command arguments", default: [] },
        cwd: { type: "string", description: "Working directory relative to workspace root", default: "." },
      },
      required: ["command"],
    },
  },
  {
    name: "run_tests",
    description: "Run test suites across the workspace with optional filter.",
    inputSchema: {
      type: "object",
      properties: {
        testFilter: { type: "string", description: "Optional test filename or name pattern filter" },
      },
    },
  },
]);

export function getBuiltinMcpTool(name: string): McpToolDefinition | undefined {
  return BUILTIN_MCP_TOOLS.find((tool) => tool.name === name);
}


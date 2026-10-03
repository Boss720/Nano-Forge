/**
 * Unified Model Context Protocol (MCP) Tool Registry.
 *
 * Normalizes builtin coding tools and external MCP server tools into
 * standard MCP tool definitions ({ name, description, inputSchema }),
 * executing all invocations safely inside ToolExecutionSandbox.
 */

import {
  type McpToolDefinition,
  type McpToolCallResult,
  type ToolExecutionResult,
  BUILTIN_MCP_TOOLS,
  getBuiltinMcpTool,
} from "@nanoforge/protocol";
import { ToolExecutionSandbox, SecuritySandboxError } from "./sandbox.js";
import { BuiltinToolAdapter } from "./builtinAdapter.js";
import { WorkspaceFileError } from "../workspace/filesystem.js";

export interface McpToolHandler {
  (args: Record<string, unknown>, callId: string): Promise<unknown>;
}

export interface UnifiedMcpRegistryOptions {
  sandbox: ToolExecutionSandbox;
  adapter?: BuiltinToolAdapter;
}

export class UnifiedMcpToolRegistry {
  private readonly sandbox: ToolExecutionSandbox;
  private readonly adapter: BuiltinToolAdapter;
  private readonly tools = new Map<string, McpToolDefinition>();
  private readonly handlers = new Map<string, McpToolHandler>();

  constructor(options: UnifiedMcpRegistryOptions) {
    this.sandbox = options.sandbox;
    this.adapter = options.adapter ?? new BuiltinToolAdapter({ sandbox: this.sandbox });
    this.registerBuiltins();
  }

  getSandbox(): ToolExecutionSandbox {
    return this.sandbox;
  }

  getAdapter(): BuiltinToolAdapter {
    return this.adapter;
  }

  /**
   * Registers all standard builtin tools with their MCP definitions and handlers.
   */
  private registerBuiltins(): void {
    for (const tool of BUILTIN_MCP_TOOLS) {
      this.tools.set(tool.name, tool);
    }

    // Register handlers
    this.handlers.set("read_file", async (args) => {
      return this.adapter.readFile(args as any);
    });

    this.handlers.set("write_file", async (args) => {
      return this.adapter.writeFile(args as any);
    });

    this.handlers.set("replace_file_content", async (args) => {
      return this.adapter.replaceFileContent(args as any);
    });

    this.handlers.set("create_file", async (args) => {
      return this.adapter.createFile(args as any);
    });

    this.handlers.set("list_directory", async (args) => {
      return this.adapter.listDirectory(args as any);
    });

    this.handlers.set("search_files", async (args) => {
      return this.adapter.searchFiles(args as any);
    });

    this.handlers.set("search_text", async (args) => {
      return this.adapter.searchText(args as any);
    });

    this.handlers.set("git_status", async () => {
      return this.adapter.gitStatus();
    });

    this.handlers.set("git_diff", async (args) => {
      return this.adapter.gitDiff(args as any);
    });

    this.handlers.set("run_command", async (args) => {
      return this.adapter.runCommand(args as any);
    });

    this.handlers.set("run_tests", async (args) => {
      return this.adapter.runTests(args as any);
    });
  }

  /**
   * Register a custom tool or external MCP tool.
   */
  registerTool(definition: McpToolDefinition, handler: McpToolHandler): void {
    if (!definition || !definition.name) {
      throw new Error("Invalid MCP tool definition: missing name.");
    }
    this.tools.set(definition.name, definition);
    this.handlers.set(definition.name, handler);
  }

  /**
   * List all registered tools in MCP standard schema format.
   */
  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Lookup a tool definition by name.
   */
  getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Dispatches and executes an MCP tool call within the sandbox.
   * Returns structured ToolExecutionResult with telemetry.
   */
  async executeTool(
    name: string,
    args: Record<string, unknown> = {},
    callId = `call_${Date.now()}`
  ): Promise<ToolExecutionResult> {
    const startMs = Date.now();
    const handler = this.handlers.get(name);

    if (!handler) {
      return this.sandbox.formatResult({
        callId,
        toolName: name,
        rawOutput: `Tool "${name}" is not registered in MCP registry.`,
        status: "EXECUTION_ERROR",
        durationMs: Date.now() - startMs,
        exitCode: 1,
        error: `Tool "${name}" not found`,
      });
    }

    try {
      const output = await handler(args, callId);
      const durationMs = Date.now() - startMs;

      let rawOutput: string;
      let bytesWritten: number | undefined;

      if (typeof output === "string") {
        rawOutput = output;
      } else if (typeof output === "object" && output !== null) {
        if ("bytesWritten" in output && typeof (output as any).bytesWritten === "number") {
          bytesWritten = (output as any).bytesWritten;
        }
        if ("stdout" in output && typeof (output as any).stdout === "string") {
          rawOutput = (output as any).stdout;
          if ((output as any).stderr) {
            rawOutput += `\n[stderr]\n${(output as any).stderr}`;
          }
        } else {
          rawOutput = JSON.stringify(output, null, 2);
        }
      } else {
        rawOutput = String(output ?? "");
      }

      return this.sandbox.formatResult({
        callId,
        toolName: name,
        rawOutput,
        status: "SUCCESS",
        durationMs,
        exitCode: 0,
        bytesWritten,
      });
    } catch (err: any) {
      const durationMs = Date.now() - startMs;
      const isSecurityError =
        err instanceof SecuritySandboxError ||
        (err instanceof WorkspaceFileError && err.code === "path_outside_workspace");
      const isConflictError = err instanceof WorkspaceFileError && err.code === "write_conflict";

      const status = isSecurityError ? "PERMISSION_DENIED" : "EXECUTION_ERROR";
      const exitCode = isSecurityError ? 126 : isConflictError ? 49 : 1;

      return this.sandbox.formatResult({
        callId,
        toolName: name,
        rawOutput: `Tool execution failed: ${err.message || String(err)}`,
        status,
        durationMs,
        exitCode,
        error: err.message || String(err),
      });
    }
  }

  /**
   * Formats tool execution result into standard MCP response object.
   */
  formatMcpResponse(result: ToolExecutionResult): McpToolCallResult {
    return {
      content: [
        {
          type: "text",
          text: result.output,
        },
      ],
      isError: result.status !== "SUCCESS",
    };
  }
}

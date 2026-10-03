/**
 * Builtin Tool Adapters for NanoForge Workspace Operations.
 *
 * Implements deterministic coding tools matching the MCP standard,
 * executing within the ToolExecutionSandbox.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import {
  handleReadDir,
  handleReadFile,
  handleWriteFile,
  handleSearch,
  handleGitStatus,
  WorkspaceFileError,
} from "../workspace/filesystem.js";
import { ToolExecutionSandbox, SecuritySandboxError } from "./sandbox.js";
import type { SubagentSupervisor } from "../agents/supervisor.js";
import type { SharedMemoryEngine } from "../agents/memory.js";

export interface BuiltinAdapterOptions {
  sandbox: ToolExecutionSandbox;
  supervisor?: SubagentSupervisor;
  memoryEngine?: SharedMemoryEngine;
}

export class BuiltinToolAdapter {
  private readonly sandbox: ToolExecutionSandbox;
  private readonly supervisor?: SubagentSupervisor;
  private readonly memoryEngine?: SharedMemoryEngine;

  constructor(options: BuiltinAdapterOptions) {
    this.sandbox = options.sandbox;
    this.supervisor = options.supervisor;
    this.memoryEngine = options.memoryEngine;
  }

  getSandbox(): ToolExecutionSandbox {
    return this.sandbox;
  }

  async readFile(params: { path: string; startLine?: number; endLine?: number }): Promise<{
    content: string;
    language: string;
    size: number;
    lines: number;
    sha256: string;
  }> {
    const fullPath = this.sandbox.confinePath(params.path);
    const relPath = path.relative(this.sandbox.getWorkspaceRoot(), fullPath);
    const result = await handleReadFile(this.sandbox.getWorkspaceRoot(), relPath);

    let content = result.content;
    const allLines = content.split("\n");
    const totalLines = allLines.length;

    if (params.startLine !== undefined || params.endLine !== undefined) {
      const start = Math.max(1, params.startLine ?? 1);
      const end = Math.min(totalLines, params.endLine ?? totalLines);
      if (start <= end) {
        content = allLines.slice(start - 1, end).join("\n");
      }
    }

    return {
      content,
      language: result.language,
      size: result.size,
      lines: totalLines,
      sha256: result.sha256,
    };
  }

  async writeFile(params: { path: string; content: string }): Promise<{
    success: boolean;
    path: string;
    bytesWritten: number;
    sha256: string;
  }> {
    const fullPath = this.sandbox.confinePath(params.path);
    const relPath = path.relative(this.sandbox.getWorkspaceRoot(), fullPath);
    const result = await handleWriteFile(this.sandbox.getWorkspaceRoot(), relPath, params.content);

    return {
      success: true,
      path: relPath,
      bytesWritten: result.size,
      sha256: result.sha256,
    };
  }

  async createFile(params: { path: string; content: string; overwrite?: boolean }): Promise<{
    success: boolean;
    path: string;
    bytesWritten: number;
    sha256: string;
  }> {
    const fullPath = this.sandbox.confinePath(params.path);
    const relPath = path.relative(this.sandbox.getWorkspaceRoot(), fullPath);

    // If file already exists and overwrite is false, throw conflict
    try {
      await fs.stat(fullPath);
      if (!params.overwrite) {
        throw new WorkspaceFileError(
          "write_conflict",
          `File "${params.path}" already exists. Set overwrite: true to replace.`
        );
      }
    } catch (err: any) {
      if (err.code !== "ENOENT" && !(err instanceof WorkspaceFileError)) {
        throw err;
      }
      if (err instanceof WorkspaceFileError) {
        throw err;
      }
    }

    const result = await handleWriteFile(this.sandbox.getWorkspaceRoot(), relPath, params.content);
    return {
      success: true,
      path: relPath,
      bytesWritten: result.size,
      sha256: result.sha256,
    };
  }

  async replaceFileContent(params: {
    path: string;
    targetContent: string;
    replacementContent: string;
    startLine?: number;
    endLine?: number;
  }): Promise<{
    success: boolean;
    path: string;
    linesChanged: number;
    sha256: string;
  }> {
    const fullPath = this.sandbox.confinePath(params.path);
    const relPath = path.relative(this.sandbox.getWorkspaceRoot(), fullPath);
    const current = await handleReadFile(this.sandbox.getWorkspaceRoot(), relPath);

    const originalContent = current.content;
    let newContent: string;

    if (params.startLine !== undefined || params.endLine !== undefined) {
      const lines = originalContent.split("\n");
      const start = Math.max(1, params.startLine ?? 1) - 1;
      const end = Math.min(lines.length, params.endLine ?? lines.length);

      const targetWindow = lines.slice(start, end).join("\n");
      if (!targetWindow.includes(params.targetContent)) {
        throw new WorkspaceFileError(
          "write_conflict",
          `Target content was not found within specified line range [${params.startLine ?? 1}, ${params.endLine ?? lines.length}]`
        );
      }

      const replacedWindow = targetWindow.replace(params.targetContent, params.replacementContent);
      const newLines = [
        ...lines.slice(0, start),
        ...replacedWindow.split("\n"),
        ...lines.slice(end),
      ];
      newContent = newLines.join("\n");
    } else {
      if (!originalContent.includes(params.targetContent)) {
        throw new WorkspaceFileError("write_conflict", `Target content not found in file: ${params.path}`);
      }
      newContent = originalContent.replace(params.targetContent, params.replacementContent);
    }

    const writeResult = await handleWriteFile(this.sandbox.getWorkspaceRoot(), relPath, newContent);
    return {
      success: true,
      path: relPath,
      linesChanged: Math.abs(newContent.split("\n").length - originalContent.split("\n").length) + 1,
      sha256: writeResult.sha256,
    };
  }

  async listDirectory(params: { path?: string }): Promise<Array<{
    name: string;
    isDir: boolean;
    size?: number;
    modified?: string;
  }>> {
    const target = params.path && params.path.trim() ? params.path : ".";
    const fullPath = this.sandbox.confinePath(target);
    const relPath = path.relative(this.sandbox.getWorkspaceRoot(), fullPath);
    return handleReadDir(this.sandbox.getWorkspaceRoot(), relPath);
  }

  async searchFiles(params: { pattern: string; path?: string }): Promise<string[]> {
    const basePath = params.path && params.path.trim() ? params.path : ".";
    const fullBasePath = this.sandbox.confinePath(basePath);
    const matches: string[] = [];

    const walk = async (currentDir: string): Promise<void> => {
      let entries: Array<{ name: string; isDir: boolean }>;
      try {
        const relDir = path.relative(this.sandbox.getWorkspaceRoot(), currentDir);
        entries = await handleReadDir(this.sandbox.getWorkspaceRoot(), relDir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullEntryPath = path.join(currentDir, entry.name);
        const relEntryPath = path.relative(this.sandbox.getWorkspaceRoot(), fullEntryPath).replace(/\\/g, "/");

        const normalizedPattern = params.pattern.toLowerCase();
        if (
          entry.name.toLowerCase().includes(normalizedPattern) ||
          relEntryPath.toLowerCase().includes(normalizedPattern)
        ) {
          matches.push(relEntryPath);
          if (matches.length >= 100) return;
        }

        if (entry.isDir) {
          await walk(fullEntryPath);
          if (matches.length >= 100) return;
        }
      }
    };

    await walk(fullBasePath);
    return matches;
  }

  async searchText(params: {
    query: string;
    path?: string;
    caseSensitive?: boolean;
    includes?: string[];
  }) {
    return handleSearch(this.sandbox.getWorkspaceRoot(), params.query, {
      caseSensitive: params.caseSensitive,
      includes: params.includes,
    });
  }

  async gitStatus() {
    return handleGitStatus(this.sandbox.getWorkspaceRoot());
  }

  async gitDiff(params: { path?: string; staged?: boolean }): Promise<string> {
    const args = ["-C", this.sandbox.getWorkspaceRoot(), "diff"];
    if (params.staged) {
      args.push("--staged");
    }
    if (params.path) {
      const fullPath = this.sandbox.confinePath(params.path);
      const relPath = path.relative(this.sandbox.getWorkspaceRoot(), fullPath);
      args.push("--", relPath);
    }

    try {
      const { stdout } = await execa("git", args, { reject: false });
      return stdout || "(No diff)";
    } catch (err: any) {
      return `git diff error: ${err.message || String(err)}`;
    }
  }

  async runCommand(params: {
    command: string;
    args?: string[];
    cwd?: string;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args = params.args ?? [];
    const evaluation = this.sandbox.evaluateCommand(params.command, args);

    if (!evaluation.isAllowed) {
      throw new SecuritySandboxError(
        "DANGEROUS_COMMAND",
        evaluation.reason || `Execution of "${params.command}" was denied by security policy.`
      );
    }

    const cwdCandidate = params.cwd ?? ".";
    const fullCwd = this.sandbox.confinePath(cwdCandidate);

    const result = await execa(params.command, args, {
      cwd: fullCwd,
      reject: false,
      timeout: 60_000,
    });

    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? 0,
    };
  }

  async runTests(params: { testFilter?: string }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const args = ["test"];
    if (params.testFilter) {
      args.push("--", params.testFilter);
    }

    const result = await execa("npm", args, {
      cwd: this.sandbox.getWorkspaceRoot(),
      reject: false,
      timeout: 120_000,
    });

    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? 0,
    };
  }
}

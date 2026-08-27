/**
 * Live WebSocket session composition for the local agent host.
 *
 * This is deliberately host-side: client frames are requests only.  Model
 * proposals still pass through RunCoordinator's policy and approval seams,
 * while workspace writes remain disabled unless the embedding application
 * opts in to a reviewed write flow.
 */
import path from "node:path";
import type { WorkspaceDescriptor, WorkspaceErrorCode } from "@protocol/workspace";
import type { ExecutionPlan } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
import {
  commandExecuteFrameSchema,
  type CommandExecuteFrame,
  type CommandResultFrame,
} from "@protocol/commands";
import { z } from "zod";
import {
  invokeSubagentParamsSchema,
  manageSubagentsParamsSchema,
  sendMessageParamsSchema,
  type ManageSubagentsAction,
} from "@protocol/subagents";
import {
  safeParseTerminalClientMessage,
  type TerminalServerMessage,
} from "@protocol/terminal";
import type { WebSocket } from "ws";
import { AuditStore } from "./audit/store";
import {
  decodeClientMessage,
  type ClientMessage,
  type HostMessage,
} from "./protocol";
import { loadPolicy } from "./policy/policy";
import { OpenAICompatibleAdapter } from "./providers/openaiCompatible";
import { InMemoryProviderRegistry } from "./providers/registry";
import { RunCoordinator, bindRouter, type ApprovalGate, type ApprovalOutcome, type ApprovalRequest } from "./runs/coordinator";
import { RunEventLog, type RunEvent } from "./runs/events";
import { runTerminalJob } from "./terminal/runner";
import { PtyManager } from "./terminal/ptyManager";
import {
  handleGitStatus,
  handleReadDir,
  handleReadFile,
  handleSearch,
  handleStat,
  handleWriteFile,
} from "./workspace/filesystem";
import { createWorkspaceWatcher } from "./workspace/watcher.js";
import { assertWorkspaceGeneration, validateWorkspaceRoot, WorkspaceRootError } from "./workspace/runtime.js";
import { WorkspaceFileError } from "./workspace/filesystem.js";
import { SubagentSupervisor } from "./agents/supervisor.js";
import { DaemonManager } from "./daemons/manager.js";
import { SharedMemoryEngine } from "./agents/memory.js";

export interface AgentSessionOptions {
  workspaceRoot?: string;
  workspaceDescriptor?: WorkspaceDescriptor;
  /**
   * Disabled by default. Direct browser-originated writes need a separate
   * diff/approval workflow; enabling this is only for trusted embeddings.
   */
  allowWorkspaceWrites?: boolean;
  /** Provider configuration is read only in the privileged host process. */
  provider?: {
    id?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  /** Virtual PTY manager instance for interactive terminal sessions. */
  ptyManager?: PtyManager;
  /** Subagent supervisor instance. */
  subagentSupervisor?: SubagentSupervisor;
  /** Daemon task manager instance. */
  daemonManager?: DaemonManager;
  /** Shared memory engine instance. */
  memoryEngine?: SharedMemoryEngine;
}

type Send = (message: HostMessage | TerminalServerMessage | CommandResultFrame) => void;

class SocketApprovalGate implements ApprovalGate {
  private readonly pending = new Map<string, (outcome: ApprovalOutcome) => void>();

  constructor(private readonly send: Send, private readonly now: () => string) {}

  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const requestId = request.runId + ":" + request.stepId + ":" + request.tool;
    this.send({
      type: "tool.approval_required",
      requestId,
      runId: request.runId,
      request: request.request,
      reason: request.reason,
      at: this.now(),
    });
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  resolve(
    requestId: string,
    approved: boolean,
    reason?: string,
    runId?: string,
    stepId?: string,
  ): boolean {
    let keyToResolve: string | undefined;
    if (this.pending.has(requestId)) {
      keyToResolve = requestId;
    } else if (runId && stepId) {
      const prefix = `${runId}:${stepId}`;
      for (const key of this.pending.keys()) {
        if (key === prefix || key.startsWith(prefix + ":")) {
          keyToResolve = key;
          break;
        }
      }
    } else {
      for (const key of this.pending.keys()) {
        if (key === requestId || key.startsWith(requestId + ":")) {
          keyToResolve = key;
          break;
        }
      }
    }

    if (!keyToResolve) return false;
    const resolve = this.pending.get(keyToResolve);
    if (!resolve) return false;
    this.pending.delete(keyToResolve);
    resolve(approved ? { outcome: "granted" } : { outcome: "denied", ...(reason ? { reason } : {}) });
    return true;
  }

  close(): void {
    for (const resolve of this.pending.values()) {
      resolve({ outcome: "denied", reason: "client disconnected" });
    }
    this.pending.clear();
  }
}

const profileFor = (providerId: string, model: string): ModelProfile => ({
  id: model,
  provider: providerId,
  capabilities: { planning: 1, coding: 1, vision: 0, toolCalling: 1 },
  costPer1kInputTokens: 0,
  costPer1kOutputTokens: 0,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 2_000,
});

const stateForEvent = (event: RunEvent): "done" | "error" | "cancelled" | undefined => {
  switch (event.type) {
    case "run.completed": return "done";
    case "run.cancelled": return "cancelled";
    case "run.failed":
    case "run.halted": return "error";
    default: return undefined;
  }
};

type CommandSupervisor = Pick<SubagentSupervisor, "spawnSubagent" | "manageSubagents" | "sendMessage">;

const commandResult = (
  frame: CommandExecuteFrame,
  result: Omit<CommandResultFrame, "type" | "command" | "requestId">,
): CommandResultFrame => ({
  type: "command.result",
  command: frame.command,
  requestId: frame.requestId,
  ...result,
});

const flagString = (flags: Record<string, string | number | boolean>, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
};

export function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const pathStr = issue.path.length > 0 ? issue.path.join(".") : "parameter";
      return `${pathStr}: ${issue.message}`;
    })
    .join("; ");
}

export function serializeZodIssues(issues: z.ZodIssue[]): Array<{ path: string; message: string; code: string }> {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Dispatches the swarm slash-command subset through the supervisor API. This
 * function is exported and dependency-injected so transport tests can verify
 * command semantics without opening a socket or constructing a supervisor.
 */
export async function dispatchCommand(
  frame: CommandExecuteFrame,
  supervisor: CommandSupervisor,
): Promise<CommandResultFrame> {
  const rawCommand = frame.command.trim().toLowerCase();
  const flags = frame.parsed?.flags ?? {};
  const positional = [...(frame.parsed?.positional ?? frame.args ?? [])];
  const aliasActions: Record<string, string> = {
    "/agent-list": "list",
    "/agent-tree": "tree",
    "/agent-inspect": "inspect",
    "/agent-message": "message",
    "/agent-pause": "pause",
    "/agent-resume": "resume",
    "/agent-stop": "stop",
    "/agent-focus": "focus",
  };
  const command = rawCommand === "/sw" || rawCommand === "/agents" || rawCommand === "/agent" || rawCommand === "/a" || aliasActions[rawCommand]
    ? "/swarm"
    : rawCommand;
  if (aliasActions[rawCommand]) positional.unshift(aliasActions[rawCommand]);
  else if (rawCommand === "/agents" && positional.length === 0) positional.unshift("list");
  const embeddedAction = command.startsWith("/swarm.") ? command.slice("/swarm.".length) : undefined;
  const action = (embeddedAction ?? positional[0] ?? "").toLowerCase();

  if (command !== "/swarm" && !embeddedAction) {
    return commandResult(frame, {
      success: false,
      error: `Unsupported command: ${frame.command}`,
      data: { code: "unsupported_command" },
    });
  }

  try {
    switch (action) {
      case "run": {
        const archetype = flagString(flags, "archetype", "type") ?? "custom";
        const prompt = flagString(flags, "prompt") ?? (embeddedAction ? positional.join(" ") : positional.slice(1).join(" "));
        if (!prompt || !prompt.trim()) {
          return commandResult(frame, {
            success: false,
            error: "swarm run requires a prompt",
            data: { code: "invalid_command" },
          });
        }
        const name = flagString(flags, "name");
        const roles = flagString(flags, "roles")?.split(",").map((role) => role.trim()).filter(Boolean);
        const isolation = flagString(flags, "workspaceIsolation", "isolation");
        const timeoutValue = flags.timeoutSeconds ?? flags.timeout;
        const budgetValue = flags.budgetTokens ?? flags.budget;
        const skills = flagString(flags, "skills")?.split(",").map((s) => s.trim()).filter(Boolean);
        const model = flagString(flags, "model");

        const rawRunParams = {
          archetype,
          prompt: prompt.trim(),
          ...(name ? { name } : {}),
          ...(roles?.length ? { roles } : {}),
          ...(isolation ? { workspaceIsolation: isolation } : {}),
          ...(typeof timeoutValue === "number" ? { timeoutSeconds: timeoutValue } : {}),
          ...(typeof budgetValue === "number" ? { budgetTokens: budgetValue } : {}),
          ...(skills?.length ? { skills } : {}),
          ...(model ? { model } : {}),
        };

        const parseResult = invokeSubagentParamsSchema.safeParse(rawRunParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm run arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.spawnSubagent(
          parseResult.data,
          flagString(flags, "parentId", "parent"),
        );
        return commandResult(frame, {
          success: true,
          output: `Started subagent ${result.name} (${result.subagentId})`,
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "list":
      case "tree": {
        const recursiveVal = typeof flags.recursive === "boolean" ? flags.recursive : undefined;
        const rawListParams = {
          action: "list" as const,
          ...(recursiveVal !== undefined ? { recursive: recursiveVal } : {}),
        };

        const parseResult = manageSubagentsParamsSchema.safeParse(rawListParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm ${action} arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.manageSubagents(parseResult.data, flagString(flags, "callerId", "caller"));
        return commandResult(frame, {
          success: result.success,
          ...(result.message ? { output: result.message } : {}),
          ...(result.message && !result.success ? { error: result.message } : {}),
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "inspect": {
        const subagentId = flagString(flags, "subagentId", "agent", "id") ?? frame.parsed?.mentions?.agents?.[0] ?? (embeddedAction ? positional[0] : positional[1]);
        if (!subagentId) {
          return commandResult(frame, { success: false, error: "swarm inspect requires a subagent id", data: { code: "invalid_command" } });
        }
        const fileParam = flagString(flags, "file", "inspectFile") ?? (embeddedAction ? positional[1] : positional[2]);
        const rawInspectParams = {
          action: "inspect" as const,
          subagentId,
          ...(fileParam ? { inspectFile: fileParam } : {}),
        };

        const parseResult = manageSubagentsParamsSchema.safeParse(rawInspectParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm inspect arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.manageSubagents(parseResult.data);
        return commandResult(frame, {
          success: result.success,
          ...(result.inspectedContent ? { output: result.inspectedContent } : {}),
          ...(result.message ? { error: result.message } : {}),
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "message": {
        if (!supervisor.sendMessage) {
          return commandResult(frame, { success: false, error: "Host does not support swarm messages", data: { code: "unsupported_capability" } });
        }
        const recipientId = flagString(flags, "recipientId", "recipient", "agent") ?? frame.parsed?.mentions?.agents?.[0] ?? (embeddedAction ? positional[0] : positional[1]);
        const body = flagString(flags, "body") ?? (embeddedAction ? positional.slice(1).join(" ") : positional.slice(2).join(" "));
        if (!recipientId || !body || !body.trim()) {
          return commandResult(frame, { success: false, error: "swarm message requires a recipient and body", data: { code: "invalid_command" } });
        }
        const rawMessageParams = {
          recipientId,
          subject: flagString(flags, "subject") ?? "Direct Message",
          body: body.trim(),
          priority: flagString(flags, "priority") ?? "normal",
          referencedArtifacts: [],
        };

        const parseResult = sendMessageParamsSchema.safeParse(rawMessageParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm message arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.sendMessage(
          parseResult.data,
          flagString(flags, "senderId", "sender") ?? "root",
        );
        return commandResult(frame, {
          success: true,
          output: `Message ${result.messageId} delivered`,
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "pause":
      case "resume":
      case "stop": {
        const subagentId = flagString(flags, "subagentId", "agent", "id") ?? frame.parsed?.mentions?.agents?.[0] ?? (embeddedAction ? positional[0] : positional[1]);
        if (!subagentId) {
          return commandResult(frame, { success: false, error: `swarm ${action} requires a subagent id`, data: { code: "invalid_command" } });
        }
        const rawManageParams = {
          action: (action === "stop" ? "kill" : action) as ManageSubagentsAction,
          subagentId,
          ...(action === "stop" ? { recursive: flags.recursive !== false } : {}),
        };

        const parseResult = manageSubagentsParamsSchema.safeParse(rawManageParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm ${action} arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.manageSubagents(parseResult.data);
        return commandResult(frame, {
          success: result.success,
          ...(result.success ? { output: result.message } : { error: result.message ?? `swarm ${action} failed` }),
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      default:
        return commandResult(frame, { success: false, error: `Unsupported swarm action: ${action || "(missing)"}`, data: { code: "unsupported_action" } });
    }
  } catch (error) {
    return commandResult(frame, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: { code: "command_dispatch_error" },
    });
  }
}

const parseCommandFrame = (raw: unknown): CommandExecuteFrame | null => {
  let parsed: unknown = raw;
  if (typeof raw === "string" || raw instanceof Buffer || Array.isArray(raw)) {
    try { parsed = JSON.parse(String(raw)); } catch { return null; }
  }
  const result = commandExecuteFrameSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/** Attach a fully composed coordinator + workspace RPC session to one socket. */
export function attachAgentSession(
  socket: WebSocket,
  context: { hostId: string },
  options: AgentSessionOptions = {},
): void {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const workspace = options.workspaceDescriptor;
  if (!workspace) {
    throw new Error("Agent session requires a validated workspace descriptor");
  }
  const generation = workspace.generation;
  const now = () => new Date().toISOString();
  const send: Send = (message) => {
    const payload = JSON.stringify(message);
    if (socket.readyState === 1) socket.send(payload);
    else socket.once("open", () => socket.send(payload));
  };
  const providerId = options.provider?.id ?? process.env.NANOFORGE_PROVIDER_ID ?? "openai-compatible";
  const model = options.provider?.model ?? process.env.NANOFORGE_PROVIDER_MODEL ?? "unconfigured";
  const registry = new InMemoryProviderRegistry();
  registry.register(new OpenAICompatibleAdapter({
    id: providerId,
    model,
    baseUrl: options.provider?.baseUrl ?? process.env.NANOFORGE_PROVIDER_BASE_URL ?? "http://127.0.0.1:9",
    apiKey: options.provider?.apiKey ?? process.env.NANOFORGE_PROVIDER_API_KEY,
  }));
  const profiles = [profileFor(providerId, model)];
  const eventLog = new RunEventLog();
  const auditStore = new AuditStore({ rootDir: path.join(workspaceRoot, ".nanoforge", "runs") });
  const approvalGate = new SocketApprovalGate(send, now);
  const coordinator = new RunCoordinator({
    router: bindRouter(profiles),
    profiles,
    providerRegistry: registry,
    policy: loadPolicy(workspaceRoot),
    runner: runTerminalJob,
    auditStore,
    approvalGate,
    eventLog,
    workspaceRoot,
  });
  const runs = new Map<string, ReturnType<RunCoordinator["submitRun"]>>();
  let watcher: ReturnType<typeof createWorkspaceWatcher> | undefined;
  const ptyManager =
    options.ptyManager ??
    new PtyManager({
      workspaceRoot,
      onMessage: (msg) => send(msg),
    });

  const daemonManager = options.daemonManager ?? new DaemonManager();
  const subagentSupervisor =
    options.subagentSupervisor ??
    new SubagentSupervisor({
      workspaceRoot,
      daemonSupervisor: daemonManager.supervisor,
      scheduler: daemonManager.scheduler,
    });
  const memoryEngine = options.memoryEngine ?? subagentSupervisor.memory;

  const onTerminalMessage = (message: TerminalServerMessage) => send(message);
  ptyManager.on("message", onTerminalMessage);

  const unsubs: (() => void)[] = [];

  const unsubSubagents = subagentSupervisor.subscribe((event) => {
    send({ type: "subagent.event", event, at: now() });
  });
  if (typeof unsubSubagents === "function") unsubs.push(unsubSubagents);

  const unsubMemory = memoryEngine.subscribe((event) => {
    send({ type: "memory.event", event, at: now() });
  });
  if (typeof unsubMemory === "function") unsubs.push(unsubMemory);

  const unsubSupervisor = daemonManager.supervisor.subscribe((event) => {
    send({ type: "task.event", event, at: now() });
  });
  if (typeof unsubSupervisor === "function") unsubs.push(unsubSupervisor);

  const unsubScheduler = daemonManager.scheduler.subscribe((event) => {
    send({ type: "task.event", event, at: now() });
  });
  if (typeof unsubScheduler === "function") unsubs.push(unsubScheduler);

  const unsubEventLog = eventLog.subscribeAll((event) => {
    // Submission emits its first ledger events synchronously. Defer their
    // socket fan-out so the caller always receives queued/running first.
    queueMicrotask(() => {
      const state = stateForEvent(event);
      if (state) {
        send({ type: "run.state", runId: event.runId, state, at: event.at });
      }
      send({ type: "run.event", runId: event.runId, event: event.type, data: event as any, at: event.at });
    });
  });
  if (typeof unsubEventLog === "function") unsubs.push(unsubEventLog);
  send({ type: "host.ready", version: "0.1.0", hostId: context.hostId, workspace, at: now() });

  const workspaceError = (
    error: unknown,
    requestId?: string,
    requestedWorkspace?: WorkspaceDescriptor,
  ): void => {
    const nodeCode = (error as NodeJS.ErrnoException | undefined)?.code;
    let code: WorkspaceErrorCode = "io_error";
    if (error instanceof WorkspaceRootError || error instanceof WorkspaceFileError) code = error.code;
    else if (nodeCode === "ENOENT") code = "not_found";
    else if (nodeCode === "EACCES" || nodeCode === "EPERM") code = "permission_denied";
    send({
      type: "workspace.error",
      requestId,
      code,
      message: error instanceof Error ? error.message : String(error),
      generation,
      recoverable: code !== "permission_denied" && code !== "root_too_broad",
      requestedWorkspace,
      at: now(),
    });
  };
  const dispatchWorkspace = async (message: ClientMessage): Promise<void> => {
    try {
      if (message.type === "workspace.describe") {
        send({ type: "workspace.ready", requestId: message.requestId, workspace, at: now() });
        return;
      }
      if (message.type === "workspace.open") {
        assertWorkspaceGeneration(message.generation, generation);
        const requested = await validateWorkspaceRoot(message.path, generation + 1);
        const sameRoot = path.resolve(requested.canonicalRoot).toLowerCase() === path.resolve(workspaceRoot).toLowerCase();
        if (sameRoot) {
          send({ type: "workspace.ready", requestId: message.requestId, workspace, at: now() });
          return;
        }
        if (Array.from(runs.values()).some((run) => run.status() === "running" || run.status() === "paused")) {
          throw new WorkspaceRootError("active_work", "Cannot switch workspaces while a run is active");
        }
        workspaceError(
          new WorkspaceRootError("reconnect_required", "Validated workspace requires a host reconnect so every privileged subsystem changes root atomically"),
          message.requestId,
          requested.descriptor,
        );
        return;
      }
      if ("generation" in message) assertWorkspaceGeneration(message.generation, generation);
      switch (message.type) {
        case "workspace.readDir":
          send({ type: "workspace.readDir.result", requestId: message.requestId, path: message.path, entries: await handleReadDir(workspaceRoot, message.path), generation });
          return;
        case "workspace.readFile": {
          const result = await handleReadFile(workspaceRoot, message.path);
          send({ type: "workspace.readFile.result", requestId: message.requestId, path: message.path, ...result, generation });
          return;
        }
        case "workspace.stat":
          send({ type: "workspace.stat.result", requestId: message.requestId, path: message.path, stat: await handleStat(workspaceRoot, message.path), generation });
          return;
        case "workspace.search":
          send({ type: "workspace.search.result", requestId: message.requestId, matches: await handleSearch(workspaceRoot, message.query, message.options), generation });
          return;
        case "workspace.gitStatus":
          send({ type: "workspace.gitStatus.result", requestId: message.requestId, files: await handleGitStatus(workspaceRoot), generation });
          return;
        case "workspace.writeFile":
          if (!options.allowWorkspaceWrites) throw new WorkspaceRootError("write_not_approved", "workspace writes require an approved write workflow");
          {
            const result = await handleWriteFile(workspaceRoot, message.path, message.content, {
              expectedSha256: message.expectedSha256,
              expectedModified: message.expectedModified,
            });
            send({ type: "workspace.writeFile.result", requestId: message.requestId, path: message.path, generation, ...result });
          }
          return;
        case "workspace.watch":
          if (message.enabled && !watcher) {
            watcher = createWorkspaceWatcher({ workspaceRoot }, (event) => send({ type: "workspace.fileChanged", ...event, generation }));
          } else if (!message.enabled && watcher) {
            await watcher.close();
            watcher = undefined;
          }
          send({ type: "workspace.watch.result", requestId: message.requestId, enabled: Boolean(message.enabled && watcher), generation });
          return;
        case "workspace.unwatch":
          if (watcher) {
            await watcher.close();
            watcher = undefined;
          }
          send({ type: "workspace.watch.result", requestId: message.requestId, enabled: false, generation });
          return;
      }
    } catch (error) {
      workspaceError(error, "requestId" in message ? message.requestId : undefined);
    }
  };

  socket.on("message", async (data: unknown) => {
    const commandMessage = parseCommandFrame(data);
    if (commandMessage) {
      const result = await dispatchCommand(commandMessage, subagentSupervisor);
      send(result);
      return;
    }
    const decoded = decodeClientMessage(data);
    if (!decoded.ok) {
      if (typeof data === "string" || data instanceof Buffer || Array.isArray(data)) {
        try {
          const parsed = JSON.parse(String(data));
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "type" in parsed &&
            typeof (parsed as { type: unknown }).type === "string" &&
            ((parsed as { type: string }).type).startsWith("terminal.")
          ) {
            const terminalResult = safeParseTerminalClientMessage(parsed);
            if (terminalResult.success) {
              const tMsg = terminalResult.data;
              switch (tMsg.type) {
                case "terminal.create":
                  void ptyManager.createSession(tMsg).catch((err) => {
                    send({
                      type: "error",
                      code: "terminal_error",
                      message: err instanceof Error ? err.message : String(err),
                      at: now(),
                    });
                  });
                  break;
                case "terminal.input":
                  ptyManager.writeInput(tMsg.id, tMsg.data);
                  break;
                case "terminal.resize":
                  ptyManager.resize(tMsg.id, tMsg.cols, tMsg.rows);
                  break;
                case "terminal.kill":
                  void ptyManager.kill(tMsg.id, tMsg.signal);
                  break;
              }
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
      socket.close(4400, "invalid message");
      return;
    }
    const message = decoded.message;
    if (message.type.startsWith("workspace.")) {
      void dispatchWorkspace(message);
      return;
    }
    switch (message.type) {
      case "ping": send({ type: "pong", at: now() }); break;
      case "plan.submit": {
        // The wire schema deliberately stays forward-compatible; the
        // coordinator performs the authoritative plan validation before a
        // step can execute.
        try {
          const handle = coordinator.submitRun(message.plan as unknown as ExecutionPlan);
          runs.set(handle.runId, handle);
          if (message.requestId) {
            send({
              type: "plan.submit.result",
              requestId: message.requestId,
              runId: handle.runId,
              accepted: true,
              planId: message.plan.id,
              at: now(),
            });
          }
          send({ type: "run.state", runId: handle.runId, state: "queued", at: now() });
          send({ type: "run.state", runId: handle.runId, state: "running", at: now() });
        } catch (err) {
          send({
            type: "error",
            code: "invalid_plan",
            message: err instanceof Error ? err.message : String(err),
            requestId: message.requestId,
            at: now(),
          });
        }
        break;
      }
      case "run.pause": {
        const handle = runs.get(message.runId);
        if (!handle) {
          send({
            type: "error",
            code: "unknown_run",
            message: `run not found: ${message.runId}`,
            runId: message.runId,
            requestId: message.requestId,
            at: now(),
          });
        } else {
          handle.pause();
          if (message.requestId) {
            send({
              type: "run.pause.result",
              requestId: message.requestId,
              runId: message.runId,
              at: now(),
            });
          }
        }
        break;
      }
      case "run.resume": {
        const handle = runs.get(message.runId);
        if (!handle) {
          send({
            type: "error",
            code: "unknown_run",
            message: `run not found: ${message.runId}`,
            runId: message.runId,
            requestId: message.requestId,
            at: now(),
          });
        } else {
          handle.resume();
          if (message.requestId) {
            send({
              type: "run.resume.result",
              requestId: message.requestId,
              runId: message.runId,
              at: now(),
            });
          }
        }
        break;
      }
      case "run.cancel": {
        const handle = runs.get(message.runId);
        if (!handle) {
          send({
            type: "error",
            code: "unknown_run",
            message: `run not found: ${message.runId}`,
            runId: message.runId,
            requestId: message.requestId,
            at: now(),
          });
        } else {
          handle.cancel();
          if (message.requestId) {
            send({
              type: "run.cancel.result",
              requestId: message.requestId,
              runId: message.runId,
              at: now(),
            });
          }
        }
        break;
      }
      case "approval.grant": {
        const resolved = approvalGate.resolve(message.requestId, true, undefined, message.runId, message.stepId);
        send({
          type: "approval.grant.result",
          requestId: message.requestId,
          runId: message.runId,
          stepId: message.stepId,
          resolved,
          at: now(),
        });
        break;
      }
      case "approval.deny": {
        const resolved = approvalGate.resolve(message.requestId, false, message.reason, message.runId, message.stepId);
        send({
          type: "approval.deny.result",
          requestId: message.requestId,
          runId: message.runId,
          stepId: message.stepId,
          resolved,
          at: now(),
        });
        break;
      }
      case "tool.response": {
        const resolved = approvalGate.resolve(message.requestId, message.approved, message.reason);
        send({
          type: "tool.response.result",
          requestId: message.requestId,
          resolved,
          at: now(),
        });
        break;
      }
      case "subagent.invoke": {
        try {
          const result = await subagentSupervisor.spawnSubagent(message.params, message.parentId);
          send({ type: "subagent.invoke.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "subagent_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "subagent.manage": {
        try {
          const result = await subagentSupervisor.manageSubagents(message.params, message.callerId);
          send({ type: "subagent.manage.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "subagent_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "subagent.sendMessage": {
        try {
          const result = await subagentSupervisor.sendMessage(message.params, message.senderId);
          send({ type: "subagent.sendMessage.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "subagent_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "subagent.define": {
        try {
          const result = await subagentSupervisor.defineSubagent(message.params);
          send({ type: "subagent.define.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "subagent_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "task.manage": {
        try {
          const result = await daemonManager.manageTask(message.params);
          send({ type: "task.manage.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "task_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "schedule.create": {
        try {
          const result = await daemonManager.scheduleTask(message.params, message.creatorSubagentId);
          send({ type: "schedule.create.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "schedule_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "memory.set": {
        try {
          const result = memoryEngine.set(message.params, message.authorInfo);
          send({ type: "memory.set.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "memory_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "memory.get": {
        try {
          const result = memoryEngine.get(message.params);
          send({ type: "memory.get.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "memory_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "memory.query": {
        try {
          const result = memoryEngine.query(message.params);
          send({ type: "memory.query.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "memory_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "memory.delete": {
        try {
          const result = memoryEngine.delete(message.params);
          send({ type: "memory.delete.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "memory_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
    }
  });
  socket.on("close", () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    approvalGate.close();
    void watcher?.close();
    auditStore.close();
    ptyManager.off("message", onTerminalMessage);
    if (!options.ptyManager) {
      ptyManager.dispose();
    }
    if (!options.subagentSupervisor) {
      void subagentSupervisor.dispose();
    }
    if (!options.daemonManager) {
      void daemonManager.dispose();
    }
  });
}

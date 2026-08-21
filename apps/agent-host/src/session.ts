/**
 * Live WebSocket session composition for the local agent host.
 *
 * This is deliberately host-side: client frames are requests only.  Model
 * proposals still pass through RunCoordinator's policy and approval seams,
 * while workspace writes remain disabled unless the embedding application
 * opts in to a reviewed write flow.
 */
import path from "node:path";
import type { ExecutionPlan } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
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
import { SubagentSupervisor } from "./agents/supervisor.js";
import { DaemonManager } from "./daemons/manager.js";
import { SharedMemoryEngine } from "./agents/memory.js";
import { VoiceSessionManager } from "./voice/voiceManager.js";

export interface AgentSessionOptions {
  workspaceRoot?: string;
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
  /** Voice session manager instance. */
  voiceManager?: VoiceSessionManager;
}

type Send = (message: HostMessage | TerminalServerMessage) => void;

class SocketApprovalGate implements ApprovalGate {
  private readonly pending = new Map<string, (outcome: ApprovalOutcome) => void>();

  constructor(private readonly send: Send, private readonly now: () => string) {}

  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    this.send({
      type: "tool.approval_required",
      requestId: request.runId + ":" + request.stepId + ":" + request.tool,
      runId: request.runId,
      request: request.request,
      reason: request.reason,
      at: this.now(),
    });
    // The request id in the public protocol must be stable and correlation
    // safe. Coordinator-generated ids are intentionally opaque, so this
    // gate uses the same deterministic key when resolving client responses.
    const requestId = request.runId + ":" + request.stepId + ":" + request.tool;
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  resolve(requestId: string, approved: boolean, reason?: string): boolean {
    const resolve = this.pending.get(requestId);
    if (!resolve) return false;
    this.pending.delete(requestId);
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

/** Attach a fully composed coordinator + workspace RPC session to one socket. */
export function attachAgentSession(
  socket: WebSocket,
  context: { hostId: string },
  options: AgentSessionOptions = {},
): void {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
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
  const voiceManager =
    options.voiceManager ??
    new VoiceSessionManager({
      workspaceRoot,
      coordinator,
      providerRegistry: registry,
      profiles,
      send: (msg) => send(msg),
    });

  subagentSupervisor.subscribe((event) => {
    send({ type: "subagent.event", event, at: now() });
  });

  memoryEngine.subscribe((event) => {
    send({ type: "memory.event", event, at: now() });
  });

  daemonManager.supervisor.subscribe((event) => {
    send({ type: "task.event", event, at: now() });
  });

  daemonManager.scheduler.subscribe((event) => {
    send({ type: "task.event", event, at: now() });
  });

  eventLog.subscribeAll((event) => {
    // Submission emits its first ledger events synchronously. Defer their
    // socket fan-out so the caller always receives queued/running first.
    queueMicrotask(() => {
      const state = stateForEvent(event);
      if (state) {
        send({ type: "run.state", runId: event.runId, state, at: event.at });
      }
      send({ type: "run.event", runId: event.runId, event: event.type, data: event, at: event.at });
    });
  });
  send({ type: "host.ready", version: "0.1.0", hostId: context.hostId, at: now() });

  const workspaceError = (error: unknown): void => {
    send({
      type: "error",
      code: "workspace_error",
      message: error instanceof Error ? error.message : String(error),
      at: now(),
    });
  };
  const dispatchWorkspace = async (message: ClientMessage): Promise<void> => {
    try {
      switch (message.type) {
        case "workspace.readDir":
          send({ type: "workspace.readDir.result", requestId: message.requestId, path: message.path, entries: await handleReadDir(workspaceRoot, message.path) });
          return;
        case "workspace.readFile": {
          const result = await handleReadFile(workspaceRoot, message.path);
          send({ type: "workspace.readFile.result", requestId: message.requestId, path: message.path, ...result });
          return;
        }
        case "workspace.stat":
          send({ type: "workspace.stat.result", requestId: message.requestId, path: message.path, stat: await handleStat(workspaceRoot, message.path) });
          return;
        case "workspace.search":
          send({ type: "workspace.search.result", requestId: message.requestId, matches: await handleSearch(workspaceRoot, message.query, message.options) });
          return;
        case "workspace.gitStatus":
          send({ type: "workspace.gitStatus.result", requestId: message.requestId, files: await handleGitStatus(workspaceRoot) });
          return;
        case "workspace.writeFile":
          if (!options.allowWorkspaceWrites) throw new Error("workspace writes require an approved write workflow");
          await handleWriteFile(workspaceRoot, message.path, message.content);
          send({ type: "workspace.writeFile.result", requestId: message.requestId, path: message.path, success: true });
          return;
        case "workspace.watch":
          if (message.enabled && !watcher) {
            watcher = createWorkspaceWatcher({ workspaceRoot }, (event) => send({ type: "workspace.fileChanged", ...event }));
          } else if (!message.enabled && watcher) {
            await watcher.close();
            watcher = undefined;
          }
          return;
      }
    } catch (error) {
      workspaceError(error);
    }
  };

  socket.on("message", async (data: unknown) => {
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
    if (message.type.startsWith("voice.")) {
      void voiceManager.handleClientMessage(message);
      return;
    }
    switch (message.type) {
      case "ping": send({ type: "pong", at: now() }); break;
      case "plan.submit": {
        // The wire schema deliberately stays forward-compatible; the
        // coordinator performs the authoritative plan validation before a
        // step can execute.
        const handle = coordinator.submitRun(message.plan as unknown as ExecutionPlan);
        runs.set(handle.runId, handle);
        send({ type: "run.state", runId: handle.runId, state: "queued", at: now() });
        send({ type: "run.state", runId: handle.runId, state: "running", at: now() });
        break;
      }
      case "run.pause": {
        const handle = runs.get(message.runId);
        if (!handle) send({ type: "error", code: "unknown_run", message: "run not found", runId: message.runId, at: now() });
        else handle.pause();
        break;
      }
      case "run.resume": {
        const handle = runs.get(message.runId);
        if (!handle) send({ type: "error", code: "unknown_run", message: "run not found", runId: message.runId, at: now() });
        else handle.resume();
        break;
      }
      case "run.cancel": {
        const handle = runs.get(message.runId);
        if (!handle) send({ type: "error", code: "unknown_run", message: "run not found", runId: message.runId, at: now() });
        else handle.cancel();
        break;
      }
      case "approval.grant":
        approvalGate.resolve(message.requestId, true);
        break;
      case "approval.deny":
      case "tool.response":
        approvalGate.resolve(message.requestId, message.type === "tool.response" ? message.approved : false, message.reason);
        break;
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
    approvalGate.close();
    void watcher?.close();
    auditStore.close();
    ptyManager.dispose();
    void daemonManager.dispose();
    voiceManager.dispose();
  });
}


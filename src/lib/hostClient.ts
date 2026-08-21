/**
 * Module 2 Task 7: WebSocket client for the local agent host.
 *
 * Connects to `ws://127.0.0.1:<port>/agent?token=<single-use-token>`. The
 * token is single-use, so reconnects are NOT automatic — once the socket
 * closes the client stays closed and the caller must obtain a fresh token.
 * A close with code 4401 (token rejected) surfaces as a typed
 * {@link HostAuthError}.
 *
 * The socket implementation is injectable (`WebSocketImpl`) so tests run in
 * a plain node environment without a real network.
 *
 * Wire protocol (all frames are JSON text):
 *   client -> host: plan.submit | approval.grant | approval.deny |
 *                   run.pause | run.cancel      (each carries a requestId)
 *   host -> client: run.state | tool.approval_required | tool.output |
 *                   run.event | error
 * A request resolves on the first host frame echoing its requestId
 * (`run.event`/`run.state`/`tool.output` = success, `error` = rejection).
 * The client only ever sends approvals/pauses/cancels/plans — it NEVER emits
 * a tool execution frame; execution is the host's job after policy + grant.
 */
import type { ExecutionPlan, PlanUIState, ToolRunState } from "@/types";
import type { DirEntry, SearchMatch, GitFileStatus } from "@/types/workspace";
import type { HostIntegrationsState } from "@/lib/hostSession";
import type {
  InvokeSubagentParams,
  InvokeSubagentResult,
  ManageSubagentsParams,
  ManageSubagentsResult,
  SendMessageParams,
  SendMessageResult,
  DefineSubagentParams,
  DefineSubagentResult,
  SubagentInfo,
  SubagentMessage,
  SubagentLifecycleEvent,
  SubagentState,
  SubagentTelemetry,
} from "@protocol/subagents";
import type {
  ManageTaskParams,
  ManageTaskResult,
  ScheduleParams,
  ScheduleResult,
  TaskSummary,
  TaskLifecycleEvent,
} from "@protocol/tasks";
import type {
  MemoryEntry,
  MemorySetParams,
  MemorySetResult,
  MemoryGetParams,
  MemoryGetResult,
  MemoryQueryParams,
  MemoryQueryResult,
  MemoryDeleteParams,
  MemoryDeleteResult,
} from "@protocol/memory";

/* ------------------------------------------------------------------ */
/* Wire message shapes                                                */
/* ------------------------------------------------------------------ */

export type HostClientRequestType =
  | "plan.submit"
  | "approval.grant"
  | "approval.deny"
  | "run.pause"
  | "run.cancel"
  | "workspace.readDir"
  | "workspace.search"
  | "workspace.gitStatus"
  | "integration.toggle"
  | "subagent.invoke"
  | "subagent.manage"
  | "subagent.sendMessage"
  | "subagent.define"
  | "task.manage"
  | "schedule.create"
  | "memory.set"
  | "memory.get"
  | "memory.query"
  | "memory.delete"
  | "playground.dispatchTurn"
  | "playground.simulateTurn"
  | "playground.injectFailure";

export interface HostClientRequest {
  type: HostClientRequestType;
  requestId: string;
  plan?: ExecutionPlan;
  runId?: string;
  stepId?: string;
  kind?: "rules" | "skill" | "mcp";
  id?: string;
  enabled?: boolean;
  params?: unknown;
  parentId?: string;
  callerId?: string;
  senderId?: string;
  creatorSubagentId?: string;
}

export interface RunStateMessage {
  type: "run.state";
  runId: string;
  state: PlanUIState;
  stepStates?: Record<string, string>;
}

export interface ToolApprovalRequiredMessage {
  type: "tool.approval_required";
  runId: string;
  toolId: string;
  executable: string;
  args: string[];
  cwd: string;
  policyReason: string;
}

export interface ToolOutputMessage {
  type: "tool.output";
  runId: string;
  toolId: string;
  stream?: "stdout" | "stderr";
  chunk: string;
  truncated?: boolean;
  state?: ToolRunState;
  exitCode?: number;
}

export interface RunEventMessage {
  type: "run.event";
  runId: string;
  event: string;
  detail?: string;
  data?: unknown;
}

export interface HostErrorMessage {
  type: "error";
  code: string;
  message: string;
  runId?: string;
}

export interface IntegrationsSnapshotMessage {
  type: "integrations.snapshot";
  requestId?: string;
  snapshot: HostIntegrationsState;
}

export interface SubagentInvokeResultMessage {
  type: "subagent.invoke.result";
  requestId: string;
  result: InvokeSubagentResult;
}

export interface SubagentManageResultMessage {
  type: "subagent.manage.result";
  requestId: string;
  result: ManageSubagentsResult;
}

export interface SubagentSendMessageResultMessage {
  type: "subagent.sendMessage.result";
  requestId: string;
  result: SendMessageResult;
}

export interface SubagentDefineResultMessage {
  type: "subagent.define.result";
  requestId: string;
  result: DefineSubagentResult;
}

export interface SubagentEventMessage {
  type: "subagent.event";
  event: SubagentLifecycleEvent;
  at?: string;
}

export interface SubagentSpawnedMessage {
  type: "subagent.spawned";
  subagent: SubagentInfo;
  at?: string;
}

export interface SubagentStateChangedMessage {
  type: "subagent.state_changed" | "subagent.state";
  subagentId: string;
  previousState?: SubagentState;
  newState?: SubagentState;
  state?: SubagentState;
  reason?: string;
  tokensUsed?: number;
  at?: string;
}

export interface SubagentMessageSentMessage {
  type: "subagent.message_sent" | "subagent.message";
  message: SubagentMessage;
  at?: string;
}

export interface SubagentHeartbeatMessage {
  type: "subagent.heartbeat";
  subagentId: string;
  lastVisited: string;
  progressSummary?: string;
  at?: string;
}

export interface SubagentCompletedMessage {
  type: "subagent.completed";
  subagentId: string;
  tokensUsed: number;
  turnCount: number;
  handoffArtifact?: string;
  at?: string;
}

export interface SubagentErroredMessage {
  type: "subagent.errored";
  subagentId: string;
  error: string;
  code?: string;
  at?: string;
}

export interface SubagentTreeUpdatedMessage {
  type: "subagent.tree_updated";
  rootId: string;
  activeCount: number;
  tree: SubagentInfo[];
  at?: string;
}

export interface SubagentsSnapshotMessage {
  type: "subagents.snapshot";
  snapshot: SubagentInfo[];
  at?: string;
}

export interface TaskManageResultMessage {
  type: "task.manage.result";
  requestId: string;
  result: ManageTaskResult;
}

export interface ScheduleCreateResultMessage {
  type: "schedule.create.result";
  requestId: string;
  result: ScheduleResult;
}

export interface TaskEventMessage {
  type: "task.event";
  event: TaskLifecycleEvent;
  at?: string;
}

export interface TaskSpawnedMessage {
  type: "task.spawned";
  task: TaskSummary;
  at?: string;
}

export interface TaskCompletedMessage {
  type: "task.completed";
  taskId: string;
  exitCode?: number | null;
  durationMs?: number;
  at?: string;
}

export interface TaskKilledMessage {
  type: "task.killed";
  taskId: string;
  signal?: string;
  at?: string;
}

export interface ScheduleTriggeredMessage {
  type: "schedule.triggered";
  scheduleId: string;
  iteration: number;
  prompt: string;
  at?: string;
}

export interface ScheduleCancelledMessage {
  type: "schedule.cancelled";
  scheduleId: string;
  reason: string;
  at?: string;
}

export interface TasksSnapshotMessage {
  type: "tasks.snapshot";
  snapshot: TaskSummary[];
  at?: string;
}

export interface SchedulesSnapshotMessage {
  type: "schedules.snapshot";
  snapshot: ScheduleResult[];
  at?: string;
}

export interface MemorySetResultMessage {
  type: "memory.set.result";
  requestId: string;
  result: MemorySetResult;
}

export interface MemoryGetResultMessage {
  type: "memory.get.result";
  requestId: string;
  result: MemoryGetResult;
}

export interface MemoryQueryResultResultMessage {
  type: "memory.query.result";
  requestId: string;
  result: MemoryQueryResult;
}

export interface MemoryDeleteResultMessage {
  type: "memory.delete.result";
  requestId: string;
  result: MemoryDeleteResult;
}

export interface MemoryEntrySetMessage {
  type: "memory.entry_set";
  entry: MemoryEntry;
  at?: string;
}

export interface MemoryEntryDeletedMessage {
  type: "memory.entry_deleted";
  key: string;
  namespace: string;
  at?: string;
}

export interface MemoryClearedMessage {
  type: "memory.cleared";
  namespace?: string;
  at?: string;
}

export interface MemorySnapshotMessage {
  type: "memory.snapshot";
  snapshot: MemoryEntry[];
  at?: string;
}

export interface SubagentTelemetryUpdatedMessage {
  type: "subagent.telemetry_updated";
  subagentId: string;
  telemetry: SubagentTelemetry;
  at?: string;
}

export interface SubagentTurnStartedMessage {
  type: "subagent.turn_started";
  subagentId: string;
  turnId?: string;
  prompt?: string;
  at?: string;
}

export interface SubagentTurnCompletedMessage {
  type: "subagent.turn_completed";
  subagentId: string;
  turnId?: string;
  tokensUsed?: number;
  turnLatencyMs?: number;
  output?: string;
  at?: string;
}

export interface PlaygroundDispatchTurnResultMessage {
  type: "playground.dispatchTurn.result";
  requestId: string;
  result?: {
    success: boolean;
    turnId?: string;
    response?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
  turnId?: string;
  response?: string;
  tokensUsed?: number;
  latencyMs?: number;
  success?: boolean;
}

export interface PlaygroundSimulateTurnResultMessage {
  type: "playground.simulateTurn.result";
  requestId: string;
  result?: {
    success: boolean;
    turnId?: string;
    scenario?: string;
    output?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
  turnId?: string;
  scenario?: string;
  output?: string;
  tokensUsed?: number;
  latencyMs?: number;
  success?: boolean;
}

export interface PlaygroundInjectFailureResultMessage {
  type: "playground.injectFailure.result";
  requestId: string;
  result?: {
    success: boolean;
    affectedSubagents?: string[];
    recovered?: boolean;
    message?: string;
  };
  affectedSubagents?: string[];
  recovered?: boolean;
  message?: string;
  success?: boolean;
}

export type HostMessage =
  | RunStateMessage
  | ToolApprovalRequiredMessage
  | ToolOutputMessage
  | RunEventMessage
  | HostErrorMessage
  | IntegrationsSnapshotMessage
  | SubagentInvokeResultMessage
  | SubagentManageResultMessage
  | SubagentSendMessageResultMessage
  | SubagentDefineResultMessage
  | SubagentEventMessage
  | SubagentSpawnedMessage
  | SubagentStateChangedMessage
  | SubagentMessageSentMessage
  | SubagentHeartbeatMessage
  | SubagentCompletedMessage
  | SubagentErroredMessage
  | SubagentTreeUpdatedMessage
  | SubagentsSnapshotMessage
  | TaskManageResultMessage
  | ScheduleCreateResultMessage
  | TaskEventMessage
  | TaskSpawnedMessage
  | TaskCompletedMessage
  | TaskKilledMessage
  | ScheduleTriggeredMessage
  | ScheduleCancelledMessage
  | TasksSnapshotMessage
  | SchedulesSnapshotMessage
  | MemorySetResultMessage
  | MemoryGetResultMessage
  | MemoryQueryResultResultMessage
  | MemoryDeleteResultMessage
  | MemoryEntrySetMessage
  | MemoryEntryDeletedMessage
  | MemoryClearedMessage
  | MemorySnapshotMessage
  | SubagentTelemetryUpdatedMessage
  | SubagentTurnStartedMessage
  | SubagentTurnCompletedMessage
  | PlaygroundDispatchTurnResultMessage
  | PlaygroundSimulateTurnResultMessage
  | PlaygroundInjectFailureResultMessage
  | { type: "workspace.readDir.result"; requestId: string; path: string; entries: DirEntry[] }
  | { type: "workspace.search.result"; requestId: string; matches: SearchMatch[] }
  | { type: "workspace.gitStatus.result"; requestId: string; files: GitFileStatus[] }
  | { type: "workspace.fileChanged"; path: string; changeType: "created" | "modified" | "deleted" };

/** Any host frame may carry a requestId correlating it to a client request. */
type WithRequestId = { requestId?: string };

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

/** Socket closed with 4401 — single-use token missing, reused, or expired. */
export class HostAuthError extends Error {
  readonly code = 4401;
  constructor(reason?: string) {
    super(`agent host rejected the session token (4401)${reason ? `: ${reason}` : ""}`);
    this.name = "HostAuthError";
  }
}

/** Socket closed for a non-auth reason before/between requests. */
export class HostConnectionError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "HostConnectionError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Injectable socket                                                  */
/* ------------------------------------------------------------------ */

/** Structural subset of the browser WebSocket the client relies on. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface HostClientOptions {
  /** Loopback port printed by the host on startup. */
  port: number;
  /** Single-use bearer token. Never persisted by this client. */
  token: string;
  /** Override for tests; defaults to the global WebSocket constructor. */
  WebSocketImpl?: WebSocketFactory;
}

const WS_OPEN = 1;
const AUTH_CLOSE_CODE = 4401;

const HOST_MESSAGE_TYPES = new Set([
  "run.state",
  "tool.approval_required",
  "tool.output",
  "run.event",
  "error",
  "workspace.readDir.result",
  "workspace.search.result",
  "workspace.gitStatus.result",
  "workspace.fileChanged",
  "integrations.snapshot",
  "subagent.invoke.result",
  "subagent.manage.result",
  "subagent.sendMessage.result",
  "subagent.define.result",
  "subagent.event",
  "subagent.spawned",
  "subagent.state_changed",
  "subagent.state",
  "subagent.message_sent",
  "subagent.message",
  "subagent.heartbeat",
  "subagent.completed",
  "subagent.errored",
  "subagent.tree_updated",
  "subagents.snapshot",
  "task.manage.result",
  "schedule.create.result",
  "task.event",
  "task.spawned",
  "task.completed",
  "task.killed",
  "schedule.triggered",
  "schedule.cancelled",
  "tasks.snapshot",
  "schedules.snapshot",
  "memory.set.result",
  "memory.get.result",
  "memory.query.result",
  "memory.delete.result",
  "memory.entry_set",
  "memory.entry_deleted",
  "memory.cleared",
  "memory.snapshot",
  "subagent.telemetry_updated",
  "subagent.turn_started",
  "subagent.turn_completed",
  "playground.dispatchTurn.result",
  "playground.simulateTurn.result",
  "playground.injectFailure.result",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === "string";

/**
 * Lightweight defensive validation of an incoming frame. Returns the typed
 * message or null when the frame is malformed (malformed frames are dropped;
 * model/host output is untrusted by contract).
 */
export function parseHostMessage(raw: unknown): (HostMessage & WithRequestId) | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || !isString(data.type) || !HOST_MESSAGE_TYPES.has(data.type)) return null;
  const requestId = isString(data.requestId) ? data.requestId : undefined;

  switch (data.type) {
    case "run.state":
      if (!isString(data.runId) || !isString(data.state)) return null;
      return { ...(data as unknown as RunStateMessage), requestId };
    case "tool.approval_required":
      if (
        !isString(data.runId) ||
        !isString(data.toolId) ||
        !isString(data.executable) ||
        !Array.isArray(data.args) ||
        !data.args.every(isString) ||
        !isString(data.cwd) ||
        !isString(data.policyReason)
      )
        return null;
      return { ...(data as unknown as ToolApprovalRequiredMessage), requestId };
    case "tool.output":
      if (!isString(data.runId) || !isString(data.toolId) || !isString(data.chunk)) return null;
      return { ...(data as unknown as ToolOutputMessage), requestId };
    case "run.event":
      if (!isString(data.runId) || !isString(data.event)) return null;
      return { ...(data as unknown as RunEventMessage), requestId };
    case "error":
      if (!isString(data.code) || !isString(data.message)) return null;
      return { ...(data as unknown as HostErrorMessage), requestId };
    case "workspace.readDir.result":
      if (!isString(data.requestId) || !isString(data.path) || !Array.isArray(data.entries)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.search.result":
      if (!isString(data.requestId) || !Array.isArray(data.matches)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.gitStatus.result":
      if (!isString(data.requestId) || !Array.isArray(data.files)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.fileChanged":
      if (!isString(data.path) || !isString(data.changeType)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "integrations.snapshot":
      if (!isRecord(data.snapshot)) return null;
      return { ...(data as unknown as IntegrationsSnapshotMessage), requestId };
    case "subagent.invoke.result":
    case "subagent.manage.result":
    case "subagent.sendMessage.result":
    case "subagent.define.result":
    case "task.manage.result":
    case "schedule.create.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "subagent.event":
      if (!isRecord(data.event)) return null;
      return { ...(data as unknown as SubagentEventMessage), requestId };
    case "subagent.spawned":
      if (!isRecord(data.subagent)) return null;
      return { ...(data as unknown as SubagentSpawnedMessage), requestId };
    case "subagent.state_changed":
    case "subagent.state":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentStateChangedMessage), requestId };
    case "subagent.message_sent":
    case "subagent.message":
      if (!isRecord(data.message)) return null;
      return { ...(data as unknown as SubagentMessageSentMessage), requestId };
    case "subagent.heartbeat":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentHeartbeatMessage), requestId };
    case "subagent.completed":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentCompletedMessage), requestId };
    case "subagent.errored":
      if (!isString(data.subagentId) || !isString(data.error)) return null;
      return { ...(data as unknown as SubagentErroredMessage), requestId };
    case "subagent.tree_updated":
      if (!isString(data.rootId) || !Array.isArray(data.tree)) return null;
      return { ...(data as unknown as SubagentTreeUpdatedMessage), requestId };
    case "subagents.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as SubagentsSnapshotMessage), requestId };
    case "task.event":
      if (!isRecord(data.event)) return null;
      return { ...(data as unknown as TaskEventMessage), requestId };
    case "task.spawned":
      if (!isRecord(data.task)) return null;
      return { ...(data as unknown as TaskSpawnedMessage), requestId };
    case "task.completed":
      if (!isString(data.taskId)) return null;
      return { ...(data as unknown as TaskCompletedMessage), requestId };
    case "task.killed":
      if (!isString(data.taskId)) return null;
      return { ...(data as unknown as TaskKilledMessage), requestId };
    case "schedule.triggered":
      if (!isString(data.scheduleId)) return null;
      return { ...(data as unknown as ScheduleTriggeredMessage), requestId };
    case "schedule.cancelled":
      if (!isString(data.scheduleId)) return null;
      return { ...(data as unknown as ScheduleCancelledMessage), requestId };
    case "tasks.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as TasksSnapshotMessage), requestId };
    case "schedules.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as SchedulesSnapshotMessage), requestId };
    case "memory.set.result":
    case "memory.get.result":
    case "memory.query.result":
    case "memory.delete.result":
    case "playground.dispatchTurn.result":
    case "playground.simulateTurn.result":
    case "playground.injectFailure.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "memory.entry_set":
      if (!isRecord(data.entry)) return null;
      return { ...(data as unknown as MemoryEntrySetMessage), requestId };
    case "memory.entry_deleted":
      if (!isString(data.key) || !isString(data.namespace)) return null;
      return { ...(data as unknown as MemoryEntryDeletedMessage), requestId };
    case "memory.cleared":
      return { ...(data as unknown as MemoryClearedMessage), requestId };
    case "memory.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as MemorySnapshotMessage), requestId };
    case "subagent.telemetry_updated":
      if (!isString(data.subagentId) || !isRecord(data.telemetry)) return null;
      return { ...(data as unknown as SubagentTelemetryUpdatedMessage), requestId };
    case "subagent.turn_started":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentTurnStartedMessage), requestId };
    case "subagent.turn_completed":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentTurnCompletedMessage), requestId };
    default:
      return null;
  }
}

export type HostEventHandler = (msg: HostMessage) => void;

interface PendingRequest {
  resolve: (value?: any) => void;
  reject: (err: Error) => void;
}

export class HostClient {
  private readonly url: string;
  private readonly makeSocket: WebSocketFactory;
  private ws: WebSocketLike | null = null;
  private seq = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<HostEventHandler>();
  private openPromise: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private closed = false;

  constructor(opts: HostClientOptions) {
    this.url = `ws://127.0.0.1:${opts.port}/agent?token=${encodeURIComponent(opts.token)}`;
    this.makeSocket =
      opts.WebSocketImpl ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
  }

  /** Open the socket. Resolves on `open`; rejects HostAuthError on a 4401 close. */
  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) return Promise.resolve();
    if (this.closed) return Promise.reject(new HostConnectionError("host client is closed"));
    this.ws = this.makeSocket(this.url);
    this.ws.onopen = () => {
      this.openPromise?.resolve();
      this.openPromise = null;
    };
    this.ws.onmessage = (ev) => this.handleFrame(ev.data);
    this.ws.onerror = () => {
      /* errors always arrive with/are followed by a close event */
    };
    this.ws.onclose = (ev) => this.handleClose(ev.code, ev.reason);
    return new Promise<void>((resolve, reject) => {
      this.openPromise = { resolve, reject };
    });
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WS_OPEN;
  }

  /** Subscribe to validated host events. Returns an unsubscribe function. */
  onEvent(handler: HostEventHandler): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  submitPlan(plan: ExecutionPlan): Promise<void> {
    return this.request({ type: "plan.submit", plan });
  }

  grantApproval(runId: string, stepId: string): Promise<void> {
    return this.request({ type: "approval.grant", runId, stepId });
  }

  denyApproval(runId: string, stepId: string): Promise<void> {
    return this.request({ type: "approval.deny", runId, stepId });
  }

  pauseRun(runId: string): Promise<void> {
    return this.request({ type: "run.pause", runId });
  }

  cancelRun(runId: string): Promise<void> {
    return this.request({ type: "run.cancel", runId });
  }

  readDir(path = ""): Promise<DirEntry[]> { return this.requestResult({ type: "workspace.readDir", path }).then((m) => (m as { entries: DirEntry[] }).entries); }
  search(query: string, options?: { caseSensitive?: boolean; includes?: string[]; maxResults?: number }): Promise<SearchMatch[]> {
    return this.requestResult({ type: "workspace.search", query, options }).then((m) => (m as { matches: SearchMatch[] }).matches);
  }
  gitStatus(): Promise<GitFileStatus[]> { return this.requestResult({ type: "workspace.gitStatus" }).then((m) => (m as { files: GitFileStatus[] }).files); }
  writeFile(path: string, content: string): Promise<void> { return this.request({ type: "workspace.writeFile", path, content } as never); }
  toggleIntegration(kind: "rules" | "skill" | "mcp", id: string, enabled: boolean): Promise<void> {
    return this.request({ type: "integration.toggle", kind, id, enabled });
  }

  invokeSubagent(params: InvokeSubagentParams, parentId?: string): Promise<InvokeSubagentResult> {
    return this.requestResult({
      type: "subagent.invoke",
      params,
      ...(parentId ? { parentId } : {}),
    }).then((m) => (m as { result?: InvokeSubagentResult }).result ?? (m as unknown as InvokeSubagentResult));
  }

  manageSubagents(params: ManageSubagentsParams, callerId?: string): Promise<ManageSubagentsResult> {
    return this.requestResult({
      type: "subagent.manage",
      params,
      ...(callerId ? { callerId } : {}),
    }).then((m) => (m as { result?: ManageSubagentsResult }).result ?? (m as unknown as ManageSubagentsResult));
  }

  sendMessage(params: SendMessageParams, senderId = "root"): Promise<SendMessageResult> {
    return this.requestResult({
      type: "subagent.sendMessage",
      params,
      senderId,
    }).then((m) => (m as { result?: SendMessageResult }).result ?? (m as unknown as SendMessageResult));
  }

  defineSubagent(params: DefineSubagentParams): Promise<DefineSubagentResult> {
    return this.requestResult({
      type: "subagent.define",
      params,
    }).then((m) => (m as { result?: DefineSubagentResult }).result ?? (m as unknown as DefineSubagentResult));
  }

  manageTask(params: ManageTaskParams): Promise<ManageTaskResult> {
    return this.requestResult({
      type: "task.manage",
      params,
    }).then((m) => (m as { result?: ManageTaskResult }).result ?? (m as unknown as ManageTaskResult));
  }

  createSchedule(params: ScheduleParams, creatorSubagentId?: string): Promise<ScheduleResult> {
    return this.requestResult({
      type: "schedule.create",
      params,
      ...(creatorSubagentId ? { creatorSubagentId } : {}),
    }).then((m) => (m as { result?: ScheduleResult }).result ?? (m as unknown as ScheduleResult));
  }

  setSharedMemory(params: MemorySetParams): Promise<MemorySetResult> {
    return this.requestResult({
      type: "memory.set",
      params,
    }).then((m) => (m as { result?: MemorySetResult }).result ?? (m as unknown as MemorySetResult));
  }

  getSharedMemory(params: MemoryGetParams): Promise<MemoryGetResult> {
    return this.requestResult({
      type: "memory.get",
      params,
    }).then((m) => (m as { result?: MemoryGetResult }).result ?? (m as unknown as MemoryGetResult));
  }

  querySharedMemory(params: MemoryQueryParams): Promise<MemoryQueryResult> {
    return this.requestResult({
      type: "memory.query",
      params,
    }).then((m) => (m as { result?: MemoryQueryResult }).result ?? (m as unknown as MemoryQueryResult));
  }

  deleteSharedMemory(params: MemoryDeleteParams): Promise<MemoryDeleteResult> {
    return this.requestResult({
      type: "memory.delete",
      params,
    }).then((m) => (m as { result?: MemoryDeleteResult }).result ?? (m as unknown as MemoryDeleteResult));
  }

  dispatchPlaygroundTurn(subagentId: string, prompt: string): Promise<any> {
    return this.requestResult({
      type: "playground.dispatchTurn",
      params: { subagentId, prompt },
    }).then((m) => (m as { result?: any }).result ?? m);
  }

  simulateAgentTurn(subagentId: string, scenario: string): Promise<any> {
    return this.requestResult({
      type: "playground.simulateTurn",
      params: { subagentId, scenario },
    }).then((m) => (m as { result?: any }).result ?? m);
  }

  injectAgentFailure(subagentId: string, failureType: string, strategy?: string): Promise<any> {
    return this.requestResult({
      type: "playground.injectFailure",
      params: { subagentId, failureType, ...(strategy ? { strategy } : {}) },
    }).then((m) => (m as { result?: any }).result ?? m);
  }

  /** Terminate the session. No reconnect — the token is single-use. */
  close(): void {
    this.closed = true;
    this.failPending(new HostConnectionError("host client closed"));
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== 3 /* CLOSED */) {
      try {
        ws.close(1000, "client done");
      } catch {
        /* fake sockets may throw; ignore */
      }
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private request(msg: Omit<HostClientRequest, "requestId">): Promise<void> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.reject(new HostConnectionError("not connected to agent host"));
    }
    const requestId = `req-${++this.seq}`;
    const frame: HostClientRequest = { ...msg, requestId };
    return new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private requestResult(msg: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return Promise.reject(new HostConnectionError("not connected to agent host"));
    const requestId = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws!.send(JSON.stringify({ ...msg, requestId }));
    });
  }

  private handleFrame(raw: unknown): void {
    const msg = parseHostMessage(typeof raw === "string" ? raw : String(raw));
    if (!msg) return; // untrusted/malformed frame: drop silently

    // request/response correlation
    if (msg.requestId) {
      const p = this.pending.get(msg.requestId);
      if (p) {
        this.pending.delete(msg.requestId);
        if (msg.type === "error") {
          p.reject(new HostConnectionError(`${msg.code}: ${msg.message}`));
        } else {
          p.resolve(msg);
        }
      }
    }

    for (const handler of this.subscribers) handler(msg);
  }

  private handleClose(code: number, reason?: string): void {
    const err =
      code === AUTH_CLOSE_CODE
        ? new HostAuthError(reason)
        : new HostConnectionError(
            `agent host socket closed (${code}${reason ? `: ${reason}` : ""})`,
            code,
          );
    if (this.openPromise) {
      this.openPromise.reject(err);
      this.openPromise = null;
    }
    this.failPending(err);
    if (code === AUTH_CLOSE_CODE) {
      for (const handler of this.subscribers) {
        handler({ type: "error", code: "unauthorized", message: err.message });
      }
    }
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

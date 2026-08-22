import type { ExecutionPlan } from "@nanoforge/protocol";
import {
  ApprovalDeniedError,
  AuthenticationError,
  ConnectionError,
  NanoForgeError,
  ProtocolError,
  TimeoutError,
} from "./errors";
import { EventStreamQueue, TypedEventEmitter } from "./events";
import { AgentSession } from "./session";
import type {
  GitFileStatus,
  NanoForgeClientOptions,
  RunEvent,
  SearchMatch,
  SessionOptions,
  SubmittedPlan,
  ToolCallRequest,
  WorkspaceDirEntry,
  WorkspaceFileStat,
} from "./types";

interface PendingRpc {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: any;
}

/**
 * Programmatic client for interacting with the NanoForge Agent Host.
 */
export class NanoForgeClient extends TypedEventEmitter {
  private readonly _options: NanoForgeClientOptions;
  private _ws: any = null;
  private _connected = false;
  private _sessions = new Map<string, AgentSession>();
  private _pendingRpcs = new Map<string, PendingRpc>();
  private _activeStreams = new Map<string, EventStreamQueue<RunEvent>>();
  private _pendingStreamPlans: Array<{ planId: string; queue: EventStreamQueue<RunEvent> }> = [];
  private _reconnectAttempts = 0;
  private _isDisconnecting = false;
  private _connectPromise: Promise<void> | null = null;

  constructor(options: NanoForgeClientOptions) {
    super();
    this._options = {
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 5,
      timeoutMs: 10000,
      autoReconnect: false,
      ...options,
    };
  }

  /**
   * Whether the client is actively connected to the host.
   */
  public isConnected(): boolean {
    return this._connected && this._ws && this._ws.readyState === 1;
  }

  /**
   * Connects to the NanoForge agent host via WebSocket.
   */
  public async connect(): Promise<void> {
    if (this.isConnected()) return;
    if (this._connectPromise) return this._connectPromise;

    this._isDisconnecting = false;
    this._connectPromise = new Promise<void>((resolve, reject) => {
      try {
        let wsUrl = this._options.hostUrl;
        if (wsUrl.startsWith("http://")) {
          wsUrl = wsUrl.replace("http://", "ws://");
        } else if (wsUrl.startsWith("https://")) {
          wsUrl = wsUrl.replace("https://", "wss://");
        }

        // Normalize URL path and attach token query param if provided
        const urlObj = new URL(wsUrl);
        if (!urlObj.pathname || urlObj.pathname === "/") {
          urlObj.pathname = "/agent";
        }
        if (this._options.token) {
          urlObj.searchParams.set("token", this._options.token);
        }

        const WebSocketCtor =
          this._options.WebSocket ||
          (typeof globalThis !== "undefined" && (globalThis as any).WebSocket);

        if (!WebSocketCtor) {
          throw new ConnectionError("No WebSocket implementation found in current environment");
        }

        const ws = new WebSocketCtor(urlObj.toString());
        this._ws = ws;

        const timeout = setTimeout(() => {
          if (!this._connected) {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
            reject(new TimeoutError("Connection to NanoForge host timed out"));
          }
        }, this._options.timeoutMs || 10000);

        ws.onopen = () => {
          this._connected = true;
          this._reconnectAttempts = 0;
          clearTimeout(timeout);
          this.emit("connect");
          resolve();
        };

        ws.onmessage = (event: any) => {
          this._handleMessage(event.data);
        };

        ws.onerror = (err: any) => {
          this.emit("error", err);
          if (!this._connected) {
            clearTimeout(timeout);
            reject(new ConnectionError("Failed to connect to NanoForge host"));
          }
        };

        ws.onclose = (event: any) => {
          const wasConnected = this._connected;
          this._connected = false;
          clearTimeout(timeout);

          // Check for security close codes
          if (event && event.code === 4401) {
            this.emit("error", new AuthenticationError());
          } else if (event && event.code === 4400) {
            this.emit("error", new ProtocolError("Protocol schema violation"));
          }

          this.emit("disconnect", { code: event?.code, reason: event?.reason });

          // Terminate any active streams and pending RPCs
          for (const [id, rpc] of this._pendingRpcs.entries()) {
            clearTimeout(rpc.timer);
            rpc.reject(new ConnectionError("Connection closed while waiting for RPC response"));
          }
          this._pendingRpcs.clear();

          for (const [runId, stream] of this._activeStreams.entries()) {
            stream.fail(new ConnectionError("Connection closed during run stream"));
          }
          this._activeStreams.clear();
          this._pendingStreamPlans = [];

          if (
            wasConnected &&
            !this._isDisconnecting &&
            this._options.autoReconnect &&
            this._reconnectAttempts < (this._options.maxReconnectAttempts || 5)
          ) {
            this._reconnectAttempts++;
            const delay = this._options.reconnectIntervalMs || 1000;
            setTimeout(() => {
              this._connectPromise = null;
              void this.connect().catch(() => {});
            }, delay);
          }
        };
      } catch (err: any) {
        this._connectPromise = null;
        reject(new ConnectionError(err.message || "Failed to initialize WebSocket"));
      }
    }).finally(() => {
      this._connectPromise = null;
    });

    return this._connectPromise;
  }

  /**
   * Gracefully disconnects the WebSocket client.
   */
  public async disconnect(): Promise<void> {
    this._isDisconnecting = true;
    if (this._ws) {
      try {
        this._ws.close(1000, "Client initiated disconnect");
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
    this._connected = false;
  }

  /**
   * Sends a ping frame and returns round-trip latency in milliseconds.
   */
  public async ping(): Promise<number> {
    const start = Date.now();
    await this._sendRaw({ type: "ping" });
    return Date.now() - start;
  }

  /**
   * Creates a new agent session.
   */
  public async createSession(options: SessionOptions = {}): Promise<AgentSession> {
    const session = new AgentSession(this, options);
    this._sessions.set(session.id, session);
    return session;
  }

  /**
   * Retrieves an existing session by ID.
   */
  public getSession(sessionId: string): AgentSession | undefined {
    return this._sessions.get(sessionId);
  }

  /**
   * Submits an execution plan and returns the assigned run ID.
   */
  public async submitPlan(plan: SubmittedPlan | ExecutionPlan): Promise<string> {
    await this._sendRaw({
      type: "plan.submit",
      plan: {
        id: plan.id,
        goal: plan.goal,
        steps: plan.steps.map((s) => ({
          ...s,
        })),
      },
    });
    return plan.id;
  }

  /**
   * Submits a plan and yields real-time streaming run events as an AsyncIterable.
   */
  public async *streamRun(plan: SubmittedPlan | ExecutionPlan): AsyncIterable<RunEvent> {
    const queue = new EventStreamQueue<RunEvent>();
    const planId = plan.id;
    this._activeStreams.set(planId, queue);
    const pendingEntry = { planId, queue };
    this._pendingStreamPlans.push(pendingEntry);

    try {
      await this.submitPlan(plan);
      for await (const event of queue) {
        yield event;
      }
    } finally {
      this._activeStreams.delete(planId);
      for (const [key, q] of this._activeStreams.entries()) {
        if (q === queue) {
          this._activeStreams.delete(key);
        }
      }
      const idx = this._pendingStreamPlans.indexOf(pendingEntry);
      if (idx !== -1) {
        this._pendingStreamPlans.splice(idx, 1);
      }
    }
  }

  /**
   * Grant approval for a pending tool execution.
   */
  public async grantApproval(requestId: string): Promise<void> {
    await this._sendRaw({
      type: "approval.grant",
      requestId,
    });
  }

  /**
   * Deny approval for a pending tool execution.
   */
  public async denyApproval(requestId: string, reason?: string): Promise<void> {
    await this._sendRaw({
      type: "approval.deny",
      requestId,
      reason,
    });
  }

  /**
   * Sends an explicit tool response.
   */
  public async sendToolResponse(
    requestId: string,
    approved: boolean,
    reason?: string,
  ): Promise<void> {
    await this._sendRaw({
      type: "tool.response",
      requestId,
      approved,
      reason,
    });
  }

  /**
   * Pauses an active plan run.
   */
  public async pauseRun(runId: string): Promise<void> {
    await this._sendRaw({
      type: "run.pause",
      runId,
    });
  }

  /**
   * Resumes a paused plan run.
   */
  public async resumeRun(runId: string): Promise<void> {
    await this._sendRaw({
      type: "run.resume",
      runId,
    });
  }

  /**
   * Cancels an active plan run.
   */
  public async cancelRun(runId: string, reason?: string): Promise<void> {
    await this._sendRaw({
      type: "run.cancel",
      runId,
      reason,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Workspace Operations                                                     */
  /* ------------------------------------------------------------------------ */

  public async readDir(path: string): Promise<WorkspaceDirEntry[]> {
    const result = await this._callRpc("workspace.readDir", { path });
    return result.entries;
  }

  public async readFile(
    path: string,
  ): Promise<{ content: string; language: string; size: number }> {
    return this._callRpc("workspace.readFile", { path });
  }

  public async writeFile(path: string, content: string): Promise<boolean> {
    const result = await this._callRpc("workspace.writeFile", { path, content });
    return result.success;
  }

  public async stat(path: string): Promise<WorkspaceFileStat> {
    const result = await this._callRpc("workspace.stat", { path });
    return result.stat;
  }

  public async search(
    query: string,
    options?: { caseSensitive?: boolean; includes?: string[]; maxResults?: number },
  ): Promise<SearchMatch[]> {
    const result = await this._callRpc("workspace.search", { query, options });
    return result.matches;
  }

  public async gitStatus(): Promise<GitFileStatus[]> {
    const result = await this._callRpc("workspace.gitStatus", {});
    return result.files;
  }

  public async watchWorkspace(enabled: boolean): Promise<void> {
    await this._sendRaw({
      type: "workspace.watch",
      enabled,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Subagent Operations                                                      */
  /* ------------------------------------------------------------------------ */

  public async invokeSubagent(params: any, parentId?: string): Promise<any> {
    const result = await this._callRpc("subagent.invoke", { params, parentId });
    return result.result;
  }

  public async manageSubagents(params: any, callerId?: string): Promise<any> {
    const result = await this._callRpc("subagent.manage", { params, callerId });
    return result.result;
  }

  public async sendMessage(params: any, senderId: string): Promise<any> {
    const result = await this._callRpc("subagent.sendMessage", { params, senderId });
    return result.result;
  }

  public async defineSubagent(params: any): Promise<any> {
    const result = await this._callRpc("subagent.define", { params });
    return result.result;
  }

  /* ------------------------------------------------------------------------ */
  /* Task & Schedule Operations                                               */
  /* ------------------------------------------------------------------------ */

  public async manageTask(params: any): Promise<any> {
    const result = await this._callRpc("task.manage", { params });
    return result.result;
  }

  public async createSchedule(params: any, creatorSubagentId?: string): Promise<any> {
    const result = await this._callRpc("schedule.create", { params, creatorSubagentId });
    return result.result;
  }

  /* ------------------------------------------------------------------------ */
  /* Memory Operations                                                        */
  /* ------------------------------------------------------------------------ */

  public async setMemory(params: any, authorInfo?: any): Promise<any> {
    const result = await this._callRpc("memory.set", { params, authorInfo });
    return result.result;
  }

  public async getMemory(params: any): Promise<any> {
    const result = await this._callRpc("memory.get", { params });
    return result.result;
  }

  public async queryMemory(params: any): Promise<any> {
    const result = await this._callRpc("memory.query", { params });
    return result.result;
  }

  public async deleteMemory(params: any): Promise<any> {
    const result = await this._callRpc("memory.delete", { params });
    return result.result;
  }

  /* ------------------------------------------------------------------------ */
  /* Private Internal Helpers                                                 */
  /* ------------------------------------------------------------------------ */

  private async _sendRaw(message: any): Promise<void> {
    if (!this.isConnected()) {
      await this.connect();
    }
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    this._ws.send(payload);
  }

  private async _callRpc<T = any>(type: string, payload: Record<string, any>): Promise<T> {
    const requestId = crypto.randomUUID();
    const timeoutMs = this._options.timeoutMs || 10000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRpcs.delete(requestId);
        reject(new TimeoutError(`RPC call "${type}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pendingRpcs.set(requestId, { resolve, reject, timer });

      this._sendRaw({
        type,
        requestId,
        ...payload,
      }).catch((err) => {
        clearTimeout(timer);
        this._pendingRpcs.delete(requestId);
        reject(err);
      });
    });
  }

  private _handleMessage(raw: any): void {
    let msg: any;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg !== "object") return;

    // Handle RPC response frames
    if (msg.requestId && this._pendingRpcs.has(msg.requestId)) {
      const rpc = this._pendingRpcs.get(msg.requestId)!;
      clearTimeout(rpc.timer);
      this._pendingRpcs.delete(msg.requestId);
      if (msg.type === "error") {
        rpc.reject(new NanoForgeError(msg.message || "RPC failed"));
      } else {
        rpc.resolve(msg);
      }
      return;
    }

    // Route event to active run stream queue if applicable
    let queue: EventStreamQueue<RunEvent> | undefined;

    if (msg.runId && this._activeStreams.has(msg.runId)) {
      queue = this._activeStreams.get(msg.runId);
    }

    const planId =
      msg.planId ||
      (msg.data && typeof msg.data === "object" ? (msg.data as any).planId : undefined) ||
      (msg.event && typeof msg.event === "object" ? (msg.event as any).planId : undefined);

    if (!queue && planId && this._activeStreams.has(planId)) {
      queue = this._activeStreams.get(planId);
      if (msg.runId && queue) {
        this._activeStreams.set(msg.runId, queue);
      }
    }

    if (!queue && msg.runId && this._pendingStreamPlans.length > 0) {
      if (planId) {
        const matchIdx = this._pendingStreamPlans.findIndex((p) => p.planId === planId);
        if (matchIdx !== -1) {
          const match = this._pendingStreamPlans[matchIdx];
          queue = match.queue;
          this._activeStreams.set(msg.runId, queue);
          this._pendingStreamPlans.splice(matchIdx, 1);
        }
      } else {
        const firstPending = this._pendingStreamPlans.shift();
        if (firstPending) {
          queue = firstPending.queue;
          this._activeStreams.set(msg.runId, queue);
        }
      }
    }

    if (queue) {
      const runEvent: RunEvent = {
        type: msg.type,
        runId: msg.runId || planId || "",
        at: msg.at || new Date().toISOString(),
        state: msg.state,
        event: msg.event,
        data: msg.data,
        chunk: msg.chunk,
        stream: msg.stream,
        truncated: msg.truncated,
        detail: msg.detail,
        error: msg.message,
        requestId: msg.requestId,
      };
      queue.push(runEvent);

      const isTerminal =
        (msg.type === "run.state" && ["done", "error", "cancelled"].includes(msg.state)) ||
        (msg.type === "run.event" &&
          ["run.completed", "run.failed", "run.cancelled", "run.halted"].includes(msg.event));

      if (isTerminal) {
        queue.finish();
      }
    }

    // Emit typed events to listeners
    this.emit(msg.type, msg);
    this.emit("message", msg);

    if (msg.type === "tool.approval_required") {
      this.emit("approval_required", {
        requestId: msg.requestId,
        runId: msg.runId,
        request: msg.request,
        reason: msg.reason,
        at: msg.at,
      } as ToolCallRequest);
    }
  }
}

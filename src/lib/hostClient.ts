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

/* ------------------------------------------------------------------ */
/* Wire message shapes                                                */
/* ------------------------------------------------------------------ */

export type HostClientRequestType =
  | "plan.submit"
  | "approval.grant"
  | "approval.deny"
  | "run.pause"
  | "run.cancel";

export interface HostClientRequest {
  type: HostClientRequestType;
  requestId: string;
  plan?: ExecutionPlan;
  runId?: string;
  stepId?: string;
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
}

export interface HostErrorMessage {
  type: "error";
  code: string;
  message: string;
  runId?: string;
}

export type HostMessage =
  | RunStateMessage
  | ToolApprovalRequiredMessage
  | ToolOutputMessage
  | RunEventMessage
  | HostErrorMessage;

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
    default:
      return null;
  }
}

export type HostEventHandler = (msg: HostMessage) => void;

interface PendingRequest {
  resolve: () => void;
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
          p.resolve();
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

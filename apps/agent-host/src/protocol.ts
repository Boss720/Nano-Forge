/**
 * WebSocket protocol contracts — Module 2, Task 4.
 *
 * Zod schemas for every message that crosses
 * `ws://127.0.0.1:<port>/agent?token=<single-use-token>`, in both directions.
 * The host validates EVERY incoming client message; a schema violation closes
 * the socket with code 4400. The UI `hostClient` (Task 7) consumes the
 * inferred TypeScript types exported here, so event/state names are frozen:
 * run states are exactly `queued | approval_required | running | done |
 * error | cancelled`.
 */
import { z } from "zod";
import type { ExecutionPlan } from "@protocol/plan";

/** Canonical run lifecycle states shared with the UI tool cards. */
export const RUN_STATES = [
  "queued",
  "approval_required",
  "running",
  "done",
  "error",
  "cancelled",
] as const;

export const runStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof runStateSchema>;

/** Bounded identifier (plan ids, run ids, approval request ids). */
const idSchema = z.string().min(1).max(128);

/** ISO-8601 timestamp carried by every host-originated event. */
const atSchema = z.string().min(1);

/**
 * Wire shape of a tool execution proposal. Mirrors
 * `policy/policy.ts` `ToolRequest` (kind "terminal.exec"); later kinds
 * (browser.*, mcp.call) extend this object literal union.
 */
export const toolRequestSchema = z.object({
  kind: z.literal("terminal.exec"),
  cwd: z.string().min(1).max(4096),
  executable: z.string().min(1).max(1024),
  args: z.array(z.string().max(8192)).max(256),
});
export type ToolRequestMessage = z.infer<typeof toolRequestSchema>;

/**
 * Plan payload for `plan.submit`. Structurally tolerant (unknown step fields
 * pass through) so the wire protocol stays compatible with
 * `@protocol/plan`'s {@link ExecutionPlan} as it evolves; the host re-validates
 * plans with the Task 2 validator before executing anything.
 */
export const planSubmitSchema = z.object({
  type: z.literal("plan.submit"),
  plan: z.looseObject({
    id: idSchema,
    goal: z.string().max(8192),
    steps: z.array(z.looseObject({ id: idSchema })).max(512),
  }),
});

/* ------------------------------------------------------------------------ */
/* Workspace Types                                                          */
/* ------------------------------------------------------------------------ */

export const dirEntrySchema = z.object({
  name: z.string(),
  isDir: z.boolean(),
  size: z.number().optional(),
  modified: z.string().optional(),
});
export type DirEntry = z.infer<typeof dirEntrySchema>;

export const fileStatSchema = z.object({
  size: z.number(),
  modified: z.string(),
  isDir: z.boolean(),
  isFile: z.boolean(),
});
export type FileStat = z.infer<typeof fileStatSchema>;

export const searchMatchSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
  text: z.string(),
  matchText: z.string(),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

export const gitFileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(["M", "A", "D", "R", "?", "!"]),
});
export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;

/* ------------------------------------------------------------------------ */
/* Client -> Host                                                           */
/* ------------------------------------------------------------------------ */

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  planSubmitSchema,
  z.object({ type: z.literal("approval.grant"), requestId: idSchema }),
  z.object({
    type: z.literal("approval.deny"),
    requestId: idSchema,
    reason: z.string().max(4096).optional(),
  }),
  z.object({ type: z.literal("run.pause"), runId: idSchema }),
  z.object({ type: z.literal("run.resume"), runId: idSchema }),
  z.object({
    type: z.literal("run.cancel"),
    runId: idSchema,
    reason: z.string().max(4096).optional(),
  }),
  /** Client answer to a host `tool.approval_required` request. */
  z.object({
    type: z.literal("tool.response"),
    requestId: idSchema,
    approved: z.boolean(),
    reason: z.string().max(4096).optional(),
  }),
  // Workspace RPCs
  z.object({ type: z.literal("workspace.readDir"), requestId: idSchema, path: z.string() }),
  z.object({ type: z.literal("workspace.readFile"), requestId: idSchema, path: z.string() }),
  z.object({ type: z.literal("workspace.writeFile"), requestId: idSchema, path: z.string(), content: z.string() }),
  z.object({ type: z.literal("workspace.stat"), requestId: idSchema, path: z.string() }),
  z.object({
    type: z.literal("workspace.search"),
    requestId: idSchema,
    query: z.string(),
    options: z.object({
      caseSensitive: z.boolean().optional(),
      includes: z.array(z.string()).optional(),
      maxResults: z.number().optional(),
    }).optional(),
  }),
  z.object({ type: z.literal("workspace.gitStatus"), requestId: idSchema }),
  z.object({ type: z.literal("workspace.watch"), enabled: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];

/* ------------------------------------------------------------------------ */
/* Host -> Client                                                           */
/* ------------------------------------------------------------------------ */

export const hostMessageSchema = z.discriminatedUnion("type", [
  /** First frame after a successful handshake. */
  z.object({
    type: z.literal("host.ready"),
    version: z.string(),
    hostId: idSchema,
    at: atSchema,
  }),
  z.object({ type: z.literal("pong"), at: atSchema }),
  /** Run lifecycle transition; `state` is one of RUN_STATES. */
  z.object({
    type: z.literal("run.state"),
    runId: idSchema,
    state: runStateSchema,
    at: atSchema,
    detail: z.string().max(4096).optional(),
  }),
  /** Policy/approval gate: execution pauses until the client answers. */
  z.object({
    type: z.literal("tool.approval_required"),
    requestId: idSchema,
    runId: idSchema,
    request: toolRequestSchema,
    reason: z.string().max(4096),
    at: atSchema,
  }),
  /** Incremental terminal output. */
  z.object({
    type: z.literal("tool.output"),
    runId: idSchema,
    requestId: idSchema.optional(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
    truncated: z.boolean(),
    at: atSchema,
  }),
  /** Generic run-scoped event (pause requested, artifact written, ...). */
  z.object({
    type: z.literal("run.event"),
    runId: idSchema,
    event: z.string().min(1).max(128),
    data: z.unknown().optional(),
    at: atSchema,
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1).max(128),
    message: z.string().max(4096),
    runId: idSchema.optional(),
    at: atSchema.optional(),
  }),
  // Workspace RPC Results
  z.object({ type: z.literal("workspace.readDir.result"), requestId: idSchema, path: z.string(), entries: z.array(dirEntrySchema) }),
  z.object({ type: z.literal("workspace.readFile.result"), requestId: idSchema, path: z.string(), content: z.string(), language: z.string(), size: z.number() }),
  z.object({ type: z.literal("workspace.writeFile.result"), requestId: idSchema, path: z.string(), success: z.boolean() }),
  z.object({ type: z.literal("workspace.stat.result"), requestId: idSchema, path: z.string(), stat: fileStatSchema }),
  z.object({ type: z.literal("workspace.search.result"), requestId: idSchema, matches: z.array(searchMatchSchema) }),
  z.object({ type: z.literal("workspace.gitStatus.result"), requestId: idSchema, files: z.array(gitFileStatusSchema) }),
  z.object({ type: z.literal("workspace.fileChanged"), path: z.string(), changeType: z.enum(["created", "modified", "deleted"]) }),
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;
export type HostMessageType = HostMessage["type"];

/** Convenience extracts for the UI hostClient. */
export type RunStateMessage = Extract<HostMessage, { type: "run.state" }>;
export type ToolApprovalRequiredMessage = Extract<
  HostMessage,
  { type: "tool.approval_required" }
>;
export type ToolOutputMessage = Extract<HostMessage, { type: "tool.output" }>;
export type RunEventMessage = Extract<HostMessage, { type: "run.event" }>;
export type HostErrorMessage = Extract<HostMessage, { type: "error" }>;

/** Structural type of a submitted plan payload (aligned with @protocol/plan). */
export type SubmittedPlan = Pick<ExecutionPlan, "id" | "goal"> & {
  steps: Array<Pick<ExecutionPlan["steps"][number], "id">> &
    Record<string, unknown>;
};

export type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: "invalid_json" | "schema_violation" };

/**
 * Parse and validate one raw inbound WebSocket frame. The server closes the
 * socket with 4400 on any `{ ok: false }` result.
 */
export function decodeClientMessage(raw: unknown): DecodeResult {
  let parsed: unknown = raw;
  if (typeof raw === "string" || raw instanceof Buffer || Array.isArray(raw)) {
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  const result = clientMessageSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: "schema_violation" };
  return { ok: true, message: result.data };
}

export interface NanoModel {
  id: string;
  name: string;
  provider: string;
  /** USD per 1M tokens */
  inputPrice: number;
  outputPrice: number;
  contextK: number;
  tags: string[];
  /** true when returned by the live /api/v1/models endpoint */
  live?: boolean;
  /** true when pricing came from the magnitude heuristic, not explicit per-token fields */
  priceEstimated?: boolean;
}

export type ToolKind = "read_file" | "edit_file" | "run_command" | "search" | "think";

export interface ToolCall {
  id: string;
  kind: ToolKind;
  title: string;
  detail: string;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface Patch {
  file: string;
  lines: DiffLine[];
  status: "pending" | "applied" | "rejected";
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  patch?: Patch;
  usage?: { input: number; output: number; costUsd: number };
  model?: string;
  /**
   * Task 2.2: marks messages produced by the edit-verify auto-loop
   * (verification prompt + the model's reply). Stored with role
   * "user"/"assistant" (NOT "system") so they stay in the wire context built
   * by `handleSend`, which filters out role === "system". The transcript
   * renders them collapsed.
   */
  auto?: boolean;
  ts: number;
}

/** Task 2.3: per-model generation settings, persisted in localStorage. */
export interface GenerationPrefs {
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_GEN_PREFS: GenerationPrefs = { temperature: 0.3, maxTokens: 4096 };

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
}

export interface ConnectionState {
  apiKey: string;
  baseUrl: string;
  status: "disconnected" | "checking" | "connected" | "error";
  error?: string;
  liveModels: boolean;
}

export interface UsageTotals {
  input: number;
  output: number;
  costUsd: number;
  requests: number;
}

export interface VirtualFile {
  path: string;
  language: string;
  content: string;
}

/**
 * Final roadmap phase (cost dashboard): one immutable record per finished
 * run. Persisted alongside the aggregate `UsageTotals` so per-model and
 * per-day breakdowns stay available after restart. Helpers live in
 * `src/lib/usageLog.ts`.
 */
export interface UsageRun {
  id: string;
  /** Epoch milliseconds when the run finished. */
  ts: number;
  modelId: string;
  input: number;
  output: number;
  costUsd: number;
  /** Errored runs are recorded for audit but are not billable requests. */
  errored?: boolean;
}

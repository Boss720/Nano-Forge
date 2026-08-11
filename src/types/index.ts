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
  ts: number;
}

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

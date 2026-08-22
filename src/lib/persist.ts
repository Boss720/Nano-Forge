import type { Chat, Session, UsageRun, UsageTotals, VirtualFile, Workspace } from "@/types";

/**
 * Versioned localStorage persistence. Version 1 stored a flat `sessions`
 * array; version 2 stores `workspaces` containing `chats`. Files remain a
 * global field deliberately, so workspace removal can never remove files.
 */
export const STORAGE_KEY = "nanoforge.v1";
export const LEGACY_STATE_VERSION = 1;
export const WORKSPACE_STATE_VERSION = 2;
export const STATE_VERSION = 3;

export interface LegacyPersistedState {
  version: typeof LEGACY_STATE_VERSION;
  sessions: Session[];
  usage: UsageTotals;
  files: VirtualFile[];
  runs?: UsageRun[];
}

/** Compatibility shape used by older fixtures and pre-workspace clients. */
export interface LegacyCompatibilityState {
  version: typeof LEGACY_STATE_VERSION;
  sessions: unknown[];
  usage: Record<string, unknown>;
  files: unknown[];
  runs?: unknown;
}

export type PersistedUsage = UsageTotals & {
  inputTokens?: number;
  outputTokens?: number;
};

export interface PersistedState {
  version: typeof STATE_VERSION;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeChatId: string;
  usage: PersistedUsage;
  files: VirtualFile[];
  runs?: UsageRun[];
  /** Legacy read aliases retained for older integrations during migration. */
  sessions?: unknown[];
}

/** The version-2 workspace state, retained solely for migration. */
interface PersistedStateV2 extends Omit<PersistedState, "version"> {
  version: typeof WORKSPACE_STATE_VERSION;
}

export type PersistedStateInput =
  | Omit<PersistedState, "version">
  | Omit<LegacyPersistedState, "version">
  | Omit<LegacyCompatibilityState, "version">;

/** The subset of the DOM Storage API we rely on. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DEFAULT_WORKSPACE_ID = "workspace-default";

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    typeof value.model === "string" &&
    typeof value.createdAt === "number"
  );
}

function isChat(value: unknown): value is Chat {
  if (!isSession(value)) return false;
  const chat = value as Chat;
  return (
    (chat.archived === undefined || typeof chat.archived === "boolean") &&
    (chat.pinned === undefined || typeof chat.pinned === "boolean")
  );
}

function isWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    Array.isArray(value.chats) &&
    value.chats.every(isChat) &&
    (value.archived === undefined || typeof value.archived === "boolean") &&
    (value.pinned === undefined || typeof value.pinned === "boolean") &&
    (value.location === undefined || isWorkspaceLocation(value.location))
  );
}

function isWorkspaceLocation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.kind === "local" &&
    typeof value.hostWorkspaceId === "string" &&
    typeof value.displayPath === "string" &&
    typeof value.lastOpenedAt === "number" &&
    (value.status === undefined || value.status === "ready" || value.status === "unavailable" || value.status === "connecting");
}

function isUsage(value: unknown): value is UsageTotals {
  if (!isRecord(value)) return false;
  return ["input", "output", "costUsd", "requests"].every(
    (key) => typeof value[key] === "number",
  );
}

function isLegacyPersistedState(value: unknown): value is LegacyPersistedState {
  if (!isRecord(value)) return false;
  return (
    value.version === LEGACY_STATE_VERSION &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isSession) &&
    isUsage(value.usage) &&
    Array.isArray(value.files) &&
    (value.runs === undefined || Array.isArray(value.runs))
  );
}

function isLegacyCompatibilityState(value: unknown): value is LegacyCompatibilityState {
  if (!isRecord(value)) return false;
  return (
    value.version === LEGACY_STATE_VERSION &&
    Array.isArray(value.sessions) &&
    isRecord(value.usage) &&
    Array.isArray(value.files) &&
    (value.runs === undefined || Array.isArray(value.runs))
  );
}

function normalizeUsage(usage: Record<string, unknown>): PersistedUsage {
  const input = typeof usage.input === "number" ? usage.input : typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
  const output = typeof usage.output === "number" ? usage.output : typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
  const costUsd = typeof usage.costUsd === "number" ? usage.costUsd : 0;
  const requests = typeof usage.requests === "number" ? usage.requests : 0;
  return {
    input,
    output,
    costUsd,
    requests,
    ...(typeof usage.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
    ...(typeof usage.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
  };
}

function compatibilityChat(value: unknown, index: number): Chat {
  if (isChat(value)) return { ...value };
  const record = isRecord(value) ? value : {};
  const turns = Array.isArray(record.turns) ? record.turns : [];
  const messages = Array.isArray(record.messages)
    ? record.messages
    : turns.map((turn, turnIndex) => {
        const item = isRecord(turn) ? turn : {};
        const role = item.role === "user" || item.role === "system" ? item.role : "assistant";
        return {
          id: typeof item.id === "string" ? item.id : `legacy-message-${index}-${turnIndex}`,
          role,
          content: typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "",
          ts: typeof item.ts === "number" ? item.ts : Date.now() + turnIndex,
        };
      });
  return {
    id: typeof record.id === "string" ? record.id : `legacy-chat-${index}`,
    title: typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : "Untitled chat",
    messages: messages as Chat["messages"],
    model: typeof record.model === "string" ? record.model : "unknown",
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
  };
}

function migrateLegacyCompatibilityState(state: LegacyCompatibilityState): PersistedState {
  const chats = state.sessions.map(compatibilityChat);
  const workspace: Workspace = {
    id: DEFAULT_WORKSPACE_ID,
    name: "Default workspace",
    chats,
    createdAt: chats[0]?.createdAt ?? Date.now(),
  };
  return {
    version: STATE_VERSION,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeChatId: chats[0]?.id ?? "",
    usage: normalizeUsage(state.usage),
    files: state.files as VirtualFile[],
    ...(Array.isArray(state.runs) ? { runs: state.runs as UsageRun[] } : {}),
    sessions: state.sessions,
  };
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!isRecord(value)) return false;
  return (
    value.version === STATE_VERSION &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every(isWorkspace) &&
    typeof value.activeWorkspaceId === "string" &&
    typeof value.activeChatId === "string" &&
    isUsage(value.usage) &&
    Array.isArray(value.files) &&
    (value.runs === undefined || Array.isArray(value.runs))
  );
}

function isPersistedStateV2(value: unknown): value is PersistedStateV2 {
  if (!isRecord(value)) return false;
  return value.version === WORKSPACE_STATE_VERSION &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every(isWorkspace) &&
    typeof value.activeWorkspaceId === "string" &&
    typeof value.activeChatId === "string" &&
    isUsage(value.usage) &&
    Array.isArray(value.files) &&
    (value.runs === undefined || Array.isArray(value.runs));
}

function migrateWorkspaceStateV2(state: PersistedStateV2): PersistedState {
  return sanitizePersistedState({ ...state, version: STATE_VERSION });
}

/** Drops unknown location properties (notably legacy absolute roots) on every read/write boundary. */
function sanitizePersistedState(state: PersistedState): PersistedState {
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) => {
      if (!workspace.location) return workspace;
      const { kind, hostWorkspaceId, displayPath, lastOpenedAt, status } = workspace.location;
      return { ...workspace, location: { kind, hostWorkspaceId, displayPath, lastOpenedAt, ...(status ? { status } : {}) } };
    }),
  };
}

/** Converts the old flat schema into the normalized workspace schema. */
export function migrateLegacyState(state: LegacyPersistedState): PersistedState {
  const workspace: Workspace = {
    id: DEFAULT_WORKSPACE_ID,
    name: "Default workspace",
    chats: state.sessions.map((session) => ({ ...session })),
    createdAt: state.sessions[0]?.createdAt ?? Date.now(),
  };
  return {
    version: STATE_VERSION,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeChatId: workspace.chats[0]?.id ?? "",
    usage: state.usage,
    files: state.files,
    ...(state.runs === undefined ? {} : { runs: state.runs }),
  };
}

/**
 * Saves either a new workspace payload or a legacy flat payload. Accepting
 * the latter keeps old persistence consumers source-compatible; it is
 * normalized to the current version on write.
 */
export function saveState(
  state: PersistedStateInput,
  storage: StorageLike | undefined = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    const legacyCandidate = { version: LEGACY_STATE_VERSION, ...state };
    const payload = "workspaces" in state
      ? ({ version: STATE_VERSION, ...state } satisfies PersistedState)
      : isLegacyPersistedState(legacyCandidate)
        ? migrateLegacyState(legacyCandidate)
        : migrateLegacyCompatibilityState(legacyCandidate as LegacyCompatibilityState);
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizePersistedState(payload)));
    return true;
  } catch {
    return false;
  }
}

/** Reads, validates, and migrates persisted state without throwing. */
export function loadState(
  storage: StorageLike | undefined = defaultStorage(),
): PersistedState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (isPersistedState(parsed)) return sanitizePersistedState(parsed);
    if (isPersistedStateV2(parsed)) return migrateWorkspaceStateV2(parsed);
    if (isLegacyPersistedState(parsed)) return migrateLegacyState(parsed);
    if (isLegacyCompatibilityState(parsed)) return migrateLegacyCompatibilityState(parsed);
    return null;
  } catch {
    return null;
  }
}

export interface DebouncedSaver {
  (state: PersistedStateInput): void;
  flush(): void;
  cancel(): void;
}

export function createDebouncedSaver(
  delayMs = 500,
  storage: StorageLike | undefined = defaultStorage(),
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedStateInput | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      const state = pending;
      pending = null;
      saveState(state, storage);
    }
  };

  const saver = ((state: PersistedStateInput) => {
    pending = state;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending !== null) {
        const next = pending;
        pending = null;
        saveState(next, storage);
      }
    }, delayMs);
  }) as DebouncedSaver;

  saver.flush = flush;
  saver.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };
  return saver;
}

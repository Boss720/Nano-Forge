import type { Session, UsageRun, UsageTotals, VirtualFile } from "@/types";

/**
 * localStorage persistence (roadmap Task 3.1).
 *
 * State is serialized as `{ version: 1, sessions, usage, files }` under the
 * key `nanoforge.v1`. The `version` field leaves room for future migrations;
 * any payload whose version does not match is treated as absent.
 *
 * All functions accept an optional `storage` parameter (any Storage-like
 * object) defaulting to `globalThis.localStorage`, so they are testable in a
 * node environment and usable with sessionStorage or in-memory stubs.
 *
 * Error policy: `loadState` NEVER throws — missing key, corrupted JSON,
 * version mismatch, or a throwing storage all yield `null`. `saveState`
 * returns `false` instead of throwing (e.g. quota exceeded).
 */

export const STORAGE_KEY = "nanoforge.v1";
export const STATE_VERSION = 1;

export interface PersistedState {
  version: typeof STATE_VERSION;
  sessions: Session[];
  usage: UsageTotals;
  files: VirtualFile[];
  /**
   * Final roadmap phase (cost dashboard): per-run usage records. Optional
   * and additive — `STATE_VERSION` stays 1, and saves written before this
   * field existed load with `runs === undefined` (NOT an empty array), so
   * callers should default with `loaded.runs ?? []`.
   */
  runs?: UsageRun[];
}

/** The subset of the DOM Storage API we rely on. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined; // accessing localStorage can throw (e.g. blocked cookies)
  }
}

/** True when `value` has the shape of a v1 persisted payload. */
function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === STATE_VERSION &&
    Array.isArray(v.sessions) &&
    Array.isArray(v.files) &&
    typeof v.usage === "object" &&
    v.usage !== null &&
    // `runs` is optional, but when present it must be an array.
    (v.runs === undefined || Array.isArray(v.runs))
  );
}

/**
 * Serializes `{ version: 1, sessions, usage, files }` to storage.
 * Returns `true` on success, `false` when storage is unavailable or throws.
 */
export function saveState(
  state: Omit<PersistedState, "version">,
  storage: StorageLike | undefined = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    const payload: PersistedState = { version: STATE_VERSION, ...state };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and validates persisted state. Returns `null` (never throws) when
 * the key is missing, the JSON is corrupted, the version mismatches, the
 * shape is wrong, or storage itself is unavailable.
 */
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
      return null; // corrupted JSON
    }
    return isPersistedState(parsed) ? parsed : null; // version / shape mismatch
  } catch {
    return null;
  }
}

/**
 * A debounced save function plus imperative controls. Calling it schedules a
 * save `delayMs` in the future; each subsequent call resets the timer and
 * replaces the pending payload, so a burst of changes coalesces into one
 * write with the LATEST state.
 */
export interface DebouncedSaver {
  (state: Omit<PersistedState, "version">): void;
  /** Writes the pending payload immediately (no-op if none is pending). */
  flush(): void;
  /** Drops any pending payload without saving. */
  cancel(): void;
}

/**
 * Returns a debounced saver (default delay 500ms per the roadmap).
 * Uses injectable storage and the ambient timer; tests can drive it with
 * `vi.useFakeTimers()`.
 */
export function createDebouncedSaver(
  delayMs = 500,
  storage: StorageLike | undefined = defaultStorage(),
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Omit<PersistedState, "version"> | null = null;

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

  const saver = ((state: Omit<PersistedState, "version">) => {
    pending = state;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending !== null) {
        const s = pending;
        pending = null;
        saveState(s, storage);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, UsageTotals, VirtualFile } from "@/types";
import {
  createDebouncedSaver,
  loadState,
  saveState,
  STORAGE_KEY,
  type PersistedState,
  type StorageLike,
} from "@/lib/persist";

/** Minimal in-memory Storage stub (vitest runs with environment "node"). */
function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
  setItemCalls: number;
} {
  const store = {
    data: { ...initial },
    setItemCalls: 0,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store.data, key) ? store.data[key] : null;
    },
    setItem(key: string, value: string) {
      store.setItemCalls++;
      store.data[key] = String(value);
    },
    removeItem(key: string) {
      delete store.data[key];
    },
  };
  return store;
}

function makeState(): Omit<PersistedState, "version"> {
  const sessions: Session[] = [
    {
      id: "s1",
      title: "Demo",
      model: "gpt-nano",
      createdAt: 1720000000000,
      messages: [{ id: "m1", role: "user", content: "hi", ts: 1720000000001 }],
    },
  ];
  const usage: UsageTotals = { input: 120, output: 45, costUsd: 0.0021, requests: 3 };
  const files: VirtualFile[] = [{ path: "src/server.ts", language: "ts", content: "// code" }];
  return { sessions, usage, files };
}

describe("saveState / loadState round-trip", () => {
  it("round-trips sessions, usage and files under nanoforge.v1 with version 1", () => {
    const storage = makeStorage();
    const state = makeState();

    expect(saveState(state, storage)).toBe(true);

    const raw = storage.data[STORAGE_KEY];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw).version).toBe(1);

    const loaded = loadState(storage);
    expect(loaded).toEqual({ version: 1, ...state });
  });

  it("returns null when the key is missing", () => {
    expect(loadState(makeStorage())).toBeNull();
  });

  it("returns null on corrupted JSON (never throws)", () => {
    const storage = makeStorage({ [STORAGE_KEY]: "{not valid json!!!" });
    expect(loadState(storage)).toBeNull();
  });

  it("returns null on version mismatch (never throws)", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, ...makeState() }));
    expect(loadState(storage)).toBeNull();
  });

  it("returns null when required fields have the wrong shape", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessions: "oops", usage: {}, files: [] }));
    expect(loadState(storage)).toBeNull();
  });

  it("returns null instead of throwing when storage itself throws", () => {
    const broken: StorageLike = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {},
    };
    expect(loadState(broken)).toBeNull();
    expect(saveState(makeState(), broken)).toBe(false);
  });
});

describe("createDebouncedSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid calls into a single write with the latest state", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(500, storage);

    saver({ ...makeState(), sessions: [] });
    saver({ ...makeState(), files: [] });
    saver(makeState()); // latest wins

    vi.advanceTimersByTime(499);
    expect(storage.setItemCalls).toBe(0);

    vi.advanceTimersByTime(1);
    expect(storage.setItemCalls).toBe(1);
    expect(loadState(storage)).toEqual({ version: 1, ...makeState() });
  });

  it("uses a 500ms delay by default", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(undefined, storage);
    saver(makeState());
    vi.advanceTimersByTime(499);
    expect(storage.setItemCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.setItemCalls).toBe(1);
  });

  it("flush() writes the pending payload immediately", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(500, storage);
    saver(makeState());
    saver.flush();
    expect(storage.setItemCalls).toBe(1);
    // The timer was cleared; nothing more fires later.
    vi.advanceTimersByTime(10_000);
    expect(storage.setItemCalls).toBe(1);
  });

  it("cancel() drops the pending payload", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(500, storage);
    saver(makeState());
    saver.cancel();
    vi.advanceTimersByTime(10_000);
    expect(storage.setItemCalls).toBe(0);
  });
});

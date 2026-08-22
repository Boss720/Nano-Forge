import { describe, expect, it } from "vitest";
import { MemoryAttachmentSnapshotStore } from "@/lib/attachments/snapshots";

describe("MemoryAttachmentSnapshotStore", () => {
  it("stores, overwrites, and removes snapshots deterministically", async () => {
    const store = new MemoryAttachmentSnapshotStore();
    await store.save("one", "first");
    await store.save("one", "second");
    expect(await store.load("one")).toBe("second");
    await store.remove("one");
    expect(await store.load("one")).toBeUndefined();
  });
});

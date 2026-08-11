import { describe, expect, it } from "vitest";
import type { DiffLine, Patch } from "@/types";
import { VIRTUAL_PROJECT } from "@/lib/catalog";
import { applyPatch, revertPatch } from "@/lib/vfs";

/**
 * Mirror of the RATE_LIMIT_PATCH diff in src/lib/demoAgent.ts (not exported
 * there), wrapped as a Patch targeting the virtual project's server file.
 */
const RATE_LIMIT_LINES: DiffLine[] = [
  { type: "ctx", text: 'import http from "node:http";' },
  { type: "add", text: 'import { allow } from "./rate-limit.js";' },
  { type: "ctx", text: "" },
  { type: "ctx", text: "const PORT = Number(process.env.PORT ?? 8080);" },
  { type: "del", text: "" },
  { type: "add", text: "" },
  { type: "add", text: "const WINDOW_MS = 60_000;" },
  { type: "add", text: "const MAX_REQUESTS = 60;" },
  { type: "ctx", text: "" },
  { type: "ctx", text: "const server = http.createServer((req, res) => {" },
  { type: "add", text: '  const key = req.socket.remoteAddress ?? "anon";' },
  { type: "add", text: "  if (!allow(key, MAX_REQUESTS, WINDOW_MS)) {" },
  { type: "add", text: '    res.writeHead(429, { "retry-after": "60" });' },
  { type: "add", text: '    res.end("rate limit exceeded");' },
  { type: "add", text: "    return;" },
  { type: "add", text: "  }" },
  { type: "ctx", text: '  if (req.url === "/health") {' },
  { type: "del", text: '    res.writeHead(200, { "content-type": "application/json" });' },
  { type: "add", text: '    res.writeHead(200, { "content-type": "application/json", "x-rate-limit": String(MAX_REQUESTS) });' },
  { type: "ctx", text: '    res.end(JSON.stringify({ ok: true }));' },
  { type: "ctx", text: "    return;" },
  { type: "ctx", text: "  }" },
];

const PATCH: Patch = { file: "src/server.ts", lines: RATE_LIMIT_LINES, status: "pending" };

const DELETED_LINE = '    res.writeHead(200, { "content-type": "application/json" });';
const ADDED_LINE = '    res.writeHead(200, { "content-type": "application/json", "x-rate-limit": String(MAX_REQUESTS) });';

function contentOf(files: typeof VIRTUAL_PROJECT, path: string): string {
  const f = files.find((v) => v.path === path);
  if (!f) throw new Error(`missing ${path}`);
  return f.content;
}

describe("applyPatch", () => {
  it("applies RATE_LIMIT_PATCH: added lines in, deleted lines out", () => {
    const next = applyPatch(VIRTUAL_PROJECT, PATCH);
    const content = contentOf(next, "src/server.ts");

    expect(content).toContain("x-rate-limit");
    expect(content).toContain(ADDED_LINE);
    expect(content).toContain('import { allow } from "./rate-limit.js";');
    expect(content).not.toContain(DELETED_LINE);
    // context lines survive
    expect(content).toContain('const server = http.createServer((req, res) => {');
    // trailing-newline convention preserved
    expect(content.endsWith("\n")).toBe(true);
  });

  it("returns a new array and keeps identity of untouched files", () => {
    const next = applyPatch(VIRTUAL_PROJECT, PATCH);
    expect(next).not.toBe(VIRTUAL_PROJECT);
    for (const file of VIRTUAL_PROJECT) {
      const match = next.find((f) => f.path === file.path);
      if (file.path === PATCH.file) {
        expect(match).not.toBe(file);
        expect(match?.language).toBe(file.language);
      } else {
        expect(match).toBe(file);
      }
    }
    // input not mutated
    expect(contentOf(VIRTUAL_PROJECT, "src/server.ts")).not.toContain("x-rate-limit");
  });

  it("is a no-op for an unknown target path", () => {
    const ghost: Patch = { ...PATCH, file: "src/nope.ts" };
    const next = applyPatch(VIRTUAL_PROJECT, ghost);
    expect(next).toBe(VIRTUAL_PROJECT);
  });
});

describe("revertPatch", () => {
  it("reconstructs the original content: deleted lines back, added lines gone", () => {
    const next = revertPatch(VIRTUAL_PROJECT, PATCH);
    const content = contentOf(next, "src/server.ts");

    expect(content).toContain(DELETED_LINE);
    expect(content).not.toContain("x-rate-limit");
    expect(content).not.toContain(ADDED_LINE);
    expect(content).not.toContain('import { allow } from "./rate-limit.js";');
    expect(content).toContain('const server = http.createServer((req, res) => {');
  });

  it("restores the original lines after apply (round trip)", () => {
    const applied = applyPatch(VIRTUAL_PROJECT, PATCH);
    const restored = revertPatch(applied, PATCH);
    expect(contentOf(restored, "src/server.ts")).toBe(contentOf(revertPatch(VIRTUAL_PROJECT, PATCH), "src/server.ts"));
  });

  it("is a no-op for an unknown target path", () => {
    const ghost: Patch = { ...PATCH, file: "src/nope.ts" };
    expect(revertPatch(VIRTUAL_PROJECT, ghost)).toBe(VIRTUAL_PROJECT);
  });
});

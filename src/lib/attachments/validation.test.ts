import { describe, expect, it } from "vitest";
import { readBrowserFile, validateFileName } from "@/lib/attachments/validation";

function textFile(name: string, content: string, type = "text/plain"): File {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as File;
}

describe("browser attachment validation", () => {
  it("accepts UTF-8 text/code and keeps the content out of metadata concerns", async () => {
    const result = await readBrowserFile(textFile("example.ts", "export const ok = true;", "text/typescript"));
    expect(result.status).toBe("ready");
    expect(result.source).toBe("upload");
    expect(result.content).toContain("ok = true");
  });

  it("rejects secret, archive, executable, and binary inputs", async () => {
    expect(validateFileName(".env")).toMatch(/secrets/i);
    expect(validateFileName("bundle.zip")).toMatch(/secrets|binaries|archives/i);
    expect(validateFileName("run.exe")).toMatch(/secrets|binaries|archives/i);
    const binary = await readBrowserFile(textFile("payload.ts", "a\0b", "text/typescript"));
    expect(binary.status).toBe("error");
    expect(binary.error).toMatch(/binary/i);
  });
});

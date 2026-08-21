/**
 * Launcher Security & Path Confinement Adversarial Stress Test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStaticServer } = require("../nanoforge-launcher.cjs");

describe("Milestone 6 Challenger: Launcher Deep Security Boundary Checks", () => {
  let server: http.Server;
  let testPort: number;
  const testDist = path.resolve(__dirname, "../../dist");

  beforeEach(async () => {
    server = createStaticServer(testDist);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        testPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("probes sibling prefix collision vulnerability (e.g. dist vs dist-sibling)", () => {
    // If distRoot is .../dist
    // candidateFile resolving to .../dist_fake/file.txt
    const distRoot = "C:\\app\\dist";
    const fakeSiblingFile = "C:\\app\\dist_secrets\\passwords.txt";

    // Vulnerable check:
    const isVulnerableMatch = fakeSiblingFile.startsWith(distRoot);
    expect(isVulnerableMatch).toBe(true); // Demonstrates the flaw in startsWith(distRoot)

    // Secure check:
    const safePrefix = distRoot.endsWith(path.sep) ? distRoot : distRoot + path.sep;
    const isSecureMatch = fakeSiblingFile.startsWith(safePrefix) || fakeSiblingFile === distRoot;
    expect(isSecureMatch).toBe(false); // Secure check correctly blocks it
  });

  it("probes URI malformed crash on unhandled decodeURIComponent error", () => {
    const malformedUri = "/%ZZ%FF";
    expect(() => {
      decodeURIComponent(malformedUri);
    }).toThrow(URIError);
  });

  it("probes null byte uncaught exception in fs.stat", () => {
    const nullBytePath = "C:\\app\\dist\\test\0.txt";
    expect(() => {
      fs.stat(nullBytePath, () => {});
    }).toThrow(TypeError);
  });
});

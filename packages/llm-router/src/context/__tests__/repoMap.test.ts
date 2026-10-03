import { describe, it, expect } from "vitest";
import { RepositoryMapGenerator } from "../repoMap.js";

describe("RepositoryMapGenerator Suite", () => {
  it("generates a compact structured repository outline", () => {
    const generator = new RepositoryMapGenerator();
    const map = generator.generate({
      projectName: "NanoForge",
      runtime: "Node.js v22",
      framework: "Fastify + React 19",
      branch: "gem",
      packages: [
        {
          name: "@nanoforge/protocol",
          path: "packages/protocol",
          description: "Schemas and wire contracts",
          entryPoint: "src/index.ts",
        },
        {
          name: "@nanoforge/llm-router",
          path: "packages/llm-router",
          description: "Universal provider router and context engine",
          entryPoint: "src/index.ts",
        },
        {
          name: "agent-host",
          path: "apps/agent-host",
          description: "Fastify daemon and subagent supervisor",
          entryPoint: "src/server.ts",
        },
      ],
      keyFiles: ["docs/CURRENT_ARCHITECTURE.md", "docs/IMPLEMENTATION_PLAN.md"],
      testSuites: ["npm run test:protocol", "npm run test:host", "npm test"],
    });

    expect(map).toContain("## REPOSITORY MAP");
    expect(map).toContain("**Project**: NanoForge");
    expect(map).toContain("**Runtime / Framework**: Node.js v22 (Fastify + React 19)");
    expect(map).toContain("**Git Branch**: `gem`");
    expect(map).toContain("`@nanoforge/protocol` (`packages/protocol`) (entry: `src/index.ts`)");
    expect(map).toContain("`docs/CURRENT_ARCHITECTURE.md`");
    expect(map).toContain("npm run test:protocol");

    // Token footprint verification (< 250 words)
    const wordCount = map.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(150);
  });
});

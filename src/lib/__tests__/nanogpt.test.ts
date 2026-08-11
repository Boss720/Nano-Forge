import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, toPerMillion } from "../nanogpt";

describe("toPerMillion", () => {
  it("treats exactly 0.01 as already per-million (boundary)", () => {
    expect(toPerMillion(0.01)).toBe(0.01);
  });

  it("scales per-token values below 0.01 up to per-million", () => {
    expect(toPerMillion(0.00000175)).toBe(1.75);
    expect(toPerMillion(0.000014)).toBe(14);
    expect(toPerMillion(0.001)).toBe(1000);
  });

  it("passes through values already expressed per-million", () => {
    expect(toPerMillion(14)).toBe(14);
    expect(toPerMillion(1.75)).toBe(1.75);
  });

  it("accepts numeric strings", () => {
    expect(toPerMillion("0.00000175")).toBe(1.75);
    expect(toPerMillion("0.01")).toBe(0.01);
  });

  it("returns 0 for missing/invalid/non-positive input", () => {
    expect(toPerMillion(undefined)).toBe(0);
    expect(toPerMillion(null)).toBe(0);
    expect(toPerMillion("nope")).toBe(0);
    expect(toPerMillion(0)).toBe(0);
    expect(toPerMillion(-5)).toBe(0);
  });
});

function stubModelsResponse(data: Array<Record<string, unknown>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 })),
  );
}

describe("fetchModels pricing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers explicit pricing.prompt/completion as per-token values", async () => {
    stubModelsResponse([
      {
        id: "acme/x",
        name: "X",
        pricing: { prompt: "0.00000175", completion: "0.000014" },
        context_length: 64_000,
      },
    ]);
    const models = await fetchModels("http://example.test", "key");
    expect(models).toHaveLength(1);
    expect(models[0].inputPrice).toBe(1.75);
    expect(models[0].outputPrice).toBe(14);
    expect(models[0].priceEstimated).toBeUndefined();
    expect(models[0].contextK).toBe(64);
  });

  it("falls back to the magnitude heuristic and sets priceEstimated", async () => {
    stubModelsResponse([
      { id: "acme/y", pricing: { input: 2.5, output: 10 }, context_length: 32_000 },
    ]);
    const models = await fetchModels("http://example.test", "key");
    expect(models[0].inputPrice).toBe(2.5);
    expect(models[0].outputPrice).toBe(10);
    expect(models[0].priceEstimated).toBe(true);
  });

  it("sets priceEstimated when only one explicit per-token field is present", async () => {
    stubModelsResponse([
      { id: "acme/z", pricing: { prompt: "0.000001", output: 8 }, context_length: 32_000 },
    ]);
    const models = await fetchModels("http://example.test", "key");
    expect(models[0].inputPrice).toBe(1);
    expect(models[0].outputPrice).toBe(8);
    expect(models[0].priceEstimated).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, streamChat, toPerMillion } from "../nanogpt";

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

/** SSE body that streams one delta plus a usage frame, then terminates. */
function sseBody(): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function stubStreamResponse() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(sseBody(), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof stubStreamResponse>): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

function silentHandlers() {
  return { onDelta: () => {}, onDone: () => {}, onError: () => {} };
}

describe("streamChat generation options (Task 2.3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("omits temperature/max_tokens when no options are passed (backwards compatible)", async () => {
    const fetchMock = stubStreamResponse();
    await streamChat("http://example.test", "key", "model-x", [{ role: "user", content: "hi" }], silentHandlers());
    const body = requestBody(fetchMock);
    expect(body).toMatchObject({ model: "model-x", stream: true });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("passes temperature and maxTokens into the request body", async () => {
    const fetchMock = stubStreamResponse();
    await streamChat(
      "http://example.test",
      "key",
      "model-x",
      [{ role: "user", content: "hi" }],
      silentHandlers(),
      undefined,
      { temperature: 0.3, maxTokens: 4096 },
    );
    const body = requestBody(fetchMock);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(4096);
  });

  it("streams deltas and reports usage to the handlers", async () => {
    stubStreamResponse();
    const deltas: string[] = [];
    let usage: { input: number; output: number } | null = null;
    await streamChat(
      "http://example.test",
      "key",
      "model-x",
      [{ role: "user", content: "hi" }],
      { onDelta: (d) => deltas.push(d), onDone: (u) => (usage = u), onError: () => {} },
    );
    expect(deltas.join("")).toBe("hi");
    expect(usage).toEqual({ input: 3, output: 2 });
  });
});

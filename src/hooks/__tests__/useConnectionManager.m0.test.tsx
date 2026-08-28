// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_MODELS } from "@/lib/catalog";
import { DEFAULT_BASE_URL, fetchModels, validateKey } from "@/lib/nanogpt";
import { loadConnection, useConnectionManager } from "../useConnectionManager";

vi.mock("@/lib/nanogpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nanogpt")>("@/lib/nanogpt");
  return {
    ...actual,
    fetchModels: vi.fn(),
    validateKey: vi.fn(),
  };
});

const fetchModelsMock = vi.mocked(fetchModels);
const validateKeyMock = vi.mocked(validateKey);

const liveModel = {
  id: FALLBACK_MODELS[3].id,
  name: FALLBACK_MODELS[3].name,
  provider: FALLBACK_MODELS[3].provider,
  inputPrice: FALLBACK_MODELS[3].inputPrice,
  outputPrice: FALLBACK_MODELS[3].outputPrice,
  contextK: FALLBACK_MODELS[3].contextK,
  tags: FALLBACK_MODELS[3].tags,
  live: true as const,
};

describe("useConnectionManager M0 contract", () => {
  beforeEach(() => {
    localStorage.clear();
    validateKeyMock.mockReset();
    fetchModelsMock.mockReset();
    validateKeyMock.mockResolvedValue({ ok: true });
    fetchModelsMock.mockResolvedValue([liveModel]);
  });

  afterEach(() => cleanup());

  it("scrubs legacy apiKey storage while preserving only the base URL", () => {
    localStorage.setItem(
      "nanoforge.connection",
      JSON.stringify({ apiKey: "sk-legacy-secret", baseUrl: "https://nano-gpt.com/api/v1" }),
    );

    const loaded = loadConnection();

    expect(loaded).toEqual({
      apiKey: "",
      baseUrl: "https://nano-gpt.com/api/v1",
      status: "disconnected",
      liveModels: false,
    });
    expect(JSON.parse(localStorage.getItem("nanoforge.connection") ?? "{}")).toEqual({
      baseUrl: "https://nano-gpt.com/api/v1",
    });
  });

  it("persists only the safe base URL after a successful connect", async () => {
    const { result } = renderHook(() => useConnectionManager());

    await act(async () => {
      await result.current.handleConnect("sk-test-secret", DEFAULT_BASE_URL);
    });

    await waitFor(() => {
      expect(result.current.connection.status).toBe("connected");
    });

    expect(validateKeyMock).toHaveBeenCalledWith(DEFAULT_BASE_URL, "sk-test-secret");
    expect(JSON.parse(localStorage.getItem("nanoforge.connection") ?? "{}")).toEqual({
      baseUrl: DEFAULT_BASE_URL,
    });
    expect(localStorage.getItem("nanoforge.connection") ?? "").not.toContain("sk-test-secret");
  });
});

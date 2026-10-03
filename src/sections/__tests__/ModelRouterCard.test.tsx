// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelRouterCard,
  type CandidateScoreEntry,
  type CompactHandoffSummary,
} from "../ModelRouterCard";

afterEach(cleanup);

const mockCandidates: CandidateScoreEntry[] = [
  {
    modelId: "ollama/qwen2.5-coder:7b",
    provider: "ollama",
    tier: 0,
    isFree: true,
    capabilityFloorMatch: true,
    qualityScore: 0.9,
    reliabilityScore: 0.95,
    speedScore: 0.9,
    scarcityPenalty: 0,
    totalScore: 95,
    health: "HEALTHY",
  },
  {
    modelId: "gemini/gemini-2.5-flash",
    provider: "gemini",
    tier: 1,
    isFree: true,
    capabilityFloorMatch: true,
    qualityScore: 0.92,
    reliabilityScore: 0.88,
    speedScore: 0.95,
    scarcityPenalty: 0.1,
    totalScore: 89,
    health: "RATE_LIMITED",
    cooldownRemainingSeconds: 42,
  },
];

const mockHandoff: CompactHandoffSummary = {
  targetModel: "groq/llama-3.3-70b-versatile",
  tokenCount: 160,
  wordCount: 88,
  activeStep: "step-4-write-tests",
  decisions: ["Adopted Free-First fallback", "Preserved uncommitted changes"],
  modifiedFiles: ["src/sections/ModelRouterCard.tsx", "src/sections/TopBar.tsx"],
};

describe("ModelRouterCard (Phase 11)", () => {
  it("renders primary model details, tier badge, and estimated cost", () => {
    render(
      <ModelRouterCard
        primaryModel="ollama/qwen2.5-coder:7b"
        tierName="Tier 0 (Local)"
        estimatedCostUsd={0}
        reason="Local tier selected to minimize cost and preserve latency."
        freeFirstEnabled={true}
      />
    );

    expect(screen.getByText("ollama/qwen2.5-coder:7b")).toBeInTheDocument();
    expect(screen.getByText("Tier 0 (Local)")).toBeInTheDocument();
    expect(screen.getByText("free ($0.00)")).toBeInTheDocument();
    expect(screen.getByText(/Local tier selected to minimize cost/)).toBeInTheDocument();
    expect(screen.getByText("Free-First: ON")).toBeInTheDocument();
  });

  it("handles Free-First mode toggle switch callback", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <ModelRouterCard
        primaryModel="ollama/qwen2.5-coder:7b"
        estimatedCostUsd={0}
        reason="Auto routed"
        freeFirstEnabled={true}
        onToggleFreeFirst={onToggle}
      />
    );

    const switchBtn = screen.getByRole("switch", { name: "Toggle Free-First mode" });
    await user.click(switchBtn);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("allows toggling between AUTO and PINNED model status", async () => {
    const user = userEvent.setup();
    const onPin = vi.fn();

    // Auto state -> click pin
    const { unmount } = render(
      <ModelRouterCard
        primaryModel="gemini/gemini-2.5-flash"
        estimatedCostUsd={0.001}
        reason="Pinned by user"
        freeFirstEnabled={false}
        pinnedModel={null}
        onSelectPinModel={onPin}
      />
    );

    const pinBtn = screen.getByRole("button", { name: /auto/i });
    await user.click(pinBtn);
    expect(onPin).toHaveBeenCalledWith("gemini/gemini-2.5-flash");

    unmount();

    // Pinned state -> click unpin
    render(
      <ModelRouterCard
        primaryModel="gemini/gemini-2.5-flash"
        estimatedCostUsd={0.001}
        reason="Pinned by user"
        freeFirstEnabled={false}
        pinnedModel="gemini/gemini-2.5-flash"
        onSelectPinModel={onPin}
      />
    );

    const unpinBtn = screen.getByRole("button", { name: /pinned/i });
    await user.click(unpinBtn);
    expect(onPin).toHaveBeenCalledWith(null);
  });

  it("expands candidate evaluations table on demand", async () => {
    const user = userEvent.setup();

    render(
      <ModelRouterCard
        primaryModel="ollama/qwen2.5-coder:7b"
        estimatedCostUsd={0}
        reason="Best match"
        freeFirstEnabled={true}
        candidates={mockCandidates}
      />
    );

    const expandBtn = screen.getByRole("button", { name: /Candidate Evaluations \(2\)/i });
    expect(screen.queryByText("Score")).not.toBeInTheDocument();

    await user.click(expandBtn);
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
    expect(screen.getByText("42s")).toBeInTheDocument(); // Cooldown timer
  });

  it("expands compact handoff inspector and displays decisions and modified files", async () => {
    const user = userEvent.setup();

    render(
      <ModelRouterCard
        primaryModel="groq/llama-3.3-70b-versatile"
        estimatedCostUsd={0}
        reason="Switched via handoff"
        freeFirstEnabled={true}
        handoff={mockHandoff}
      />
    );

    const handoffBtn = screen.getByRole("button", {
      name: /Compact Handoff \(160 tokens \/ 88 words\)/i,
    });
    expect(screen.queryByText(/step-4-write-tests/i)).not.toBeInTheDocument();

    await user.click(handoffBtn);
    expect(screen.getByText(/Target: groq\/llama-3.3-70b-versatile/i)).toBeInTheDocument();
    expect(screen.getByText(/step-4-write-tests/i)).toBeInTheDocument();
    expect(screen.getByText("Adopted Free-First fallback")).toBeInTheDocument();
    expect(screen.getByText("src/sections/ModelRouterCard.tsx")).toBeInTheDocument();
  });
});

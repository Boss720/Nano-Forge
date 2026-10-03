// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RouterTelemetryDashboard,
  type RouterTelemetryStats,
} from "../RouterTelemetryDashboard";

afterEach(cleanup);

const mockStats: RouterTelemetryStats = {
  totalRouted: 128,
  freeTierPercentage: 85,
  avgLatencyMs: 32,
  failoverCount: 3,
  activeCooldowns: 1,
  providers: [
    {
      provider: "ollama",
      displayName: "Ollama (Local)",
      status: "healthy",
      modelsCount: 4,
      isLocal: true,
    },
    {
      provider: "gemini",
      displayName: "Google Gemini",
      status: "degraded",
      modelsCount: 6,
      activeCooldowns: 1,
    },
    {
      provider: "groq",
      displayName: "Groq Cloud",
      status: "healthy",
      modelsCount: 3,
    },
  ],
};

describe("RouterTelemetryDashboard (Phase 11)", () => {
  it("renders modal dialog with 4 summary stat cards when open", () => {
    render(
      <RouterTelemetryDashboard
        open={true}
        onOpenChange={vi.fn()}
        stats={mockStats}
      />
    );

    expect(screen.getByText("Model Router Telemetry & Fleet Overview")).toBeInTheDocument();
    expect(
      screen.getByText(/Real-time capability-floor routing metrics, zero-cost savings/i)
    ).toBeInTheDocument();

    // 4 Key Stat Cards
    expect(screen.getByText("Free Priority")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();

    expect(screen.getByText("Total Routed")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();

    expect(screen.getByText("Avg Latency")).toBeInTheDocument();
    expect(screen.getByText("32ms")).toBeInTheDocument();

    expect(screen.getByText("429 Failovers")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders provider fleet health cards and statuses", () => {
    render(
      <RouterTelemetryDashboard
        open={true}
        onOpenChange={vi.fn()}
        stats={mockStats}
      />
    );

    expect(screen.getByText("Provider Fleet Health")).toBeInTheDocument();
    expect(screen.getByText("1 active cooldown(s)")).toBeInTheDocument();

    // Ollama
    expect(screen.getByText("Ollama (Local)")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.getByText("4 model(s) available")).toBeInTheDocument();

    // Gemini in cooldown
    expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    expect(screen.getByText("cooldown")).toBeInTheDocument();

    // Groq
    expect(screen.getByText("Groq Cloud")).toBeInTheDocument();
  });

  it("does not render modal dialog contents when closed", () => {
    render(
      <RouterTelemetryDashboard
        open={false}
        onOpenChange={vi.fn()}
        stats={mockStats}
      />
    );

    expect(screen.queryByText("Model Router Telemetry & Fleet Overview")).not.toBeInTheDocument();
  });
});

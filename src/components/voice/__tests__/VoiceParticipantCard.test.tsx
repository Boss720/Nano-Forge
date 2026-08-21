// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VoiceParticipantCard } from "../VoiceParticipantCard";

describe("VoiceParticipantCard Component", () => {
  afterEach(cleanup);

  it("1. Renders agent and user participant cards", () => {
    render(
      <VoiceParticipantCard
        status="listening"
        participant={{
          userId: "user-123",
          userName: "Bob Builder",
          agentId: "agent-k2",
          agentName: "Kimi K2 Agent",
        }}
        voiceProfile={{
          voiceId: "voice-1",
          name: "Warm Voice",
          rate: 1.2,
          pitch: 1.0,
          timbre: "warm",
          language: "en-US",
        }}
      />
    );

    expect(screen.getByTestId("voice-participant-card")).toBeInTheDocument();
    expect(screen.getByTestId("voice-participant-agent")).toBeInTheDocument();
    expect(screen.getByTestId("voice-participant-user")).toBeInTheDocument();
    expect(screen.getByText("Kimi K2 Agent")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByText("warm · 1.2x")).toBeInTheDocument();
  });

  it("2. Renders default names when participant is undefined", () => {
    render(<VoiceParticipantCard status="listening" />);

    expect(screen.getByText("NanoForge Agent")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("neutral · 1x")).toBeInTheDocument();
  });

  it("3. Shows muted label when status is muted", () => {
    render(<VoiceParticipantCard status="muted" />);

    expect(screen.getByText("Mic Muted")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VoiceCallTranscriptionStream } from "../VoiceCallTranscriptionStream";
import type { VoiceTranscriptItem } from "@/hooks/useVoiceCall";

describe("VoiceCallTranscriptionStream Component", () => {
  afterEach(cleanup);

  it("1. Renders empty prompt placeholder when no turns or interim text exist", () => {
    render(<VoiceCallTranscriptionStream turns={[]} interimTranscript="" />);

    expect(screen.getByText("Ready for voice input")).toBeInTheDocument();
  });

  it("2. Renders user and agent dialogue bubbles", () => {
    const turns: VoiceTranscriptItem[] = [
      {
        id: "turn-1",
        turnId: "turn-1",
        speaker: "user",
        text: "Please summarize the codebase architecture.",
        isFinal: true,
        timestamp: new Date().toISOString(),
      },
      {
        id: "turn-2",
        turnId: "turn-2",
        speaker: "agent",
        text: "NanoForge uses a clean architecture with protocol, services, and UI layers.",
        isFinal: true,
        timestamp: new Date().toISOString(),
      },
    ];

    render(<VoiceCallTranscriptionStream turns={turns} />);

    expect(screen.getByTestId("transcript-bubble-user")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-bubble-agent")).toBeInTheDocument();
    expect(screen.getByText("Please summarize the codebase architecture.")).toBeInTheDocument();
    expect(screen.getByText("NanoForge uses a clean architecture with protocol, services, and UI layers.")).toBeInTheDocument();
  });

  it("3. Renders streaming interim user speech bubble", () => {
    render(
      <VoiceCallTranscriptionStream
        turns={[]}
        interimTranscript="Working on the implementation"
      />
    );

    expect(screen.getByTestId("transcript-bubble-interim")).toBeInTheDocument();
    expect(screen.getByText("Working on the implementation")).toBeInTheDocument();
  });

  it("4. Renders [interrupted] tag when turn was interrupted", () => {
    const turns: VoiceTranscriptItem[] = [
      {
        id: "turn-int",
        turnId: "turn-int",
        speaker: "agent",
        text: "I was saying something [interrupted]",
        interrupted: true,
        isFinal: true,
        timestamp: new Date().toISOString(),
      },
    ];

    render(<VoiceCallTranscriptionStream turns={turns} />);

    expect(screen.getByTestId("interrupted-badge")).toBeInTheDocument();
    expect(screen.getByTestId("interrupted-badge")).toHaveTextContent("[interrupted]");
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VoiceCallHeader, formatCallDuration } from "../VoiceCallHeader";

describe("VoiceCallHeader Component", () => {
  afterEach(cleanup);

  it("1. formatCallDuration helper formats seconds correctly", () => {
    expect(formatCallDuration(0)).toBe("00:00");
    expect(formatCallDuration(9)).toBe("00:09");
    expect(formatCallDuration(59)).toBe("00:59");
    expect(formatCallDuration(60)).toBe("01:00");
    expect(formatCallDuration(125)).toBe("02:05");
    expect(formatCallDuration(3600)).toBe("01:00:00");
    expect(formatCallDuration(3665)).toBe("01:01:05");
    expect(formatCallDuration(-5)).toBe("00:00");
  });

  it("2. Renders header with agent name, timer and close button", () => {
    const onClose = vi.fn();
    render(
      <VoiceCallHeader
        status="listening"
        durationSeconds={42}
        agentName="Custom Agent"
        onClose={onClose}
      />
    );

    expect(screen.getByTestId("voice-call-header")).toBeInTheDocument();
    expect(screen.getByText("Voice Call")).toBeInTheDocument();
    expect(screen.getByText("· Custom Agent")).toBeInTheDocument();
    expect(screen.getByTestId("voice-call-timer")).toHaveTextContent("00:42");

    const closeBtn = screen.getByTestId("voice-call-close-button");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

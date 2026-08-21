// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VoiceCallDrawer } from "../VoiceCallDrawer";
import type { VoiceCallStatus, VoiceCallSession } from "@protocol/voice";

const mockSession: VoiceCallSession = {
  sessionId: "11111111-2222-3333-4444-555555555555",
  status: "listening",
  startedAt: new Date().toISOString(),
  durationSeconds: 15,
  isMuted: false,
  inputGain: 1.0,
  outputVolume: 1.0,
  voiceProfile: {
    voiceId: "agent-voice",
    name: "Agent Voice",
    rate: 1.0,
    pitch: 1.0,
    timbre: "warm",
    language: "en-US",
  },
  participant: {
    userId: "user-1",
    userName: "Alice Developer",
    agentId: "agent-1",
    agentName: "NanoForge Agent",
  },
  totalTurns: 2,
};

describe("VoiceCallDrawer Component", () => {
  beforeEach(() => {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(cleanup);

  it("1. Does not render in DOM when isOpen is false", () => {
    render(<VoiceCallDrawer isOpen={false} />);
    expect(screen.queryByTestId("voice-call-drawer")).toBeNull();
  });

  it("2. Renders drawer dialog and backdrop when isOpen is true", () => {
    render(
      <VoiceCallDrawer
        isOpen={true}
        session={mockSession}
        status="listening"
        durationSeconds={30}
      />
    );

    expect(screen.getByTestId("voice-call-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("voice-call-backdrop")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("3. Displays correct status badge across statuses", () => {
    const statuses: VoiceCallStatus[] = [
      "connecting",
      "listening",
      "thinking",
      "speaking",
      "muted",
      "ended",
    ];

    for (const status of statuses) {
      const { unmount } = render(
        <VoiceCallDrawer isOpen={true} status={status} durationSeconds={10} />
      );
      const badge = screen.getByTestId("voice-status-badge");
      expect(badge).toBeInTheDocument();
      unmount();
    }
  });

  it("4. Displays formatted call duration timer", () => {
    render(
      <VoiceCallDrawer
        isOpen={true}
        status="listening"
        durationSeconds={125} // 02:05
      />
    );

    const timer = screen.getByTestId("voice-call-timer");
    expect(timer.textContent).toBe("02:05");
  });

  it("5. Clicking mute button triggers onToggleMute handler", () => {
    const onToggleMute = vi.fn();
    render(
      <VoiceCallDrawer
        isOpen={true}
        status="listening"
        isMuted={false}
        onToggleMute={onToggleMute}
      />
    );

    const muteBtn = screen.getByTestId("mute-toggle-button");
    fireEvent.click(muteBtn);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("6. Clicking interrupt button during speaking triggers onInterrupt", () => {
    const onInterrupt = vi.fn();
    render(
      <VoiceCallDrawer
        isOpen={true}
        status="speaking"
        onInterrupt={onInterrupt}
      />
    );

    const interruptBtn = screen.getByTestId("interrupt-agent-button");
    expect(interruptBtn).not.toBeDisabled();
    fireEvent.click(interruptBtn);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("7. Clicking end call button triggers onEndCall handler", () => {
    const onEndCall = vi.fn();
    render(
      <VoiceCallDrawer
        isOpen={true}
        status="listening"
        onEndCall={onEndCall}
      />
    );

    const endBtn = screen.getByTestId("end-call-button");
    fireEvent.click(endBtn);
    expect(onEndCall).toHaveBeenCalledTimes(1);
  });

  it("8. Clicking backdrop triggers onClose handler", () => {
    const onClose = vi.fn();
    render(
      <VoiceCallDrawer
        isOpen={true}
        status="listening"
        onClose={onClose}
      />
    );

    const backdrop = screen.getByTestId("voice-call-backdrop");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("9. Pressing Escape key triggers onClose handler", () => {
    const onClose = vi.fn();
    render(
      <VoiceCallDrawer
        isOpen={true}
        status="listening"
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

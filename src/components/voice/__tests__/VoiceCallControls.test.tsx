// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VoiceCallControls } from "../VoiceCallControls";

describe("VoiceCallControls Component", () => {
  beforeEach(() => {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(cleanup);

  it("1. Renders all control elements properly", () => {
    render(
      <VoiceCallControls
        status="listening"
        isMuted={false}
        micGain={1.0}
        speakerVolume={0.8}
        onToggleMute={vi.fn()}
        onInterrupt={vi.fn()}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(screen.getByTestId("mute-toggle-button")).toBeInTheDocument();
    expect(screen.getByTestId("interrupt-agent-button")).toBeInTheDocument();
    expect(screen.getByTestId("end-call-button")).toBeInTheDocument();
    expect(screen.getByTestId("mic-gain-slider")).toBeInTheDocument();
    expect(screen.getByTestId("speaker-volume-slider")).toBeInTheDocument();
  });

  it("2. Mute button toggles between Mute and Unmute states", () => {
    const onToggleMute = vi.fn();
    const { rerender } = render(
      <VoiceCallControls
        status="listening"
        isMuted={false}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={onToggleMute}
        onInterrupt={vi.fn()}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const muteBtn = screen.getByTestId("mute-toggle-button");
    expect(muteBtn).toHaveTextContent("Mute");
    expect(muteBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(muteBtn);
    expect(onToggleMute).toHaveBeenCalledTimes(1);

    // Re-render as muted
    rerender(
      <VoiceCallControls
        status="muted"
        isMuted={true}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={onToggleMute}
        onInterrupt={vi.fn()}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(screen.getByTestId("mute-toggle-button")).toHaveTextContent("Unmute");
    expect(screen.getByTestId("mute-toggle-button")).toHaveAttribute("aria-pressed", "true");
  });

  it("3. Interrupt button is enabled only during speaking and thinking statuses", () => {
    const onInterrupt = vi.fn();
    const { rerender } = render(
      <VoiceCallControls
        status="listening"
        isMuted={false}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={vi.fn()}
        onInterrupt={onInterrupt}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const interruptBtn = screen.getByTestId("interrupt-agent-button");
    expect(interruptBtn).toBeDisabled();

    // Re-render as speaking
    rerender(
      <VoiceCallControls
        status="speaking"
        isMuted={false}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={vi.fn()}
        onInterrupt={onInterrupt}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(interruptBtn).not.toBeDisabled();
    fireEvent.click(interruptBtn);
    expect(onInterrupt).toHaveBeenCalledTimes(1);

    // Re-render as thinking
    rerender(
      <VoiceCallControls
        status="thinking"
        isMuted={false}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={vi.fn()}
        onInterrupt={onInterrupt}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(interruptBtn).not.toBeDisabled();
  });

  it("4. End call button triggers onEndCall callback", () => {
    const onEndCall = vi.fn();
    render(
      <VoiceCallControls
        status="listening"
        isMuted={false}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={vi.fn()}
        onInterrupt={vi.fn()}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={onEndCall}
      />
    );

    const endBtn = screen.getByTestId("end-call-button");
    fireEvent.click(endBtn);
    expect(onEndCall).toHaveBeenCalledTimes(1);
  });
});

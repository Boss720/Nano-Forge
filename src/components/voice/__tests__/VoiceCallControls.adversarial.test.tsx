// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VoiceCallControls } from "../VoiceCallControls";
import type { VoiceCallStatus } from "@protocol/voice";

describe("VoiceCallControls Adversarial & Fuzzing Suite", () => {
  beforeEach(() => {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(cleanup);

  it("1. Status Matrix: verifies enable/disable rules across all 7 statuses", () => {
    const allStatuses: VoiceCallStatus[] = [
      "idle",
      "connecting",
      "listening",
      "thinking",
      "speaking",
      "muted",
      "ended",
    ];

    const onToggleMute = vi.fn();
    const onInterrupt = vi.fn();
    const onEndCall = vi.fn();

    allStatuses.forEach((status) => {
      cleanup();
      render(
        <VoiceCallControls
          status={status}
          isMuted={status === "muted"}
          micGain={1.0}
          speakerVolume={0.8}
          onToggleMute={onToggleMute}
          onInterrupt={onInterrupt}
          onSetMicGain={vi.fn()}
          onSetSpeakerVolume={vi.fn()}
          onEndCall={onEndCall}
        />
      );

      const muteBtn = screen.getByTestId("mute-toggle-button");
      const interruptBtn = screen.getByTestId("interrupt-agent-button");
      const endBtn = screen.getByTestId("end-call-button");
      const micSlider = screen.getByTestId("mic-gain-slider");
      const spkSlider = screen.getByTestId("speaker-volume-slider");

      if (status === "ended") {
        expect(muteBtn).toBeDisabled();
        expect(interruptBtn).toBeDisabled();
        expect(endBtn).toBeDisabled();
      } else if (status === "connecting") {
        expect(muteBtn).toBeDisabled();
        expect(interruptBtn).toBeDisabled();
        expect(endBtn).not.toBeDisabled();
      } else if (status === "speaking" || status === "thinking") {
        expect(muteBtn).not.toBeDisabled();
        expect(interruptBtn).not.toBeDisabled();
        expect(endBtn).not.toBeDisabled();
      } else {
        // listening / muted
        expect(muteBtn).not.toBeDisabled();
        expect(interruptBtn).toBeDisabled();
        expect(endBtn).not.toBeDisabled();
      }

      expect(micSlider).toBeInTheDocument();
      expect(spkSlider).toBeInTheDocument();
    });
  });

  it("2. Rapid click hammering on Mute, Interrupt, and End Call buttons", () => {
    const onToggleMute = vi.fn();
    const onInterrupt = vi.fn();
    const onEndCall = vi.fn();

    render(
      <VoiceCallControls
        status="speaking"
        isMuted={false}
        micGain={1.0}
        speakerVolume={1.0}
        onToggleMute={onToggleMute}
        onInterrupt={onInterrupt}
        onSetMicGain={vi.fn()}
        onSetSpeakerVolume={vi.fn()}
        onEndCall={onEndCall}
      />
    );

    const muteBtn = screen.getByTestId("mute-toggle-button");
    const interruptBtn = screen.getByTestId("interrupt-agent-button");
    const endBtn = screen.getByTestId("end-call-button");

    // Click spamming 100 times
    for (let i = 0; i < 100; i++) {
      fireEvent.click(muteBtn);
      fireEvent.click(interruptBtn);
      fireEvent.click(endBtn);
    }

    expect(onToggleMute).toHaveBeenCalledTimes(100);
    expect(onInterrupt).toHaveBeenCalledTimes(100);
    expect(onEndCall).toHaveBeenCalledTimes(100);
  });

  it("3. Slider fuzzing with boundary and floating point values", () => {
    const onSetMicGain = vi.fn();
    const onSetSpeakerVolume = vi.fn();

    const { rerender } = render(
      <VoiceCallControls
        status="listening"
        isMuted={false}
        micGain={0.0}
        speakerVolume={0.0}
        onToggleMute={vi.fn()}
        onInterrupt={vi.fn()}
        onSetMicGain={onSetMicGain}
        onSetSpeakerVolume={onSetSpeakerVolume}
        onEndCall={vi.fn()}
      />
    );

    const micSlider = screen.getByTestId("mic-gain-slider");
    const spkSlider = screen.getByTestId("speaker-volume-slider");

    expect(micSlider).toHaveAttribute("aria-valuenow", "0");
    expect(spkSlider).toHaveAttribute("aria-valuenow", "0");

    // Max values
    rerender(
      <VoiceCallControls
        status="listening"
        isMuted={false}
        micGain={2.0}
        speakerVolume={1.0}
        onToggleMute={vi.fn()}
        onInterrupt={vi.fn()}
        onSetMicGain={onSetMicGain}
        onSetSpeakerVolume={onSetSpeakerVolume}
        onEndCall={vi.fn()}
      />
    );

    expect(micSlider).toHaveAttribute("aria-valuenow", "2");
    expect(spkSlider).toHaveAttribute("aria-valuenow", "1");
  });
});

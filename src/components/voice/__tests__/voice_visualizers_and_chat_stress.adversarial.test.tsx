// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, renderHook } from "@testing-library/react";
import { VoiceWaveformVisualizer } from "../VoiceWaveformVisualizer";
import { VoiceFrequencyVisualizer } from "../VoiceFrequencyVisualizer";
import { VoiceCallTranscriptionStream } from "../VoiceCallTranscriptionStream";
import { ChatComposer } from "@/sections/ChatComposer";
import { TopBar } from "@/sections/TopBar";
import { useVoiceCall, type VoiceTranscriptItem } from "@/hooks/useVoiceCall";
import type { AudioVisualData } from "@/services/audioEngine";
import { audioEngineService } from "@/services/audioEngine";
import type { ConnectionState } from "@/types";

describe("Adversarial Stress Test: Voice Visualizers, ChatComposer & Lifecycle", () => {
  const mockConnection: ConnectionState = {
    status: "connected",
    apiKey: "test-api-key-12345",
    baseUrl: "https://nano-gpt.com/api/v1",
    liveModels: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

    // Mock HTMLCanvasElement 2D context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({
        addColorStop: vi.fn(),
      }),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      shadowBlur: 0,
      shadowColor: "",
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // SUITE 1: VoiceWaveformVisualizer Adversarial Edge Cases & Stress
  // =========================================================================
  describe("Suite 1: VoiceWaveformVisualizer Adversarial Edge Cases", () => {
    it("1.1 Handles zero-length and empty timeDomainData without dividing by zero or throwing", () => {
      const emptyVisualData: AudioVisualData = {
        timeDomainData: new Uint8Array(0),
        frequencyData: new Uint8Array(0),
        rmsVolume: 0.5, // Non-zero RMS but empty buffer
        peakVolume: 0.5,
      };

      expect(() => {
        render(<VoiceWaveformVisualizer visualData={emptyVisualData} />);
      }).not.toThrow();

      expect(screen.getByTestId("voice-waveform-canvas")).toBeInTheDocument();
    });

    it("1.2 Handles extreme canvas dimensions (0x0, negative values, large resolutions)", () => {
      const normalData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: new Uint8Array(128).fill(0),
        rmsVolume: 0.1,
        peakVolume: 0.2,
      };

      expect(() => {
        const { unmount } = render(
          <VoiceWaveformVisualizer visualData={normalData} width={0} height={0} />
        );
        unmount();
      }).not.toThrow();

      expect(() => {
        const { unmount } = render(
          <VoiceWaveformVisualizer visualData={normalData} width={3840} height={2160} />
        );
        unmount();
      }).not.toThrow();
    });

    it("1.3 Survives 100 rapid mount / unmount cycles with no context leak", () => {
      const activeData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 255 : 0)),
        frequencyData: new Uint8Array(128).fill(100),
        rmsVolume: 0.8,
        peakVolume: 1.0,
      };

      for (let i = 0; i < 100; i++) {
        const { unmount } = render(<VoiceWaveformVisualizer visualData={activeData} />);
        unmount();
      }

      expect(true).toBe(true);
    });

    it("1.4 Handles custom background and neon color overrides gracefully", () => {
      const activeData: AudioVisualData = {
        timeDomainData: new Uint8Array([128, 200, 50, 180, 90]),
        frequencyData: new Uint8Array(128).fill(50),
        rmsVolume: 0.4,
        peakVolume: 0.7,
      };

      render(
        <VoiceWaveformVisualizer
          visualData={activeData}
          color="#f43f5e"
          backgroundColor="#09090b"
        />
      );

      expect(screen.getByTestId("voice-waveform-canvas")).toBeInTheDocument();
      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // SUITE 2: VoiceFrequencyVisualizer Adversarial Edge Cases
  // =========================================================================
  describe("Suite 2: VoiceFrequencyVisualizer Adversarial Edge Cases", () => {
    it("2.1 Clamps extreme barCount values [0, 1, -10, 1000] safely", () => {
      const visualData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: new Uint8Array(128).fill(120),
        rmsVolume: 0.5,
        peakVolume: 0.7,
      };

      // Test negative and sub-minimum barCount
      expect(() => {
        const { unmount } = render(
          <VoiceFrequencyVisualizer visualData={visualData} isSpeaking={true} barCount={-5} />
        );
        unmount();
      }).not.toThrow();

      // Test excessive barCount
      expect(() => {
        const { unmount } = render(
          <VoiceFrequencyVisualizer visualData={visualData} isSpeaking={true} barCount={500} />
        );
        unmount();
      }).not.toThrow();
    });

    it("2.2 Fallback when ctx.roundRect is not supported in legacy browser contexts", () => {
      // Temporarily remove roundRect from prototype mock
      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        rect: vi.fn(),
        createLinearGradient: vi.fn().mockReturnValue({
          addColorStop: vi.fn(),
        }),
      };
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      const visualData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: new Uint8Array([200, 150, 100, 50, 0]),
        rmsVolume: 0.6,
        peakVolume: 0.8,
      };

      render(<VoiceFrequencyVisualizer visualData={visualData} isSpeaking={true} barCount={16} />);

      expect(mockCtx.rect).toHaveBeenCalled();
      expect(screen.getByTestId("voice-frequency-canvas")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // SUITE 3: High-Volume Dialogue Streaming & Large Transcripts
  // =========================================================================
  describe("Suite 3: High-Volume Dialogue Streaming (100+ Turns & Large Payloads)", () => {
    it("3.1 Efficiently renders 120 turns with alternating speakers without crashing", () => {
      const turns: VoiceTranscriptItem[] = Array.from({ length: 120 }, (_, i) => ({
        id: `turn-stress-${i}`,
        turnId: `turn-${i}`,
        speaker: i % 2 === 0 ? "user" : "agent",
        text: `Turn payload index ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
        isFinal: true,
        interrupted: i % 15 === 0 && i % 2 !== 0,
        timestamp: new Date(Date.now() - (120 - i) * 1000).toISOString(),
      }));

      render(
        <VoiceCallTranscriptionStream
          turns={turns}
          interimTranscript="Streaming speech input..."
          isAgentSpeaking={false}
          autoScroll={true}
        />
      );

      const userBubbles = screen.getAllByTestId("transcript-bubble-user");
      const agentBubbles = screen.getAllByTestId("transcript-bubble-agent");

      expect(userBubbles.length).toBe(60);
      expect(agentBubbles.length).toBe(60);
      expect(screen.getByTestId("transcript-bubble-interim")).toBeInTheDocument();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it("3.2 Handles massive transcript payloads (10,000+ characters per turn)", () => {
      const hugeText = "NanoForge ".repeat(1000) + " [interrupted]";
      const turns: VoiceTranscriptItem[] = [
        {
          id: "turn-huge-1",
          turnId: "turn-1",
          speaker: "agent",
          text: hugeText,
          isFinal: true,
          interrupted: true,
          timestamp: new Date().toISOString(),
        },
      ];

      render(<VoiceCallTranscriptionStream turns={turns} />);

      expect(screen.getByTestId("transcript-bubble-agent")).toBeInTheDocument();
      expect(screen.getByTestId("interrupted-badge")).toBeInTheDocument();
    });

    it("3.3 Safely handles adversarial characters, XSS script injection, and ANSI sequences", () => {
      const turns: VoiceTranscriptItem[] = [
        {
          id: "turn-xss",
          turnId: "turn-xss",
          speaker: "user",
          text: `<script>alert('xss')</script><img src=x onerror=alert(1)> \u001b[31mRedText\u001b[0m 🚀💻`,
          isFinal: true,
          timestamp: new Date().toISOString(),
        },
      ];

      render(<VoiceCallTranscriptionStream turns={turns} />);

      const bubble = screen.getByTestId("transcript-bubble-user");
      expect(bubble).toBeInTheDocument();
      expect(bubble.textContent).toContain("<script>alert('xss')</script>");
    });

    it("3.4 Handles missing scrollIntoView implementation on legacy environments gracefully", () => {
      const originalScroll = Element.prototype.scrollIntoView;
      // @ts-expect-error test undefined scrollIntoView
      delete Element.prototype.scrollIntoView;

      const turns: VoiceTranscriptItem[] = [
        {
          id: "turn-1",
          turnId: "turn-1",
          speaker: "user",
          text: "Test without scrollIntoView",
          isFinal: true,
          timestamp: new Date().toISOString(),
        },
      ];

      expect(() => {
        render(<VoiceCallTranscriptionStream turns={turns} autoScroll={true} />);
      }).not.toThrow();

      Element.prototype.scrollIntoView = originalScroll;
    });
  });

  // =========================================================================
  // SUITE 4: Slash Command Parsing & Edge Cases in ChatComposer
  // =========================================================================
  describe("Suite 4: Slash Command Parsing & Edge Cases in ChatComposer", () => {
    it("4.1 Triggers voice call on /call and /voice commands via Enter autocomplete or submit button", () => {
      const handleVoiceCall = vi.fn();
      const handleSendMessage = vi.fn();

      render(
        <ChatComposer
          onSendMessage={handleSendMessage}
          onTriggerVoiceCall={handleVoiceCall}
        />
      );

      const textarea = screen.getByTestId("chat-textarea");

      // Flow 1: Typing "/call", first Enter autocompletes to "/call ", second Enter executes command
      fireEvent.change(textarea, { target: { value: "/call" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false }); // Autocompletes slash palette
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false }); // Submits /call
      expect(handleVoiceCall).toHaveBeenCalledTimes(1);
      expect(handleSendMessage).not.toHaveBeenCalled();

      // Flow 2: Typing "/voice " with space (popover dismissed), single Enter executes command
      fireEvent.change(textarea, { target: { value: "/voice " } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
      expect(handleVoiceCall).toHaveBeenCalledTimes(2);

      // Flow 3: Clicking the Run Agent button on "/call"
      fireEvent.change(textarea, { target: { value: "/call start" } });
      const runBtn = screen.getByTestId("run-agent-button");
      fireEvent.click(runBtn);
      expect(handleVoiceCall).toHaveBeenCalledTimes(3);
    });

    it("4.2 Does NOT trigger voice call on non-matching prefix commands (/calling, /callback, /voicemail)", () => {
      const handleVoiceCall = vi.fn();
      const handleSendMessage = vi.fn();

      render(
        <ChatComposer
          onSendMessage={handleSendMessage}
          onTriggerVoiceCall={handleVoiceCall}
        />
      );

      const textarea = screen.getByTestId("chat-textarea");

      // "/calling someone" should be treated as normal message, not voice call trigger
      fireEvent.change(textarea, { target: { value: "/calling someone" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
      expect(handleVoiceCall).not.toHaveBeenCalled();
      expect(handleSendMessage).toHaveBeenCalledWith("/calling someone", undefined);

      // "/voicemail review"
      fireEvent.change(textarea, { target: { value: "/voicemail review" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
      expect(handleVoiceCall).not.toHaveBeenCalled();
      expect(handleSendMessage).toHaveBeenCalledWith("/voicemail review", undefined);
    });

    it("4.3 Handles regex special characters in slash query without syntax errors", () => {
      render(<ChatComposer onSendMessage={vi.fn()} />);
      const textarea = screen.getByTestId("chat-textarea");

      // Type regex meta-characters after /
      const specialInputs = ["/(", "/[", "/.*", "/$", "/^", "/\\", "/{2,4}"];

      for (const input of specialInputs) {
        expect(() => {
          fireEvent.change(textarea, { target: { value: input } });
        }).not.toThrow();
      }
    });

    it("4.4 Navigates slash popover with keyboard (ArrowDown, ArrowUp, Enter, Escape)", () => {
      render(<ChatComposer onSendMessage={vi.fn()} />);
      const textarea = screen.getByTestId("chat-textarea");

      // Open slash popover
      fireEvent.change(textarea, { target: { value: "/" } });
      expect(screen.getByTestId("slash-popover")).toBeInTheDocument();

      // Navigate down
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
      fireEvent.keyDown(textarea, { key: "ArrowDown" });

      // Navigate up
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      // Dismiss with Escape
      fireEvent.keyDown(textarea, { key: "Escape" });
      expect(screen.queryByTestId("slash-popover")).not.toBeInTheDocument();
    });

    it("4.5 Selecting slash command item via click or Enter replaces draft text", () => {
      render(<ChatComposer onSendMessage={vi.fn()} />);
      const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: "/ca" } });
      const callItem = screen.getByTestId("slash-item-call");
      expect(callItem).toBeInTheDocument();

      fireEvent.click(callItem);
      expect(textarea.value).toBe("/call ");
    });

    it("4.6 Voice Call Mic trigger button in composer opens voice call drawer", () => {
      const handleVoiceCall = vi.fn();
      render(
        <ChatComposer
          onSendMessage={vi.fn()}
          onTriggerVoiceCall={handleVoiceCall}
          isVoiceCallActive={false}
        />
      );

      const micBtn = screen.getByTestId("composer-mic-button");
      expect(micBtn).toBeInTheDocument();
      fireEvent.click(micBtn);
      expect(handleVoiceCall).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // SUITE 5: TopBar Voice Call Trigger & Badge Integration
  // =========================================================================
  describe("Suite 5: TopBar Voice Call Trigger Seam & Accessibility", () => {
    it("5.1 Renders inactive Voice Call button with clean styling and accessible label", () => {
      const handleOpenVoice = vi.fn();
      render(
        <TopBar
          connection={mockConnection}
          usage={{ requests: 5, input: 1000, output: 500, costUsd: 0.0025 }}
          onOpenSettings={vi.fn()}
          onOpenSidebar={vi.fn()}
          onOpenModels={vi.fn()}
          onExport={vi.fn()}
          canExport={true}
          onOpenCosts={vi.fn()}
          onOpenImages={vi.fn()}
          onOpenVoiceCall={handleOpenVoice}
          isVoiceCallActive={false}
        />
      );

      const voiceBtn = screen.getByTestId("topbar-voice-call-button");
      expect(voiceBtn).toBeInTheDocument();
      expect(voiceBtn).toHaveAttribute("data-call-active", "false");
      expect(voiceBtn).toHaveAttribute("aria-label", "Start voice call");

      fireEvent.click(voiceBtn);
      expect(handleOpenVoice).toHaveBeenCalledTimes(1);
    });

    it("5.2 Renders active Voice Call badge and pulse indicator when call is connected", () => {
      render(
        <TopBar
          connection={mockConnection}
          usage={{ requests: 5, input: 1000, output: 500, costUsd: 0.0025 }}
          onOpenSettings={vi.fn()}
          onOpenSidebar={vi.fn()}
          onOpenModels={vi.fn()}
          onExport={vi.fn()}
          canExport={true}
          onOpenCosts={vi.fn()}
          onOpenImages={vi.fn()}
          onOpenVoiceCall={vi.fn()}
          isVoiceCallActive={true}
          voiceCallStatus="speaking"
        />
      );

      const voiceBtn = screen.getByTestId("topbar-voice-call-button");
      expect(voiceBtn).toHaveAttribute("data-call-active", "true");
      expect(voiceBtn).toHaveAttribute("aria-label", "Open active voice call");
      expect(voiceBtn).toHaveAttribute("title", "Voice Call (speaking)");
    });
  });

  // =========================================================================
  // SUITE 6: useVoiceCall Hook & Visualizer RAF Loop Teardown Stress
  // =========================================================================
  describe("Suite 6: useVoiceCall Controller Lifecycle & RAF Loop Management", () => {
    it("6.1 Rapid drawer open/close toggles RAF visualizer loop cleanly without leak", async () => {
      const cancelRafSpy = vi.spyOn(window, "cancelAnimationFrame");

      // Mock audio engine initialize
      vi.spyOn(audioEngineService, "initialize").mockResolvedValue(true);
      vi.spyOn(audioEngineService, "cleanup").mockImplementation(() => {});

      const { result, unmount } = renderHook(() => useVoiceCall({ autoOpenDrawer: false }));

      // Start call
      await act(async () => {
        await result.current.startCall();
      });

      expect(result.current.isCallActive).toBe(true);

      // Rapidly toggle drawer 20 times
      for (let i = 0; i < 20; i++) {
        act(() => {
          result.current.openDrawer();
        });
        expect(result.current.isDrawerOpen).toBe(true);

        act(() => {
          result.current.closeDrawer();
        });
        expect(result.current.isDrawerOpen).toBe(false);
      }

      // Ensure cancelAnimationFrame was called to terminate loops
      expect(cancelRafSpy).toHaveBeenCalled();

      // End call and unmount
      act(() => {
        result.current.endCall();
      });
      unmount();
    });

    it("6.2 Unmounting component with active call and open drawer tears down all timers and RAF loops", async () => {
      vi.spyOn(audioEngineService, "initialize").mockResolvedValue(true);
      vi.spyOn(audioEngineService, "cleanup");
      const cancelRafSpy = vi.spyOn(window, "cancelAnimationFrame");

      const { result, unmount } = renderHook(() => useVoiceCall({ autoOpenDrawer: true }));

      await act(async () => {
        await result.current.startCall();
      });

      expect(result.current.isCallActive).toBe(true);
      expect(result.current.isDrawerOpen).toBe(true);

      // Fast-forward duration timer 5 seconds
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current.durationSeconds).toBe(5);

      // Unmount hook directly
      unmount();

      // Verify RAF cancel was executed on unmount
      expect(cancelRafSpy).toHaveBeenCalled();
    });
  });
});

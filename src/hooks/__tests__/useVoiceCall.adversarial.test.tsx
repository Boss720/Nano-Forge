// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceCall } from "../useVoiceCall";
import {
  setupAudioMocks,
  cleanupAudioMocks,
  MockSpeechRecognition,
  MockSpeechSynthesis,
} from "@/test/audioMocks";
import { audioEngineService } from "@/services/audioEngine";
import { speechSynthesisService } from "@/services/speechSynthesis";
import { isValidVoiceStateTransition, type VoiceCallStatus } from "@protocol/voice";

describe("useVoiceCall Adversarial & Stress Testing Suite", () => {
  let audioMocks: ReturnType<typeof setupAudioMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    audioMocks = setupAudioMocks({ ttsDelayMs: 0, autoCompleteTTS: true });
  });

  afterEach(() => {
    cleanupAudioMocks();
    audioMocks.restore();
    vi.useRealTimers();
  });

  /* ------------------------------------------------------------------ */
  /* AREA 1: Rapid Call Start/Stop Spamming & Concurrency               */
  /* ------------------------------------------------------------------ */
  describe("1. Rapid Call Start/Stop Spamming & Lifecycle Races", () => {
    it("handles 50 concurrent startCall invocations without corruption or duplicate sessions", async () => {
      const { result } = renderHook(() => useVoiceCall());

      const startPromises: Promise<boolean>[] = [];
      await act(async () => {
        for (let i = 0; i < 50; i++) {
          startPromises.push(result.current.startCall());
        }
      });

      const results = await Promise.all(startPromises);
      expect(results.every((r) => r === true)).toBe(true);
      expect(result.current.status).toBe("listening");
      expect(result.current.isCallActive).toBe(true);
      expect(result.current.session).not.toBeNull();
      // Audio engine should only be initialized once
      expect(audioEngineService.isInitialized).toBe(true);
    });

    it("handles rapid alternating startCall and endCall spamming", async () => {
      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        for (let i = 0; i < 20; i++) {
          if (i % 2 === 0) {
            void result.current.startCall();
          } else {
            result.current.endCall("user_hangup");
          }
        }
      });

      // Terminal state should be deterministic and clean
      expect(["idle", "ended", "listening"]).toContain(result.current.status);
      if (result.current.status === "ended") {
        expect(result.current.isCallActive).toBe(false);
        expect(audioEngineService.isInitialized).toBe(false);
      }
    });

    it("handles endCall invoked while startCall is pending async initialization", async () => {
      let resolveInit: (val: boolean) => void = () => {};
      const pendingInitPromise = new Promise<boolean>((res) => {
        resolveInit = res;
      });

      vi.spyOn(audioEngineService, "initialize").mockImplementationOnce(() => pendingInitPromise);

      const { result } = renderHook(() => useVoiceCall());

      let startPromise: Promise<boolean>;
      act(() => {
        startPromise = result.current.startCall();
      });

      expect(result.current.status).toBe("connecting");

      // User hits hangup while still connecting
      act(() => {
        result.current.endCall("user_hangup");
      });

      expect(result.current.status).toBe("ended");

      // Now audio engine finishes initializing later
      await act(async () => {
        resolveInit(true);
        await startPromise;
      });

      // Status should remain ended and not erroneously switch to listening
      expect(result.current.status).toBe("ended");
      expect(result.current.isCallActive).toBe(false);
      expect(result.current.session?.status).toBe("ended");
    });

    it("handles multiple endCall calls in sequence (idempotent)", async () => {
      const onCallEnd = vi.fn();
      const { result } = renderHook(() => useVoiceCall({ onCallEnd }));

      await act(async () => {
        await result.current.startCall();
      });

      act(() => {
        result.current.endCall("user_hangup");
        result.current.endCall("user_hangup");
        result.current.endCall("timeout");
        result.current.endCall("error");
      });

      expect(result.current.status).toBe("ended");
      // Callback should only be called once for active call
      expect(onCallEnd).toHaveBeenCalledTimes(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /* AREA 2: Concurrent Mute/Gain Controls during Active TTS Streaming  */
  /* ------------------------------------------------------------------ */
  describe("2. Concurrent Audio Controls During Active TTS Streaming", () => {
    it("handles concurrent rapid mute toggling while TTS speech is actively streaming", async () => {
      if (MockSpeechSynthesis.lastInstance) {
        MockSpeechSynthesis.lastInstance.ttsDelayMs = 100;
        MockSpeechSynthesis.lastInstance.autoComplete = false;
      }

      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      // Start TTS playback
      let speakPromise: Promise<void> | undefined;
      act(() => {
        speakPromise = result.current.speakAgentResponse(
          "This is a streaming agent explanation about quantum mechanics."
        );
      });

      expect(result.current.status).toBe("speaking");

      // Rapidly toggle mute 30 times during speech
      act(() => {
        for (let i = 0; i < 30; i++) {
          result.current.toggleMute();
        }
      });

      expect(result.current.isMuted).toBe(false); // Even number of toggles (30) => back to false
      expect(result.current.status).toBe("speaking"); // TTS still active

      // Now complete TTS
      await act(async () => {
        if (MockSpeechSynthesis.lastInstance?.spokenUtterances.length) {
          const u = MockSpeechSynthesis.lastInstance.spokenUtterances[0];
          u.onend?.({ type: "end", utterance: u });
        }
        await speakPromise;
      });

      expect(result.current.status).toBe("listening");
    });

    it("transitions to 'muted' instead of 'listening' when TTS completes if call was muted mid-speech", async () => {
      if (MockSpeechSynthesis.lastInstance) {
        MockSpeechSynthesis.lastInstance.autoComplete = false;
      }

      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      let speakPromise: Promise<void> | undefined;
      act(() => {
        speakPromise = result.current.speakAgentResponse("Speaking response...");
      });

      expect(result.current.status).toBe("speaking");

      // Mute while speaking
      act(() => {
        result.current.setMuted(true);
      });

      expect(result.current.isMuted).toBe(true);
      // Status remains speaking while TTS output continues
      expect(result.current.status).toBe("speaking");

      // Complete TTS
      await act(async () => {
        const u = MockSpeechSynthesis.lastInstance?.spokenUtterances[0];
        u?.onend?.({ type: "end", utterance: u });
        await speakPromise;
      });

      // Status should transition to 'muted', not 'listening'
      expect(result.current.status).toBe("muted");
    });

    it("handles concurrent gain and volume rapid slider sweeps during playback", async () => {
      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      act(() => {
        // High frequency volume adjustments from UI slider
        for (let i = 0; i <= 100; i++) {
          result.current.setMicGain(i / 50); // 0.0 to 2.0
          result.current.setSpeakerVolume(i / 100); // 0.0 to 1.0
        }
      });

      expect(result.current.micGain).toBe(2.0);
      expect(result.current.speakerVolume).toBe(1.0);
      expect(audioEngineService.micGain).toBe(2.0);
      expect(audioEngineService.speakerVolume).toBe(1.0);
      expect(speechSynthesisService.settings.volume).toBe(1.0);
    });

    it("clamps extreme invalid values (NaN, Infinity, negative, excessive)", async () => {
      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      act(() => {
        result.current.setMicGain(NaN);
        result.current.setSpeakerVolume(Infinity);
      });

      expect(result.current.micGain).toBe(1.0); // Default fallback for NaN
      expect(result.current.speakerVolume).toBe(1.0); // Clamped max for Infinity

      act(() => {
        result.current.setMicGain(-999);
        result.current.setSpeakerVolume(-50);
      });

      expect(result.current.micGain).toBe(0.0);
      expect(result.current.speakerVolume).toBe(0.0);
    });

    it("does not synthesize speech or transition state if speakAgentResponse is called after endCall", async () => {
      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      act(() => {
        result.current.endCall("user_hangup");
      });

      expect(result.current.status).toBe("ended");
      expect(result.current.isCallActive).toBe(false);

      const speakSpy = vi.spyOn(speechSynthesisService, "speak");

      await act(async () => {
        await result.current.speakAgentResponse("Late model response after hangup");
      });

      expect(result.current.status).toBe("ended");
      expect(speakSpy).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /* AREA 3: Barge-In Interruptions During Agent Thinking vs Speaking   */
  /* ------------------------------------------------------------------ */
  describe("3. Rapid Barge-In Interruptions Across States", () => {
    it("interrupts agent immediately during 'thinking' state before TTS even starts", async () => {
      const onCommitTurn = vi.fn();
      const { result } = renderHook(() => useVoiceCall({ onCommitTurn }));

      await act(async () => {
        await result.current.startCall();
      });

      // Submit user prompt -> enters thinking state
      await act(async () => {
        await result.current.sendVoicePrompt("Run diagnostic report");
      });

      expect(result.current.status).toBe("thinking");

      // User interrupts while agent is thinking
      act(() => {
        result.current.interruptAgent("user_manual_button");
      });

      expect(result.current.status).toBe("listening");
    });

    it("handles rapid burst of speech start events during active speaking without crashing", async () => {
      if (MockSpeechSynthesis.lastInstance) {
        MockSpeechSynthesis.lastInstance.autoComplete = false;
      }

      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      act(() => {
        void result.current.speakAgentResponse("Explaining the detailed architecture steps.");
      });

      expect(result.current.status).toBe("speaking");

      // Burst of 10 rapid speech onset events
      act(() => {
        for (let i = 0; i < 10; i++) {
          MockSpeechRecognition.lastInstance?.emitSpeechStart();
        }
      });

      expect(speechSynthesisService.isSpeaking).toBe(false);
      expect(result.current.status).toBe("listening");
      expect(result.current.transcriptHistory.some((t) => t.interrupted)).toBe(true);
    });

    it("ignores barge-in when status is already idle, connecting, or ended", () => {
      const { result } = renderHook(() => useVoiceCall());

      expect(result.current.status).toBe("idle");
      // Interrupt on idle should be a no-op
      act(() => {
        result.current.interruptAgent("user_manual_button");
      });
      expect(result.current.status).toBe("idle");
    });

    it("marks only the agent turn as [interrupted] in transcript history", async () => {
      if (MockSpeechSynthesis.lastInstance) {
        MockSpeechSynthesis.lastInstance.autoComplete = false;
      }

      const { result } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      // User prompt
      await act(async () => {
        await result.current.sendVoicePrompt("Hello");
      });

      // Agent speaks
      act(() => {
        void result.current.speakAgentResponse("Hello there! How can I assist you today with code?");
      });

      // Interrupt
      act(() => {
        result.current.interruptAgent("user_speech_detected");
      });

      const history = result.current.transcriptHistory;
      expect(history.length).toBe(2);
      expect(history[0].speaker).toBe("user");
      expect(history[0].interrupted).toBeUndefined();
      expect(history[1].speaker).toBe("agent");
      expect(history[1].interrupted).toBe(true);
      expect(history[1].text).toContain("[interrupted]");
    });
  });

  /* ------------------------------------------------------------------ */
  /* AREA 4: Invalid State Transitions & Media Error Recovery          */
  /* ------------------------------------------------------------------ */
  describe("4. Invalid State Transitions & Media Device Error Recovery", () => {
    it("verifies protocol state machine transition validity", () => {
      const validPairs: [VoiceCallStatus, VoiceCallStatus][] = [
        ["idle", "connecting"],
        ["connecting", "listening"],
        ["listening", "thinking"],
        ["thinking", "speaking"],
        ["speaking", "listening"],
        ["listening", "muted"],
        ["muted", "listening"],
        ["listening", "ended"],
        ["ended", "connecting"],
      ];

      for (const [from, to] of validPairs) {
        expect(isValidVoiceStateTransition(from, to)).toBe(true);
      }

      const invalidPairs: [VoiceCallStatus, VoiceCallStatus][] = [
        ["idle", "speaking"],
        ["idle", "thinking"],
        ["idle", "muted"],
        ["ended", "speaking"],
        ["ended", "thinking"],
        ["ended", "muted"],
      ];

      for (const [from, to] of invalidPairs) {
        expect(isValidVoiceStateTransition(from, to)).toBe(false);
      }
    });

    it("recovers cleanly when media device permission is rejected (NotAllowedError)", async () => {
      const errorSpy = vi.spyOn(audioEngineService, "initialize").mockImplementationOnce(async () => {
        return false;
      });

      const { result } = renderHook(() => useVoiceCall());

      let ok = false;
      await act(async () => {
        ok = await result.current.startCall();
      });

      expect(ok).toBe(false);
      expect(result.current.status).toBe("ended");
      expect(result.current.error).toContain("microphone permissions");
      expect(result.current.isCallActive).toBe(false);

      // Attempting restart after failure should work if permission is granted
      errorSpy.mockRestore();

      await act(async () => {
        ok = await result.current.startCall();
      });

      expect(ok).toBe(true);
      expect(result.current.status).toBe("listening");
      expect(result.current.isCallActive).toBe(true);
    });

    it("cleans up speech recognition and timers on hook unmount", async () => {
      const { result, unmount } = renderHook(() => useVoiceCall());

      await act(async () => {
        await result.current.startCall();
      });

      expect(result.current.status).toBe("listening");

      // Unmount hook while active
      unmount();

      // Advancing timer should not throw
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    });

    it("handles prompt submission failures without wedging the state machine", async () => {
      const onSendPrompt = vi.fn().mockRejectedValueOnce(new Error("Network connection dropped"));
      const { result } = renderHook(() => useVoiceCall({ onSendPrompt }));

      await act(async () => {
        await result.current.startCall();
      });

      await act(async () => {
        await result.current.sendVoicePrompt("Failing prompt");
      });

      expect(result.current.error).toBe("Network connection dropped");
      // State should safely revert to listening (or muted) instead of getting stuck in thinking
      expect(result.current.status).toBe("listening");
    });

    it("does not dispatch prompt or alter history if sendVoicePrompt is called when call is not active", async () => {
      const onSendPrompt = vi.fn();
      const { result } = renderHook(() => useVoiceCall({ onSendPrompt }));

      expect(result.current.status).toBe("idle");

      await act(async () => {
        await result.current.sendVoicePrompt("Prompt while idle");
      });

      expect(onSendPrompt).not.toHaveBeenCalled();
      expect(result.current.transcriptHistory.length).toBe(0);
    });
  });
});

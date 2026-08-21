// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceCall } from "../useVoiceCall";
import { setupAudioMocks, cleanupAudioMocks, MockSpeechRecognition, MockSpeechSynthesis } from "@/test/audioMocks";
import { audioEngineService } from "@/services/audioEngine";
import { speechSynthesisService } from "@/services/speechSynthesis";

describe("useVoiceCall Controller Hook", () => {
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

  it("1. Initializes with idle default state", () => {
    const { result } = renderHook(() => useVoiceCall());

    expect(result.current.status).toBe("idle");
    expect(result.current.isCallActive).toBe(false);
    expect(result.current.isMuted).toBe(false);
    expect(result.current.micGain).toBe(1.0);
    expect(result.current.speakerVolume).toBe(1.0);
    expect(result.current.durationSeconds).toBe(0);
    expect(result.current.isDrawerOpen).toBe(false);
    expect(result.current.interimTranscript).toBe("");
    expect(result.current.finalTranscript).toBe("");
    expect(result.current.transcriptHistory).toEqual([]);
    expect(result.current.session).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("2. startCall initializes audio engine, starts speech recognition and opens drawer", async () => {
    const { result } = renderHook(() => useVoiceCall({ autoOpenDrawer: true }));

    let success = false;
    await act(async () => {
      success = await result.current.startCall();
    });

    expect(success).toBe(true);
    expect(result.current.status).toBe("listening");
    expect(result.current.isCallActive).toBe(true);
    expect(result.current.isDrawerOpen).toBe(true);
    expect(result.current.session).not.toBeNull();
    expect(audioEngineService.isInitialized).toBe(true);
  });

  it("3. Handles microphone initialization failure gracefully", async () => {
    vi.spyOn(audioEngineService, "initialize").mockResolvedValueOnce(false);

    const { result } = renderHook(() => useVoiceCall());

    let success = false;
    await act(async () => {
      success = await result.current.startCall();
    });

    expect(success).toBe(false);
    expect(result.current.status).toBe("ended");
    expect(result.current.error).toContain("microphone");
  });

  it("4. Toggles and sets microphone mute state", async () => {
    const { result } = renderHook(() => useVoiceCall());

    await act(async () => {
      await result.current.startCall();
    });

    expect(result.current.status).toBe("listening");

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(true);
    expect(result.current.status).toBe("muted");
    expect(audioEngineService.isMuted).toBe(true);

    act(() => {
      result.current.setMuted(false);
    });

    expect(result.current.isMuted).toBe(false);
    expect(result.current.status).toBe("listening");
    expect(audioEngineService.isMuted).toBe(false);
  });

  it("5. Sets clamped mic gain and speaker volume", async () => {
    const { result } = renderHook(() => useVoiceCall());

    await act(async () => {
      await result.current.startCall();
    });

    act(() => {
      result.current.setMicGain(1.8);
      result.current.setSpeakerVolume(0.6);
    });

    expect(result.current.micGain).toBe(1.8);
    expect(result.current.speakerVolume).toBe(0.6);

    // Test extreme boundary clamping
    act(() => {
      result.current.setMicGain(5.0);
      result.current.setSpeakerVolume(-0.5);
    });

    expect(result.current.micGain).toBe(2.0);
    expect(result.current.speakerVolume).toBe(0.0);
  });

  it("6. Advances duration timer every second while call is active", async () => {
    const { result } = renderHook(() => useVoiceCall());

    await act(async () => {
      await result.current.startCall();
    });

    expect(result.current.durationSeconds).toBe(0);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.durationSeconds).toBe(3);

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(result.current.durationSeconds).toBe(7);
  });

  it("7. Dispatches voice prompt and triggers onSendPrompt callback", async () => {
    const onSendPrompt = vi.fn();
    const { result } = renderHook(() => useVoiceCall({ onSendPrompt }));

    await act(async () => {
      await result.current.startCall();
    });

    await act(async () => {
      await result.current.sendVoicePrompt("Create a new router file");
    });

    expect(onSendPrompt).toHaveBeenCalledWith("Create a new router file");
    expect(result.current.status).toBe("thinking");
    expect(result.current.transcriptHistory.length).toBe(1);
    expect(result.current.transcriptHistory[0].text).toBe("Create a new router file");
    expect(result.current.transcriptHistory[0].speaker).toBe("user");
  });

  it("8. speakAgentResponse speaks text and completes successfully", async () => {
    const onCommitTurn = vi.fn();
    const { result } = renderHook(() => useVoiceCall({ onCommitTurn }));

    await act(async () => {
      await result.current.startCall();
    });

    await act(async () => {
      await result.current.speakAgentResponse("Here is the updated code.");
    });

    expect(result.current.transcriptHistory.length).toBe(1);
    expect(result.current.transcriptHistory[0].speaker).toBe("agent");
    expect(result.current.transcriptHistory[0].text).toBe("Here is the updated code.");
    expect(result.current.status).toBe("listening");
  });

  it("9. Barge-in interruption cancels synthesis and reverts status to listening", async () => {
    // Enable delay for barge-in test
    if (MockSpeechSynthesis.lastInstance) {
      MockSpeechSynthesis.lastInstance.ttsDelayMs = 5000;
    }

    const { result } = renderHook(() => useVoiceCall());

    await act(async () => {
      await result.current.startCall();
    });

    // Start speaking
    act(() => {
      void result.current.speakAgentResponse("Long ongoing explanation...");
    });

    expect(result.current.status).toBe("speaking");

    // Interrupt
    act(() => {
      result.current.interruptAgent("user_manual_button");
    });

    expect(speechSynthesisService.isSpeaking).toBe(false);
    expect(result.current.status).toBe("listening");
  });

  it("10. Barge-in triggered by user speech start during agent speech", async () => {
    // Enable delay for barge-in test
    if (MockSpeechSynthesis.lastInstance) {
      MockSpeechSynthesis.lastInstance.ttsDelayMs = 5000;
    }

    const { result } = renderHook(() => useVoiceCall());

    await act(async () => {
      await result.current.startCall();
    });

    // Start agent speech
    act(() => {
      void result.current.speakAgentResponse("Explaining the plan...");
    });

    expect(result.current.status).toBe("speaking");

    // Simulate microphone speech onset
    act(() => {
      MockSpeechRecognition.lastInstance?.emitSpeechStart();
    });

    expect(speechSynthesisService.isSpeaking).toBe(false);
    expect(result.current.status).toBe("listening");
  });

  it("11. endCall stops audio, cancels speech, commits transcripts and marks ended", async () => {
    const onCallEnd = vi.fn();
    const { result } = renderHook(() => useVoiceCall({ onCallEnd }));

    await act(async () => {
      await result.current.startCall();
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    act(() => {
      result.current.endCall("user_hangup");
    });

    expect(result.current.status).toBe("ended");
    expect(result.current.isCallActive).toBe(false);
    expect(audioEngineService.isInitialized).toBe(false);
    expect(onCallEnd).toHaveBeenCalledWith([], 5);
  });

  it("12. Drawer open/close/toggle handlers work properly", () => {
    const { result } = renderHook(() => useVoiceCall());

    expect(result.current.isDrawerOpen).toBe(false);

    act(() => {
      result.current.openDrawer();
    });
    expect(result.current.isDrawerOpen).toBe(true);

    act(() => {
      result.current.closeDrawer();
    });
    expect(result.current.isDrawerOpen).toBe(false);

    act(() => {
      result.current.toggleDrawer();
    });
    expect(result.current.isDrawerOpen).toBe(true);
  });
});

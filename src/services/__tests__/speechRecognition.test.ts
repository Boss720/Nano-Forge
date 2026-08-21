// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpeechRecognitionService } from "../speechRecognition";
import { setupAudioMocks, resetAudioMocks, MockSpeechRecognition } from "@/test/audioMocks";

describe("SpeechRecognitionService", () => {
  let mocks: ReturnType<typeof setupAudioMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks = setupAudioMocks();
  });

  afterEach(() => {
    resetAudioMocks();
    mocks.restore();
    vi.useRealTimers();
  });

  describe("Support & Initialization", () => {
    it("reports isSupported = true when SpeechRecognition exists", () => {
      const service = new SpeechRecognitionService();
      expect(service.isSupported).toBe(true);
      expect(service.isListening).toBe(false);
      expect(service.transcript).toBe("");
    });

    it("reports isSupported = false when window APIs are undefined", () => {
      mocks.restore();
      const originalSR = (globalThis as any).SpeechRecognition;
      const originalWSR = (globalThis as any).webkitSpeechRecognition;
      delete (globalThis as any).SpeechRecognition;
      delete (globalThis as any).webkitSpeechRecognition;

      const service = new SpeechRecognitionService();
      expect(service.isSupported).toBe(false);

      // Safe execution of start / stop without throwing
      expect(() => service.start()).not.toThrow();
      expect(() => service.stop()).not.toThrow();

      (globalThis as any).SpeechRecognition = originalSR;
      (globalThis as any).webkitSpeechRecognition = originalWSR;
    });

    it("respects custom options for lang, continuous, interimResults, silenceTimeoutMs", () => {
      const onInterim = vi.fn();
      const onFinal = vi.fn();
      const onAuto = vi.fn();

      const service = new SpeechRecognitionService({
        lang: "es-ES",
        continuous: false,
        interimResults: true,
        silenceTimeoutMs: 2000,
        onInterimResult: onInterim,
        onFinalResult: onFinal,
        onAutoDispatch: onAuto,
      });

      expect(service.isSupported).toBe(true);
    });
  });

  describe("Lifecycle & Controls", () => {
    it("starts and stops recognition cleanly", () => {
      const service = new SpeechRecognitionService();
      service.start();
      expect(service.isListening).toBe(true);

      service.stop();
      expect(service.isListening).toBe(false);
    });

    it("ignores redundant start() calls when already listening", () => {
      const service = new SpeechRecognitionService();
      service.start();
      service.start();
      expect(service.isListening).toBe(true);
    });

    it("handles multiple consecutive stop() calls safely", () => {
      const service = new SpeechRecognitionService();
      service.start();
      expect(() => {
        service.stop();
        service.stop();
      }).not.toThrow();
      expect(service.isListening).toBe(false);
    });

    it("resets transcript cleanly via resetTranscript()", () => {
      const service = new SpeechRecognitionService();
      service.simulateTranscript("test speech", true);
      expect(service.transcript).toBe("test speech");

      service.resetTranscript();
      expect(service.transcript).toBe("");
      expect(service.finalText).toBe("");
      expect(service.interimText).toBe("");
    });
  });

  describe("Streaming Transcripts & Interim Separation", () => {
    it("separates interim text from final committed text via simulateTranscript", () => {
      const onInterim = vi.fn();
      const onFinal = vi.fn();

      const service = new SpeechRecognitionService({
        onInterimResult: onInterim,
        onFinalResult: onFinal,
      });

      service.simulateTranscript("writing tests", false);
      expect(service.interimText).toBe("writing tests");
      expect(service.finalText).toBe("");
      expect(service.transcript).toBe("writing tests");
      expect(onInterim).toHaveBeenCalledWith("writing tests");
      expect(onFinal).not.toHaveBeenCalled();

      service.simulateTranscript("writing tests now", true);
      expect(service.interimText).toBe("");
      expect(service.finalText).toBe("writing tests now");
      expect(service.transcript).toBe("writing tests now");
      expect(onFinal).toHaveBeenCalledWith("writing tests now");
    });

    it("concatenates multiple final transcript turns with spaces", () => {
      const service = new SpeechRecognitionService();
      service.simulateTranscript("first sentence.", true);
      service.simulateTranscript("second sentence.", true);

      expect(service.finalText).toBe("first sentence. second sentence.");
      expect(service.transcript).toBe("first sentence. second sentence.");
    });

    it("ignores empty whitespace inputs on simulateTranscript", () => {
      const onFinal = vi.fn();
      const service = new SpeechRecognitionService({ onFinalResult: onFinal });
      service.simulateTranscript("   ", true);
      expect(service.transcript).toBe("");
      expect(onFinal).not.toHaveBeenCalled();
    });

    it("processes recognition results from browser events", () => {
      const onInterim = vi.fn();
      const onFinal = vi.fn();

      const service = new SpeechRecognitionService({
        onInterimResult: onInterim,
        onFinalResult: onFinal,
      });
      service.start();

      const mockSR = MockSpeechRecognition.lastInstance!;
      expect(mockSR).not.toBeNull();

      mockSR.emitResult([{ transcript: "hello there", confidence: 0.9 }], false);
      expect(service.interimText).toBe("hello there");
      expect(onInterim).toHaveBeenCalledWith("hello there");

      mockSR.emitResult([{ transcript: "hello there friend", confidence: 0.95 }], true);
      expect(service.finalText).toBe("hello there friend");
      expect(service.interimText).toBe("");
      expect(onFinal).toHaveBeenCalledWith("hello there friend");
    });
  });

  describe("VAD Pause Auto-Dispatch & Timer Debouncing", () => {
    it("auto-dispatches prompt after 1400ms silence and resets buffer", () => {
      const onAutoDispatch = vi.fn();
      const service = new SpeechRecognitionService({
        silenceTimeoutMs: 1400,
        onAutoDispatch,
      });

      service.simulateTranscript("create a fastify websocket server", true);
      expect(onAutoDispatch).not.toHaveBeenCalled();

      // Advance past 1000ms (still within silence window)
      vi.advanceTimersByTime(1000);
      expect(onAutoDispatch).not.toHaveBeenCalled();

      // Advance remaining 400ms
      vi.advanceTimersByTime(400);
      expect(onAutoDispatch).toHaveBeenCalledWith("create a fastify websocket server");
      expect(service.transcript).toBe("");
    });

    it("resets silence timer if user resumes speaking before timeout", () => {
      const onAutoDispatch = vi.fn();
      const service = new SpeechRecognitionService({
        silenceTimeoutMs: 1400,
        onAutoDispatch,
      });

      service.simulateTranscript("first part", false);
      vi.advanceTimersByTime(1000); // 1000ms elapsed
      expect(onAutoDispatch).not.toHaveBeenCalled();

      // User continues speaking at 1000ms
      service.simulateTranscript("first part second part", true);

      // Advance another 1000ms (total 2000ms from start, but only 1000ms from second speech)
      vi.advanceTimersByTime(1000);
      expect(onAutoDispatch).not.toHaveBeenCalled();

      // Advance remaining 400ms from second speech
      vi.advanceTimersByTime(400);
      expect(onAutoDispatch).toHaveBeenCalledWith("first part second part");
    });

    it("does not auto-dispatch when transcript is empty", () => {
      const onAutoDispatch = vi.fn();
      const service = new SpeechRecognitionService({
        silenceTimeoutMs: 1400,
        onAutoDispatch,
      });

      service.start();
      vi.advanceTimersByTime(2000);
      expect(onAutoDispatch).not.toHaveBeenCalled();
    });

    it("cancels auto-dispatch timer if stop() is called during silence window", () => {
      const onAutoDispatch = vi.fn();
      const service = new SpeechRecognitionService({
        silenceTimeoutMs: 1400,
        onAutoDispatch,
      });

      service.simulateTranscript("pending prompt", true);
      vi.advanceTimersByTime(800);

      service.stop();
      vi.advanceTimersByTime(1000);

      expect(onAutoDispatch).not.toHaveBeenCalled();
    });
  });

  describe("Barge-In Hook Trigger", () => {
    it("triggers onSpeechStart immediately when speech begins", () => {
      const onSpeechStart = vi.fn();
      const service = new SpeechRecognitionService({
        onSpeechStart,
      });

      service.simulateTranscript("stop talking", false);
      expect(onSpeechStart).toHaveBeenCalledTimes(1);
    });

    it("triggers onSpeechStart via recognition event", () => {
      const onSpeechStart = vi.fn();
      const service = new SpeechRecognitionService({
        onSpeechStart,
      });
      service.start();

      const mockSR = MockSpeechRecognition.lastInstance!;
      mockSR.emitSpeechStart();
      expect(onSpeechStart).toHaveBeenCalledTimes(1);
    });

    it("triggers onSpeechEnd callback when utterance finishes", () => {
      const onSpeechEnd = vi.fn();
      const service = new SpeechRecognitionService({
        onSpeechEnd,
      });

      service.simulateTranscript("finished sentence", true);
      expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Resilience & Permissions", () => {
    it("ignores non-fatal no-speech error without stopping listening", () => {
      const onError = vi.fn();
      const service = new SpeechRecognitionService({ onError });
      service.start();

      (service as any).handleError({ error: "no-speech" });
      expect(service.isListening).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it("handles not-allowed permission error by stopping and notifying onError", () => {
      const onError = vi.fn();
      const service = new SpeechRecognitionService({ onError });
      service.start();

      (service as any).handleError({ error: "not-allowed" });
      expect(service.isListening).toBe(false);
      expect(onError).toHaveBeenCalledWith({ error: "not-allowed" });
    });

    it("auto-restarts recognition on unexpected onend when continuous listening is enabled", () => {
      const service = new SpeechRecognitionService({ continuous: true });
      service.start();

      const mockSR = MockSpeechRecognition.lastInstance!;
      expect(service.isListening).toBe(true);

      mockSR.emitEnd();
      expect(service.isListening).toBe(true);

      vi.advanceTimersByTime(150);
      expect(service.isListening).toBe(true);
    });
  });
});

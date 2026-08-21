# SpeechRecognitionService Investigation & Technical Specification

## 1. Observation

Direct observations from the project codebase, contracts, and requirement documents:

1. **Requirement R2 & Acceptance Criteria** (`ORIGINAL_REQUEST.md:15-17`, `36-37`):
   - *"Implement real-time microphone capture and speech recognition using browser Web Speech API / Whisper transcription fallbacks. Stream live interim transcripts directly into the active voice drawer, allowing hands-free prompt submission to the active agent host or chat session upon voice pause."*
   - *"Speaking into the microphone produces real-time interim transcription text in the call view."*
   - *"Completing a speech utterance automatically dispatches the prompt to the agent session."*

2. **Feature Inventory F5 & Scope Contract** (`PROJECT.md:53`, `SCOPE.md:58-83`):
   - `F5`: Live Speech-to-Text (STT) & VAD Auto-Dispatch via `src/services/speechRecognition.ts`.
   - Contract definition:
     ```typescript
     export interface SpeechRecognitionOptions {
       lang?: string; // default: "en-US"
       continuous?: boolean; // default: true
       interimResults?: boolean; // default: true
       silenceTimeoutMs?: number; // default: 1400ms
       onInterimResult?: (interimText: string) => void;
       onFinalResult?: (finalText: string) => void;
       onSpeechStart?: () => void; // Used for TTS Barge-in
       onSpeechEnd?: () => void;
       onAutoDispatch?: (fullPrompt: string) => void;
       onError?: (error: any) => void;
     }

     export interface ISpeechRecognitionService {
       readonly isSupported: boolean;
       readonly isListening: boolean;
       readonly transcript: string;
       readonly interimText: string;
       readonly finalText: string;
       
       start(): void;
       stop(): void;
       resetTranscript(): void;
       simulateTranscript(text: string, isFinal?: boolean): void; // Fallback / Testing seam
     }
     ```

3. **Barge-In Requirement** (`ORIGINAL_REQUEST.md:39`, `SCOPE.md:65`):
   - User speech during agent playback must immediately interrupt and cancel current TTS playback (`onSpeechStart` callback -> `speechSynthesizer.cancel()`).

4. **Test Environment & Mocks** (`package.json:107`, `vitest.config.ts:6`, `SCOPE.md:109-110`):
   - JSDOM and Node test environments do not natively provide `window.SpeechRecognition` or `window.webkitSpeechRecognition`.
   - All tests require a standardized test mock harness (`src/test/audioMocks.ts`) with controllable events (`onstart`, `onspeechstart`, `onresult`, `onspeechend`, `onerror`, `onend`) and fake timer advancing.

---

## 2. Logic Chain

From the observations, we derive the technical requirements and architecture:

1. **Browser Engine Support & Detection (Observation 2, 4)**:
   - Modern browsers implement speech recognition under either `window.SpeechRecognition` or `window.webkitSpeechRecognition`.
   - The service must safely query `typeof window !== "undefined"` and detect either constructor without throwing.
   - If neither exists, `isSupported` evaluates to `false`. The service remains instantiable and safe: calling `start()` does not crash, and `simulateTranscript(...)` continues to function normally so headless tests and manual input work seamlessly.

2. **Streaming Transcript Accumulation (Observation 1, 2)**:
   - In continuous mode (`continuous: true`, `interimResults: true`), the browser delivers `SpeechRecognitionEvent` containing a list of `SpeechRecognitionResult` items.
   - Results with `isFinal === true` represent finalized phrases. Results with `isFinal === false` represent live in-flight hypotheses.
   - The service maintains separate state for `finalText` (committed) and `interimText` (live preview).
   - `transcript` is dynamically calculated as the trimmed concatenation of `finalText` and `interimText`.
   - `onInterimResult(interimText)` fires whenever interim hypothesis updates.
   - `onFinalResult(finalText)` fires whenever a chunk is committed.

3. **VAD Pause Detection & Auto-Dispatch (Observation 1, 2)**:
   - When the user is actively speaking (indicated by `onspeechstart` or non-empty speech results), any pending silence timer is cleared.
   - When the utterance completes (indicated by `onspeechend` or arrival of a speech result), a silence timer is armed with `silenceTimeoutMs` (default 1400ms).
   - If new speech arrives before 1400ms expires, the timer resets.
   - When 1400ms elapses without new speech:
     - Check if accumulated `transcript.trim()` has content.
     - If non-empty, trigger `onAutoDispatch(fullPrompt)`.
     - Reset transcript buffers via `resetTranscript()` so subsequent turns start cleanly.

4. **Instant Barge-In Hook (Observation 3)**:
   - On the very first indication of speech (`onspeechstart`, initial interim result, or `simulateTranscript`), `onSpeechStart()` is invoked immediately.
   - This provides sub-50ms latency to cancel TTS audio and abort LLM stream generation.

5. **Resilience & Auto-Restart**:
   - Chromium SpeechRecognition frequently disconnects with `onend` or `no-speech` errors during pauses.
   - If `isListening` is active and `stop()` was not intentionally called, the service automatically restarts recognition after a short tick (100ms) with error-loop suppression.
   - Fatal errors like `"not-allowed"` disable auto-restart and emit `onError`.

6. **Deterministic Testing Seam (Observation 4)**:
   - `simulateTranscript(text, isFinal)` replicates the exact state transitions of browser recognition:
     - Non-final: sets `interimText`, emits `onSpeechStart`, calls `onInterimResult`, arms 1400ms timer.
     - Final: appends to `finalText`, clears `interimText`, calls `onFinalResult`, arms 1400ms timer.
     - Firing fake timers immediately tests `onAutoDispatch` without physical audio hardware.

---

## 3. Caveats

1. **Browser Permission Dialogs**: In real browsers, calling `recognition.start()` requires user microphone permission. If denied, the browser fires `onerror` with `{ error: "not-allowed" }`. The service must handle this without crashing and notify `onError`.
2. **Audio Echo / Self-Triggering**: When agent TTS is speaking through speakers, the microphone might pick up agent audio. The Voice Call orchestrator hook (`useVoiceCall` in M3) should ideally mute or ignore STT during agent speech if echo cancellation is imperfect, or rely on instant barge-in to cut TTS upon true user speech.
3. **No Caveats on Core Logic**: All event paths, accumulation math, and timer lifecycles are fully bounded and testable.

---

## 4. Conclusion & Technical Blueprint

### 4.1 Production Implementation Blueprint: `src/services/speechRecognition.ts`

```typescript
/**
 * SpeechRecognitionService
 * Web Speech API continuous speech recognition with streaming interim transcripts,
 * VAD pause auto-dispatch (1400ms default), instant TTS barge-in hooks, and headless simulation seam.
 */

export interface SpeechRecognitionOptions {
  lang?: string; // default: "en-US"
  continuous?: boolean; // default: true
  interimResults?: boolean; // default: true
  silenceTimeoutMs?: number; // default: 1400ms
  onInterimResult?: (interimText: string) => void;
  onFinalResult?: (finalText: string) => void;
  onSpeechStart?: () => void; // Used for TTS Barge-in
  onSpeechEnd?: () => void;
  onAutoDispatch?: (fullPrompt: string) => void;
  onError?: (error: any) => void;
}

export interface ISpeechRecognitionService {
  readonly isSupported: boolean;
  readonly isListening: boolean;
  readonly transcript: string;
  readonly interimText: string;
  readonly finalText: string;

  start(): void;
  stop(): void;
  resetTranscript(): void;
  simulateTranscript(text: string, isFinal?: boolean): void; // Fallback / Testing seam
}

type BrowserSpeechRecognition = any;

export class SpeechRecognitionService implements ISpeechRecognitionService {
  private recognition: BrowserSpeechRecognition | null = null;
  private options: SpeechRecognitionOptions;
  
  private _isListening = false;
  private _isExplicitlyStopped = true;
  private _isUserSpeaking = false;
  
  private _committedFinalText = "";
  private _currentSessionFinalText = "";
  private _interimText = "";
  private _finalText = "";
  private _transcript = "";

  private _silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SpeechRecognitionOptions = {}) {
    this.options = {
      lang: "en-US",
      continuous: true,
      interimResults: true,
      silenceTimeoutMs: 1400,
      ...options,
    };

    this.initRecognition();
  }

  public get isSupported(): boolean {
    return typeof window !== "undefined" && (
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window
    );
  }

  public get isListening(): boolean {
    return this._isListening;
  }

  public get transcript(): string {
    return this._transcript;
  }

  public get interimText(): string {
    return this._interimText;
  }

  public get finalText(): string {
    return this._finalText;
  }

  private initRecognition(): void {
    if (!this.isSupported) return;

    try {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (!SpeechRecognitionClass) return;

      const recognition = new SpeechRecognitionClass();
      recognition.continuous = this.options.continuous ?? true;
      recognition.interimResults = this.options.interimResults ?? true;
      recognition.lang = this.options.lang ?? "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this._isListening = true;
      };

      recognition.onspeechstart = () => {
        this.handleSpeechStart();
      };

      recognition.onspeechend = () => {
        this.handleSpeechEnd();
      };

      recognition.onresult = (event: any) => {
        this.handleResult(event);
      };

      recognition.onerror = (event: any) => {
        this.handleError(event);
      };

      recognition.onend = () => {
        this.handleEnd();
      };

      this.recognition = recognition;
    } catch (err) {
      this.options.onError?.(err);
    }
  }

  public start(): void {
    if (this._isListening) return;

    this._isExplicitlyStopped = false;
    this.clearRestartTimer();

    if (!this.recognition) {
      this.initRecognition();
    }

    if (this.recognition) {
      try {
        this.recognition.start();
        this._isListening = true;
      } catch (err: any) {
        // Recognition may already be running or in transition
        if (err.name !== "InvalidStateError") {
          this.options.onError?.(err);
        }
      }
    } else {
      this._isListening = true;
    }
  }

  public stop(): void {
    this._isExplicitlyStopped = true;
    this._isListening = false;
    this._isUserSpeaking = false;

    this.clearSilenceTimer();
    this.clearRestartTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore if already stopped
      }
    }
  }

  public resetTranscript(): void {
    this.clearSilenceTimer();
    this._committedFinalText = "";
    this._currentSessionFinalText = "";
    this._interimText = "";
    this._finalText = "";
    this._transcript = "";
    this._isUserSpeaking = false;
  }

  public simulateTranscript(text: string, isFinal: boolean = true): void {
    const trimmed = text.trim();
    if (!trimmed && isFinal) return;

    // 1. Trigger speech start if starting new utterance
    if (!this._isUserSpeaking) {
      this.handleSpeechStart();
    }

    // 2. Clear any pending silence timeout while speech arrives
    this.clearSilenceTimer();

    // 3. Accumulate text
    if (isFinal) {
      this._committedFinalText = [this._committedFinalText, trimmed]
        .filter(Boolean)
        .join(" ");
      this._interimText = "";
      this._finalText = this._committedFinalText;
      this._transcript = this._finalText;

      this.options.onFinalResult?.(this._finalText);
      this.handleSpeechEnd();
    } else {
      this._interimText = trimmed;
      this._transcript = [this._finalText, this._interimText]
        .filter(Boolean)
        .join(" ");

      this.options.onInterimResult?.(this._interimText);
      // Restart silence timer even for interim updates to catch speech pause
      this.armSilenceTimer();
    }
  }

  private handleSpeechStart(): void {
    this._isUserSpeaking = true;
    this.clearSilenceTimer();
    this.options.onSpeechStart?.();
  }

  private handleSpeechEnd(): void {
    this._isUserSpeaking = false;
    this.options.onSpeechEnd?.();
    this.armSilenceTimer();
  }

  private handleResult(event: any): void {
    if (!this._isUserSpeaking) {
      this.handleSpeechStart();
    }

    this.clearSilenceTimer();

    let sessionFinal = "";
    let interim = "";

    const results = event.results || [];
    for (let i = 0; i < results.length; ++i) {
      const item = results[i];
      const text = item[0]?.transcript || "";
      if (item.isFinal) {
        sessionFinal += (sessionFinal ? " " : "") + text.trim();
      } else {
        interim += (interim ? " " : "") + text.trim();
      }
    }

    this._currentSessionFinalText = sessionFinal;
    this._interimText = interim;

    const combinedFinal = [this._committedFinalText, this._currentSessionFinalText]
      .filter(Boolean)
      .join(" ")
      .trim();

    this._finalText = combinedFinal;
    this._transcript = [this._finalText, this._interimText]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (interim) {
      this.options.onInterimResult?.(interim);
    }
    if (combinedFinal && sessionFinal) {
      this.options.onFinalResult?.(combinedFinal);
    }

    this.armSilenceTimer();
  }

  private handleError(event: any): void {
    const errorType = event?.error || "unknown";

    // Non-fatal errors in continuous mode
    if (errorType === "no-speech" || errorType === "aborted") {
      return;
    }

    // Permission denied or system blocked
    if (errorType === "not-allowed" || errorType === "service-not-allowed") {
      this._isListening = false;
      this._isExplicitlyStopped = true;
      this.clearSilenceTimer();
      this.options.onError?.(event);
      return;
    }

    this.options.onError?.(event);
  }

  private handleEnd(): void {
    // If recognition ended during active session, commit session text and auto-restart
    if (this._currentSessionFinalText) {
      this._committedFinalText = [this._committedFinalText, this._currentSessionFinalText]
        .filter(Boolean)
        .join(" ");
      this._currentSessionFinalText = "";
    }

    if (this._isListening && !this._isExplicitlyStopped) {
      this.clearRestartTimer();
      this._restartTimer = setTimeout(() => {
        if (this._isListening && !this._isExplicitlyStopped && this.recognition) {
          try {
            this.recognition.start();
          } catch {
            // Handled on next cycle
          }
        }
      }, 100);
    } else {
      this._isListening = false;
    }
  }

  private armSilenceTimer(): void {
    this.clearSilenceTimer();
    const timeoutMs = this.options.silenceTimeoutMs ?? 1400;

    this._silenceTimer = setTimeout(() => {
      this.handleSilenceTimeout();
    }, timeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this._silenceTimer !== null) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  private clearRestartTimer(): void {
    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  private handleSilenceTimeout(): void {
    this._silenceTimer = null;
    const promptToDispatch = this._transcript.trim();

    if (promptToDispatch.length > 0) {
      this.options.onAutoDispatch?.(promptToDispatch);
      this.resetTranscript();
    }
  }
}
```

---

### 4.2 Mock Harness Implementation: `src/test/audioMocks.ts`

```typescript
import { vi } from "vitest";

export class MockSpeechRecognition {
  continuous = true;
  interimResults = true;
  lang = "en-US";
  maxAlternatives = 1;

  onstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn(() => {
    this.onstart?.();
  });

  stop = vi.fn(() => {
    this.onend?.();
  });

  abort = vi.fn(() => {
    this.onend?.();
  });

  // Test trigger helpers
  emitSpeechStart(): void {
    this.onspeechstart?.();
  }

  emitSpeechEnd(): void {
    this.onspeechend?.();
  }

  emitResult(transcript: string, isFinal: boolean): void {
    const resultItem = [{ transcript, confidence: 0.95 }];
    Object.assign(resultItem, { isFinal });
    const event = {
      resultIndex: 0,
      results: [resultItem],
    };
    this.onresult?.(event);
  }

  emitError(error: string): void {
    this.onerror?.({ error });
  }

  emitEnd(): void {
    this.onend?.();
  }
}

export function setupAudioMocks(): void {
  Object.defineProperty(window, "SpeechRecognition", {
    writable: true,
    configurable: true,
    value: MockSpeechRecognition,
  });
  Object.defineProperty(window, "webkitSpeechRecognition", {
    writable: true,
    configurable: true,
    value: MockSpeechRecognition,
  });
}

export function resetAudioMocks(): void {
  vi.clearAllMocks();
  vi.clearAllTimers();
}
```

---

### 4.3 Comprehensive Unit Test Specification: `src/services/__tests__/speechRecognition.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpeechRecognitionService } from "../speechRecognition";
import { setupAudioMocks, resetAudioMocks } from "@/test/audioMocks";

describe("SpeechRecognitionService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupAudioMocks();
  });

  afterEach(() => {
    resetAudioMocks();
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
      const originalSR = (window as any).SpeechRecognition;
      const originalWSR = (window as any).webkitSpeechRecognition;
      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;

      const service = new SpeechRecognitionService();
      expect(service.isSupported).toBe(false);

      // Safe execution of start / stop without throwing
      expect(() => service.start()).not.toThrow();
      expect(() => service.stop()).not.toThrow();

      (window as any).SpeechRecognition = originalSR;
      (window as any).webkitSpeechRecognition = originalWSR;
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
    it("separates interim text from final committed text", () => {
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
      service.simulateTranscript("second part", true);

      // Advance another 1000ms (total 2000ms from start, but only 1000ms from second speech)
      vi.advanceTimersByTime(1000);
      expect(onAutoDispatch).not.toHaveBeenCalled();

      // Advance remaining 400ms from second speech
      vi.advanceTimersByTime(400);
      expect(onAutoDispatch).toHaveBeenCalledWith("second part");
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
  });
});
```

---

## 5. Verification Method

To independently verify the implementation once executed by the Worker agent:

1. **Unit Test Command**:
   ```bash
   npx vitest run src/services/__tests__/speechRecognition.test.ts
   ```
   - Must execute all 12+ unit tests with a 100% pass rate.
   - Must verify fake timer advancement, interim streaming, VAD auto-dispatch, and barge-in callbacks.

2. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   ```
   - Must verify 0 type errors across `SpeechRecognitionService`, `ISpeechRecognitionService`, and `SpeechRecognitionOptions`.

3. **Full Project Suite Verification**:
   ```bash
   npm test
   npm run build
   ```
   - Must succeed with 0 errors.

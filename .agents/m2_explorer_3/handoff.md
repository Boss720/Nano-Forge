# Milestone 2 Explorer 3 — Handoff Report: SpeechSynthesisService, Test Mocks & Unit Test Strategy

## 1. Observation

### 1.1 Requirements & Workspace State
- **Workspace root**: `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge`
- **Original User Request (`ORIGINAL_REQUEST.md`)**:
  - `§R3. Text-to-Speech (TTS) Synthesis & Streaming Agent Audio Playback`: Integrate dynamic text-to-speech audio synthesis that converts agent output tokens and message turns into spoken audio during an active call. Support speech cancellation/interruption when the user begins speaking, speech rate/pitch configuration, and multiple voice timbre choices.
  - `§R5. Complete Verification & System Integrity`: Deliver comprehensive unit, component, and adversarial test suites across packages/protocol, apps/agent-host, and src/ ensuring all tests pass with 100% success rate, 0 build errors (`npm run build`).
- **Project Plan (`PROJECT.md`)**:
  - Lines 107-111: Speech Synthesis Service Contract (`src/services/speechSynthesis.ts`) specifying `speak(text: string): Promise<void>`, `cancel(): void` (Immediate barge-in cancellation), `updateSettings(settings: Partial<TTSSettings>): void`, `getVoices(): SpeechSynthesisVoice[]`.
  - Lines 128-131: Unit test files `src/services/__tests__/audioEngine.test.ts`, `src/services/__tests__/speechRecognition.test.ts`, `src/services/__tests__/speechSynthesis.test.ts`, and `src/test/audioMocks.ts`.
- **Milestone Scope (`.agents/m2_orch/SCOPE.md`)**:
  - Lines 7-11, 86-111: Technical interfaces for `TTSSettings`, `ISpeechSynthesisService`, `setupAudioMocks()`, `resetAudioMocks()`, and full unit testing coverage for Milestone 2.
- **Existing Test Configuration (`package.json` & `vitest.config.ts`)**:
  - `package.json` line 11: `"test": "vitest run"`.
  - `package.json` lines 79-81, 96, 107: `jsdom: "^30.0.1"`, `@testing-library/react: "^16.3.2"`, `vitest: "^4.1.10"`.
  - `vitest.config.ts` lines 5-8: `environment: "node"`, `include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"]`.
  - In existing component tests (e.g. `src/sections/ChatComposer.test.tsx` line 1), `// @vitest-environment jsdom` is used at the top of DOM-dependent test files.
- **File System Inspection**:
  - Directories `src/services/` and `src/test/` do not exist yet and are planned for Milestone 2 worker implementation.

---

## 2. Logic Chain

### 2.1 SpeechSynthesisService Architecture (`src/services/speechSynthesis.ts`)
1. **Browser Capability & Graceful Degradation**:
   - `typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window` checks guarantee safe initialization in SSR, Node, JSDOM, and unsupported browsers.
   - When unsupported, `isSupported` returns `false`, and all methods (`speak`, `cancel`, `pause`, `resume`) execute as safe, non-throwing operations.
2. **Voice Discovery & Async Lifecycle**:
   - Web browsers (specifically Chrome, Safari, and Edge) load system voices asynchronously, often returning `[]` on initial load.
   - `SpeechSynthesisService` attaches an event listener to `window.speechSynthesis.onvoiceschanged` and caches the voice list.
   - It exposes `getVoices(): SpeechSynthesisVoice[]` and emits an internal `voiceschanged` event so UI selectors and listeners update immediately.
3. **Settings Validation & Clamping**:
   - `TTSSettings`: `{ voiceURI: string | null, rate: number, pitch: number, volume: number }`.
   - `rate` is clamped strictly between `0.5` and `2.0` (default `1.0`).
   - `pitch` is clamped strictly between `0.5` and `1.5` (default `1.0`).
   - `volume` is clamped strictly between `0.0` and `1.0` (default `1.0`).
   - `voiceURI` allows selecting a specific voice by URI, with fallback to default system voice when null or not found.
4. **Sentence Boundary Chunking Engine (`chunkTextForSpeech`)**:
   - *Problem*: Browser TTS engines (Chromium specifically) silently freeze or fail when given text longer than ~200-300 characters or lasting longer than ~15 seconds. In addition, conversational responsiveness requires streaming sentences naturally.
   - *Solution*: A multi-stage hierarchical chunking algorithm:
     - Stage 1: Split along sentence boundary punctuation (`[.!?\n]+`).
     - Stage 2: For any sentence exceeding 150 characters, split along clause delimiters (commas `,`, semicolons `;`, colons `:`, em-dashes `—`).
     - Stage 3: For any clause still exceeding 150 characters (e.g. run-on text, code snippets), split at word boundaries (whitespace) so words are never truncated.
     - Stage 4: Trim and filter empty/whitespace chunks.
5. **Utterance Queue & Execution Engine**:
   - `speak(text: string): Promise<void>` partitions text into chunks and enqueues them in an internal queue.
   - Chunks are synthesized sequentially: chunk 0 starts -> `onend` fires -> chunk 1 starts -> ... -> queue empty -> resolves Promise.
   - Chrome GC Workaround: Retains a strong reference `_activeUtteranceRef` to the currently playing `SpeechSynthesisUtterance` to prevent browser garbage collection mid-speech.
6. **Immediate Barge-In Cancellation (`cancel()`)**:
   - When the user starts speaking (barge-in signal from `SpeechRecognitionService`) or clicks the interrupt button:
     - `cancel()` immediately calls `window.speechSynthesis.cancel()`.
     - Clears the remaining chunk queue (`_chunkQueue = []`).
     - Sets `_isSpeaking = false` and `_isCancelled = true`.
     - Cleans up active utterance references and resolves/aborts the active `speak()` promise cleanly without deadlocks.
     - Calling `speak(newText)` while speech is active automatically cancels prior utterances first.

### 2.2 Reusable Audio & Speech Test Mock Factory (`src/test/audioMocks.ts`)
1. **Why a Dedicated Mock Factory?**
   - JSDOM and Node test environments lack native Web Audio API (`AudioContext`, `AnalyserNode`, `GainNode`, `MediaStreamAudioSourceNode`), `MediaDevices` (`getUserMedia`), Web Speech API (`SpeechRecognition`, `webkitSpeechRecognition`), and `SpeechSynthesis` (`speechSynthesis`, `SpeechSynthesisUtterance`).
   - Without a centralized, high-fidelity mock factory, unit tests for services, hooks (`useVoiceCall`), and UI components (`VoiceCallDrawer`, `VoiceWaveformVisualizer`, `VoiceFrequencyVisualizer`) will fail or require repetitive, fragile inline mocking.
2. **Mock Factory Architecture**:
   - `MockAudioContext`: Full state machine (`suspended` -> `running` -> `closed`), node factories (`createAnalyser`, `createGain`, `createMediaStreamSource`), and `destination`.
   - `MockAnalyserNode`: Implements `fftSize`, `frequencyBinCount`, `smoothingTimeConstant`, `minDecibels`, `maxDecibels`, `getByteTimeDomainData`, `getByteFrequencyData`, with test hooks to inject waveform/silence data.
   - `MockGainNode`: Implements `gain` with `.value` and scheduling methods (`setValueAtTime`, `linearRampToValueAtTime`).
   - `MockMediaStreamTrack` & `MockMediaStream`: Implements `enabled`, `readyState`, `stop()`, `getAudioTracks()`.
   - `MockSpeechRecognition`: Implements continuous recognition, interim/final result emission (`simulateTranscript`), speech start/end events, and error simulation.
   - `MockSpeechSynthesis` & `MockSpeechSynthesisUtterance`: Implements voice list, utterance queue, event dispatch (`start`, `end`, `error`, `voiceschanged`), and cancellation handling.
   - Global helpers: `setupAudioMocks()`, `resetAudioMocks()`, `cleanupAudioMocks()`.

### 2.3 Comprehensive Unit Test Strategy
1. **`audioEngine.test.ts`**:
   - 100% branch and edge-case coverage:
     - Uninitialized defaults and state inspection.
     - Successful initialization with standard constraints (`echoCancellation`, `noiseSuppression`, `autoGainControl`).
     - Idempotent initialization.
     - Unsupported environment fallbacks (missing `AudioContext` or `getUserMedia`).
     - User permission denial (`NotAllowedError`) and device missing (`NotFoundError`).
     - Autoplay suspended state and `resumeContext()`.
     - Mic audio graph verification (ensuring mic is NOT connected to `audioContext.destination`).
     - Speaker audio graph verification.
     - Gain and volume controls with boundary clamping (`[-1, 3]` -> `[0, 2]` / `[0, 1]`).
     - Mute/unmute state toggle, track disable/enable, and gain restoration.
     - Visualizer data calculation (time-domain waveform, frequency bins, RMS volume, peak volume, silence vs signal).
     - Full teardown and resource cleanup.
2. **`speechRecognition.test.ts`**:
   - 100% branch and edge-case coverage:
     - Environment support detection (`SpeechRecognition` / `webkitSpeechRecognition`).
     - Start and stop lifecycle with idempotency.
     - Streaming interim transcript accumulation and `onInterimResult` callbacks.
     - Streaming final transcript accumulation and `onFinalResult` callbacks.
     - Speech start detection (`onspeechstart`) triggering `onSpeechStart` for barge-in.
     - VAD pause detection timer (1400ms debounce), timer resets on ongoing speech, and auto-dispatch upon pause.
     - Fallback / testing seam `simulateTranscript(text, isFinal)`.
     - `resetTranscript()` clearing buffers.
     - Error handling (`no-speech`, `audio-capture`, `not-allowed`, `network`) and safe recovery.
3. **`speechSynthesis.test.ts`**:
   - 100% branch and edge-case coverage:
     - Environment support detection.
     - Async voice enumeration and `voiceschanged` event handling.
     - Setting updates and clamping (`rate` [0.5, 2.0], `pitch` [0.5, 1.5], `volume` [0.0, 1.0], `voiceURI`).
     - Chunking engine (`chunkTextForSpeech`): short sentences, punctuation splits, clause splits, word-boundary splits for run-on sentences, newline splits, whitespace trimming.
     - Sequential utterance playback lifecycle (`onstart` -> `onend` -> next chunk).
     - Instant barge-in cancellation (`cancel()`): cancels active speech, clears pending queue, stops playback, and prevents subsequent chunk emission.
     - Pause and resume controls.
     - Error handling (`canceled`/`interrupted` vs real errors).
     - Garbage collection reference anchoring.

---

## 3. Caveats

1. **Browser Specific Quirks**: In real browser engines (specifically Safari / WebKit), `SpeechSynthesisUtterance` can occasionally have audio routing delays; our mock factory simulates the standard W3C Web Speech specification with configurable timer triggers.
2. **Single AudioContext Destination**: The browser's Web Speech API does not allow routing `speechSynthesis` output directly into a custom Web Audio `MediaStreamDestinationNode` in standard browsers. Therefore, speaker visualizer data for TTS is driven by synthesis activity events and simulated frequency synthesis in client visualizers or custom AudioBuffer playback if server TTS chunks are used.
3. **Vitest JSDOM Pragma**: Because the root `vitest.config.ts` is configured with `environment: "node"`, all frontend test files (`src/**/*.test.ts`, `src/**/*.test.tsx`) must include `// @vitest-environment jsdom` as the first line.

---

## 4. Conclusion & Concrete Implementation Specifications

The designs below provide complete, production-ready specifications for Milestone 2 workers.

### 4.1 Implementation Specification: `src/services/speechSynthesis.ts`

```typescript
/**
 * Speech Synthesis Service for NanoForge Interactive Audio Call System
 * Wraps window.speechSynthesis and window.SpeechSynthesisUtterance with:
 * - Robust voice enumeration and asynchronous voice loading
 * - Sentence boundary chunking engine for long assistant responses (>150 chars)
 * - Immediate barge-in cancellation and queue reset
 * - Settings validation and clamping (voiceURI, rate, pitch, volume)
 * - Chrome GC bug prevention via strong utterance anchoring
 */

export interface TTSSettings {
  voiceURI: string | null;
  rate: number; // 0.5 to 2.0 (default: 1.0)
  pitch: number; // 0.5 to 1.5 (default: 1.0)
  volume: number; // 0.0 to 1.0 (default: 1.0)
}

export interface ISpeechSynthesisService {
  readonly isSupported: boolean;
  readonly isSpeaking: boolean;
  readonly voices: SpeechSynthesisVoice[];
  readonly settings: TTSSettings;

  updateSettings(settings: Partial<TTSSettings>): void;
  speak(text: string): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoice[];
  on(event: string, callback: (...args: any[]) => void): () => void;
  off(event: string, callback: (...args: any[]) => void): void;
}

/**
 * Splits text into conversational utterance chunks:
 * 1. Split on sentence boundaries (. ! ? \n)
 * 2. If chunk > maxChunkLength (150 chars), split on clause boundaries (, ; : —)
 * 3. If clause > maxChunkLength, split on word boundaries (whitespace)
 * 4. Filter empty/whitespace chunks
 */
export function chunkTextForSpeech(text: string, maxChunkLength = 150): string[] {
  if (!text || !text.trim()) return [];

  const normalized = text.trim();
  if (normalized.length <= maxChunkLength && !normalized.includes("\n")) {
    return [normalized];
  }

  // 1. Split by sentence boundaries (. ! ? \n)
  const sentenceRegex = /[^.!?\n]+[.!?\n]*/g;
  const rawSentences = normalized.match(sentenceRegex) || [normalized];
  const chunks: string[] = [];

  for (const rawSentence of rawSentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    if (sentence.length <= maxChunkLength) {
      chunks.push(sentence);
    } else {
      // 2. Split by clause boundaries (, ; : —)
      const clauseRegex = /[^,;:—]+[,;:—]*/g;
      const rawClauses = sentence.match(clauseRegex) || [sentence];

      for (const rawClause of rawClauses) {
        const clause = rawClause.trim();
        if (!clause) continue;

        if (clause.length <= maxChunkLength) {
          chunks.push(clause);
        } else {
          // 3. Split by word boundaries
          const words = clause.split(/\s+/);
          let currentChunk = "";

          for (const word of words) {
            if (!word) continue;
            const candidate = currentChunk ? `${currentChunk} ${word}` : word;
            if (candidate.length <= maxChunkLength) {
              currentChunk = candidate;
            } else {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = word;
            }
          }
          if (currentChunk) {
            chunks.push(currentChunk);
          }
        }
      }
    }
  }

  return chunks.length > 0 ? chunks : [normalized];
}

export class SpeechSynthesisService implements ISpeechSynthesisService {
  private _isSupported: boolean = false;
  private _isSpeaking: boolean = false;
  private _voices: SpeechSynthesisVoice[] = [];
  private _settings: TTSSettings = {
    voiceURI: null,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
  };
  private _chunkQueue: string[] = [];
  private _activeResolve: (() => void) | null = null;
  private _activeReject: ((err: any) => void) | null = null;
  private _isCancelled: boolean = false;
  private _activeUtteranceRef: SpeechSynthesisUtterance | null = null;
  private _listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor() {
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window
    ) {
      this._isSupported = true;
      this.initVoices();
    }
  }

  private initVoices(): void {
    if (!this._isSupported) return;

    this.refreshVoices();
    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        this.refreshVoices();
      });
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        this.refreshVoices();
      };
    }
  }

  private refreshVoices(): void {
    if (!this._isSupported) return;
    try {
      this._voices = window.speechSynthesis.getVoices() || [];
      this.emit("voiceschanged", this._voices);
    } catch {
      this._voices = [];
    }
  }

  public get isSupported(): boolean {
    return this._isSupported;
  }

  public get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  public get voices(): SpeechSynthesisVoice[] {
    return this._voices;
  }

  public get settings(): TTSSettings {
    return { ...this._settings };
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this._isSupported) return [];
    this.refreshVoices();
    return this._voices;
  }

  public updateSettings(settings: Partial<TTSSettings>): void {
    if (settings.rate !== undefined) {
      this._settings.rate = Math.max(0.5, Math.min(2.0, Number(settings.rate) || 1.0));
    }
    if (settings.pitch !== undefined) {
      this._settings.pitch = Math.max(0.5, Math.min(1.5, Number(settings.pitch) || 1.0));
    }
    if (settings.volume !== undefined) {
      this._settings.volume = Math.max(0.0, Math.min(1.0, Number(settings.volume) ?? 1.0));
    }
    if (settings.voiceURI !== undefined) {
      this._settings.voiceURI = settings.voiceURI;
    }
    this.emit("settingschanged", this.settings);
  }

  public async speak(text: string): Promise<void> {
    if (!this._isSupported) return;

    // Immediately cancel any in-flight playback before starting new text
    this.cancel();
    this._isCancelled = false;

    const chunks = chunkTextForSpeech(text);
    if (chunks.length === 0) return;

    this._chunkQueue = [...chunks];
    this._isSpeaking = true;
    this.emit("start");

    return new Promise<void>((resolve, reject) => {
      this._activeResolve = resolve;
      this._activeReject = reject;
      this.playNextChunk();
    });
  }

  private playNextChunk(): void {
    if (this._isCancelled || this._chunkQueue.length === 0) {
      this.finishSpeech();
      return;
    }

    const chunk = this._chunkQueue.shift()!;
    const utterance = new SpeechSynthesisUtterance(chunk);
    this._activeUtteranceRef = utterance; // Retain GC anchor

    utterance.rate = this._settings.rate;
    utterance.pitch = this._settings.pitch;
    utterance.volume = this._settings.volume;

    if (this._settings.voiceURI) {
      const voice = this._voices.find((v) => v.voiceURI === this._settings.voiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    }

    utterance.onstart = () => {
      this.emit("chunkstart", chunk);
    };

    utterance.onend = () => {
      this._activeUtteranceRef = null;
      if (this._isCancelled) {
        this.finishSpeech();
      } else {
        this.playNextChunk();
      }
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      this._activeUtteranceRef = null;
      if (
        event.error === "canceled" ||
        event.error === "interrupted" ||
        this._isCancelled
      ) {
        this.finishSpeech();
      } else {
        this.finishSpeech(new Error(`SpeechSynthesis error: ${event.error}`));
      }
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      this.finishSpeech(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public cancel(): void {
    this._isCancelled = true;
    this._chunkQueue = [];

    if (this._isSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancel errors
      }
    }

    this.finishSpeech();
    this.emit("cancel");
  }

  public pause(): void {
    if (this._isSupported && this._isSpeaking) {
      try {
        window.speechSynthesis.pause();
        this.emit("pause");
      } catch {
        // Ignore pause errors
      }
    }
  }

  public resume(): void {
    if (this._isSupported && this._isSpeaking) {
      try {
        window.speechSynthesis.resume();
        this.emit("resume");
      } catch {
        // Ignore resume errors
      }
    }
  }

  private finishSpeech(error?: Error): void {
    this._isSpeaking = false;
    this._activeUtteranceRef = null;

    const resolve = this._activeResolve;
    const reject = this._activeReject;
    this._activeResolve = null;
    this._activeReject = null;

    if (error && reject) {
      reject(error);
    } else if (resolve) {
      resolve();
    }

    this.emit("end");
  }

  public on(event: string, callback: (...args: any[]) => void): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  public off(event: string, callback: (...args: any[]) => void): void {
    this._listeners.get(event)?.delete(callback);
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`Error in SpeechSynthesisService event listener [${event}]:`, err);
        }
      }
    }
  }
}

export const speechSynthesisService = new SpeechSynthesisService();
```

---

### 4.2 Implementation Specification: `src/test/audioMocks.ts`

```typescript
// @vitest-environment jsdom
import { vi } from "vitest";

export interface MockAudioOptions {
  autoCompleteTTS?: boolean;
  ttsDelayMs?: number;
  initialVoices?: SpeechSynthesisVoice[];
}

export class MockAudioParam {
  public value: number = 1.0;
  public setValueAtTime = vi.fn((val: number) => {
    this.value = val;
  });
  public linearRampToValueAtTime = vi.fn((val: number) => {
    this.value = val;
  });
  public exponentialRampToValueAtTime = vi.fn((val: number) => {
    this.value = val;
  });
}

export class MockGainNode {
  public gain = new MockAudioParam();
  public connect = vi.fn((target: any) => target);
  public disconnect = vi.fn();
}

export class MockAnalyserNode {
  private _fftSize: number = 128;
  public smoothingTimeConstant: number = 0.8;
  public minDecibels: number = -90;
  public maxDecibels: number = -10;
  private _mockTimeData: Uint8Array | null = null;
  private _mockFreqData: Uint8Array | null = null;

  public get fftSize(): number {
    return this._fftSize;
  }
  public set fftSize(val: number) {
    this._fftSize = val;
  }
  public get frequencyBinCount(): number {
    return this._fftSize / 2;
  }

  public setMockTimeDomainData(data: Uint8Array | number[]) {
    this._mockTimeData = new Uint8Array(data);
  }

  public setMockFrequencyData(data: Uint8Array | number[]) {
    this._mockFreqData = new Uint8Array(data);
  }

  public getByteTimeDomainData(array: Uint8Array) {
    if (this._mockTimeData) {
      array.set(this._mockTimeData.subarray(0, array.length));
    } else {
      // Default to silence (128)
      array.fill(128);
    }
  }

  public getByteFrequencyData(array: Uint8Array) {
    if (this._mockFreqData) {
      array.set(this._mockFreqData.subarray(0, array.length));
    } else {
      // Default to silence (0)
      array.fill(0);
    }
  }

  public connect = vi.fn((target: any) => target);
  public disconnect = vi.fn();
}

export class MockMediaStreamAudioSourceNode {
  public connect = vi.fn((target: any) => target);
  public disconnect = vi.fn();
  constructor(public mediaStream: any) {}
}

export class MockAudioDestinationNode {
  public maxChannelCount = 2;
}

export class MockAudioContext {
  public state: AudioContextState = "running";
  public sampleRate: number = 44100;
  public currentTime: number = 0;
  public destination = new MockAudioDestinationNode();

  public createGain = vi.fn(() => new MockGainNode());
  public createAnalyser = vi.fn(() => new MockAnalyserNode());
  public createMediaStreamSource = vi.fn(
    (stream: any) => new MockMediaStreamAudioSourceNode(stream)
  );

  public resume = vi.fn(async () => {
    this.state = "running";
  });
  public suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  public close = vi.fn(async () => {
    this.state = "closed";
  });
}

export class MockMediaStreamTrack {
  public id: string = "mock-track-" + Math.random().toString(36).substring(7);
  public kind: string = "audio";
  public enabled: boolean = true;
  public muted: boolean = false;
  public readyState: "live" | "ended" = "live";

  public stop = vi.fn(() => {
    this.readyState = "ended";
  });
}

export class MockMediaStream {
  public id: string = "mock-stream-" + Math.random().toString(36).substring(7);
  private _tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()];

  public get active(): boolean {
    return this._tracks.some((t) => t.readyState === "live");
  }

  public getTracks() {
    return [...this._tracks];
  }
  public getAudioTracks() {
    return this._tracks.filter((t) => t.kind === "audio");
  }
  public getVideoTracks() {
    return this._tracks.filter((t) => t.kind === "video");
  }
  public addTrack(track: MockMediaStreamTrack) {
    this._tracks.push(track);
  }
  public removeTrack(track: MockMediaStreamTrack) {
    this._tracks = this._tracks.filter((t) => t !== track);
  }
}

export class MockSpeechRecognitionEvent {
  public resultIndex: number;
  public results: any;
  constructor(type: string, initDict: { resultIndex: number; results: any }) {
    this.resultIndex = initDict.resultIndex;
    this.results = initDict.results;
  }
}

export class MockSpeechRecognition {
  public static lastInstance: MockSpeechRecognition | null = null;
  public continuous: boolean = true;
  public interimResults: boolean = true;
  public lang: string = "en-US";

  public onstart: ((ev: Event) => void) | null = null;
  public onend: ((ev: Event) => void) | null = null;
  public onspeechstart: ((ev: Event) => void) | null = null;
  public onspeechend: ((ev: Event) => void) | null = null;
  public onresult: ((ev: any) => void) | null = null;
  public onerror: ((ev: any) => void) | null = null;

  public isRunning: boolean = false;

  constructor() {
    MockSpeechRecognition.lastInstance = this;
  }

  public start = vi.fn(() => {
    this.isRunning = true;
    if (this.onstart) {
      this.onstart(new Event("start"));
    }
  });

  public stop = vi.fn(() => {
    this.isRunning = false;
    if (this.onspeechend) {
      this.onspeechend(new Event("speechend"));
    }
    if (this.onend) {
      this.onend(new Event("end"));
    }
  });

  public abort = vi.fn(() => {
    this.isRunning = false;
    if (this.onend) {
      this.onend(new Event("end"));
    }
  });

  // Test triggers
  public emitSpeechStart() {
    if (this.onspeechstart) {
      this.onspeechstart(new Event("speechstart"));
    }
  }

  public emitResult(items: Array<{ transcript: string; isFinal?: boolean; confidence?: number }>) {
    const results: any = [];
    items.forEach((item) => {
      const alt = [{ transcript: item.transcript, confidence: item.confidence ?? 0.95 }];
      (alt as any).isFinal = !!item.isFinal;
      results.push(alt);
    });

    if (this.onresult) {
      this.onresult(
        new MockSpeechRecognitionEvent("result", {
          resultIndex: 0,
          results,
        })
      );
    }
  }

  public emitSpeechEnd() {
    if (this.onspeechend) {
      this.onspeechend(new Event("speechend"));
    }
  }

  public emitError(error: string, message = "Speech recognition error") {
    if (this.onerror) {
      this.onerror({ error, message });
    }
  }
}

export class MockSpeechSynthesisUtterance {
  public text: string;
  public lang: string = "en-US";
  public voice: SpeechSynthesisVoice | null = null;
  public volume: number = 1.0;
  public rate: number = 1.0;
  public pitch: number = 1.0;

  public onstart: ((ev: any) => void) | null = null;
  public onend: ((ev: any) => void) | null = null;
  public onerror: ((ev: any) => void) | null = null;
  public onpause: ((ev: any) => void) | null = null;
  public onresume: ((ev: any) => void) | null = null;

  constructor(text: string = "") {
    this.text = text;
  }
}

export class MockSpeechSynthesis {
  public static lastInstance: MockSpeechSynthesis | null = null;
  public speaking: boolean = false;
  public paused: boolean = false;
  public pending: boolean = false;
  public onvoiceschanged: ((ev: Event) => void) | null = null;

  public autoComplete: boolean = true;
  public ttsDelayMs: number = 0;
  public spokenUtterances: MockSpeechSynthesisUtterance[] = [];
  private _voices: SpeechSynthesisVoice[] = [];
  private _listeners: Map<string, Set<Function>> = new Map();

  constructor(options?: MockAudioOptions) {
    MockSpeechSynthesis.lastInstance = this;
    if (options?.autoCompleteTTS !== undefined) {
      this.autoComplete = options.autoCompleteTTS;
    }
    if (options?.ttsDelayMs !== undefined) {
      this.ttsDelayMs = options.ttsDelayMs;
    }
    this._voices = options?.initialVoices || [
      {
        voiceURI: "Google US English",
        name: "Google US English",
        lang: "en-US",
        localService: false,
        default: true,
      } as SpeechSynthesisVoice,
      {
        voiceURI: "Samantha",
        name: "Samantha",
        lang: "en-US",
        localService: true,
        default: false,
      } as SpeechSynthesisVoice,
    ];
  }

  public getVoices = vi.fn(() => [...this._voices]);

  public setVoices(voices: SpeechSynthesisVoice[]) {
    this._voices = [...voices];
    if (this.onvoiceschanged) {
      this.onvoiceschanged(new Event("voiceschanged"));
    }
    this.dispatchEvent(new Event("voiceschanged"));
  }

  public speak = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
    this.spokenUtterances.push(utterance);
    this.speaking = true;

    if (utterance.onstart) {
      utterance.onstart({ type: "start", utterance });
    }

    if (this.autoComplete) {
      if (this.ttsDelayMs > 0) {
        setTimeout(() => {
          if (this.speaking) {
            this.speaking = false;
            if (utterance.onend) utterance.onend({ type: "end", utterance });
          }
        }, this.ttsDelayMs);
      } else {
        queueMicrotask(() => {
          if (this.speaking) {
            this.speaking = false;
            if (utterance.onend) utterance.onend({ type: "end", utterance });
          }
        });
      }
    }
  });

  public cancel = vi.fn(() => {
    this.speaking = false;
    this.paused = false;
    const current = this.spokenUtterances[this.spokenUtterances.length - 1];
    if (current && current.onerror) {
      current.onerror({ error: "canceled", type: "error" });
    }
  });

  public pause = vi.fn(() => {
    this.paused = true;
  });

  public resume = vi.fn(() => {
    this.paused = false;
  });

  public addEventListener(event: string, cb: Function) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(cb);
  }

  public removeEventListener(event: string, cb: Function) {
    this._listeners.get(event)?.delete(cb);
  }

  public dispatchEvent(event: Event) {
    this._listeners.get(event.type)?.forEach((cb) => cb(event));
    return true;
  }
}

export function setupAudioMocks(options?: MockAudioOptions) {
  const originalAudioContext = (globalThis as any).AudioContext;
  const originalWebkitAudioContext = (globalThis as any).webkitAudioContext;
  const originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
  const originalSpeechRecognition = (globalThis as any).SpeechRecognition;
  const originalWebkitSpeechRecognition = (globalThis as any).webkitSpeechRecognition;
  const originalSpeechSynthesis = (globalThis as any).speechSynthesis;
  const originalSpeechSynthesisUtterance = (globalThis as any).SpeechSynthesisUtterance;

  (globalThis as any).AudioContext = MockAudioContext;
  (globalThis as any).webkitAudioContext = MockAudioContext;

  if (!navigator.mediaDevices) {
    (navigator as any).mediaDevices = {};
  }
  navigator.mediaDevices.getUserMedia = vi.fn(async () => new MockMediaStream() as any);

  (globalThis as any).SpeechRecognition = MockSpeechRecognition;
  (globalThis as any).webkitSpeechRecognition = MockSpeechRecognition;

  const mockSynthesis = new MockSpeechSynthesis(options);
  (globalThis as any).speechSynthesis = mockSynthesis;
  (globalThis as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

  return {
    mockAudioContext: MockAudioContext,
    mockSpeechRecognition: MockSpeechRecognition,
    mockSpeechSynthesis: mockSynthesis,
    restore: () => {
      (globalThis as any).AudioContext = originalAudioContext;
      (globalThis as any).webkitAudioContext = originalWebkitAudioContext;
      if (originalGetUserMedia) {
        navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      }
      (globalThis as any).SpeechRecognition = originalSpeechRecognition;
      (globalThis as any).webkitSpeechRecognition = originalWebkitSpeechRecognition;
      (globalThis as any).speechSynthesis = originalSpeechSynthesis;
      (globalThis as any).SpeechSynthesisUtterance = originalSpeechSynthesisUtterance;
    },
  };
}

export function resetAudioMocks() {
  vi.clearAllMocks();
  MockSpeechRecognition.lastInstance = null;
  MockSpeechSynthesis.lastInstance = null;
}
```

---

### 4.3 Implementation Specification: `src/services/__tests__/speechSynthesis.test.ts`

```typescript
// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SpeechSynthesisService, chunkTextForSpeech } from "../speechSynthesis";
import { setupAudioMocks, resetAudioMocks } from "@/test/audioMocks";

describe("SpeechSynthesisService & Chunking Engine", () => {
  let mocks: ReturnType<typeof setupAudioMocks>;
  let service: SpeechSynthesisService;

  beforeEach(() => {
    mocks = setupAudioMocks({ autoCompleteTTS: true });
    service = new SpeechSynthesisService();
  });

  afterEach(() => {
    resetAudioMocks();
    mocks.restore();
  });

  describe("Sentence Boundary Chunking Engine (chunkTextForSpeech)", () => {
    it("returns empty array for empty or whitespace text", () => {
      expect(chunkTextForSpeech("")).toEqual([]);
      expect(chunkTextForSpeech("   \n\t  ")).toEqual([]);
    });

    it("keeps short sentences as single chunks", () => {
      const text = "Hello, how are you?";
      expect(chunkTextForSpeech(text)).toEqual(["Hello, how are you?"]);
    });

    it("splits multiple sentences on standard punctuation (. ! ? \n)", () => {
      const text = "Hello world! How are you today? I am your AI assistant.\nReady to help.";
      const chunks = chunkTextForSpeech(text);
      expect(chunks).toEqual([
        "Hello world!",
        "How are you today?",
        "I am your AI assistant.",
        "Ready to help.",
      ]);
    });

    it("subdivides long sentences (>150 chars) along clause boundaries (commas/semicolons)", () => {
      const longSentence =
        "This is an intentionally verbose sentence designed to exceed the maximum character limit of one hundred and fifty characters, and it features several distinct clauses, so we can ensure clause-level partitioning functions properly.";
      const chunks = chunkTextForSpeech(longSentence, 100);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });

    it("subdivides long sentences without punctuation along word boundaries", () => {
      const longRunOn =
        "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24 word25 word26 word27 word28 word29 word30";
      const chunks = chunkTextForSpeech(longRunOn, 50);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(50);
      });
      // Rejoined words match original
      expect(chunks.join(" ")).toBe(longRunOn);
    });
  });

  describe("Service Initialization & Voices", () => {
    it("reports isSupported === true in mock browser environment", () => {
      expect(service.isSupported).toBe(true);
    });

    it("enumerates available voices and handles voiceschanged event", () => {
      const voices = service.getVoices();
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].voiceURI).toBe("Google US English");

      const onVoicesChanged = vi.fn();
      service.on("voiceschanged", onVoicesChanged);

      mocks.mockSpeechSynthesis.setVoices([
        {
          voiceURI: "Custom Voice",
          name: "Custom Voice",
          lang: "en-US",
          localService: true,
          default: true,
        } as SpeechSynthesisVoice,
      ]);

      expect(onVoicesChanged).toHaveBeenCalled();
      expect(service.voices[0].voiceURI).toBe("Custom Voice");
    });
  });

  describe("Settings & Boundary Clamping", () => {
    it("initializes with default TTSSettings", () => {
      expect(service.settings).toEqual({
        voiceURI: null,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
      });
    });

    it("clamps rate between 0.5 and 2.0", () => {
      service.updateSettings({ rate: 3.5 });
      expect(service.settings.rate).toBe(2.0);

      service.updateSettings({ rate: 0.1 });
      expect(service.settings.rate).toBe(0.5);
    });

    it("clamps pitch between 0.5 and 1.5", () => {
      service.updateSettings({ pitch: 2.0 });
      expect(service.settings.pitch).toBe(1.5);

      service.updateSettings({ pitch: 0.2 });
      expect(service.settings.pitch).toBe(0.5);
    });

    it("clamps volume between 0.0 and 1.0", () => {
      service.updateSettings({ volume: 1.5 });
      expect(service.settings.volume).toBe(1.0);

      service.updateSettings({ volume: -0.5 });
      expect(service.settings.volume).toBe(0.0);
    });

    it("updates voiceURI and emits settingschanged event", () => {
      const onSettingsChanged = vi.fn();
      service.on("settingschanged", onSettingsChanged);

      service.updateSettings({ voiceURI: "Samantha" });
      expect(service.settings.voiceURI).toBe("Samantha");
      expect(onSettingsChanged).toHaveBeenCalledWith(
        expect.objectContaining({ voiceURI: "Samantha" })
      );
    });
  });

  describe("Speech Playback & Sequential Chunking", () => {
    it("speaks short text and resolves promise on completion", async () => {
      const startSpy = vi.fn();
      const endSpy = vi.fn();
      service.on("start", startSpy);
      service.on("end", endSpy);

      await service.speak("Hello from NanoForge voice assistant.");

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(service.isSpeaking).toBe(false);
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);
      expect(mocks.mockSpeechSynthesis.spokenUtterances[0].text).toBe(
        "Hello from NanoForge voice assistant."
      );
    });

    it("speaks multi-sentence text in sequential chunks", async () => {
      const chunkSpy = vi.fn();
      service.on("chunkstart", chunkSpy);

      await service.speak("Sentence one. Sentence two! Sentence three?");

      expect(chunkSpy).toHaveBeenCalledTimes(3);
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(3);
      expect(mocks.mockSpeechSynthesis.spokenUtterances[0].text).toBe("Sentence one.");
      expect(mocks.mockSpeechSynthesis.spokenUtterances[1].text).toBe("Sentence two!");
      expect(mocks.mockSpeechSynthesis.spokenUtterances[2].text).toBe("Sentence three?");
    });

    it("applies customized rate, pitch, volume, and voice to utterances", async () => {
      service.updateSettings({
        rate: 1.5,
        pitch: 1.2,
        volume: 0.8,
        voiceURI: "Google US English",
      });

      await service.speak("Testing configured timbre and speed.");

      const utt = mocks.mockSpeechSynthesis.spokenUtterances[0];
      expect(utt.rate).toBe(1.5);
      expect(utt.pitch).toBe(1.2);
      expect(utt.volume).toBe(0.8);
      expect(utt.voice?.voiceURI).toBe("Google US English");
    });

    it("supports pause and resume operations", async () => {
      const pauseSpy = vi.fn();
      const resumeSpy = vi.fn();
      service.on("pause", pauseSpy);
      service.on("resume", resumeSpy);

      // Trigger speak without auto-completion to test active pause
      mocks.mockSpeechSynthesis.autoComplete = false;
      const speakPromise = service.speak("Holding speech open.");

      expect(service.isSpeaking).toBe(true);

      service.pause();
      expect(mocks.mockSpeechSynthesis.pause).toHaveBeenCalled();
      expect(pauseSpy).toHaveBeenCalled();

      service.resume();
      expect(mocks.mockSpeechSynthesis.resume).toHaveBeenCalled();
      expect(resumeSpy).toHaveBeenCalled();

      service.cancel();
      await speakPromise;
    });
  });

  describe("Immediate Barge-In Cancellation", () => {
    it("cancels active speech, clears queue, and aborts subsequent chunks", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;
      const cancelSpy = vi.fn();
      service.on("cancel", cancelSpy);

      const speakPromise = service.speak(
        "First long chunk. Second long chunk. Third long chunk."
      );

      expect(service.isSpeaking).toBe(true);
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);

      // User barges in!
      service.cancel();

      await speakPromise;

      expect(mocks.mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(service.isSpeaking).toBe(false);
      // Ensure remaining chunks were NOT spoken
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);
    });

    it("automatically cancels prior playback when speak() is called again", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;

      const firstSpeak = service.speak("Initial message.");
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);

      mocks.mockSpeechSynthesis.autoComplete = true;
      const secondSpeak = service.speak("Overriding urgent message.");

      await Promise.all([firstSpeak, secondSpeak]);

      expect(mocks.mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(2);
      expect(mocks.mockSpeechSynthesis.spokenUtterances[1].text).toBe(
        "Overriding urgent message."
      );
    });

    it("gracefully handles cancel() when idle", () => {
      expect(() => service.cancel()).not.toThrow();
      expect(service.isSpeaking).toBe(false);
    });
  });

  describe("Error Resilience & Unsupported Environments", () => {
    it("handles utterance cancellation error without rejecting promise", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;

      const speakPromise = service.speak("Testing cancellation error tolerance.");
      const utt = mocks.mockSpeechSynthesis.spokenUtterances[0];

      // Simulate browser firing canceled error event
      utt.onerror?.({ error: "canceled", type: "error" });

      await expect(speakPromise).resolves.toBeUndefined();
      expect(service.isSpeaking).toBe(false);
    });

    it("handles fatal utterance errors cleanly", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;

      const speakPromise = service.speak("Testing fatal synthesis error.");
      const utt = mocks.mockSpeechSynthesis.spokenUtterances[0];

      utt.onerror?.({ error: "audio-busy", type: "error" });

      await expect(speakPromise).rejects.toThrow(/audio-busy/);
      expect(service.isSpeaking).toBe(false);
    });

    it("degrades safely when speechSynthesis is not in window", async () => {
      mocks.restore();
      const original = (globalThis as any).speechSynthesis;
      delete (globalThis as any).speechSynthesis;

      const unsupportedService = new SpeechSynthesisService();
      expect(unsupportedService.isSupported).toBe(false);
      expect(unsupportedService.getVoices()).toEqual([]);

      await expect(unsupportedService.speak("Test text")).resolves.toBeUndefined();
      expect(() => unsupportedService.cancel()).not.toThrow();

      (globalThis as any).speechSynthesis = original;
    });
  });
});
```

---

## 5. Verification Method

To verify all components independently once implemented by Milestone 2 workers:

1. **Unit Test Execution**:
   ```bash
   # Run all Milestone 2 service unit tests
   npx vitest run src/services/__tests__/speechSynthesis.test.ts
   npx vitest run src/services/__tests__/audioEngine.test.ts
   npx vitest run src/services/__tests__/speechRecognition.test.ts
   ```
2. **Full Test Suite & Typecheck**:
   ```bash
   npm test
   npm run build
   ```
3. **Invalidation Conditions**:
   - Any test timeout or unhandled promise rejection during barge-in cancellation.
   - Long text (>150 chars) failing to split at sentence/clause boundaries.
   - Volume/gain/rate/pitch settings accepting out-of-range negative or excessive values without clamping.
   - Memory leaks from unclosed `AudioContext` or unstopped `MediaStreamTrack` instances.

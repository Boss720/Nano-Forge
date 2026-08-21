# Technical Report: Audio Engine, Web Audio/Speech APIs & Verification Architecture

**Agent Role**: Audio Engine & Verification Explorer (`survey_explorer_3`)  
**Target Milestone**: Interactive Audio Voice Call System  
**Timestamp**: 2026-08-15T17:19:15Z  

---

## 1. Observation

### 1.1 Workspace Layout & Scripts Baseline
Direct inspection of `package.json` (`c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/package.json`), workspace packages, and test configs revealed the following test and build infrastructure:
- **Scripts & Commands**:
  - `npm run test:protocol` → Executes `vitest run --config packages/protocol/vitest.config.ts`. (Verified: 10 test files, 239 passed in ~12.4s).
  - `npm run test:host` → Executes `vitest run --config apps/agent-host/vitest.config.ts`. (Verified: 39 test files, 378 passed in ~11.4s).
  - `npm test` → Executes `vitest run` using root `vitest.config.ts`. (Verified: 40 test files, 381 passed in ~79.6s).
  - `npm run build` → Executes `tsc -b && vite build`. (Verified: 0 TypeScript errors, Vite client production bundle built cleanly in ~37.2s).
- **Test Configuration & Environments**:
  - Root `vitest.config.ts` configures `environment: "node"` with include patterns `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.{ts,tsx}`.
  - Component tests under `src/sections/` and `src/sections/__tests__/` use per-file environment pragmas `// @vitest-environment jsdom` and `@testing-library/jest-dom/vitest`.
  - JSDOM does not natively support Web Audio API (`AudioContext`, `AnalyserNode`, `GainNode`, `MediaStream`, `navigator.mediaDevices.getUserMedia`) or Web Speech API (`SpeechRecognition`, `webkitSpeechRecognition`, `window.speechSynthesis`, `SpeechSynthesisUtterance`).
- **Existing Frontend Integration Points**:
  - `src/sections/TopBar.tsx` (lines 46–201): Renders header toolbar buttons for `onOpenSidebar`, `onOpenSettings`, `onOpenTheme`, `onOpenCosts`, `onOpenImages`, `onOpenArtifacts`, and `onOpenSubagents`.
  - `src/sections/ChatComposer.tsx` (lines 136–566): Renders chat textarea, slash command palette popover, `@file` context mention autocomplete, model status badges, and action controls (`run-agent-button`, `stop-agent-button`, `GenSettings`).
  - `src/App.tsx` (lines 131–875): Central controller coordinating session state, model catalog, `useHostSession`, overlays, and drawer sheets (`Sheet`, `Dialog`).

---

## 2. Logic Chain

### 2.1 Web Audio API Engine Architecture & Service Contracts

```
+-----------------------------------------------------------------------------------+
|                            Web Audio Graph Architecture                           |
+-----------------------------------------------------------------------------------+
                                                                                     
 [User Microphone]                                                                   
        │                                                                            
        ▼                                                                            
 [MediaStreamTrack] (echoCancellation, noiseSuppression, autoGainControl)             
        │                                                                            
        ▼                                                                            
 [MediaStreamAudioSourceNode]                                                        
        │                                                                            
        ▼                                                                            
 [Mic GainNode] ─── (gain: 0.0 to 2.0; mute sets gain: 0 & track.enabled = false)     
        │                                                                            
        ▼                                                                            
 [Mic AnalyserNode] ─── (fftSize: 128, smoothing: 0.8)                                
        │                                                                            
        ▼ (Data Tap)                                                                 
 [User Waveform / Amplitude Visualizer]                                              
 (Note: Mic graph does NOT route to audioContext.destination to avoid local feedback)
                                                                                     
 [Agent TTS Audio / Speech Synthesis / AudioBuffer]                                 
        │                                                                            
        ▼                                                                            
 [Speaker GainNode] ─── (volume: 0.0 to 1.0)                                         
        │                                                                            
        ▼                                                                            
 [Speaker AnalyserNode] ─── (fftSize: 128, smoothing: 0.8)                           
        │               │                                                            
        ▼ (Data Tap)    ▼                                                            
 [Agent Spectrum]    [audioContext.destination] (Hardware Speakers / Headphones)     
```

#### Audio Engine Service Interface (`src/services/audioEngine.ts` / `src/hooks/useAudioEngine.ts`):
```typescript
export interface AudioEngineConfig {
  fftSize?: number; // default: 128 (64 frequency bins)
  smoothingTimeConstant?: number; // default: 0.8
  minDecibels?: number; // default: -90
  maxDecibels?: number; // default: -10
}

export interface AudioVisualData {
  timeDomainData: Uint8Array;
  frequencyData: Uint8Array;
  rmsVolume: number; // 0.0 to 1.0 normalized
  peakVolume: number; // 0.0 to 1.0 normalized
}

export interface IAudioEngine {
  readonly isInitialized: boolean;
  readonly isMuted: boolean;
  readonly micGain: number;
  readonly speakerVolume: number;
  readonly audioContextState: AudioContextState;
  
  initialize(): Promise<boolean>;
  setMuted(muted: boolean): void;
  setMicGain(gain: number): void; // 0.0 - 2.0
  setSpeakerVolume(volume: number): void; // 0.0 - 1.0
  getMicVisualData(): AudioVisualData;
  getSpeakerVisualData(): AudioVisualData;
  resumeContext(): Promise<void>;
  cleanup(): void;
}
```

#### Key Technical Principles:
1. **Autoplay Policy Handling**: Browser `AudioContext` initializes in `"suspended"` state unless initiated within a user gesture. The engine must check `audioContext.state === "suspended"` and call `audioContext.resume()` upon the user's initial click on "Start Voice Call".
2. **MediaStream Constraints**: Audio capture uses `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }`.
3. **Mute Semantics**: Muting disables the mic track (`track.enabled = false`) and zeroes input gain (`micGainNode.gain.setValueAtTime(0, audioContext.currentTime)`). It does **not** close the `AudioContext` or tear down the call session.
4. **Complete Resource Disposal**:
   - All tracks in `mediaStream.getTracks()` stopped via `.stop()`.
   - All audio nodes disconnected via `.disconnect()`.
   - `AudioContext.close()` invoked.
   - Any active `requestAnimationFrame` ticker canceled.

---

### 2.2 Speech-to-Text (STT) Architecture & VAD Auto-Dispatch

```
+------------------------------------------------------------------------------------+
|                         STT Lifecycle & Streaming VAD Flow                         |
+------------------------------------------------------------------------------------+

 [User Starts Speaking]
        │
        ├──► onspeechstart ─────────────► [TRIGGER BARGE-IN: Cancel Agent TTS]
        │
        └──► onresult (isFinal: false) ──► Stream interim transcript to Call Drawer UI
                     │
                     ▼ (User finishes utterance / pauses)
             onresult (isFinal: true) ───► Commit to final transcript buffer
                     │
                     ▼
             onspeechend / Silence ──────► Start VAD Timer (1,200ms - 1,500ms)
                     │
          ┌──────────┴──────────┐
   [New Speech In Window]   [Silence Timeout Expires]
          │                     │
   Reset VAD Timer              ▼
                     Check: non-empty & not muted & not agent-speaking
                                │
                                ▼
                     Auto-dispatch Prompt to Agent Host / Chat Session
                                │
                                ▼
                     Set Call Status: "thinking"
```

#### Speech Recognition Service Contract (`src/services/speechRecognition.ts` / `src/hooks/useSpeechRecognition.ts`):
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
  onError?: (error: SpeechRecognitionErrorEvent) => void;
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

#### Fallback & Robustness Strategy:
- When `window.SpeechRecognition` and `window.webkitSpeechRecognition` are missing (e.g. Firefox, non-HTTPS insecure context, or headless JSDOM):
  - Service sets `isSupported: false`.
  - Renders visual status badge: `"STT: Manual/Simulated"`.
  - Drawer exposes manual push-to-talk / text input seam and simulated vocal utterance buttons for test verification.

---

### 2.3 Text-to-Speech (TTS) Architecture & Barge-In Mechanics

```
+------------------------------------------------------------------------------------+
|                         TTS Streaming & Instant Barge-In                           |
+------------------------------------------------------------------------------------+

 [Agent Output Tokens / Stream Turns]
        │
        ▼
 [Sentence Boundary Chunking Engine] (splits on [.!?\n]+, min chunk length: 15 chars)
        │
        ▼
 [Utterance Queue] ──► SpeechSynthesisUtterance (rate, pitch, volume, selected voice)
        │
        ▼
 [window.speechSynthesis.speak()] ──► Plays agent audio response (Status: "speaking")
        │
        │
 [USER INTERRUPTS / SPEAKS]
        │
        ▼
 [onSpeechStart / Barge-In Event]
        │
        ├──► window.speechSynthesis.cancel() (Instantly clears queue & cuts audio)
        ├──► Reset TTS Queue & Playing State
        └──► Set Call Status: "listening"
```

#### Speech Synthesis Service Contract (`src/services/speechSynthesis.ts` / `src/hooks/useSpeechSynthesis.ts`):
```typescript
export interface TTSSettings {
  voiceURI: string | null;
  rate: number; // 0.5 to 2.0 (default 1.0)
  pitch: number; // 0.5 to 1.5 (default 1.0)
  volume: number; // 0.0 to 1.0 (default 1.0)
}

export interface ISpeechSynthesisService {
  readonly isSupported: boolean;
  readonly isSpeaking: boolean;
  readonly voices: SpeechSynthesisVoice[];
  readonly settings: TTSSettings;
  
  updateSettings(settings: Partial<TTSSettings>): void;
  speak(text: string): Promise<void>;
  cancel(): void; // Instant barge-in cancellation
  pause(): void;
  resume(): void;
}
```

#### Utterance Chunking Rule:
Long assistant responses (>150 characters) are chunked into complete sentences to prevent browser speech synthesis buffer truncation and reduce initial audio playback latency.

---

### 2.4 Real-Time Audio Visualizer Data Pipeline

```
+------------------------------------------------------------------------------------+
|                     Dual-Channel Real-Time Visualizer Pipeline                     |
+------------------------------------------------------------------------------------+

                   ┌─── User Mic AnalyserNode (64 bins)
                   │
 [RAF Loop: 60fps] ┼──► getByteTimeDomainData() ──► Waveform Canvas / SVG Oscilloscope
                   │
                   │
                   └──► getByteFrequencyData()  ──► Dynamic Frequency Bar Equalizer
                   │
                   └─── Agent Speaker AnalyserNode (64 bins)
```

1. **Sampling Loop**: `requestAnimationFrame` queries `analyserNode.getByteFrequencyData(freqArray)` and `analyserNode.getByteTimeDomainData(timeArray)` at display refresh rate (~60 FPS).
2. **Dynamic Range Normalization**: Values (0–255) are mapped to 0.0–1.0 with smoothing applied (`smoothingTimeConstant = 0.8`).
3. **Dual Visualizer Display**:
   - **User Channel**: Dynamic animated waveform canvas / oscilloscope reacting to vocal amplitude.
   - **Agent Channel**: 16 to 32 frequency equalizer bars with glowing gradient colors reacting to synthesis output.

---

### 2.5 Voice Call State Machine & Session Lifecycle

```
             ┌────────────────────────────────────────────────────────┐
             │                                                        │
             ▼                                                        │
         [ IDLE ] ──(Click "Voice Call")──► [ CONNECTING ]            │
                                                  │                   │
                                 (Init Audio & Permissions OK)        │
                                                  ▼                   │
    ┌────────────────────────────────────► [ LISTENING ] ◄────────┐   │
    │                                             │               │   │
(Agent done /                               (User speaks &        │   │
  Barge-in)                                  pause detected)      │   │
    │                                             ▼               │   │
 [ SPEAKING ] ◄───(Agent starts streaming)─── [ THINKING ]        │   │
    │     ▲                                                       │   │
    │     │                                                       │   │
    │     └───────────── (Mute Toggle) ───────────────┐           │   │
    │                                                 ▼           │   │
    └────────────────────────────────────────────► [ MUTED ] ─────┘   │
                                                      │               │
                                              (Click "End Call")      │
                                                      │               │
                                                      ▼               │
                                                  [ ENDED ] ──────────┘
                                             (Auto-persist transcripts
                                               to chat transcript)
```

---

## 3. Caveats

1. **Browser Permission Security Context**:
   `navigator.mediaDevices.getUserMedia` and Web Speech APIs require a secure origin (`https://` or `http://localhost` / `http://127.0.0.1`). In unsecured HTTP deployments or headless server environments, browser permissions will fail or be unavailable. The fallback mock mode ensures 100% operational integrity in all contexts.
2. **Speech Recognition Engine Availability**:
   Firefox and certain Linux Chromium builds do not ship with native Web Speech API recognition enabled. The architecture includes automatic capability detection and simulated voice input fallbacks.
3. **Long TTS Utterances**:
   `window.speechSynthesis` can experience silent timeouts on single utterances exceeding 15 seconds in Chromium. Sentence-level chunking completely mitigates this browser bug.
4. **JSDOM Audio Mocking**:
   Because JSDOM does not implement Web Audio or Web Speech, all automated tests must utilize robust, standardized test mock factories (`mockAudioContext`, `mockSpeechRecognition`, `mockSpeechSynthesis`).

---

## 4. Conclusion

The Interactive Audio Voice Call System architecture seamlessly integrates with NanoForge's existing single-page app and agent-host model:
1. **Audio Service Layer**: Dedicated `AudioEngineService`, `SpeechRecognitionService`, and `SpeechSynthesisService` provide clean separation of concerns and testability.
2. **UI Surfaces**:
   - TopBar: "Start Voice Call" trigger button with live call status badge and pulsers.
   - ChatComposer: Voice call mic trigger button alongside slash commands.
   - VoiceCallDrawer: Slide-out call dock featuring dual visualizers (User Waveform + Agent Frequency Equalizer), live streaming transcript, call duration timer, participant card, and full controls (Mute, Barge-In / Interrupt, Volume Sliders, Timbre Selector, End Call).
3. **Session Persistence**: On call completion, all spoken user prompts and agent responses are automatically merged into the active chat session transcript.

---

## 5. Verification Method

### 5.1 Verification Test Matrix & Commands

| Verification Step | Command | Expected Outcome |
|---|---|---|
| **Protocol Integrity** | `npm run test:protocol` | 100% pass (10 test files, ≥239 tests) |
| **Agent Host Integrity** | `npm run test:host` | 100% pass (39 test files, ≥378 tests) |
| **Frontend & Voice Suites**| `npm test` | 100% pass across all component & unit suites |
| **TypeScript & Build** | `npm run build` | 0 errors (`tsc -b && vite build`) |

### 5.2 Audio & Speech API Mock Strategies for Vitest

```typescript
// Test helper factory for Web Audio & Speech APIs in JSDOM:
export function setupAudioEngineMocks() {
  // 1. Mock AudioContext
  class MockAudioContext {
    state: AudioContextState = "running";
    currentTime = 0;
    destination = {};
    createGain = vi.fn(() => ({
      gain: { value: 1, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    createAnalyser = vi.fn(() => ({
      fftSize: 128,
      frequencyBinCount: 64,
      smoothingTimeConstant: 0.8,
      getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(128)),
      getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    createMediaStreamSource = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    resume = vi.fn(async () => { this.state = "running"; });
    suspend = vi.fn(async () => { this.state = "suspended"; });
    close = vi.fn(async () => { this.state = "closed"; });
  }

  // 2. Mock getUserMedia
  const mockTrack = { enabled: true, stop: vi.fn(), kind: "audio" };
  const mockStream = {
    getTracks: vi.fn(() => [mockTrack]),
    getAudioTracks: vi.fn(() => [mockTrack]),
  };
  
  // 3. Mock SpeechRecognition
  class MockSpeechRecognition {
    continuous = true;
    interimResults = true;
    lang = "en-US";
    onstart: (() => void) | null = null;
    onspeechstart: (() => void) | null = null;
    onresult: ((ev: any) => void) | null = null;
    onspeechend: (() => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn(() => { this.onstart?.(); });
    stop = vi.fn(() => { this.onend?.(); });
    abort = vi.fn(() => { this.onend?.(); });
  }

  // 4. Mock SpeechSynthesis
  const mockSpeechSynthesis = {
    speaking: false,
    paused: false,
    pending: false,
    getVoices: vi.fn(() => [
      { voiceURI: "v1", name: "Samantha", lang: "en-US", default: true },
      { voiceURI: "v2", name: "Daniel", lang: "en-GB", default: false },
    ]),
    speak: vi.fn((utterance) => {
      mockSpeechSynthesis.speaking = true;
      utterance.onstart?.();
      setTimeout(() => {
        mockSpeechSynthesis.speaking = false;
        utterance.onend?.();
      }, 50);
    }),
    cancel: vi.fn(() => { mockSpeechSynthesis.speaking = false; }),
    pause: vi.fn(() => { mockSpeechSynthesis.paused = true; }),
    resume: vi.fn(() => { mockSpeechSynthesis.paused = false; }),
  };

  // Assign to global window
  Object.defineProperty(window, "AudioContext", { writable: true, value: MockAudioContext });
  Object.defineProperty(window, "webkitAudioContext", { writable: true, value: MockAudioContext });
  Object.defineProperty(navigator, "mediaDevices", {
    writable: true,
    value: { getUserMedia: vi.fn(async () => mockStream) },
  });
  Object.defineProperty(window, "SpeechRecognition", { writable: true, value: MockSpeechRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { writable: true, value: MockSpeechRecognition });
  Object.defineProperty(window, "speechSynthesis", { writable: true, value: mockSpeechSynthesis });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    writable: true,
    value: class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: any = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(text: string) { this.text = text; }
    },
  });
}
```

### 5.3 Acceptance Criteria Validation Checklist
- [x] Web Audio API AudioContext, AnalyserNode, MediaStream, and GainNode contracts formulated.
- [x] SpeechRecognition STT streaming, VAD pause detection (1.4s window), and fallback mechanisms specified.
- [x] SpeechSynthesis TTS chunking, voice selection, and instant barge-in cancellation defined.
- [x] Dual-channel real-time visualizer data pipeline engineered.
- [x] Test baseline verified (`npm run test:protocol`: 239 passed, `npm run test:host`: 378 passed, `npm test`: 381 passed, `npm run build`: 0 errors).
- [x] Complete Vitest/JSDOM mock implementation strategy provided.

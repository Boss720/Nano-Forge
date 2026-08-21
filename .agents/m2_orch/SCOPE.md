# Scope: Milestone 2 — Web Audio Engine, STT & TTS Services

## Architecture
Milestone 2 delivers the client-side foundational audio engine and speech services for the Interactive Audio Voice Call System in `src/services/` and test harness in `src/test/`:
1. `src/services/audioEngine.ts`: Web Audio API graph management (AudioContext, AnalyserNodes with 64 bins, smoothing 0.8, GainNodes, MediaStream capture, gain/volume controls, RMS/peak volume calculation, FFT visual data tap).
2. `src/services/speechRecognition.ts`: Web Speech API SpeechRecognition continuous mode, interim & final transcription streaming, VAD pause detection (1400ms) for auto-dispatching prompts, speech start/end events, and fallback mock support.
3. `src/services/speechSynthesis.ts`: Web Speech synthesis, sentence chunking (>150 chars / punctuation splits), voice/rate/pitch/volume settings, and instant barge-in cancellation on speech start.
4. `src/test/audioMocks.ts`: Reusable Web Audio & Speech API mock harness for Vitest/JSDOM environments.
5. `src/services/__tests__/audioEngine.test.ts`: Comprehensive unit tests for AudioEngineService.
6. `src/services/__tests__/speechRecognition.test.ts`: Comprehensive unit tests for SpeechRecognitionService and VAD pause detection.
7. `src/services/__tests__/speechSynthesis.test.ts`: Comprehensive unit tests for SpeechSynthesisService and instant barge-in cancellation.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F4 | Web Audio Engine & Visualizer Analysers | `AudioEngineService` managing AudioContext, MediaStream mic capture, gain nodes, and FFT analysers | M2 | ORIGINAL_REQUEST §R1, R4 |
| F5 | Live Speech-to-Text (STT) & VAD Auto-Dispatch | `SpeechRecognitionService` handling real-time continuous transcription, interim updates, and pause auto-dispatch | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Text-to-Speech (TTS) Synthesis & Controls | `SpeechSynthesisService` with sentence chunking, pitch/rate/voice controls, and instant cancellation | M2 | ORIGINAL_REQUEST §R3 |

## Interface Contracts

### 1. Audio Engine Service (`src/services/audioEngine.ts`)
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
  readonly audioContextState: AudioContextState | "unsupported";
  
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

### 2. Speech Recognition Service (`src/services/speechRecognition.ts`)
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

### 3. Speech Synthesis Service (`src/services/speechSynthesis.ts`)
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

### 4. Audio & Speech Test Mocks (`src/test/audioMocks.ts`)
- `setupAudioMocks()`: sets up `window.AudioContext`, `window.webkitAudioContext`, `navigator.mediaDevices.getUserMedia`, `window.SpeechRecognition`, `window.webkitSpeechRecognition`, `window.speechSynthesis`, and `window.SpeechSynthesisUtterance`.
- `resetAudioMocks()`: resets all mock states and timers between tests.

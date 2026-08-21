# Project: NanoForge Interactive Audio Voice Call System

## Architecture
The Interactive Audio Voice Call System enables real-time bidirectional voice communication in NanoForge.
It connects browser-native Web Audio, Speech Recognition (STT), and Speech Synthesis (TTS) with the NanoForge Agent-Host and WebSocket Protocol.

```
+-----------------------------------------------------------------------------------------+
|                                    Frontend Client (src/)                               |
|                                                                                         |
|  [TopBar Trigger]  [ChatComposer Trigger]  [/call Slash Command]                       |
|         │                  │                      │                                     |
|         └──────────────────┼──────────────────────┘                                     |
|                            ▼                                                            |
|                  [useVoiceCall Controller Hook]                                         |
|                   ├── AudioEngineService (AudioContext, AnalyserNode, GainNode, Mic)   |
|                   ├── SpeechRecognitionService (Web Speech STT, VAD Pause Dispatch)    |
|                   ├── SpeechSynthesisService (TTS Queue, Utterance, Barge-in Cancel)    |
|                   └── Voice Call Session State Machine                                  |
|                            │                                                            |
|                            ▼                                                            |
|                 [VoiceCallDrawer UI Dock]                                               |
|                   ├── VoiceCallHeader (Status Badge, Duration Timer, End Call)          |
|                   ├── VoiceParticipantCard (User / Agent Profiles, Status Indicator)   |
|                   ├── VoiceWaveformVisualizer (Mic Waveform Canvas / Oscilloscope)     |
|                   ├── VoiceFrequencyVisualizer (Agent Audio Equalizer Bars)             |
|                   ├── VoiceCallTranscriptionStream (Interim & Final Speech Bubbles)     |
|                   └── VoiceCallControls (Mute, Barge-In / Interrupt, Volume, Gain)     |
|                            │                                                            |
|                            ▼ (Prompt Auto-Dispatch / Transcript Sync)                   |
|                   [Main Chat Session Transcript]                                        |
+----------------------------┬────────────────────────────────────────────────------------+
                             │ WebSocket Frames (packages/protocol)
                             ▼
+-----------------------------------------------------------------------------------------+
|                              Backend Agent Host (apps/agent-host/)                      |
|                                                                                         |
|  [Fastify WS /agent] ──► [VoiceSessionManager]                                          |
|                                ├── voice.session.start / pause / resume / end / mute    |
|                                ├── voice.transcript.submit ──► [RunCoordinator]         |
|                                ├── voice.tts.chunk / voice.turn.event ◄── [Model Stream]|
|                                └── voice.interrupt ──► [AbortController.abort()]        |
+-----------------------------------------------------------------------------------------+
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Voice Call Protocol & State Machine | Pure TypeScript & Zod schemas for voice sessions, audio frames, transcripts, turns, and interrupt events in `packages/protocol` | M1 | ORIGINAL_REQUEST §R1, R5 |
| F2 | Agent-Host Voice Session Manager | Server-side voice session lifecycle, WebSocket frame validation, and event routing in `apps/agent-host` | M1 | ORIGINAL_REQUEST §R1, R5 |
| F3 | Barge-In Interruption Signal Engine | Cancellation of in-flight LLM token generation and audio streaming upon user speech detection or interrupt button | M1 | ORIGINAL_REQUEST §R3, R5 |
| F4 | Web Audio Engine & Visualizer Analysers | `AudioEngineService` managing AudioContext, MediaStream mic capture, gain nodes, and FFT analysers | M2 | ORIGINAL_REQUEST §R1, R4 |
| F5 | Live Speech-to-Text (STT) & VAD Auto-Dispatch | `SpeechRecognitionService` handling real-time continuous transcription, interim updates, and pause auto-dispatch | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Text-to-Speech (TTS) Synthesis & Controls | `SpeechSynthesisService` with sentence chunking, pitch/rate/voice controls, and instant cancellation | M2 | ORIGINAL_REQUEST §R3 |
| F7 | TopBar & ChatComposer Trigger Seams | Accessible "Voice Call" button in TopBar with active call badge, ChatComposer mic trigger, and `/call` command | M3 | ORIGINAL_REQUEST §R1 |
| F8 | Interactive Voice Call Modal / Drawer | Full-featured drawer with call timer, participant cards, status indicators, mute, gain, and volume controls | M3 | ORIGINAL_REQUEST §R1 |
| F9 | Real-Time Dual Audio Visualizers | Dynamic microphone waveform oscilloscope and agent speaker frequency equalizer visualizers | M3 | ORIGINAL_REQUEST §R4 |
| F10 | Live Transcription Stream & Chat Persistence | Streaming interim & final transcript display in drawer, auto-committing turns to main chat transcript on call end | M3 | ORIGINAL_REQUEST §R2, R3 |
| F11 | Opaque-Box E2E Testing Suite (Tiers 1-4) | Comprehensive requirement-driven test suite with >=11*N test cases covering all features, boundaries, combinations, and workflows | E2E-Track / M4 | ORIGINAL_REQUEST §R5 |
| F12 | Adversarial Hardening & Integrity Verification | White-box adversarial testing, edge-case hardening, and forensic integrity verification with 100% test pass rate | M4 | ORIGINAL_REQUEST §R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Protocol & Agent-Host Voice Integration | `packages/protocol/src/voice.ts`, `apps/agent-host/src/protocol.ts`, `apps/agent-host/src/session.ts`, `apps/agent-host/src/voice/` | none | PLANNED |
| M2 | Web Audio Engine, STT & TTS Services | `src/services/audioEngine.ts`, `src/services/speechRecognition.ts`, `src/services/speechSynthesis.ts`, `src/test/audioMocks.ts` | none | PLANNED |
| M3 | Voice Call UI, Visualizers & Trigger Seams | `src/components/voice/*`, `src/hooks/useVoiceCall.ts`, `src/sections/TopBar.tsx`, `src/sections/ChatComposer.tsx`, `src/App.tsx` | M1, M2 | PLANNED |
| M4 | Final Acceptance Milestone (E2E & Adversarial) | Pass 100% E2E test suite (Tiers 1-4), Tier 5 adversarial hardening, forensic integrity audit | M1, M2, M3, E2E-Track | PLANNED |
| E2E | E2E Testing Track | Test harness, mock engines, test suites (Tiers 1-4: Feature, Boundary, Combinatorial, Scenario) -> `TEST_READY.md` | none (Parallel) | IN_PROGRESS |

## Interface Contracts

### 1. Protocol Contract (`packages/protocol/src/voice.ts`)
- **Status Enum**: `"idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended"`
- **Client Messages**:
  - `voice.session.start`: `{ requestId: string, voiceProfile?: VoiceProfile, inputGain?: number, outputVolume?: number }`
  - `voice.session.pause`: `{ requestId: string, sessionId: string }`
  - `voice.session.resume`: `{ requestId: string, sessionId: string }`
  - `voice.session.end`: `{ requestId: string, sessionId: string, reason?: VoiceCallEndReason }`
  - `voice.session.mute`: `{ requestId: string, sessionId: string, muted: boolean }`
  - `voice.transcript.submit`: `{ requestId: string, sessionId: string, turnId: string, text: string, isFinal: boolean, confidence?: number }`
  - `voice.interrupt`: `{ requestId: string, sessionId: string, turnId: string, reason: VoiceInterruptReason, spokenTextSnippet?: string }`
- **Host Messages**:
  - `voice.session.ready`: `{ session: VoiceCallSession, at: string }`
  - `voice.session.state`: `{ sessionId: string, status: VoiceCallStatus, at: string, detail?: string }`
  - `voice.transcript.event`: `{ frame: VoiceTranscriptFrame, at: string }`
  - `voice.tts.chunk`: `{ chunk: VoiceTtsChunk, at: string }`
  - `voice.turn.event`: `{ turn: VoiceTurnSync, at: string }`
  - `voice.interrupted`: `{ frame: VoiceInterruptFrame, at: string }`

### 2. Audio Engine Service Contract (`src/services/audioEngine.ts`)
- `initialize(): Promise<boolean>`
- `setMuted(muted: boolean): void`
- `setMicGain(gain: number): void` (0.0 to 2.0)
- `setSpeakerVolume(volume: number): void` (0.0 to 1.0)
- `getMicVisualData(): AudioVisualData` (timeDomainData: Uint8Array, frequencyData: Uint8Array, rmsVolume: number)
- `getSpeakerVisualData(): AudioVisualData`
- `cleanup(): void`

### 3. Speech Recognition Service Contract (`src/services/speechRecognition.ts`)
- `start(): void`
- `stop(): void`
- `resetTranscript(): void`
- `simulateTranscript(text: string, isFinal?: boolean): void`
- Callback events: `onInterimResult(text)`, `onFinalResult(text)`, `onSpeechStart()`, `onSpeechEnd()`, `onAutoDispatch(fullPrompt)`

### 4. Speech Synthesis Service Contract (`src/services/speechSynthesis.ts`)
- `speak(text: string): Promise<void>`
- `cancel(): void` (Immediate barge-in cancellation)
- `updateSettings(settings: Partial<TTSSettings>): void`
- `getVoices(): SpeechSynthesisVoice[]`

### 5. Voice Call Hook Contract (`src/hooks/useVoiceCall.ts`)
- State: `{ session, status, isMuted, micGain, speakerVolume, durationSeconds, interimTranscript, finalTranscript, transcriptHistory, isDrawerOpen, micVisualData, speakerVisualData }`
- Actions: `{ startCall, endCall, toggleMute, setMicGain, setSpeakerVolume, interruptAgent, openDrawer, closeDrawer, sendVoicePrompt }`

## Code Layout
- `packages/protocol/src/voice.ts` — Voice wire schemas, types, state machine helper functions.
- `packages/protocol/src/index.ts` — Protocol package entry point exporting voice module.
- `packages/protocol/test/voice.test.ts` — Comprehensive unit and schema validation tests for voice protocol.
- `apps/agent-host/src/protocol.ts` — Wire protocol schema extensions with voice message unions.
- `apps/agent-host/src/voice/voiceManager.ts` — Voice call session manager for agent-host.
- `apps/agent-host/src/session.ts` — Fastify WebSocket session message dispatcher integration.
- `apps/agent-host/test/voice/voiceManager.test.ts` — Agent-host voice session lifecycle and interruption tests.
- `src/services/audioEngine.ts` — Web Audio API graph management and visualizer data tap.
- `src/services/speechRecognition.ts` — Web Speech recognition, VAD pause detection, and fallbacks.
- `src/services/speechSynthesis.ts` — Web Speech synthesis, utterance chunking, and barge-in cancellation.
- `src/services/__tests__/audioEngine.test.ts` — Audio engine unit tests.
- `src/services/__tests__/speechRecognition.test.ts` — Speech recognition & VAD tests.
- `src/services/__tests__/speechSynthesis.test.ts` — Speech synthesis & barge-in tests.
- `src/test/audioMocks.ts` — Reusable Web Audio & Speech API mock harness.
- `src/components/voice/VoiceCallDrawer.tsx` — Main voice call drawer / modal dialog.
- `src/components/voice/VoiceWaveformVisualizer.tsx` — Microphone waveform oscilloscope canvas.
- `src/components/voice/VoiceFrequencyVisualizer.tsx` — Agent audio frequency equalizer bars.
- `src/components/voice/VoiceCallHeader.tsx` — Header with status badge, timer, and close button.
- `src/components/voice/VoiceCallControls.tsx` — Control bar for Mute, Interrupt, Gain, Volume, End Call.
- `src/components/voice/VoiceCallTranscriptionStream.tsx` — Live scrolling interim & final transcription view.
- `src/components/voice/VoiceParticipantCard.tsx` — Participant information and visual activity cards.
- `src/components/voice/__tests__/VoiceCallDrawer.test.tsx` — Comprehensive voice drawer component tests.
- `src/components/voice/__tests__/VoiceVisualizers.test.tsx` — Audio visualizer component tests.
- `src/hooks/useVoiceCall.ts` — Unified voice call orchestrator hook.
- `src/sections/TopBar.tsx` — TopBar trigger button and active call indicator.
- `src/sections/ChatComposer.tsx` — ChatComposer mic button and `/call` command.
- `src/App.tsx` — App-level drawer integration and transcript sync.

# Handoff Report: Web Audio Engine, Speech Services & `useVoiceCall` Specification

**Author**: `m3_explorer_2` (Teamwork Explorer)  
**Working Directory**: `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m3_explorer_2`  
**Date**: 2026-08-15  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

1. **Protocol Schema & Wire Definitions (`packages/protocol/src/voice.ts:1-589`)**:
   - Status schema (`voiceCallStatusSchema:17-25`): `"idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended"`.
   - Client messages: `voice.session.start`, `voice.session.pause`, `voice.session.resume`, `voice.session.end`, `voice.session.mute`, `voice.session.gain`, `voice.transcript.submit`, `voice.interrupt`, `voice.audio.chunk` (`lines 202-294`).
   - Host events: `voice.session.ready`, `voice.session.state`, `voice.transcript.event`, `voice.tts.chunk`, `voice.turn.event`, `voice.interrupted`, `voice.error` (`lines 299-365`).
   - State transition and validation helpers: `isValidVoiceStateTransition`, `isVoiceCallActive`, `isVoiceCallTerminal`, `clampGain`, `clampVolume`, `createVoiceCallSession` (`lines 370-465`).

2. **Web Audio Engine (`src/services/audioEngine.ts:1-362`)**:
   - `AudioEngineService` manages `AudioContext`, isolated mic capture (`MediaStreamAudioSourceNode` -> `GainNode` -> `AnalyserNode` with no destination connection to prevent feedback loops), and speaker playback (`GainNode` -> `AnalyserNode` -> `destination`).
   - Provides `initialize()`, `setMuted()`, `setMicGain()` (0.0-2.0), `setSpeakerVolume()` (0.0-1.0), `getMicVisualData()`, `getSpeakerVisualData()`, `resumeContext()`, and `cleanup()`.

3. **Speech Recognition Service (`src/services/speechRecognition.ts:1-396`)**:
   - Continuous Web Speech API STT with fallback simulation (`simulateTranscript`).
   - VAD silence timeout defaults to 1400ms (`silenceTimeoutMs: 1400`), triggering `onAutoDispatch(prompt)`.
   - Instant speech onset trigger `onSpeechStart()` for TTS barge-in interruption.
   - Separate interim and final transcript accumulation (`_interimText`, `_finalText`).

4. **Speech Synthesis Service (`src/services/speechSynthesis.ts:1-368`)**:
   - Wraps `window.speechSynthesis` and `SpeechSynthesisUtterance`.
   - Provides sentence/clause/word boundary chunking engine (`chunkTextForSpeech`, max 150 chars per chunk).
   - Supports immediate barge-in cancellation via `cancel()` which clears the chunk queue, aborts active utterance, and resolves pending promises.

5. **Audio Test Mock Harness (`src/test/audioMocks.ts:1-524`)**:
   - Provides `setupAudioMocks()`, `resetAudioMocks()`, `MockAudioContext`, `MockGainNode`, `MockAnalyserNode`, `MockMediaStream`, `MockSpeechRecognition`, `MockSpeechSynthesis`, and `MockSpeechSynthesisUtterance`.

---

## 2. Logic Chain

1. **State Centralization**: From Observation 1 and 2, the voice call lifecycle requires coordinating audio hardware state (gain, mute, volume), recognition state (listening, interim text, auto-dispatch), synthesis state (speaking, barge-in), and UI presentation (drawer open, visualizer data). By centralizing these in `useVoiceCall`, React components (`VoiceCallDrawer`, `TopBar`, `ChatComposer`) can bind to a single reactive source of truth.
2. **Lifecycle Determinism**: From Observation 1 (`isValidVoiceStateTransition`) and Observation 3, call initiation transitions `idle -> connecting -> listening`. During an active call, VAD pause (1400ms) transitions `listening -> thinking`, LLM streaming/TTS transitions `thinking -> speaking`, and speech completion returns `speaking -> listening`. Muting transitions `listening -> muted` and disables audio tracks.
3. **Barge-In Interruption**: From Observation 3 (`onSpeechStart`) and Observation 4 (`cancel`), when user speech is detected while the status is `"speaking"` or `"thinking"`, the hook instantly invokes `speechSynthesisService.cancel()`, notifies the backend via `voice.interrupt`, and transitions status back to `"listening"`.
4. **Visualizer Performance**: From Observation 2 (`getMicVisualData`, `getSpeakerVisualData`), sampling FFT data at 60fps via `requestAnimationFrame` while `isDrawerOpen && isCallActive` delivers smooth animations with zero allocations.
5. **Session & Chat Persistence**: When calls terminate, the hook invokes `onCallEnd(transcripts, duration)` and cleans up all audio/speech resources via `audioEngineService.cleanup()`, `speechRecognitionService.stop()`, and `speechSynthesisService.cancel()`.

---

## 3. Caveats

- **Browser Permissions**: Microphones require user consent via `navigator.mediaDevices.getUserMedia`. In non-secure HTTP origins (excluding `localhost`), browsers block microphone access. `useVoiceCall` catches this and reports a clear error string.
- **Web Speech API Availability**: In browsers lacking `SpeechRecognition` (e.g. Firefox without experimental flags), STT falls back gracefully, and the hook supports headless simulation via `simulateTranscript` for testing.
- No other caveats.

---

## 4. Conclusion

The complete architecture and specification for `src/hooks/useVoiceCall.ts` has been designed and documented in `.agents/m3_explorer_2/analysis.md`. The design fulfills all requirements of R1-R5 in `ORIGINAL_REQUEST.md`, adheres strictly to `@protocol/voice`, seamlessly integrates `AudioEngineService`, `SpeechRecognitionService`, and `SpeechSynthesisService`, and is 100% testable using `src/test/audioMocks.ts`.

---

## 5. Verification Method

1. **Inspect Artifacts**:
   - View `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m3_explorer_2\analysis.md` for the complete hook specification and implementation blueprint.
2. **Protocol Schema Tests**:
   - Run `npm run test:protocol` to verify pure protocol and state transition types pass:
     ```bash
     npm run test:protocol
     ```
3. **Audio Services Unit Tests**:
   - Run `npm test src/services/__tests__/` to verify existing audio and speech service tests pass:
     ```bash
     npx vitest run src/services/__tests__/
     ```
4. **Hook Verification Upon Implementation**:
   - Implement `src/hooks/useVoiceCall.ts` and `src/hooks/__tests__/useVoiceCall.test.tsx` using the blueprint in `analysis.md` and run:
     ```bash
     npx vitest run src/hooks/__tests__/useVoiceCall.test.tsx
     ```

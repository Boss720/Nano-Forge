## 2026-08-15T17:23:50Z

You are Milestone 2 Worker (`m2_worker_1`) for the NanoForge Interactive Audio Voice Call System.
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_worker_1
Your parent is: 2457727a-cc36-4a01-868a-c7c05b24e307

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read SCOPE.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_orch\SCOPE.md
Read explorer reports at:
- c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_explorer_1\handoff.md
- c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_explorer_2\handoff.md
- c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_explorer_3\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your exclusive write ownership:
1. `src/services/audioEngine.ts`
2. `src/services/speechRecognition.ts`
3. `src/services/speechSynthesis.ts`
4. `src/test/audioMocks.ts`
5. `src/services/__tests__/audioEngine.test.ts`
6. `src/services/__tests__/speechRecognition.test.ts`
7. `src/services/__tests__/speechSynthesis.test.ts`

Your mission:
1. Implement `src/services/audioEngine.ts` according to `SCOPE.md` and `m2_explorer_1` specifications:
   - Full Web Audio API graph (`AudioContext`, `MediaStreamAudioSourceNode`, `GainNode`, `AnalyserNode` with fftSize 128 / 64 bins, smoothing 0.8).
   - Mic stream capture with `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.
   - Microphone graph does NOT route to `audioContext.destination`.
   - Speaker graph: `speakerGainNode` -> `speakerAnalyserNode` -> `destination`.
   - Gain clamping (0.0 to 2.0), volume clamping (0.0 to 1.0), muting (disables tracks, sets gain to 0).
   - Volume metrics (RMS and Peak) and visualizer data tap (`getMicVisualData()`, `getSpeakerVisualData()`).
   - Clean resource disposal (`cleanup()`).
2. Implement `src/services/speechRecognition.ts` according to `SCOPE.md` and `m2_explorer_2` specifications:
   - Web Speech API continuous mode (`SpeechRecognition` / `webkitSpeechRecognition`), streaming interim and final transcripts.
   - VAD pause detection (1400ms timer debounce) auto-dispatching full prompt turns on silence and clearing buffers.
   - Immediate barge-in trigger via `onSpeechStart` callback.
   - Safe execution and testing/fallback seam via `simulateTranscript(text, isFinal)`.
3. Implement `src/services/speechSynthesis.ts` according to `SCOPE.md` and `m2_explorer_3` specifications:
   - `window.speechSynthesis` wrapper with voice discovery and settings (voiceURI, rate, pitch, volume).
   - Multi-stage sentence chunking engine (`chunkTextForSpeech`) splitting sentences (>150 chars) on punctuation, clauses, and words.
   - Sequential chunk utterance queue and Chrome GC anchoring.
   - Instant barge-in cancellation (`cancel()`) clearing queue, stopping active speech, and cutting audio.
4. Implement `src/test/audioMocks.ts`:
   - High-fidelity Vitest/JSDOM mock harness for `AudioContext`, `MediaStream`, `AnalyserNode`, `GainNode`, `SpeechRecognition`, `speechSynthesis`, `SpeechSynthesisUtterance`, and setup/reset helpers (`setupAudioMocks()`, `resetAudioMocks()`).
5. Implement unit test suites:
   - `src/services/__tests__/audioEngine.test.ts`
   - `src/services/__tests__/speechRecognition.test.ts`
   - `src/services/__tests__/speechSynthesis.test.ts`
   - Note: Include `// @vitest-environment jsdom` at the top of DOM-dependent test files.
6. Run the build and test verification:
   - `npx vitest run src/services/__tests__/`
   - `npm test`
   - `npm run test:protocol`
   - `npm run test:host`
   - `npm run build`
7. Ensure 100% of tests pass and 0 build errors.
8. Document all commands, test results, and file paths in `handoff.md` in your working directory and notify parent.

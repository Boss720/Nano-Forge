## 2026-08-15T17:21:00Z
You are Milestone 2 Explorer 3 focusing on SpeechSynthesisService, Test Mocks, and Unit Test Strategy.
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_explorer_3
Your parent is: 2457727a-cc36-4a01-868a-c7c05b24e307

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read SCOPE.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_orch\SCOPE.md

Your mission:
Investigate and design:
1. `src/services/speechSynthesis.ts`:
   - `window.speechSynthesis` wrapper, voice enumeration (`getVoices()`, `voiceschanged` event).
   - Utterance settings: `voiceURI`, `rate` (0.5 - 2.0), `pitch` (0.5 - 1.5), `volume` (0.0 - 1.0).
   - Sentence boundary chunking engine for long assistant responses (>150 chars, split on `[.!?\n]+`) to prevent browser buffer limits and enable responsive streaming.
   - Immediate barge-in cancellation (`cancel()`): calling `window.speechSynthesis.cancel()`, resetting queue, and stopping active playback immediately.
   - State properties: `isSupported`, `isSpeaking`, `voices`, `settings`.
2. `src/test/audioMocks.ts`:
   - Complete Vitest / JSDOM mock factory for `AudioContext`, `webkitAudioContext`, `navigator.mediaDevices.getUserMedia`, `SpeechRecognition`, `webkitSpeechRecognition`, `speechSynthesis`, and `SpeechSynthesisUtterance`.
   - Realistic event firing and timer simulations.
3. Unit Test Strategy:
   - `src/services/__tests__/audioEngine.test.ts`
   - `src/services/__tests__/speechRecognition.test.ts`
   - `src/services/__tests__/speechSynthesis.test.ts`
   - Testing 100% of branches, edge cases, pause timers, barge-in cancellation, volume calculations, and disposal.

Write your findings and comprehensive implementation plan to `handoff.md` in your working directory and notify parent.

## 2026-08-15T17:20:27Z
You are the Milestone 2 Sub-Orchestrator for NanoForge Voice Call System (Audio Engine, STT & TTS Services).
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_orch
Your parent is: 0b783e94-2621-4d55-8f48-e74cab7153f3

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read survey report at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\survey_explorer_3\handoff.md

Your mission:
1. Create `SCOPE.md` in your working directory for Milestone 2.
2. Execute the milestone cycle (Explorer -> Worker -> Reviewer -> Challenger -> Auditor -> Gate):
   - Implement `src/services/audioEngine.ts`: AudioContext, AnalyserNodes (user mic & agent speaker, 64 bins, smoothing 0.8), GainNodes, MediaStream capture, gain/volume controls, FFT visual data tap (F4).
   - Implement `src/services/speechRecognition.ts`: Web Speech API SpeechRecognition continuous mode, interim & final transcription streaming, VAD pause detection (1400ms) for auto-dispatching prompts, and fallback mock support (F5).
   - Implement `src/services/speechSynthesis.ts`: Web Speech synthesis, sentence chunking, voice/rate/pitch/volume settings, and instant barge-in cancellation on speech start (F6).
   - Implement reusable test mocks in `src/test/audioMocks.ts`.
   - Implement comprehensive unit tests: `src/services/__tests__/audioEngine.test.ts`, `src/services/__tests__/speechRecognition.test.ts`, `src/services/__tests__/speechSynthesis.test.ts`.
   - Verify all tests pass with 100% success.
3. Pass all gate reviews and write `handoff.md` in your working directory.

Update your progress.md periodically. When complete, send a message to parent with the summary and path to your handoff.md.

## 2026-08-15T17:21:34Z
You are e2e_worker_1.
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\e2e_worker_1

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read TEST_INFRA.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\TEST_INFRA.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Task:
1. Update `vitest.config.ts` to include `"tests/**/*.test.{ts,tsx}"` in `test.include`.
2. Create `tests/e2e/voice/harness.ts`:
   - A robust opaque-box test harness and virtual simulation environment for Voice Call E2E testing.
   - Include mock Web Audio engine (AudioContext, AnalyserNode with realistic FFT frequency data and time domain waveform oscillations, GainNodes, MediaStreamTracks).
   - Include mock SpeechRecognition engine with event callbacks (`onresult`, `onaudiostart`, `onspeechend`, `onerror`), continuous listening, interim and final transcript emission, and simulated speech utterance dispatch.
   - Include mock SpeechSynthesis engine with `SpeechSynthesisUtterance`, `speak()`, `cancel()` for barge-in, `pause()`, `resume()`, `getVoices()`, and event callbacks (`onstart`, `onend`, `onerror`).
   - Include mock Client-Server Voice Session Coordinator that manages session state transitions (`idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `ended`), simulates Fastify WebSocket wire frame messaging according to `packages/protocol/src/voice.ts`, handles prompt submission, model token streaming, barge-in interrupt cancellation, mute toggling, gain/volume adjustments, and transcript synchronization.
   - Export convenient helper classes / factory functions (e.g., `createVoiceTestHarness()`, `VoiceTestHarness`) with full lifecycle methods and assertion helpers.
3. Create `tests/e2e/voice/tier1_features.test.ts`:
   - Implement exactly the 60 Tier 1 test cases (5 test cases for each feature F1 to F12) as specified in `TEST_INFRA.md § Tier 1 — Feature Coverage`.
   - Every single test case should be descriptive, well-structured, genuinely executable, asserting real state transitions, event payloads, audio data manipulations, transcription flows, interruptions, and lifecycle teardowns.
4. Run `npx vitest run tests/e2e/voice/tier1_features.test.ts` to verify that all 60 tests pass with 100% success rate.
5. Write your handoff report to `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\e2e_worker_1\handoff.md` and send a message back with your results.

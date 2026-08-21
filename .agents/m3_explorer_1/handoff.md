# Milestone 3 (Voice Call UI) Handoff Report

## 1. Observation
1. **Existing Base Codebase**:
   - `src/sections/TopBar.tsx` (lines 4-26, 115-146): Contains toolbar triggers for artifacts (`onOpenArtifacts`), subagents (`onOpenSubagents`), costs, export, and settings. No voice call trigger currently exists.
   - `src/sections/ChatComposer.tsx` (lines 37-92, 269-282, 545-561): Houses `BUILTIN_SLASH_COMMANDS` (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`), textarea input, and run/stop agent buttons. No `/call` command or mic trigger button is present.
   - `src/sections/ChatPanel.tsx` (lines 95-108): Wraps `ChatComposer` and forwards chat parameters (`onSendMessage`, `onTriggerPlan`, `running`, `onStop`, `genPrefs`, `workspaceFiles`).
   - `src/App.tsx` (lines 135, 566-581, 596-608): Hosts `useHostSession`, renders `TopBar`, `Sidebar`, `ChatPanel`, and right-rail docks/drawers (`ArtifactDock`, `SubagentsPanel`, `PlanPanel`). Contains message state array `sessions` and `patchMessage` / `finishRun` handlers.
   - `packages/protocol/src/voice.ts` (lines 17-25, 202-294, 299-365): Defines full Zod schemas and type definitions for `VoiceCallStatus`, client RPCs (`voice.session.start`, `voice.session.pause`, `voice.session.resume`, `voice.session.end`, `voice.session.mute`, `voice.transcript.submit`, `voice.interrupt`), and host events (`voice.session.ready`, `voice.session.state`, `voice.transcript.event`, `voice.tts.chunk`, `voice.turn.event`, `voice.interrupted`).
   - `apps/agent-host/src/voice/voiceManager.ts` (lines 88-275, 306-650): Implements full server-side voice session lifecycle, STT submission, streaming LLM turns with TTS chunking, and AbortController-driven barge-in interruptions.
   - `src/services/audioEngine.ts` (lines 43-359): Complete Web Audio engine managing MediaStream, mic/speaker GainNodes, FFT AnalyserNodes, volume metrics, and teardown.
   - `src/services/speechRecognition.ts` (lines 75-393): Full Web Speech STT service supporting continuous recognition, interim callbacks, and VAD pause auto-dispatch.
   - `src/services/speechSynthesis.ts` (lines 102-365): Full Web Speech TTS service with sentence chunking, pitch/rate controls, and barge-in cancellation.
   - `src/test/audioMocks.ts` (lines 1-524): Mock audio environment for Vitest/jsdom testing.
   - `tests/e2e/voice/` (Tiers 1-4, 138 total tests): Full virtual voice test harness and test suites for F1 through F12.
   - Running `npm test`: 47 test files with 585 tests all pass with a 100% success rate (duration ~23.5s).

## 2. Logic Chain
1. **Trigger Seam Placement** (Observation: `TopBar.tsx`, `ChatComposer.tsx`):
   - In `TopBar.tsx`, placing the voice call button in the right actions cluster alongside artifacts and subagent toggles allows quick session initiation and visual indication of active call status with an animated pulse dot.
   - In `ChatComposer.tsx`, adding `/call` to `BUILTIN_SLASH_COMMANDS` and a dedicated mic button beside the prompt action bar enables hands-free initiation directly from the composer.
2. **Unified Hook Abstraction** (Observation: `audioEngine.ts`, `speechRecognition.ts`, `speechSynthesis.ts`, `voice.ts`):
   - A single `useVoiceCall` hook in `src/hooks/useVoiceCall.ts` centralizes audio graph lifecycle, speech recognition events, TTS streaming, visualizer polling, and barge-in handling, preventing state fragmentation.
3. **Component Structure** (Observation: `PROJECT.md` § Code Layout):
   - Decomposing the voice call UI into modular components in `src/components/voice/` (`VoiceCallDrawer`, `VoiceCallHeader`, `VoiceParticipantCard`, `VoiceWaveformVisualizer`, `VoiceFrequencyVisualizer`, `VoiceCallTranscriptionStream`, `VoiceCallControls`) provides clear separation between canvas rendering, status displays, and user controls.
4. **Bidirectional Transcript Synchronization** (Observation: `App.tsx` lines 294-325, 416-422):
   - Hooking transcript turn commitments from `useVoiceCall` into `App.tsx` session state guarantees voice turns are committed as standard user/assistant messages in `sessions`, allowing continuous chat context and markdown exports.

## 3. Caveats
- No code was modified or implemented during this investigation (strictly read-only).
- Web Audio and Web Speech APIs require standard browser environment or `src/test/audioMocks.ts` mock harness in headless test environments (jsdom).

## 4. Conclusion
The trigger seams and integration paths for Milestone 3 (Voice Call UI) are completely mapped and validated. All underlying protocol definitions, backend voice management, and Web Audio/Speech services are already present and verified. The detailed implementation blueprint in `analysis.md` provides exact interface definitions, component layouts, and test requirements for the implementer.

## 5. Verification Method
1. Inspect `analysis.md` for complete interface contracts and design details.
2. Run test suites:
   - `npm test`
   - `npm run test:protocol`
   - `npm run test:host`
3. Run `npm run build` to verify clean compilation.

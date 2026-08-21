# Milestone 3 Independent Review & Adversarial Challenge Report

**Reviewer**: `m3_reviewer_2` (Teamwork Reviewer & Adversarial Critic)  
**Date**: 2026-08-15  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

Direct code inspections, adversarial test executions, and build outputs were conducted across Milestone 3 deliverables:

### 1.1 Test Suite Verification
- `npm run test:protocol`: **PASSED** (11 test files, 258 tests passed in 3.04s).
- `npm run test:host`: **PASSED** (40 test files, 394 tests passed in 10.67s).
- `npm run build`: **PASSED** (TypeScript typechecking + Vite production bundle completed with 0 errors in 33.04s).
- `npm test` (`npx vitest run src/hooks/__tests__/useVoiceCall.adversarial.test.tsx`): **FAILED with 3 test failures out of 18 tests**:
  ```
  FAIL src/hooks/__tests__/useVoiceCall.adversarial.test.tsx
  × handles endCall invoked while startCall is pending async initialization (AssertionError: expected 'listening' to be 'ended')
  × does not synthesize speech or transition state if speakAgentResponse is called after endCall (AssertionError: expected "speak" to not be called at all, but actually been called 1 times)
  × does not dispatch prompt or alter history if sendVoicePrompt is called when call is not active (AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times)
  ```

### 1.2 Review Criteria Observations

1. **Audio Graph Isolation & Acoustic Feedback Safety**:
   - `src/services/audioEngine.ts` (lines 135–150): Microphone input stream node (`micSourceNode`) connects strictly to `micGainNode` and `micAnalyserNode`. It is **never** connected to `audioContext.destination`.
   - `src/services/audioEngine.ts` (lines 152–166): Speaker audio output connects `speakerGainNode -> speakerAnalyserNode -> audioContext.destination`.
   - **Assessment**: PASSED. Acoustic isolation is guaranteed and no microphone audio feeds back into the local speakers.

2. **Speech Recognition VAD & Auto-Dispatch**:
   - `src/services/speechRecognition.ts` (lines 97, 361–392): Silence timeout defaults to `1400ms`. Upon silence timer expiration, `handleSilenceTimeout` triggers `options.onAutoDispatch(promptToDispatch)` and resets the transcript.
   - `src/hooks/useVoiceCall.ts` (lines 335–338): `onAutoDispatch` automatically routes the accumulated speech prompt into `sendVoicePrompt(prompt)`.
   - **Assessment**: PASSED.

3. **Speech Synthesis Chunking & Barge-In Cancellation**:
   - `src/services/speechSynthesis.ts` (lines 49–100): `chunkTextForSpeech(text, maxChunkLength = 150)` splits long assistant responses across sentence, clause, and whitespace boundaries so no utterance chunk exceeds 150 characters.
   - `src/services/speechSynthesis.ts` (lines 279–296): `cancel()` invokes `window.speechSynthesis.cancel()`, purges `_chunkQueue`, resets `_isSpeaking`, and emits `"cancel"`.
   - `src/hooks/useVoiceCall.ts` (lines 184–228, 329–334): Speech onset during `speaking` or `thinking` immediately executes `interruptAgent("user_speech_detected")`, halting TTS playback, tagging `[interrupted]` onto the dialogue turn, and returning to `listening`.
   - **Assessment**: PASSED.

4. **Transcript Persistence & UI Integration**:
   - `src/App.tsx` (lines 415–440): `useVoiceCall` is wired with `onCommitTurn`, persisting completed user and agent turns into the active chat session (`session.messages`).
   - `src/sections/TopBar.tsx` (lines 157–175): Accessible trigger button `data-testid="topbar-voice-call-button"` with active state pulse dot.
   - `src/sections/ChatComposer.tsx` (lines 69–74, 285–295, 570–586): `/call` & `/voice` slash command intercept and `data-testid="composer-mic-button"` trigger.
   - `src/components/voice/VoiceCallDrawer.tsx` (lines 110–183): Mounts all 6 child subcomponents in a responsive slide-over drawer with ESC key dismissal.
   - **Assessment**: PASSED.

---

## 2. Logic Chain & Adversarial Findings

While the UI components, audio graphs, and protocol types are well constructed, adversarial stress-testing revealed three race condition and missing-guard defects in `src/hooks/useVoiceCall.ts`:

### Finding 1 [Major] — Async Initialization Race Condition in `startCall`
- **Location**: `src/hooks/useVoiceCall.ts:417–472`
- **Observation**:
  ```typescript
  transitionStatus("connecting");
  const audioSuccess = await audioEngineService.initialize();
  // ...
  const newSession = createVoiceCallSession({ ... });
  setSession(newSession);
  transitionStatus(isMuted ? "muted" : "listening");
  ```
- **Failure Mode**: If `endCall("user_hangup")` is called while `audioEngineService.initialize()` is pending (e.g. waiting for browser microphone permission dialog or device warmup), `endCall` sets `statusRef.current = "ended"`. When `initialize()` resolves, `startCall()` blindly executes without checking if the call was aborted in the interim. It overwrites `session` with a fresh active session and attempts an illegal state transition `ended -> listening`.
- **Blast Radius**: Leaves audio tracks open and places the hook in an inconsistent state after the user requested hangup.
- **Suggested Fix**:
  ```typescript
  const audioSuccess = await audioEngineService.initialize();
  if (statusRef.current === "ended" || !isStartingRef.current) {
    audioEngineService.cleanup();
    isStartingRef.current = false;
    return false;
  }
  ```

### Finding 2 [Major] — Missing Call Active Guard in `speakAgentResponse`
- **Location**: `src/hooks/useVoiceCall.ts:283–311`
- **Observation**:
  `speakAgentResponse` does not verify `isVoiceCallActive(statusRef.current)`.
- **Failure Mode**: If an asynchronous agent model response arrives over WebSocket after the user has hung up (`status === "ended"`), `speakAgentResponse` creates an agent transcript turn in history, transitions state to `speaking`, and starts TTS synthesis.
- **Blast Radius**: Causes audio to speak aloud after the user hung up the call.
- **Suggested Fix**:
  ```typescript
  const speakAgentResponse = useCallback(
    async (text: string) => {
      if (!text || !text.trim() || !autoSpeakAgentResponses || !isVoiceCallActive(statusRef.current)) return;
      // ...
    }
  );
  ```

### Finding 3 [Major] — Missing Call Active Guard in `sendVoicePrompt`
- **Location**: `src/hooks/useVoiceCall.ts:232–279`
- **Observation**:
  `sendVoicePrompt` does not verify `isVoiceCallActive(statusRef.current)`.
- **Failure Mode**: Calling `sendVoicePrompt` while the hook is `idle` or `ended` appends user turns to transcript history and attempts an illegal transition `idle -> thinking`.
- **Blast Radius**: Corrupts transcript history and state machine when prompts are submitted out of session.
- **Suggested Fix**:
  ```typescript
  const sendVoicePrompt = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim();
      if (!trimmed || !isVoiceCallActive(statusRef.current)) return;
      // ...
    }
  );
  ```

---

## 3. Caveats

- Web Speech API behavior (`SpeechRecognition`) in non-mocked headless environments is browser-dependent; fallback simulation seam `simulateTranscript()` provides robust testing coverage.
- No integrity violations, facades, or hardcoded shortcuts were detected in the codebase.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

Milestone 3 is close to completion, with excellent audio graph isolation, visualizers, trigger seams, and protocol schemas. However, because three adversarial lifecycle test cases in `src/hooks/__tests__/useVoiceCall.adversarial.test.tsx` fail due to concurrency races and missing active-state guards in `src/hooks/useVoiceCall.ts`, the milestone cannot be approved until these three fixes are implemented.

---

## 5. Verification Method

To independently verify the fixes:
1. Run adversarial hook test suite:
   ```bash
   npx vitest run src/hooks/__tests__/useVoiceCall.adversarial.test.tsx
   ```
   All 18 tests must pass with 0 failures.
2. Run complete test suites:
   ```bash
   npm run test:protocol
   npm run test:host
   npm test
   npm run build
   ```
   Confirm 100% test pass rate across all files.

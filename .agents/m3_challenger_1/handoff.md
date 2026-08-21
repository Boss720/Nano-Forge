# Handoff Report — M3 Voice Call Adversarial Challenge

**Verdict**: `REQUEST_CHANGES`

---

## 1. Observation

### Test Execution Observations
1. **Adversarial Suite Execution**:
   - Command: `npx vitest run src/hooks/__tests__/useVoiceCall.adversarial.test.tsx src/components/voice/__tests__/VoiceCallControls.adversarial.test.tsx`
   - Results: 18 passed, 3 failed across 21 test assertions.
   - Verbatim Console Errors Observed:
     - `Invalid voice call transition attempted: ended -> listening`
     - `Invalid voice call transition attempted: ended -> speaking`
     - `Invalid voice call transition attempted: idle -> thinking`

2. **Codebase Inspection**:
   - `src/hooks/useVoiceCall.ts:434-475`:
     ```ts
     // In startCall:
     const audioSuccess = await audioEngineService.initialize();
     if (!audioSuccess) { ... }
     // No check whether call was ended or aborted during initialize() await!
     audioEngineService.setMicGain(micGain);
     audioEngineService.setSpeakerVolume(speakerVolume);
     audioEngineService.setMuted(isMuted);

     const newSession = createVoiceCallSession({ ... status: isMuted ? "muted" : "listening" });
     setSession(newSession);

     if (!isMuted && recognitionRef.current) {
       recognitionRef.current.resetTranscript();
       recognitionRef.current.start();
     }
     transitionStatus(isMuted ? "muted" : "listening");
     ```
   - `src/hooks/useVoiceCall.ts:283-312`:
     ```ts
     // In speakAgentResponse:
     const speakAgentResponse = useCallback(
       async (text: string) => {
         if (!text || !text.trim() || !autoSpeakAgentResponses) return;
         // No guard checking isVoiceCallActive(statusRef.current)!
         const turnId = currentTurnIdRef.current;
         ...
         transitionStatus("speaking");
         try {
           await speechSynthesisService.speak(text);
         ...
     ```
   - `src/hooks/useVoiceCall.ts:232-280`:
     ```ts
     // In sendVoicePrompt:
     const sendVoicePrompt = useCallback(
       async (promptText: string) => {
         const trimmed = promptText.trim();
         if (!trimmed) return;
         // No guard checking isVoiceCallActive(statusRef.current)!
         const turnId = `turn-${Date.now()}`;
         ...
         transitionStatus("thinking");
         ...
     ```

---

## 2. Logic Chain

1. **Observation 1 & Code Analysis 1 (Async Start/Stop Race)**:
   - When `startCall()` is invoked, it sets `status = "connecting"` and awaits `audioEngineService.initialize()`.
   - If the user clicks `endCall()` (or an abort event fires) while `initialize()` is awaiting, `endCall()` transitions `status` to `"ended"` and runs `audioEngineService.cleanup()`.
   - When `initialize()` resolves, `startCall()` resumes unconditionally: it overwrites `session` with a newly created session marked `"listening"`, invokes `recognitionRef.current.start()`, and tries to transition `ended -> listening`.
   - While `transitionStatus` blocks the status change (due to state transition validation), `recognitionRef.current.start()` has already been started in the background, creating a zombie speech recognition capture process while the UI displays call ended.
   - **Empirical Proof**: `src/hooks/__tests__/useVoiceCall.adversarial.test.tsx` -> `"handles endCall invoked while startCall is pending async initialization"`.

2. **Observation 2 & Code Analysis 2 (Inactive TTS Playback Leak)**:
   - In `speakAgentResponse(text)`, there is no precondition checking `if (!isVoiceCallActive(statusRef.current)) return;`.
   - If the LLM generates a response or a delayed chunk arrives after the user has hung up (`status === "ended"` or `"idle"`), `speechSynthesisService.speak(text)` is invoked. Spoken audio plays aloud through the device speakers despite the call being terminated, violating privacy and call lifecycle boundaries.
   - **Empirical Proof**: `src/hooks/__tests__/useVoiceCall.adversarial.test.tsx` -> `"does not synthesize speech or transition state if speakAgentResponse is called after endCall"`.

3. **Observation 3 & Code Analysis 3 (Inactive Prompt Submission)**:
   - In `sendVoicePrompt(promptText)`, there is no precondition checking `if (!isVoiceCallActive(statusRef.current)) return;`.
   - Calling `sendVoicePrompt` when the call is `"idle"` or `"ended"` attempts an invalid state transition `idle -> thinking`, records a user turn in `transcriptHistory`, and fires `onSendPrompt` / `hostClient.sendVoiceMessage`.
   - **Empirical Proof**: `src/hooks/__tests__/useVoiceCall.adversarial.test.tsx` -> `"does not dispatch prompt or alter history if sendVoicePrompt is called when call is not active"`.

---

## 3. Caveats

- Hardware-level physical microphone disconnects (e.g. USB unplug mid-call) rely on browser `MediaStreamTrack.onended` events; in standard simulated jsdom environments, this is modeled via mock track state.
- Controls UI (`VoiceCallControls.tsx`) and visualizer rendering are well-guarded and resilient against high-frequency hammer clicking (100 clicks) and boundary fuzzing.

---

## 4. Conclusion & Actionable Fixes

**Verdict**: `REQUEST_CHANGES`

### Required Changes for Implementation Worker in `src/hooks/useVoiceCall.ts`:

1. **Fix `startCall` async race**:
   After `await audioEngineService.initialize()`, verify if the call was ended or aborted during the await:
   ```ts
   if (statusRef.current === "ended" || statusRef.current === "idle") {
     isStartingRef.current = false;
     audioEngineService.cleanup();
     return false;
   }
   ```

2. **Guard `speakAgentResponse` against inactive call states**:
   Add an active status check at the top of `speakAgentResponse`:
   ```ts
   if (!isVoiceCallActive(statusRef.current)) {
     return;
   }
   ```

3. **Guard `sendVoicePrompt` against inactive call states**:
   Add an active status check at the top of `sendVoicePrompt`:
   ```ts
   if (!isVoiceCallActive(statusRef.current)) {
     return;
   }
   ```

---

## 5. Verification Method

Run the adversarial test suites:
```powershell
npx vitest run src/hooks/__tests__/useVoiceCall.adversarial.test.tsx src/components/voice/__tests__/VoiceCallControls.adversarial.test.tsx
```

Once the three guard checks above are implemented in `src/hooks/useVoiceCall.ts`, all 21 adversarial tests in `useVoiceCall.adversarial.test.tsx` and `VoiceCallControls.adversarial.test.tsx` will pass with 100% success rate and 0 invalid transition warnings.

## 2026-08-15T18:14:51Z
You are m3_worker_fix (teamwork_preview_worker).
Your working directory is c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m3_worker_fix

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your mission:
Apply the 3 state-guard and lifecycle race condition fixes to `src/hooks/useVoiceCall.ts` as identified by the adversarial stress reviews, and verify all test suites.

Inputs to read:
- c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m3_challenger_1\handoff.md
- c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m3_reviewer_2\handoff.md
- `src/hooks/useVoiceCall.ts`
- `src/hooks/__tests__/useVoiceCall.adversarial.test.tsx`

Required fixes in `src/hooks/useVoiceCall.ts`:
1. In `startCall`:
   Immediately after `const audioSuccess = await audioEngineService.initialize();`:
   Check if the call was ended/aborted during the await:
   ```ts
   if (statusRef.current === "ended" || statusRef.current === "idle" || !isStartingRef.current) {
     isStartingRef.current = false;
     audioEngineService.cleanup();
     return false;
   }
   ```
2. In `speakAgentResponse`:
   Add an active status check at the top:
   ```ts
   if (!text || !text.trim() || !autoSpeakAgentResponses || !isVoiceCallActive(statusRef.current)) return;
   ```
3. In `sendVoicePrompt`:
   Add an active status check at the top:
   ```ts
   if (!trimmed || !isVoiceCallActive(statusRef.current)) return;
   ```

Verification:
- Run `npx vitest run src/hooks/__tests__/useVoiceCall.adversarial.test.tsx` (ensure 18/18 pass).
- Run `npm run test:protocol` (100% pass).
- Run `npm run test:host` (100% pass).
- Run `npm test` (100% pass).
- Run `npm run build` (0 errors).

Deliver your report in:
`c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m3_worker_fix\handoff.md`
Send a completion message when finished.

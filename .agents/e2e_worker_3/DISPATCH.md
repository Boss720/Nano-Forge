## 2026-08-15T17:25:33Z

You are e2e_worker_3.
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\e2e_worker_3

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read TEST_INFRA.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\TEST_INFRA.md
Read tests/e2e/voice/harness.ts at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\tests\e2e\voice\harness.ts
Read packages/protocol/src/voice.ts at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\packages\protocol\src\voice.ts

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Task:
1. Implement `tests/e2e/voice/tier3_combinations.test.ts`:
   - Implement all 12 Pairwise Cross-Feature Combinations test cases (`T3.1` through `T3.12`) as specified in `TEST_INFRA.md § Tier 3 — Cross-Feature Combinations`.
   - Each test must genuinely verify interaction across pairs of features (e.g. STT streaming + VAD auto-dispatch + Host turn dispatch; TTS synthesis + Equalizer visualizer rendering; Barge-in UI button + instant TTS cancel; Barge-in VAD + instant TTS abort; Mute button + AudioEngine gain 0 + flat waveform + status badge update; Gain slider + volume slider + AudioEngine node updates; TopBar trigger + drawer open + protocol handshake; ChatComposer /call + multi-turn call + transcript persistence; Alternating multi-turn conversation; Network drop + session teardown/reconnect; Drawer minimize/maximize state preservation; Mid-sentence interruption + partial transcript tagging).
2. Implement `tests/e2e/voice/tier4_scenarios.test.ts`:
   - Implement all 6 Real-World Application Scenario test cases (`T4.1` through `T4.6`) as specified in `TEST_INFRA.md § Tier 4 — Real-World Application Scenarios`:
     - `T4.1`: Standard Multi-Turn Voice Dialogue Workflow
     - `T4.2`: Barge-In Interruption Workflow
     - `T4.3`: Mute Toggling & Privacy Workflow
     - `T4.4`: Audio Device Tuning & Real-Time Parameter Adjustment
     - `T4.5`: Rapid Consecutive Speech Turns & Fast Dialogue
     - `T4.6`: Error Recovery, Disconnect & Transcript Persistence Workflow
3. Run `npx vitest run tests/e2e/voice/tier3_combinations.test.ts tests/e2e/voice/tier4_scenarios.test.ts` and verify that all 18 tests pass with 100% success rate.
4. Write your handoff report to `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\e2e_worker_3\handoff.md` and send a message back with your results.

## 2026-08-15T17:21:00Z
You are Milestone 2 Explorer 2 focusing on SpeechRecognitionService.
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_explorer_2
Your parent is: 2457727a-cc36-4a01-868a-c7c05b24e307

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read SCOPE.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m2_orch\SCOPE.md

Your mission:
Investigate and design the exact technical specification for `src/services/speechRecognition.ts`:
1. Web Speech API `SpeechRecognition` / `webkitSpeechRecognition` continuous mode (`continuous: true`, `interimResults: true`, `lang: "en-US"`).
2. Streaming transcript accumulation: separating interim text from final committed text.
3. VAD pause detection logic:
   - On user speech activity (`onspeechstart` / interim results), trigger `onSpeechStart` callback (used to immediately cancel TTS barge-in).
   - After user finishes utterance (`onspeechend` or silence after speech), start a silence timer (default 1400ms).
   - If new speech arrives before timer fires, reset timer.
   - If timer fires and there is accumulated transcript (and not muted), trigger `onAutoDispatch(fullPrompt)` and clear current prompt buffer.
4. Callbacks: `onInterimResult`, `onFinalResult`, `onSpeechStart`, `onSpeechEnd`, `onAutoDispatch`, `onError`.
5. Testing & fallback seams: `simulateTranscript(text: string, isFinal?: boolean)` to allow headless and manual testing.
6. Error handling: network errors, no-speech events, browser support detection (`isSupported`).

Write your findings and comprehensive implementation plan to `handoff.md` in your working directory and notify parent.

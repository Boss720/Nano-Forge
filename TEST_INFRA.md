# E2E Test Infra: NanoForge Interactive Audio Voice Call System

## Test Philosophy
- **Opaque-box, requirement-driven**: All tests evaluate externally observable behaviors, wire protocol messages, user actions, and system responses without tight coupling to internal private methods.
- **Methodology**: Systematic 4-tier testing incorporating Category-Partition Equivalence Partitioning, Boundary Value Analysis (BVA), Pairwise Combinatorial Testing, and Real-World Multi-turn Workload Testing.
- **Progressive Testability**: Verification steps must rely on minimal prerequisites, allowing early tier tests to pass as foundational layers come online.
- **Robustness**: Comprehensive negative testing verifying graceful error handling, recovery, and clean state restoration.

## Feature Inventory & Target Coverage
| # | Feature | Requirement Source | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Scenario) |
|---|---------|-------------------|:----------------:|:-----------------:|:-----------------:|:-----------------:|
| F1 | Voice Call Protocol & State Machine | ORIGINAL_REQUEST §R1, R5 | 5 | 5 | ✓ | ✓ |
| F2 | Agent-Host Voice Session Manager | ORIGINAL_REQUEST §R1, R5 | 5 | 5 | ✓ | ✓ |
| F3 | Barge-In Interruption Signal Engine | ORIGINAL_REQUEST §R3, R5 | 5 | 5 | ✓ | ✓ |
| F4 | Web Audio Engine & Visualizer Analysers | ORIGINAL_REQUEST §R1, R4 | 5 | 5 | ✓ | ✓ |
| F5 | Live Speech-to-Text (STT) & VAD Auto-Dispatch | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F6 | Text-to-Speech (TTS) Synthesis & Controls | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F7 | TopBar & ChatComposer Trigger Seams | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F8 | Interactive Voice Call Modal / Drawer | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F9 | Real-Time Dual Audio Visualizers | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| F10 | Live Transcription Stream & Chat Persistence | ORIGINAL_REQUEST §R2, R3 | 5 | 5 | ✓ | ✓ |
| F11 | Opaque-Box E2E Testing Suite (Tiers 1-4) | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ | ✓ |
| F12 | Adversarial Hardening & Integrity Verification | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ | ✓ |
| **Total** | **All 12 Features** | | **60 tests** | **60 tests** | **12 tests** | **6 tests** |

**Grand Total Minimum Test Cases**: 138 test cases.

---

## Test Architecture

### 1. Test Harness & Environment
- **Directory**: `tests/e2e/voice/`
- **Runner**: Vitest with isolated Node / JSDOM environment and mock audio & speech devices.
- **Entry Points**:
  - `tests/e2e/voice/harness.ts`: Opaque-box client simulator, mock audio context, mock speech recognition/synthesis engines, virtual agent host server.
  - `tests/e2e/voice/tier1_features.test.ts`: Tier 1 Feature Coverage test suite (60 tests).
  - `tests/e2e/voice/tier2_boundaries.test.ts`: Tier 2 Boundary & Corner test suite (60 tests).
  - `tests/e2e/voice/tier3_combinations.test.ts`: Tier 3 Cross-Feature Combinatorial test suite (12 tests).
  - `tests/e2e/voice/tier4_scenarios.test.ts`: Tier 4 Real-World Application Scenarios test suite (6 tests).

### 2. Execution Commands
```bash
# Run all voice E2E tests
npx vitest run tests/e2e/voice/

# Run individual test tiers
npx vitest run tests/e2e/voice/tier1_features.test.ts
npx vitest run tests/e2e/voice/tier2_boundaries.test.ts
npx vitest run tests/e2e/voice/tier3_combinations.test.ts
npx vitest run tests/e2e/voice/tier4_scenarios.test.ts
```

---

## Test Case Breakdown by Tier

### Tier 1 — Feature Coverage (60 Test Cases, 5 per Feature)
- **F1: Protocol & State Transitions** (5 tests):
  1. `T1.F1.1`: Valid session lifecycle transitions: `idle` -> `connecting` -> `listening` -> `thinking` -> `speaking` -> `ended`.
  2. `T1.F1.2`: Schema validation for `voice.session.start`, `pause`, `resume`, `end`, `mute`.
  3. `T1.F1.3`: Schema validation for `voice.transcript.submit` and `voice.interrupt`.
  4. `T1.F1.4`: Host events schema validation (`ready`, `state`, `transcript.event`, `tts.chunk`, `interrupted`).
  5. `T1.F1.5`: Rejection of illegal state transitions (e.g. `ended` -> `speaking` without new start).
- **F2: Agent-Host Session Lifecycle** (5 tests):
  1. `T1.F2.1`: Session creation on `voice.session.start` and broadcast of `voice.session.ready`.
  2. `T1.F2.2`: Mute and unmute handling updating server session state.
  3. `T1.F2.3`: Pause and resume session handling.
  4. `T1.F2.4`: Clean session termination on `voice.session.end`.
  5. `T1.F2.5`: Automatic cleanup on client socket disconnect.
- **F3: Barge-In Interruption Engine** (5 tests):
  1. `T1.F3.1`: Interruption frame emission when client triggers interrupt during speech playback.
  2. `T1.F3.2`: Server aborts ongoing token stream upon receiving `voice.interrupt`.
  3. `T1.F3.3`: TTS audio queue immediate clearance upon interruption.
  4. `T1.F3.4`: State reverts to `listening` after successful interruption.
  5. `T1.F3.5`: Interrupted turn event records partial transcript with `interrupted: true`.
- **F4: Web Audio Engine & Gain/Volume** (5 tests):
  1. `T1.F4.1`: AudioEngine initialization creates AudioContext and nodes cleanly.
  2. `T1.F4.2`: Mic gain adjustments (0.0 to 2.0) modify gain node value correctly.
  3. `T1.F4.3`: Speaker volume adjustments (0.0 to 1.0) modify master gain value.
  4. `T1.F4.4`: Mute mic sets mic gain / track enabled state to disabled without stopping AudioContext.
  5. `T1.F4.5`: Cleanup releases media stream tracks and closes AudioContext.
- **F5: Speech-to-Text & VAD Auto-Dispatch** (5 tests):
  1. `T1.F5.1`: Continuous speech recognition starts on call connect.
  2. `T1.F5.2`: Interim speech results trigger live callback updates.
  3. `T1.F5.3`: Final speech results update transcription buffer.
  4. `T1.F5.4`: Voice Activity Detection (VAD) pause threshold triggers prompt auto-dispatch.
  5. `T1.F5.5`: Recognition error fallback transitions gracefully.
- **F6: Text-to-Speech Synthesis & Voice Controls** (5 tests):
  1. `T1.F6.1`: Agent response text turns convert into spoken synthesis utterances.
  2. `T1.F6.2`: Long responses are chunked by sentence boundaries for low-latency playback.
  3. `T1.F6.3`: Pitch, rate, and timbre configurations apply to SpeechSynthesisUtterance.
  4. `T1.F6.4`: Explicit `cancel()` stops active synthesis instantly.
  5. `T1.F6.5`: Synthesis completion triggers transition back to `listening`.
- **F7: TopBar & ChatComposer Triggers** (5 tests):
  1. `T1.F7.1`: TopBar "Start Voice Call" button opens VoiceCallDrawer.
  2. `T1.F7.2`: TopBar shows active call badge indicator during ongoing call.
  3. `T1.F7.3`: ChatComposer mic trigger initiates voice call session.
  4. `T1.F7.4`: ChatComposer slash command `/call` opens voice call drawer and starts call.
  5. `T1.F7.5`: Clicking trigger while call is active focuses existing active call drawer.
- **F8: Voice Call Drawer UI & Controls** (5 tests):
  1. `T1.F8.1`: Drawer renders header with status badge (`listening`, `thinking`, etc.).
  2. `T1.F8.2`: Call duration timer increments every second while call is active.
  3. `T1.F8.3`: Mute button toggles microphone state with active/inactive UI indicator.
  4. `T1.F8.4`: Interrupt button is enabled during `speaking` and triggers barge-in.
  5. `T1.F8.5`: End Call button terminates session and closes/minimizes drawer.
- **F9: Dual Audio Visualizers** (5 tests):
  1. `T1.F9.1`: Mic waveform visualizer reads timeDomainData and produces non-zero canvas path when user speaks.
  2. `T1.F9.2`: Mic waveform flattens to center line when muted or silent.
  3. `T1.F9.3`: Speaker frequency visualizer renders frequency equalizer bars during agent playback.
  4. `T1.F9.4`: Speaker equalizer bars drop to zero when agent stops speaking.
  5. `T1.F9.5`: Animation frames unmount and clean up resources when drawer closes.
- **F10: Live Transcription Stream & Chat Persistence** (5 tests):
  1. `T1.F10.1`: Real-time interim transcript renders in user speech bubble.
  2. `T1.F10.2`: Final transcript commits to speech bubble history in drawer.
  3. `T1.F10.3`: Agent response turns render synchronously with TTS playback.
  4. `T1.F10.4`: Ending call transfers all voice turns into the main Chat session transcript.
  5. `T1.F10.5`: Transcription stream auto-scrolls to latest message turn.
- **F11: Opaque-Box E2E Runner Architecture** (5 tests):
  1. `T1.F11.1`: Test harness simulates end-to-end client-server WebSocket communication.
  2. `T1.F11.2`: Mock audio pipeline simulates realistic FFT frequency bins and waveforms.
  3. `T1.F11.3`: Mock speech recognition accurately mimics Web Speech API events.
  4. `T1.F11.4`: Mock speech synthesis accurately tracks active speaking status and events.
  5. `T1.F11.5`: Harness captures complete event telemetry log for verification assertions.
- **F12: Adversarial & Safety Assertions** (5 tests):
  1. `T1.F12.1`: Handling unexpected server disconnection during active speaking.
  2. `T1.F12.2`: Rejection of malformed / corrupted JSON frames over voice WebSocket.
  3. `T1.F12.3`: Rapid toggle spamming of Mute / Unmute maintains consistent state.
  4. `T1.F12.4`: Double start / rapid restart without leaking media tracks.
  5. `T1.F12.5`: Zero memory leaks on repeated call start / end cycles.

---

### Tier 2 — Boundary & Corner Cases (60 Test Cases, 5 per Feature)
- **F1: Protocol Boundaries** (5 tests):
  1. `T2.F1.1`: Empty text in `voice.transcript.submit` handled gracefully without crash.
  2. `T2.F1.2`: Maximum size payload (1MB text transcription) parsed within memory limits.
  3. `T2.F1.3`: Special unicode characters and emojis in speech transcription.
  4. `T2.F1.4`: Out-of-order turn IDs processed with monotonic ordering.
  5. `T2.F1.5`: Zero-length and extreme UUID formats for `sessionId` and `requestId`.
- **F2: Host Session Boundaries** (5 tests):
  1. `T2.F2.1`: Concurrent session creation requests on same connection handled safely.
  2. `T2.F2.2`: Immediate `voice.session.end` sent before `voice.session.ready` completes.
  3. `T2.F2.3`: Session pause when already paused (idempotency).
  4. `T2.F2.4`: Session resume when already active (idempotency).
  5. `T2.F2.5`: Extreme packet bursts (100 transcript frames/sec) throttled/queued without crashing.
- **F3: Interruption Boundaries** (5 tests):
  1. `T2.F3.1`: Interruption sent when agent is NOT speaking (ignored gracefully).
  2. `T2.F3.2`: Rapid sequential interrupts (barge-in spam) handled idempotently.
  3. `T2.F3.3`: Interrupt received at the exact final token of agent response.
  4. `T2.F3.4`: Interruption during `thinking` state before TTS starts aborts model call.
  5. `T2.F3.5`: Interruption with empty spokenTextSnippet handled cleanly.
- **F4: Audio Engine Boundaries** (5 tests):
  1. `T2.F4.1`: Gain set to negative value clamped to 0.0.
  2. `T2.F4.2`: Gain set to excessive value (>10.0) clamped to 2.0 maximum.
  3. `T2.F4.3`: Volume set to negative clamped to 0.0, >1.0 clamped to 1.0.
  4. `T2.F4.4`: AudioContext initialization failure (e.g. mic permission denied) sets error state cleanly.
  5. `T2.F4.5`: AudioContext auto-resume on user gesture when suspended by browser policy.
- **F5: STT & VAD Boundaries** (5 tests):
  1. `T2.F5.1`: Continuous background silence with no speech does not trigger false dispatch.
  2. `T2.F5.2`: Extremely short utterance (<100ms noise burst) filtered out.
  3. `T2.F5.3`: Continuous speaking for >60s without pause handled without buffer overflow.
  4. `T2.F5.4`: Web Speech API `no-speech` and `audio-capture` error events recover automatically.
  5. `T2.F5.5`: Fast speech with rapid interim updates updates UI without DOM thrashing.
- **F6: TTS Boundaries** (5 tests):
  1. `T2.F6.1`: Empty string or whitespace-only TTS synthesis completes immediately.
  2. `T2.F6.2`: Extreme pitch (0.1 / 2.0) and rate (0.1 / 10.0) parameters clamped to valid ranges.
  3. `T2.F6.3`: Text containing code blocks, markdown, and URLs sanitized for natural speech.
  4. `T2.F6.4`: Voice list empty or unavailable falls back to default system voice.
  5. `T2.F6.5`: Synthesis utterance error event triggers graceful error recovery.
- **F7: Trigger Seam Boundaries** (5 tests):
  1. `T2.F7.1`: Rapid double-clicking "Start Voice Call" button creates exactly one session.
  2. `T2.F7.2`: Starting call when another modal is open closes/backgrounds other modal.
  3. `T2.F7.3`: Triggering `/call` with trailing arguments (`/call now`) normalizes command.
  4. `T2.F7.4`: Trigger button disabled state during `connecting` transition.
  5. `T2.F7.5`: Keyboard navigation (Enter / Space) on trigger buttons opens drawer reliably.
- **F8: Drawer UI Boundaries** (5 tests):
  1. `T2.F8.1`: Drawer resize / viewport changes (mobile 320px to 4K display) maintain responsive layout.
  2. `T2.F8.2`: Call duration exceeding 1 hour formats timer as `01:00:00`.
  3. `T2.F8.3`: Escape key behavior during active call prompts confirmation before ending.
  4. `T2.F8.4`: Drawer backdrop click behavior when call is active vs ended.
  5. `T2.F8.5`: Multi-language participant names and long agent titles truncate cleanly.
- **F9: Visualizer Boundaries** (5 tests):
  1. `T2.F9.1`: Zero input amplitude renders clean flat baseline without canvas artifacts.
  2. `T2.F9.2`: Maximum clipping amplitude (0dB square wave) renders within canvas boundaries.
  3. `T2.F9.3`: High DPI / Retina display canvas scaling preserves sharp rendering without blur.
  4. `T2.F9.4`: Canvas context loss / restoration handled without unhandled exceptions.
  5. `T2.F9.5`: Background tab throttling maintains stable visualizer state upon re-focus.
- **F10: Transcription Stream Boundaries** (5 tests):
  1. `T2.F10.1`: 100+ dialogue turns in a single call render smoothly with virtualization or fast scrolling.
  2. `T2.F10.2`: Very long single speech turn (2,000 words) wraps cleanly in transcription bubble.
  3. `T2.F10.3`: Rapid back-to-back user turns before agent response concatenate or format distinctly.
  4. `T2.F10.4`: Persisting transcript when main chat session already has existing history appends accurately.
  5. `T2.F10.5`: Closing browser tab unexpectedly persists pending transcript to local storage or recovery cache.
- **F11: Harness Boundaries** (5 tests):
  1. `T2.F11.1`: Harness handles simultaneous multi-client virtual call sessions.
  2. `T2.F11.2`: Simulated network latency jitter (0ms to 2000ms) on voice frames.
  3. `T2.F11.3`: Out-of-order delivery simulation for TTS audio chunks.
  4. `T2.F11.4`: Abrupt socket termination simulation verifies cleanup assertions.
  5. `T2.F11.5`: Harness timeout detection for hanging turns.
- **F12: Security & Adversarial Boundaries** (5 tests):
  1. `T2.F12.1`: XSS injection attempts via voice transcript strings are sanitized before DOM render.
  2. `T2.F12.2`: Prompt injection phrases spoken by user ("System prompt override: ...") handled safely as text prompts.
  3. `T2.F12.3`: Audio buffer overflow protection against corrupted float32 audio arrays.
  4. `T2.F12.4`: Denial of Service (DoS) resistance against rapid connect/disconnect spam.
  5. `T2.F12.5`: Zero exposure of internal session tokens or server paths in client-facing errors.

---

### Tier 3 — Cross-Feature Combinations (12 Pairwise Test Cases)
1. `T3.1` (F1 + F5 + F2): User speech interim streaming -> VAD pause -> `voice.transcript.submit` -> Agent-Host session turn dispatch.
2. `T3.2` (F2 + F6 + F9): Agent response generation -> TTS chunk synthesis -> Speaker Equalizer visualizer rendering in sync.
3. `T3.3` (F3 + F6 + F8): Active agent TTS speech -> User clicks UI Interrupt button -> Instant TTS cancellation + state change to `listening`.
4. `T3.4` (F3 + F5 + F6): Active agent TTS speech -> User begins speaking (barge-in VAD) -> Instant TTS abort + new interim transcript begins.
5. `T3.5` (F4 + F8 + F9): User toggles Mute in drawer -> AudioEngine sets gain to 0 -> Waveform visualizer immediately goes flat -> UI badge shows `muted`.
6. `T3.6` (F4 + F8): User adjusts mic gain slider (1.5x) and speaker volume (0.8x) -> AudioEngine nodes update -> Audio output and input levels adjust accordingly.
7. `T3.7` (F7 + F8 + F1): TopBar "Start Voice Call" clicked -> Drawer opens -> Protocol handshake initiates -> Session reaches `listening` state.
8. `T3.8` (F7 + F8 + F10): ChatComposer `/call` command executed -> Call active -> 3 speech turns exchanged -> End call -> Main chat displays 3 turns.
9. `T3.9` (F5 + F6 + F10): Multi-turn conversation with alternating user speech and agent TTS -> All interim and final turns accurately tracked in transcript stream.
10. `T3.10` (F1 + F2 + F12): Network drop during active speaking -> Reconnect handshake -> Graceful error handling or session recovery without UI lockup.
11. `T3.11` (F8 + F9 + F10): Drawer minimized/maximized during active voice turn -> Visualizers and transcript stream maintain seamless rendering and state.
12. `T3.12` (F3 + F2 + F10): User interrupts agent mid-sentence -> Interrupted turn flagged in transcript history -> Next user utterance starts clean turn.

---

### Tier 4 — Real-World Application Scenarios (6 Full Multi-Turn Workflows)
1. `T4.1` — **Standard Multi-Turn Voice Dialogue Workflow**:
   - User clicks TopBar "Start Voice Call".
   - Drawer opens, session connects, status indicates `listening`.
   - User asks: *"Can you explain the architecture of NanoForge?"*.
   - STT transcribes interim -> VAD auto-dispatches.
   - Status switches to `thinking` -> Agent generates answer -> Status switches to `speaking`.
   - TTS synthesizes response while speaker visualizer animates.
   - User follows up: *"What about the protocol layer?"*.
   - Agent responds to follow-up.
   - User clicks "End Call". Call terminates cleanly and conversation appears in main chat.

2. `T4.2` — **Barge-In Interruption Workflow**:
   - User initiates call via ChatComposer `/call`.
   - User speaks prompt: *"Give me a long detailed explanation of quantum computing."*.
   - Agent begins long speaking response.
   - After 3 seconds of agent speaking, user interrupts by speaking: *"Wait, summarize it in one sentence instead."*.
   - System instantly stops TTS audio playback, cancels server stream, transitions to `listening`.
   - Agent processes the interruption and speaks the one-sentence summary.
   - User confirms: *"Thank you, good bye."* and ends call.

3. `T4.3` — **Mute Toggling & Privacy Workflow**:
   - Active voice call session in progress.
   - User clicks "Mute" button.
   - Status updates to `muted`, mic visualizer goes completely flat.
   - User speaks while muted; no STT transcription occurs, no prompt dispatched.
   - User clicks "Unmute".
   - Status updates back to `listening`, mic visualizer reacts to voice.
   - User speaks: *"Now I am back, what is the weather?"*.
   - Agent receives prompt and responds.

4. `T4.4` — **Audio Device Tuning & Real-Time Parameter Adjustment**:
   - Active voice call session.
   - User adjusts mic gain slider from 1.0 to 1.8 (amplified) and speaker volume from 1.0 to 0.5.
   - AudioEngine applies gain changes to active AudioContext nodes.
   - Waveform visualizer reflects amplified input amplitude.
   - Agent speaks response at reduced volume.
   - Call completes without distortion or audio graph errors.

5. `T4.5` — **Rapid Consecutive Speech Turns & Fast Dialogue**:
   - User asks quick question 1: *"Current time?"* -> Agent gives short answer.
   - User immediately asks question 2: *"List 3 prime numbers"* -> Agent answers.
   - User immediately asks question 3: *"What is 2+2?"* -> Agent answers.
   - All turns correctly sequenced, zero race conditions, transcript perfectly serialized.

6. `T4.6` — **Error Recovery, Disconnect & Transcript Persistence Workflow**:
   - Active voice call with several completed turns.
   - Simulated unexpected network socket glitch / drop.
   - Client displays connection warning badge and gracefully transitions to reconnection / teardown without freezing UI.
   - Call ends cleanly; partial transcript from before the crash is safely saved to the main chat session with timestamped markers.

---

## Acceptance Criteria for `TEST_READY.md`
- [ ] Test harness and opaque-box mocks implemented under `tests/e2e/voice/`.
- [ ] Tier 1 tests (60 test cases) implemented and passing.
- [ ] Tier 2 tests (60 test cases) implemented and passing.
- [ ] Tier 3 tests (12 test cases) implemented and passing.
- [ ] Tier 4 tests (6 test cases) implemented and passing.
- [ ] Total >=138 test cases executed with 100% pass rate.
- [ ] `npm run test` / `npx vitest run tests/e2e/voice/` exits with code 0.
- [ ] `TEST_READY.md` generated with full feature matrix and verification summary.

# Milestone 1: Test & Interruption Specification Report

## Features Discovered
| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Protocol | `voiceCallStatusSchema` | Zod enum defining 7 canonical voice call states: `idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `ended` | String value | Validated `VoiceCallStatus` | ZodError on unlisted string | `PROJECT.md` §1, `SCOPE.md` §1 |
| 2 | Protocol | `voiceCallEndReasonSchema` | Zod enum defining 5 termination causes: `user_hangup`, `agent_hangup`, `timeout`, `error`, `connection_lost` | String value | Validated `VoiceCallEndReason` | ZodError on unlisted string | `SCOPE.md` §1 |
| 3 | Protocol | `voiceInterruptReasonSchema` | Zod enum defining 3 interruption triggers: `user_speech_detected`, `user_manual_button`, `session_closed` | String value | Validated `VoiceInterruptReason` | ZodError on unlisted string | `PROJECT.md` §1, `SCOPE.md` §1 |
| 4 | Protocol | `voiceTimbreSchema` & `voiceProfileSchema` | Zod schemas for TTS voice settings (`voiceId`, `name`, `rate`, `pitch`, `timbre`, `language`) with bounds (rate: 0.5–2.0, pitch: 0.5–2.0) | `VoiceProfile` object | Parsed `VoiceProfile` with default values | ZodError on out-of-bounds rate/pitch or empty string | `PROJECT.md` §1, `SCOPE.md` §1 |
| 5 | Protocol | `voiceParticipantSchema` | Zod schema defining call participant info (`userId`, optional `agentId`, `agentName`) | `VoiceParticipant` object | Validated `VoiceParticipant` | ZodError on empty `userId`/`agentName` | `SCOPE.md` §1 |
| 6 | Protocol | `voiceCallSessionSchema` | Complete session state schema (`sessionId` UUID, `status`, `startedAt`, `endedAt`, `durationSeconds`, `isMuted`, `inputGain` 0.0–2.0, `outputVolume` 0.0–1.0, `voiceProfile`, `participant`, `currentTurnId`, `totalTurns`, `endReason`) | Session record object | Validated `VoiceCallSession` | ZodError on negative duration, out-of-range gain/volume, invalid UUID | `PROJECT.md` §1, `SCOPE.md` §1 |
| 7 | Protocol | `voiceTranscriptFrameSchema` | Wire schema for STT/TTS transcript chunks (`sessionId`, `turnId`, `speaker` user/agent, `kind` interim/final, `text`, `confidence`, `isFinal`, `timestamp`, `durationMs`, `waveformBins`) | Transcript payload | Validated `VoiceTranscriptFrame` | ZodError on invalid enum or missing required fields | `PROJECT.md` §1, `SCOPE.md` §1 |
| 8 | Protocol | `voiceTtsChunkSchema` | Wire schema for streamed TTS audio/text tokens (`sessionId`, `turnId`, `chunkIndex`, `textChunk`, `audioBase64`, `mimeType`, `isLastChunk`, `timestamp`, `durationMs`, `waveformBins`) | TTS chunk payload | Validated `VoiceTtsChunk` | ZodError on negative `chunkIndex` or missing fields | `PROJECT.md` §1, `SCOPE.md` §1 |
| 9 | Protocol | `voiceTurnSyncSchema` | Wire schema for conversation turn lifecycle tracking (`sessionId`, `turnId`, `state`, `prompt`, `response`, `tokensUsed`, `latencyMs`, `timestamp`) | Turn sync payload | Validated `VoiceTurnSync` | ZodError on invalid turn state | `SCOPE.md` §1 |
| 10 | Protocol | `voiceInterruptFrameSchema` | Wire schema for barge-in event records (`sessionId`, `turnId`, `reason`, `interruptedAtMs`, `spokenTextSnippet`, `timestamp`) | Interrupt payload | Validated `VoiceInterruptFrame` | ZodError on negative `interruptedAtMs` | `PROJECT.md` §1, `SCOPE.md` §1 |
| 11 | Protocol | Client RPC Schemas (`voice.session.*`, `voice.transcript.submit`, `voice.interrupt`, `voice.audio.chunk`) | Discriminated union of incoming client WebSocket RPC messages with required `requestId` and session identifiers | Client RPC JSON payload | Validated client message object | ZodError on schema violation / 4400 socket close | `PROJECT.md` §1, `SCOPE.md` §1, `apps/agent-host/src/protocol.ts` |
| 12 | Protocol | Host Event Schemas (`voice.session.ready`, `voice.session.state`, `voice.transcript.event`, `voice.tts.chunk`, `voice.turn.event`, `voice.interrupted`) | Discriminated union of outgoing host WebSocket event frames with `at` ISO timestamp | Host event object | Validated host message object | ZodError on invalid payload | `PROJECT.md` §1, `SCOPE.md` §1, `apps/agent-host/src/protocol.ts` |
| 13 | Protocol Helper | `isValidVoiceStateTransition()` | Pure transition validator function encoding the 7-state finite state machine matrix | `(current: VoiceCallStatus, next: VoiceCallStatus)` | `boolean` (true if allowed, false if disallowed) | Returns `false` for invalid transitions or reflexive self-transitions | `PROJECT.md` §1, `SCOPE.md` §1 |
| 14 | Protocol Helper | `createVoiceCallSession()` | Pure factory function creating a initialized `VoiceCallSession` with default values and UUID | `(params?: Partial<VoiceCallSession>)` | `VoiceCallSession` | Throws ZodError if invalid override params provided | `PROJECT.md` §1, `SCOPE.md` §1 |
| 15 | Protocol Helper | `isVoiceSessionActive()` & `isVoiceSessionTerminal()` | Pure utility predicates evaluating whether session is ongoing vs finished | `(status: VoiceCallStatus)` | `boolean` | Returns `false` for non-matching states | `SCOPE.md` §1, codebase helper pattern |
| 16 | Agent Host | `VoiceSessionManager.startSession` | Server-side session initialization, stores session in memory, transitions `idle` -> `connecting` -> `listening`, emits `voice.session.ready` and `voice.session.state` | `VoiceSessionStartParams` | `VoiceCallSession` | Throws error or sends error frame if start fails | `PROJECT.md` §1, `apps/agent-host/src/session.ts` |
| 17 | Agent Host | `VoiceSessionManager.pauseSession` & `resumeSession` | Pauses audio processing and transitions session state to `idle` (pause) or back to `listening` (resume) | `sessionId: string` | `void` (emits `voice.session.state`) | Emits `error` (code `voice_session_not_found`) if session missing | `PROJECT.md` §1, `SCOPE.md` §2 |
| 18 | Agent Host | `VoiceSessionManager.endSession` | Terminates session, computes total duration, sets `status: "ended"` and `endReason`, aborts active runs, cleans up resources | `(sessionId: string, reason?: VoiceCallEndReason)` | `void` (emits `voice.session.state`) | Emits `error` if session missing | `PROJECT.md` §1, `SCOPE.md` §2 |
| 19 | Agent Host | `VoiceSessionManager.setMute` | Toggles microphone mute state, updates `isMuted`, transitions status between `listening` and `muted` | `(sessionId: string, muted: boolean)` | `void` (emits `voice.session.state`) | Emits `error` if session missing | `PROJECT.md` §1, `SCOPE.md` §2 |
| 20 | Agent Host | `VoiceSessionManager.submitTranscript` | Handles interim/final STT transcripts. Final transcripts trigger prompt processing, status transition to `thinking`, and streaming TTS chunks | `VoiceTranscriptSubmitParams` | `Promise<void>` (emits transcript, state, tts chunks, turn events) | Emits `error` if session missing or in terminal state | `PROJECT.md` §1, `SCOPE.md` §2 |
| 21 | Agent Host | `VoiceSessionManager.interrupt` (Barge-In Engine) | Cancels active LLM token generation / TTS audio streaming via `AbortController`, emits `voice.interrupted` frame, syncs turn state to `interrupted`, and transitions state back to `listening` | `VoiceInterruptParams` | `void` (emits `voice.interrupted`, `voice.turn.event`, `voice.session.state`) | Graceful no-op if session already listening/idle; error if session missing | `PROJECT.md` §1, `SCOPE.md` §2 |
| 22 | Agent Host | WebSocket Dispatcher Integration (`apps/agent-host/src/session.ts`) | Extension of Fastify WebSocket message loop to route `voice.*` client frames to `VoiceSessionManager` and broadcast host events | Incoming client WebSocket frame | Route to voice manager method | Closes socket on schema violation with 4400 | `apps/agent-host/src/session.ts` |

---

## Edge Cases
| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | `isValidVoiceStateTransition` | Same state to same state (reflexive, e.g. `listening` -> `listening`) | Returns `false` (state machine requires state change) |
| 2 | `isValidVoiceStateTransition` | `ended` -> any state (`listening`, `idle`, etc.) | Returns `false` (`ended` is strictly terminal) |
| 3 | `isValidVoiceStateTransition` | `idle` -> `speaking` or `thinking` | Returns `false` (must progress through `connecting` -> `listening`) |
| 4 | `isValidVoiceStateTransition` | `connecting` -> `ended` | Returns `true` (valid early abort/hangup during connection phase) |
| 5 | `isValidVoiceStateTransition` | `thinking` -> `listening` | Returns `true` (valid response with empty action OR interruption during thinking) |
| 6 | `isValidVoiceStateTransition` | `speaking` -> `listening` | Returns `true` (valid completion of TTS speech OR barge-in interruption) |
| 7 | `isValidVoiceStateTransition` | `muted` -> `thinking` or `speaking` | Returns `true` (agent may think and speak while user mic is muted) |
| 8 | `voiceProfileSchema` | Negative `rate` (e.g. `-1.0`) or rate exceeding `2.0` (e.g. `5.0`) | Fails Zod validation with bounds error (`0.5 <= rate <= 2.0`) |
| 9 | `voiceProfileSchema` | Empty string `voiceId` or `name` (`""`) | Fails Zod validation (`min(1)`) |
| 10 | `voiceCallSessionSchema` | `inputGain` out of range (e.g. `-0.5` or `3.5`) | Fails Zod validation (`0.0 <= inputGain <= 2.0`) |
| 11 | `voiceCallSessionSchema` | `outputVolume` out of range (e.g. `-0.1` or `1.5`) | Fails Zod validation (`0.0 <= outputVolume <= 1.0`) |
| 12 | `voiceCallSessionSchema` | Non-UUID string `sessionId` | Fails Zod validation with UUID format requirement |
| 13 | `createVoiceCallSession` | Empty call `createVoiceCallSession()` with no params | Returns valid session with generated UUID, status `"idle"`, default gain `1.0`, volume `1.0`, `isMuted: false`, default profile |
| 14 | `createVoiceCallSession` | Custom params with partial voice profile | Merges partial profile with default values while maintaining schema validity |
| 15 | `decodeClientMessage` | Corrupted JSON payload `"{ type: 'voice.session.start'"` | Returns `{ ok: false, error: "invalid_json" }`, socket closes with 4400 |
| 16 | `decodeClientMessage` | Unknown message type `"{ type: 'voice.invalid.action' }"` | Returns `{ ok: false, error: "schema_violation" }`, socket closes with 4400 |
| 17 | `VoiceSessionManager.interrupt` | Interruption received when state is `listening` or `idle` | Safe no-op; does not emit error or change state; logs debug info |
| 18 | `VoiceSessionManager.interrupt` | Interruption received when state is `thinking` | Aborts pending LLM stream, emits `voice.interrupted`, transitions to `listening`, emits `voice.session.state` (`listening`) |
| 19 | `VoiceSessionManager.interrupt` | Interruption received when state is `speaking` | Cancels remaining TTS chunks, emits `voice.interrupted`, transitions to `listening`, emits `voice.session.state` (`listening`) |
| 20 | `VoiceSessionManager.interrupt` | Unknown `sessionId` provided | Emits error frame `{ type: "error", code: "voice_session_not_found" }` without throwing unhandled exception |
| 21 | `VoiceSessionManager.submitTranscript` | Submitting transcript to an `ended` session | Rejects submission, emits error frame indicating session is closed |
| 22 | `VoiceSessionManager.submitTranscript` | Submitting interim transcript (`isFinal: false`) | Broadcasts `voice.transcript.event` (`kind: "interim"`), remains in `listening` state |
| 23 | `VoiceSessionManager.submitTranscript` | Submitting final transcript (`isFinal: true`) | Broadcasts `voice.transcript.event` (`kind: "final"`), updates `totalTurns`, transitions to `thinking` |
| 24 | `VoiceSessionManager.setMute` | Toggling mute while in `thinking` or `speaking` | Updates `isMuted` flag; preserves current thinking/speaking status until turn completes or interrupts |
| 25 | `VoiceSessionManager.setMute` | Toggling mute while in `listening` | Updates `isMuted = true` and transitions status to `muted`; unmuting transitions back to `listening` |
| 26 | `VoiceSessionManager.endSession` | Ending session while agent is `speaking` | Aborts active audio generation, marks `endedAt`, computes `durationSeconds`, transitions to `ended` with `reason` |
| 27 | `VoiceSessionManager.dispose` | Socket abrupt disconnect or server shutdown | Disposes all active sessions, triggers abort signals on active runs, releases resources |

---

## 1. Observation
1. **Repository Layout and Tooling**:
   - `packages/protocol`: Configured with Vitest (`packages/protocol/vitest.config.ts`), TypeScript (`packages/protocol/tsconfig.json`). Test files are located in `src/*.test.ts` or `test/*.test.ts` (vitest glob is `src/**/*.test.ts` or project root).
   - `apps/agent-host`: Configured with Vitest (`apps/agent-host/vitest.config.ts`) with alias `@protocol -> packages/protocol/src`.
   - Root `package.json` specifies testing scripts:
     - `npm run test:protocol`: `vitest run --config packages/protocol/vitest.config.ts` (line 12).
     - `npm run test:host`: `vitest run --config apps/agent-host/vitest.config.ts` (line 13).
     - `npm run typecheck:protocol`: `tsc -p packages/protocol/tsconfig.json` (line 14).
     - `npm run typecheck:host`: `tsc -p apps/agent-host/tsconfig.json` (line 15).
2. **Protocol Design Pattern**:
   - Protocol packages use pure TypeScript and Zod (`packages/protocol/src/tasks.ts`, `packages/protocol/src/subagents.ts`, `packages/protocol/src/memory.ts`, `packages/protocol/src/plan.ts`). Zero Node runtime dependencies.
   - Schemas export both Zod schema objects (`*Schema`) and inferred TypeScript types (`type * = z.infer<typeof *Schema>`).
   - Pure state transition helpers and factories are exported alongside schemas (e.g. `createTaskSummary`, `isTaskTerminal`).
3. **Agent Host Architecture & Message Dispatching**:
   - `apps/agent-host/src/protocol.ts` defines `clientMessageSchema` (discriminated union on `type`) and `hostMessageSchema` (discriminated union on `type`).
   - `decodeClientMessage` parses raw WebSocket frames, returning `{ ok: true, message }` or `{ ok: false, error: "invalid_json" | "schema_violation" }`.
   - `apps/agent-host/src/session.ts` attaches WebSocket listeners, validates incoming messages, and routes them to subsystem managers (e.g. `subagentSupervisor`, `daemonManager`, `memoryEngine`).
   - Subsystem managers expose event subscription mechanisms (`subscribe(listener)` or `EventEmitter`) to send typed event frames back across the WebSocket connection.

---

## 2. Logic Chain
1. **Requirements Tracing**:
   - `ORIGINAL_REQUEST.md` §R1 & §R5 require interactive voice call protocol, session lifecycle management (start, mute, interrupt, end), and 100% automated test coverage.
   - `PROJECT.md` and `SCOPE.md` define Milestone 1 scope: `packages/protocol/src/voice.ts`, `packages/protocol/test/voice.test.ts`, `apps/agent-host/src/voice/voiceManager.ts`, `apps/agent-host/src/protocol.ts`, `apps/agent-host/src/session.ts`, and `apps/agent-host/test/voice/voiceManager.test.ts`.
2. **Protocol Schema Requirements**:
   - Need comprehensive schemas for all status states, end reasons, interrupt reasons, timbres, entities (`VoiceProfile`, `VoiceParticipant`, `VoiceCallSession`, `VoiceTranscriptFrame`, `VoiceTtsChunk`, `VoiceTurnSync`, `VoiceInterruptFrame`), client RPCs, and host events.
   - Schemas must enforce strict bounds: rate/pitch (0.5–2.0), inputGain (0.0–2.0), outputVolume (0.0–1.0), non-empty strings, positive integers, and UUID formats.
3. **Finite State Machine & State Transition Matrix**:
   - 7 canonical statuses: `idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `ended`.
   - Valid transitions:
     - `idle` -> `connecting`, `idle` -> `ended`
     - `connecting` -> `listening`, `connecting` -> `muted`, `connecting` -> `ended`
     - `listening` -> `thinking`, `listening` -> `muted`, `listening` -> `ended`
     - `thinking` -> `speaking`, `thinking` -> `listening` (on interrupt or text-only turn), `thinking` -> `muted`, `thinking` -> `ended`
     - `speaking` -> `listening` (turn done or barge-in interrupt), `speaking` -> `thinking` (subsequent turn/tool call), `speaking` -> `muted`, `speaking` -> `ended`
     - `muted` -> `listening` (unmute), `muted` -> `thinking`, `muted` -> `speaking`, `muted` -> `ended`
     - `ended` -> none (terminal)
   - Self-transitions (`s -> s`) are invalid in strict state transitions.
4. **Barge-In Interruption Dynamics**:
   - User speech or manual interrupt during `thinking` or `speaking` must immediately trigger `AbortController.abort()` to halt downstream token generation / audio chunks.
   - The host must broadcast a `voice.interrupted` frame and immediately transition session status back to `listening`.
   - The turn sync frame must record `state: "interrupted"`.
5. **Agent Host Voice Manager Architecture**:
   - `VoiceSessionManager` maintains an in-memory registry of sessions (`Map<string, VoiceCallSession>`), active abort controllers (`Map<string, AbortController>`), and active streams.
   - Exposes public methods: `startSession`, `pauseSession`, `resumeSession`, `endSession`, `setMute`, `submitTranscript`, `interrupt`, `handleClientMessage`, `dispose`.
   - Emits events via a listener/callback interface attached during WebSocket session attachment in `apps/agent-host/src/session.ts`.

---

## 3. Caveats
- No audio hardware or real Web Audio / Web Speech APIs are needed or available in Node/agent-host environments. All tests for Milestone 1 must use pure mock fixtures, simulated payloads, and deterministic event listeners.
- WebSocket tests in `apps/agent-host` should either use `createHost()` with loopback WebSocket client (as in `server.test.ts`) or direct unit testing of `VoiceSessionManager` and `attachAgentSession` message dispatching.

---

## 4. Conclusion
Milestone 1 test suites must cover two primary test targets:
1. `packages/protocol/test/voice.test.ts` (or `packages/protocol/src/voice.test.ts`):
   - Comprehensive unit and schema validation test suite testing all Zod schemas, boundary checks, state machine transitions (complete 7x7 matrix), session factories, and client/host frame serialization.
2. `apps/agent-host/test/voice/voiceManager.test.ts`:
   - Comprehensive unit and integration test suite testing session lifecycle, message routing, barge-in interruption engine with AbortController, turn synchronization, and adversarial/error edge cases.

---

## 5. Verification Method
1. Protocol Verification:
   - Command: `npm run test:protocol`
   - Command: `npm run typecheck:protocol`
2. Agent Host Verification:
   - Command: `npm run test:host`
   - Command: `npm run typecheck:host`
3. Full Workspace Verification:
   - Command: `npm test`
   - Command: `npm run build`

---

# Comprehensive Test Specification

## Part 1: `packages/protocol/test/voice.test.ts` Test Suite Plan

### Suite 1: Enums and Primitive Schemas
1. **`voiceCallStatusSchema`**:
   - `it("accepts all 7 canonical states")`: ["idle", "connecting", "listening", "thinking", "speaking", "muted", "ended"]
   - `it("rejects unknown statuses")`: "paused", "recording", "stopped", "", 123
2. **`voiceCallEndReasonSchema`**:
   - `it("accepts all 5 end reasons")`: ["user_hangup", "agent_hangup", "timeout", "error", "connection_lost"]
   - `it("rejects invalid end reasons")`: "aborted", "cancelled", ""
3. **`voiceInterruptReasonSchema`**:
   - `it("accepts all 3 interrupt reasons")`: ["user_speech_detected", "user_manual_button", "session_closed"]
   - `it("rejects invalid interrupt reasons")`: "random", "silence"
4. **`voiceTimbreSchema` & `voiceTranscriptKindSchema`**:
   - `it("accepts valid timbres")`: ["neutral", "warm", "crisp", "expressive"]
   - `it("accepts valid transcript kinds")`: ["interim", "final"]

### Suite 2: Entity Schemas & Validation Bounds
1. **`voiceProfileSchema`**:
   - `it("validates full voice profile with valid fields")`: `{ voiceId: "v1", name: "Alloy", rate: 1.2, pitch: 1.0, timbre: "warm", language: "en-US" }`
   - `it("applies defaults for optional rate, pitch, timbre, language")`: `{ voiceId: "v1", name: "Alloy" }` -> defaults `rate: 1.0`, `pitch: 1.0`, `timbre: "neutral"`, `language: "en-US"`
   - `it("rejects rate < 0.5 or rate > 2.0")`
   - `it("rejects pitch < 0.5 or pitch > 2.0")`
   - `it("rejects empty voiceId or name")`
2. **`voiceParticipantSchema`**:
   - `it("validates participant with userId and agentName")`
   - `it("accepts optional agentId")`
   - `it("rejects empty userId or agentName")`
3. **`voiceCallSessionSchema`**:
   - `it("validates complete session record")`: `{ sessionId: UUID, status: "listening", startedAt: ISO, durationSeconds: 42, isMuted: false, inputGain: 1.2, outputVolume: 0.8, voiceProfile, participant, totalTurns: 3 }`
   - `it("rejects invalid UUID sessionId")`
   - `it("rejects negative durationSeconds or totalTurns")`
   - `it("rejects inputGain < 0.0 or > 2.0")`
   - `it("rejects outputVolume < 0.0 or > 1.0")`
4. **`voiceTranscriptFrameSchema`**:
   - `it("validates interim transcript frame")`: `{ sessionId: UUID, turnId: "turn-1", speaker: "user", kind: "interim", text: "Hello", isFinal: false, timestamp: ISO }`
   - `it("validates final transcript frame with confidence and waveformBins")`: `{ sessionId: UUID, turnId: "turn-1", speaker: "user", kind: "final", text: "Hello world", confidence: 0.95, isFinal: true, timestamp: ISO, waveformBins: [10, 20, 30] }`
   - `it("rejects confidence < 0 or > 1")`
5. **`voiceTtsChunkSchema`**:
   - `it("validates intermediate TTS chunk with audioBase64 and mimeType")`
   - `it("validates final TTS chunk with isLastChunk: true")`
   - `it("rejects negative chunkIndex")`
6. **`voiceTurnSyncSchema`**:
   - `it("validates turn sync across states (started, transcribing, thinking, synthesizing, speaking, completed, interrupted, failed)")`
   - `it("validates prompt, optional response, tokensUsed, latencyMs")`
7. **`voiceInterruptFrameSchema`**:
   - `it("validates interrupt frame with interruptedAtMs and spokenTextSnippet")`
   - `it("rejects negative interruptedAtMs")`

### Suite 3: State Machine Transition Helper (`isValidVoiceStateTransition`)
1. **Valid Transitions (Full Coverage)**:
   - `idle` -> `connecting`, `idle` -> `ended`
   - `connecting` -> `listening`, `connecting` -> `muted`, `connecting` -> `ended`
   - `listening` -> `thinking`, `listening` -> `muted`, `listening` -> `ended`
   - `thinking` -> `speaking`, `thinking` -> `listening`, `thinking` -> `muted`, `thinking` -> `ended`
   - `speaking` -> `listening`, `speaking` -> `thinking`, `speaking` -> `muted`, `speaking` -> `ended`
   - `muted` -> `listening`, `muted` -> `thinking`, `muted` -> `speaking`, `muted` -> `ended`
2. **Invalid Transitions (Full Coverage)**:
   - `ended` -> `idle`, `ended` -> `connecting`, `ended` -> `listening`, `ended` -> `thinking`, `ended` -> `speaking`, `ended` -> `muted`, `ended` -> `ended`
   - `idle` -> `listening`, `idle` -> `thinking`, `idle` -> `speaking`, `idle` -> `muted`
   - `connecting` -> `thinking`, `connecting` -> `speaking`
   - `listening` -> `connecting`, `listening` -> `idle`, `listening` -> `speaking`
3. **Reflexive Self-Transitions**:
   - All `s -> s` for every state in `[idle, connecting, listening, thinking, speaking, muted, ended]` return `false`.
4. **Helper Predicates**:
   - `isVoiceSessionActive("listening" | "thinking" | "speaking" | "muted" | "connecting") === true`
   - `isVoiceSessionActive("idle" | "ended") === false`
   - `isVoiceSessionTerminal("ended") === true`
   - `isVoiceSessionTerminal("idle" | "listening" | "thinking" | "speaking" | "muted" | "connecting") === false`

### Suite 4: Factory Tests (`createVoiceCallSession`)
1. `it("creates default session with valid UUID, ISO timestamp, and idle status")`
2. `it("sets default inputGain: 1.0, outputVolume: 1.0, isMuted: false, totalTurns: 0")`
3. `it("accepts custom overrides for participant, voiceProfile, inputGain, outputVolume")`
4. `it("generates distinct UUIDs for consecutive factory invocations")`

### Suite 5: Frame Serialization & Deserialization (Wire RPCs & Events)
1. **Client Messages (Parsing & Validation)**:
   - `voice.session.start`: `{ type: "voice.session.start", requestId: "r1", voiceProfile: { ... }, inputGain: 1.0, outputVolume: 1.0 }`
   - `voice.session.pause`: `{ type: "voice.session.pause", requestId: "r2", sessionId: UUID }`
   - `voice.session.resume`: `{ type: "voice.session.resume", requestId: "r3", sessionId: UUID }`
   - `voice.session.end`: `{ type: "voice.session.end", requestId: "r4", sessionId: UUID, reason: "user_hangup" }`
   - `voice.session.mute`: `{ type: "voice.session.mute", requestId: "r5", sessionId: UUID, muted: true }`
   - `voice.transcript.submit`: `{ type: "voice.transcript.submit", requestId: "r6", sessionId: UUID, turnId: "t1", text: "Hello", isFinal: true }`
   - `voice.interrupt`: `{ type: "voice.interrupt", requestId: "r7", sessionId: UUID, turnId: "t1", reason: "user_speech_detected", spokenTextSnippet: "Stop" }`
   - `voice.audio.chunk`: `{ type: "voice.audio.chunk", requestId: "r8", sessionId: UUID, turnId: "t1", data: "base64...", format: "pcm16" }`
2. **Host Messages (Parsing & Validation)**:
   - `voice.session.ready`: `{ type: "voice.session.ready", requestId: "r1", session: { ... }, at: ISO }`
   - `voice.session.state`: `{ type: "voice.session.state", sessionId: UUID, status: "listening", at: ISO, detail: "connected" }`
   - `voice.transcript.event`: `{ type: "voice.transcript.event", frame: { ... }, at: ISO }`
   - `voice.tts.chunk`: `{ type: "voice.tts.chunk", chunk: { ... }, at: ISO }`
   - `voice.turn.event`: `{ type: "voice.turn.event", turn: { ... }, at: ISO }`
   - `voice.interrupted`: `{ type: "voice.interrupted", frame: { ... }, at: ISO }`
3. **Roundtrip JSON Encoding**:
   - `it("serializes and deserializes all frames to/from JSON without data loss")`

---

## Part 2: `apps/agent-host/test/voice/voiceManager.test.ts` Test Suite Plan

### Suite 1: Session Lifecycle Management
1. **`startSession`**:
   - `it("creates a new session and returns VoiceCallSession with generated sessionId")`
   - `it("transitions status to connecting -> listening and emits voice.session.ready and voice.session.state")`
   - `it("registers session in internal store accessible by getSession(sessionId)")`
   - `it("respects custom initial gain, volume, and voiceProfile parameters")`
2. **`pauseSession` & `resumeSession`**:
   - `it("pauseSession updates status to idle and broadcasts voice.session.state")`
   - `it("resumeSession updates status to listening and broadcasts voice.session.state")`
   - `it("throws/emits error when pausing or resuming an unknown sessionId")`
3. **`setMute`**:
   - `it("mutes an active listening session: sets isMuted: true and status: 'muted'")`
   - `it("unmutes a muted session: sets isMuted: false and status: 'listening'")`
   - `it("toggles mute during thinking/speaking: sets isMuted flag without overriding active speaking state")`
4. **`endSession`**:
   - `it("ends session cleanly: updates status to 'ended', sets endedAt, calculates durationSeconds")`
   - `it("records custom endReason (e.g. 'agent_hangup', 'timeout') with default 'user_hangup'")`
   - `it("aborts active turn processing when session is ended during thinking or speaking")`
   - `it("broadcasts voice.session.state with status 'ended'")`

### Suite 2: Transcript Submission & Turn Processing
1. **Interim Transcripts**:
   - `it("handles isFinal: false transcript: emits voice.transcript.event without changing listening status")`
2. **Final Transcripts & Turn Initiation**:
   - `it("handles isFinal: true transcript: increments totalTurns, updates currentTurnId, emits voice.transcript.event")`
   - `it("transitions status to 'thinking', broadcasts voice.session.state ('thinking'), and emits turn start event")`
3. **Response & TTS Chunk Streaming**:
   - `it("transitions status to 'speaking' when first TTS chunk is emitted")`
   - `it("streams sequential TTS chunks (chunkIndex 0, 1, 2... with isLastChunk: true on final chunk)")`
   - `it("emits voice.turn.event with state: 'completed' and transitions status back to 'listening'")`

### Suite 3: Barge-In Interruption Engine
1. **Interruption during `thinking`**:
   - `it("aborts active model generation AbortSignal when voice.interrupt is received during thinking")`
   - `it("broadcasts voice.interrupted frame with reason, turnId, and spokenTextSnippet")`
   - `it("emits voice.turn.event with state: 'interrupted'")`
   - `it("resets session state to 'listening' and broadcasts voice.session.state ('listening')")`
2. **Interruption during `speaking`**:
   - `it("cancels active TTS streaming pipeline immediately when voice.interrupt is received during speaking")`
   - `it("stops emission of subsequent TTS chunks for the interrupted turn")`
   - `it("broadcasts voice.interrupted frame and resets state to 'listening'")`
3. **Interruption in `listening` or `idle` state**:
   - `it("safely ignores voice.interrupt when session is already listening or idle (no-op)")`
4. **Different Interruption Reasons**:
   - `it("supports reason: 'user_speech_detected' (VAD auto-interrupt)")`
   - `it("supports reason: 'user_manual_button' (manual interrupt button)")`

### Suite 4: WebSocket Client Message Handling & Error Cases
1. **Client Message Routing (`handleClientMessage`)**:
   - `it("routes voice.session.start to startSession")`
   - `it("routes voice.session.pause to pauseSession")`
   - `it("routes voice.session.resume to resumeSession")`
   - `it("routes voice.session.end to endSession")`
   - `it("routes voice.session.mute to setMute")`
   - `it("routes voice.transcript.submit to submitTranscript")`
   - `it("routes voice.interrupt to interrupt")`
2. **Adversarial & Error Handling**:
   - `it("returns error frame on unknown sessionId for any voice RPC")`
   - `it("rejects transcript submission to an already ended session")`
   - `it("handles dispose() on socket disconnect by terminating active sessions and cleaning up listeners")`

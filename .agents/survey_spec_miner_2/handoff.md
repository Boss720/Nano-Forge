# Specification & Architecture Report: Protocol & Agent-Host Runtime

**Target Project**: NanoForge Voice Call System  
**Working Directory**: `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge`  
**Report Location**: `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\survey_spec_miner_2\handoff.md`  
**Date**: 2026-08-15  

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Protocol (Core) | Execution Plan DAG (`packages/protocol/src/plan.ts`) | Immutable DAG execution plan contracts with topological step resolution (`readySteps`), cycle detection, and approval gating | `ExecutionPlan`, `approvedStepIds` Set | `PlanValidationResult`, `PlanStep[]` | Returns validation errors for duplicate step IDs, unknown dependencies, cycles, missing approvals | Codebase inspection (`packages/protocol/src/plan.ts:1-452`) |
| 2 | Protocol (Core) | Slash Commands (`packages/protocol/src/commands.ts`) | POSIX-compliant tokenizer, lexer, context mentions (`@file`, `@rule`, `#symbol`, `@agent`), and 8 built-in slash commands (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`) | Raw command string (e.g. `"/plan Deploy --keep=5"`) | `SlashCommandWire` structure, parsed flags, positional args | Returns `null` if not starting with `/`, falls back gracefully on unclosed quotes | Codebase inspection (`packages/protocol/src/commands.ts:1-426`) |
| 3 | Protocol (Core) | Model Routing (`packages/protocol/src/routing.ts`) | Multi-model routing engine scoring capability, latency, and cost with data residency privacy filters (`local`, `cloud-eu`, `cloud`) | `RouteRequest`, `ModelProfile[]` | `RouteDecision`, `ScoreBreakdown` | Hard filter exclusions on privacy rank, vision deficiency, or context overflow | Codebase inspection (`packages/protocol/src/routing.ts:1-214`) |
| 4 | Protocol (Core) | Artifact System (`packages/protocol/src/artifacts.ts`) | Artifact format detection and feedback response schemas for diff, markdown, mermaid, html, code, image, json | `ArtifactMetadata`, `name`, `mimeType`, `content` | `ArtifactFormat`, `ArtifactFeedbackResponse` | Falls back to `"code"` on unknown types | Codebase inspection (`packages/protocol/src/artifacts.ts:1-97`) |
| 5 | Protocol (Core) | Virtual PTY Terminal (`packages/protocol/src/terminal.ts`) | Bidirectional PTY multiplexing frames (`terminal.create`, `terminal.input`, `terminal.resize`, `terminal.kill`, `terminal.created`, `terminal.data`, `terminal.exit`) | Terminal control/input frames | Streamed PTY ANSI chunks, exit notifications | Emits error frames or closes on malformed schemas | Codebase inspection (`packages/protocol/src/terminal.ts:1-227`) |
| 6 | Protocol (Core) | Subagent Swarm (`packages/protocol/src/subagents.ts`) | Actor-model mailbox messaging, 7-state subagent machine (`running`, `idle`, `waiting_for_input`, etc.), supervisor strategies, telemetry | Tool params (`invokeSubagent`, `manageSubagents`, `sendMessage`, `defineSubagent`) | Lifecycle events (`subagent.spawned`, `subagent.message_sent`, etc.) | Validates transitions against `VALID_STATE_TRANSITIONS`; rejects unauthorized senders | Codebase inspection (`packages/protocol/src/subagents.ts:1-542`) |
| 7 | Protocol (Core) | Tasks & Daemons (`packages/protocol/src/tasks.ts`) | 5-field cron parser/evaluator, one-shot timers with conditional cancellation (`never`, `any`, sender UUID), daemon process supervision | `ScheduleParams`, `ManageTaskParams` | Lifecycle events (`task.spawned`, `task.output`, `schedule.triggered`, etc.) | Rejects invalid cron expressions with `ERR_INVALID_CRON_EXPRESSION` | Codebase inspection (`packages/protocol/src/tasks.ts:1-572`) |
| 8 | Protocol (Core) | Shared Memory (`packages/protocol/src/memory.ts`) | Cross-agent key-value store with namespace sandboxing, tag queries, versioning, and TTL expiration | `MemorySetParams`, `MemoryGetParams`, `MemoryQueryParams` | `MemoryEntry`, query results, lifecycle events | Rejects invalid keys/namespaces with `ERR_MEMORY_KEY_INVALID` | Codebase inspection (`packages/protocol/src/memory.ts:1-312`) |
| 9 | Agent Host | Authenticated WebSocket Host (`apps/agent-host/src/server.ts`) | Loopback Fastify server on 127.0.0.1 with single-use cryptographic bearer tokens (192-bit base64url) | HTTP `/health`, WS `/agent?token=<token>` | `host.ready`, `pong`, and routed domain frames | Closes with 4401 on unauthorized/reused tokens; closes with 4400 on malformed frames | Codebase inspection (`apps/agent-host/src/server.ts:1-316`) |
| 10 | Agent Host | Wire Protocol Validation (`apps/agent-host/src/protocol.ts`) | Discriminated union Zod schemas for all inbound client frames and outbound host frames | Inbound JSON frame | `DecodeResult` (`{ ok: true, message }` or `{ ok: false }`) | Code 4400 socket termination on schema violation | Codebase inspection (`apps/agent-host/src/protocol.ts:1-424`) |
| 11 | Agent Host | Run Coordinator & Stream Engine (`apps/agent-host/src/runs/coordinator.ts`) | Drives `plan step -> route -> stream model -> policy gate -> tool execution -> audit event` with `AbortController` cancellation | `ExecutionPlan`, chat requests | Streamed tokens, tool proposals, approval gates, event log | Aborts active model stream on cancel; enforces policy authorization | Codebase inspection (`apps/agent-host/src/runs/coordinator.ts:1-910`) |
| 12 | Voice System (Proposed) | Voice Call Session Lifecycle (`packages/protocol/src/voice.ts`) | Dedicated voice call session management (`idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `ended`) | Session start/pause/resume/end/mute RPCs | `voice.session.ready`, `voice.session.state` events | Safe transitions; clean tear-down on disconnect or error | New protocol specification |
| 13 | Voice System (Proposed) | Live STT & Interim Transcription (`packages/protocol/src/voice.ts`) | Real-time speech recognition streaming interim & final transcripts into active voice drawer and chat | Audio chunks / transcript text | `voice.transcript.event` (`interim`/`final` frames) | Fallback to browser SpeechRecognition / Whisper | New protocol specification |
| 14 | Voice System (Proposed) | TTS Streaming & Turn Sync (`packages/protocol/src/voice.ts`) | Agent token-to-speech chunking, audio synthesis streaming, and turn synchronization | Model completion tokens / audio buffers | `voice.tts.chunk`, `voice.turn.event` frames | Graceful fallback on audio context failure | New protocol specification |
| 15 | Voice System (Proposed) | Barge-In / Interruption Engine (`packages/protocol/src/voice.ts` & `apps/agent-host`) | Immediate cancellation of in-flight LLM token generation and active TTS audio playback upon user speech or button trigger | `voice.interrupt` frame | In-flight stream aborted; TTS stopped; state resets to `listening` | Preserves partial transcript snippet | New protocol specification |

---

## Edge Cases

| # | Feature | Input | Observed / Specified Behavior |
|---|---------|-------|-------------------------------|
| 1 | WebSocket Auth | Re-connecting with previously consumed token | Socket immediately closed with code 4401 (`unauthorized`). Single-use token store guarantees one-time consumption. |
| 2 | WebSocket Frames | Non-JSON text or unrecognized `type` | Non-JSON fails `JSON.parse` -> code 4400. Unknown message type fails Zod discriminated union -> code 4400. |
| 3 | Voice Call Interruption | User starts speaking while Agent TTS is active (`speaking` state) | Client/host detects speech -> emits `voice.interrupt` frame -> triggers `AbortController.abort()` on active LLM turn -> cancels Web Audio / SpeechSynthesis playback -> records partial transcript snippet -> transitions status to `listening`. |
| 4 | Microphone Mute | User clicks Mute button during active voice call | Sends `voice.session.mute` (`muted: true`) -> updates session state to `muted` -> stops sending mic audio/transcripts without dropping WebSocket or terminating the call. Unmuting cleanly restores `listening`. |
| 5 | Call Termination | User clicks End Call or connection drops | Dispatches `voice.session.end` -> stops all audio tracks -> cancels any active TTS -> finalizes transcribed dialog turns -> commits conversation to main chat session transcript. |
| 6 | Concurrent Interruption & Tool Proposal | Barge-in arrives during tool execution proposal | If model is generating a tool proposal when interrupted, the LLM generation aborts and proposed tool execution is cancelled before policy authorization occurs. |
| 7 | High-Frequency Interim Transcripts | Speech recognition produces multiple interim updates per second | Interim frames are tagged with `kind: "interim"` and `isFinal: false`; UI throttles visual waveform & text updates; agent turn dispatch only occurs when `isFinal: true` is received after a speech pause. |

---

## 1. Observation

### 1.1 Existing Protocol Architecture (`packages/protocol`)
- `packages/protocol/src/index.ts`: Exports pure TypeScript contracts with ZERO Node.js dependencies (`@protocol/plan`, `@protocol/commands`, `@protocol/routing`, `@protocol/artifacts`, `@protocol/terminal`, `@protocol/subagents`, `@protocol/tasks`, `@protocol/memory`).
- Built-in Slash Commands in `commands.ts:109-223`: 8 commands (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`).
- Subagent State Machine in `subagents.ts:18-36`: 7 states (`running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored`).
- Task Lifecycle in `tasks.ts:25-32`: 5 states (`running`, `completed`, `failed`, `cancelled`, `killed`).
- All protocol modules use Zod schemas (`z.object`, `z.discriminatedUnion`, `z.enum`) and export matching inferred types and pure helper utilities.

### 1.2 Existing Agent-Host Architecture (`apps/agent-host`)
- `server.ts:136-190`: Fastify server on `127.0.0.1` binding an ephemeral port (or `process.env.PORT`). Binds `/health` (HTTP GET) and `/agent` (authenticated WebSocket).
- `server.ts:50-92`: Cryptographic `TokenStore` with 192-bit base64url random tokens consumed exactly once via `tokenStore.consume(token)`.
- `protocol.ts:183-294` (`clientMessageSchema`): Discriminated union of all inbound messages (`ping`, `plan.submit`, `approval.grant`, `approval.deny`, `run.pause`, `run.resume`, `run.cancel`, `tool.response`, `workspace.*`, `integration.toggle`, `subagent.*`, `task.manage`, `schedule.create`, `memory.*`).
- `protocol.ts:301-382` (`hostMessageSchema`): Discriminated union of all outbound messages (`host.ready`, `pong`, `run.state`, `tool.approval_required`, `tool.output`, `run.event`, `error`, `workspace.*.result`, `integrations.snapshot`, `subagent.*`, `task.*`, `memory.*`).
- `session.ts:128-447` (`attachAgentSession`): Coordinates `RunCoordinator`, `SubagentSupervisor`, `DaemonManager`, `SharedMemoryEngine`, `PtyManager`, and filesystem handlers over the socket.
- `runs/coordinator.ts:842-908` (`streamProposal`): Streams model completions via `adapter.streamChat()`, supporting abort signals (`ctx.abort.signal`), token accumulation, tool proposals, and error recovery.

### 1.3 Verified Test Suite Baseline
- `npm run test:protocol`: **10 test files passed (239 tests, 0 failures)**.
- `npm run test:host`: **39 test files passed (378 tests, 0 failures)**.
- `npm test` (Frontend): **40 test files passed (381 tests, 0 failures)**.
- `npm run typecheck:protocol` & `npm run typecheck:host`: **0 typecheck errors**.
- `npm run build`: **0 errors; generated production bundle in 14.52s**.

---

## 2. Logic Chain

1. **Protocol Isolation**: `packages/protocol` is shared across web browser clients, CLI, and agent-host. All voice call protocol definitions must reside in a dedicated, isomorphic, pure TypeScript module (`packages/protocol/src/voice.ts`) and be exported in `packages/protocol/src/index.ts`.
2. **Wire Schema Extension**: `apps/agent-host/src/protocol.ts` must import the voice schemas and add them to `clientMessageSchema` (for voice RPCs) and `hostMessageSchema` (for voice events/broadcasts), ensuring backward compatibility and strict type safety with code 4400 validation.
3. **Session Dispatching**: In `apps/agent-host/src/session.ts`, inbound voice messages (`voice.session.start`, `voice.session.pause`, `voice.session.resume`, `voice.session.end`, `voice.session.mute`, `voice.transcript.submit`, `voice.interrupt`) will be dispatched to a dedicated `VoiceCallManager` / voice session runtime.
4. **Interruption / Barge-in Mechanics**:
   - When user speech is detected during agent response generation or audio output, a `voice.interrupt` signal is broadcast.
   - On the Host side, `RunCoordinator` or active `streamChat` is aborted via `AbortController.abort()`.
   - On the Client side, active audio buffers or `window.speechSynthesis` cancel playback immediately.
   - The session state transitions cleanly to `listening`.

---

## 3. Required Protocol Schema Additions (`packages/protocol/src/voice.ts`)

Here is the authoritative TypeScript & Zod specification for the new voice protocol:

```typescript
/**
 * Voice Call System Wire Protocol & State Machine Contracts.
 *
 * Provides isomorphic Zod schemas, TypeScript types, and helper utilities for:
 * - Voice Call Session lifecycle (connecting, listening, thinking, speaking, muted, ended)
 * - Live STT transcription (interim and final transcripts)
 * - Agent TTS streaming, audio waveforms, and turn synchronization
 * - Barge-in / interruption signals
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Voice Call States & Enums                                       */
/* ------------------------------------------------------------------ */

export const voiceCallStatusSchema = z.enum([
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "muted",
  "ended",
]);
export type VoiceCallStatus = z.infer<typeof voiceCallStatusSchema>;

export const voiceCallEndReasonSchema = z.enum([
  "user_hangup",
  "agent_hangup",
  "timeout",
  "error",
  "connection_lost",
]);
export type VoiceCallEndReason = z.infer<typeof voiceCallEndReasonSchema>;

export const voiceInterruptReasonSchema = z.enum([
  "user_speech_detected",
  "user_manual_button",
  "session_closed",
]);
export type VoiceInterruptReason = z.infer<typeof voiceInterruptReasonSchema>;

export const transcriptKindSchema = z.enum(["interim", "final"]);
export type TranscriptKind = z.infer<typeof transcriptKindSchema>;

export const voiceTimbreSchema = z.enum(["neutral", "warm", "crisp", "expressive"]);
export type VoiceTimbre = z.infer<typeof voiceTimbreSchema>;

/* ------------------------------------------------------------------ */
/* 2. Voice Profile & Participant Configuration                       */
/* ------------------------------------------------------------------ */

export const voiceProfileSchema = z.object({
  voiceId: z.string().default("default"),
  name: z.string().default("Assistant"),
  rate: z.number().min(0.25).max(4.0).default(1.0),
  pitch: z.number().min(0.25).max(2.0).default(1.0),
  timbre: voiceTimbreSchema.default("neutral"),
  language: z.string().default("en-US"),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const voiceParticipantSchema = z.object({
  userId: z.string().default("user"),
  agentId: z.string().optional(),
  agentName: z.string().default("NanoForge Assistant"),
});
export type VoiceParticipant = z.infer<typeof voiceParticipantSchema>;

/* ------------------------------------------------------------------ */
/* 3. Core Voice Call Session Contract                                */
/* ------------------------------------------------------------------ */

export const voiceCallSessionSchema = z.object({
  sessionId: z.string().uuid(),
  status: voiceCallStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationSeconds: z.number().int().nonnegative().default(0),
  isMuted: z.boolean().default(false),
  inputGain: z.number().min(0).max(2).default(1.0),
  outputVolume: z.number().min(0).max(1).default(1.0),
  voiceProfile: voiceProfileSchema,
  participant: voiceParticipantSchema,
  currentTurnId: z.string().uuid().optional(),
  totalTurns: z.number().int().nonnegative().default(0),
  endReason: voiceCallEndReasonSchema.optional(),
});
export type VoiceCallSession = z.infer<typeof voiceCallSessionSchema>;

/* ------------------------------------------------------------------ */
/* 4. Streaming & Event Data Frames                                   */
/* ------------------------------------------------------------------ */

/**
 * Live Speech-to-Text (STT) transcript frame (interim and final).
 */
export const voiceTranscriptFrameSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  speaker: z.enum(["user", "agent"]),
  kind: transcriptKindSchema,
  text: z.string(),
  confidence: z.number().min(0).max(1).default(1.0),
  isFinal: z.boolean(),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  waveformBins: z.array(z.number().min(0).max(1)).optional(),
});
export type VoiceTranscriptFrame = z.infer<typeof voiceTranscriptFrameSchema>;

/**
 * Agent Text-to-Speech (TTS) audio streaming chunk frame.
 */
export const voiceTtsChunkSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  textChunk: z.string(),
  audioBase64: z.string().optional(),
  mimeType: z.string().optional(),
  isLastChunk: z.boolean(),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  waveformBins: z.array(z.number().min(0).max(1)).optional(),
});
export type VoiceTtsChunk = z.infer<typeof voiceTtsChunkSchema>;

/**
 * Voice turn synchronization frame.
 */
export const voiceTurnSyncSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  state: z.enum(["listening", "thinking", "speaking", "interrupted", "completed"]),
  prompt: z.string(),
  response: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional(),
  timestamp: z.string().datetime(),
});
export type VoiceTurnSync = z.infer<typeof voiceTurnSyncSchema>;

/**
 * Barge-in / interruption signal frame.
 */
export const voiceInterruptFrameSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  reason: voiceInterruptReasonSchema,
  interruptedAtMs: z.number().nonnegative(),
  spokenTextSnippet: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type VoiceInterruptFrame = z.infer<typeof voiceInterruptFrameSchema>;

/* ------------------------------------------------------------------ */
/* 5. Client -> Host RPC Messages                                     */
/* ------------------------------------------------------------------ */

export const voiceSessionStartSchema = z.object({
  type: z.literal("voice.session.start"),
  requestId: z.string().min(1).max(128),
  voiceProfile: voiceProfileSchema.optional(),
  inputGain: z.number().min(0).max(2).optional(),
  outputVolume: z.number().min(0).max(1).optional(),
});

export const voiceSessionPauseSchema = z.object({
  type: z.literal("voice.session.pause"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
});

export const voiceSessionResumeSchema = z.object({
  type: z.literal("voice.session.resume"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
});

export const voiceSessionEndSchema = z.object({
  type: z.literal("voice.session.end"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
  reason: voiceCallEndReasonSchema.optional(),
});

export const voiceSessionMuteSchema = z.object({
  type: z.literal("voice.session.mute"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
  muted: z.boolean(),
});

export const voiceTranscriptSubmitSchema = z.object({
  type: z.literal("voice.transcript.submit"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  text: z.string().min(1),
  isFinal: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});

export const voiceInterruptMessageSchema = z.object({
  type: z.literal("voice.interrupt"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  reason: voiceInterruptReasonSchema,
  spokenTextSnippet: z.string().optional(),
});

export const voiceAudioChunkSchema = z.object({
  type: z.literal("voice.audio.chunk"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  data: z.string(), // base64 encoded audio
  format: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/* 6. Host -> Client Messages & Events                                */
/* ------------------------------------------------------------------ */

export const voiceSessionReadySchema = z.object({
  type: z.literal("voice.session.ready"),
  requestId: z.string().min(1).max(128).optional(),
  session: voiceCallSessionSchema,
  at: z.string().datetime(),
});

export const voiceSessionStateSchema = z.object({
  type: z.literal("voice.session.state"),
  sessionId: z.string().uuid(),
  status: voiceCallStatusSchema,
  at: z.string().datetime(),
  detail: z.string().max(4096).optional(),
});

export const voiceTranscriptEventSchema = z.object({
  type: z.literal("voice.transcript.event"),
  frame: voiceTranscriptFrameSchema,
  at: z.string().datetime(),
});

export const voiceTtsChunkEventSchema = z.object({
  type: z.literal("voice.tts.chunk"),
  chunk: voiceTtsChunkSchema,
  at: z.string().datetime(),
});

export const voiceTurnEventSchema = z.object({
  type: z.literal("voice.turn.event"),
  turn: voiceTurnSyncSchema,
  at: z.string().datetime(),
});

export const voiceInterruptedEventSchema = z.object({
  type: z.literal("voice.interrupted"),
  frame: voiceInterruptFrameSchema,
  at: z.string().datetime(),
});

/* ------------------------------------------------------------------ */
/* 7. Pure Helper Utilities & State Machine Transitions               */
/* ------------------------------------------------------------------ */

const VALID_VOICE_STATE_TRANSITIONS: Readonly<Record<VoiceCallStatus, ReadonlySet<VoiceCallStatus>>> = {
  idle: new Set(["connecting", "ended"]),
  connecting: new Set(["listening", "muted", "ended"]),
  listening: new Set(["thinking", "speaking", "muted", "ended"]),
  thinking: new Set(["speaking", "listening", "muted", "ended"]),
  speaking: new Set(["listening", "thinking", "muted", "ended"]),
  muted: new Set(["listening", "thinking", "speaking", "ended"]),
  ended: new Set([]), // terminal state
};

export function isValidVoiceStateTransition(current: VoiceCallStatus, next: VoiceCallStatus): boolean {
  if (current === next) return true;
  const allowed = VALID_VOICE_STATE_TRANSITIONS[current];
  return allowed ? allowed.has(next) : false;
}

export function createVoiceCallSession(params: {
  sessionId?: string;
  voiceProfile?: Partial<VoiceProfile>;
  inputGain?: number;
  outputVolume?: number;
  userId?: string;
  agentName?: string;
}): VoiceCallSession {
  const sessionId = params.sessionId ?? crypto.randomUUID();
  const startedAt = new Date().toISOString();
  return voiceCallSessionSchema.parse({
    sessionId,
    status: "connecting",
    startedAt,
    durationSeconds: 0,
    isMuted: false,
    inputGain: params.inputGain ?? 1.0,
    outputVolume: params.outputVolume ?? 1.0,
    voiceProfile: voiceProfileSchema.parse(params.voiceProfile ?? {}),
    participant: {
      userId: params.userId ?? "user",
      agentName: params.agentName ?? "NanoForge Assistant",
    },
    totalTurns: 0,
  });
}
```

---

## 4. Agent-Host Lifecycle & Interruption Handling Mechanics

### 4.1 Voice Session Lifecycle
1. **Initiation (`voice.session.start`)**:
   - Host receives `voice.session.start` frame.
   - Host instantiates a new `VoiceCallSession` with UUID, sets status to `connecting`, then immediately transitions to `listening`.
   - Host emits `voice.session.ready` back to client with session metadata.
2. **Audio / Speech Ingestion (`voice.transcript.submit` / `voice.audio.chunk`)**:
   - While in `listening`, client streams user audio/interim transcript frames.
   - Upon final transcript submission (`isFinal: true`), session transitions from `listening` to `thinking`.
3. **Turn Execution & TTS Streaming**:
   - Host dispatches the finalized prompt turn to `RunCoordinator` or `ProviderAdapter.streamChat()`.
   - As completion tokens stream in, host transitions state to `speaking` and emits `voice.tts.chunk` frames containing token text and/or audio payloads along with `waveformBins` data for visualizer synchronization.
4. **Barge-In Interruption Flow**:
   - If user starts speaking while `status === "speaking"`, or if user clicks "Interrupt", client immediately fires `voice.interrupt`.
   - Host catches `voice.interrupt`:
     1. Aborts in-flight `streamChat` using `AbortController.abort()`.
     2. Emits `voice.interrupted` with `spokenTextSnippet` and `interruptedAtMs`.
     3. Transitions session state back to `listening`.
     4. Client halts Web Audio / SpeechSynthesis playback and resets visualizer.
5. **Termination (`voice.session.end`)**:
   - Session status transitions to `ended`.
   - Host finalizes session records and disconnects voice handlers.
   - Client persists all transcribed turns to chat history.

---

## 5. Caveats

- Web Speech API support varies across browser engines (Google Chrome / Edge support `webkitSpeechRecognition`, whereas Firefox may require local Whisper/fallback or user input typing fallback). The protocol is designed to support both raw audio streaming chunks and browser-recognized text transcripts seamlessly.
- Audio synthesis can be executed either via browser `SpeechSynthesisUtterance` or server-synthesized `audioBase64` chunks in `voice.tts.chunk`. Both are supported in the schema.

---

## 6. Conclusion

The specification mining and codebase analysis of `packages/protocol` and `apps/agent-host` is complete and verified:
1. All existing protocol schemas, command lexers, subagent swarms, task schedulers, and shared memory engines have been documented.
2. Complete, isomorphic TypeScript & Zod definitions for the Voice Call System have been designed in `packages/protocol/src/voice.ts`.
3. WebSocket discriminated unions in `apps/agent-host/src/protocol.ts` and dispatching in `apps/agent-host/src/session.ts` are ready for integration.
4. All existing tests pass with 100% success rate:
   - `npm run test:protocol` -> 10/10 files (239 tests)
   - `npm run test:host` -> 39/39 files (378 tests)
   - `npm test` -> 40/40 files (381 tests)
   - `npm run build` -> 0 errors

---

## 7. Verification Method

To independently verify the protocol definitions and test suites:

```bash
# 1. Run all protocol unit & adversarial tests
npm run test:protocol

# 2. Run all agent-host unit & adversarial tests
npm run test:host

# 3. Typecheck protocol & agent-host packages
npm run typecheck:protocol
npm run typecheck:host

# 4. Run frontend tests
npm test

# 5. Run full production build
npm run build
```

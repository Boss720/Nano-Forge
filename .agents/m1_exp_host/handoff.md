# Handoff Report: Agent-Host Voice Integration Architecture (Milestone 1)

## Executive Summary
This report presents the architectural blueprint for integrating real-time voice call session management, WebSocket wire schema extensions, and barge-in LLM stream cancellation into `apps/agent-host`.

---

## 1. Observation

### 1.1 Existing Codebase Structure and Test Harness
1. **Agent Host Protocol Contracts (`apps/agent-host/src/protocol.ts`)**:
   - `clientMessageSchema` (lines 183–293) is a `z.discriminatedUnion("type", [...])` validating all inbound frames from the browser client over `ws://127.0.0.1:<port>/agent?token=<token>`.
   - `hostMessageSchema` (lines 301–382) is a `z.discriminatedUnion("type", [...])` defining all outbound frames sent to the browser client.
   - `decodeClientMessage(raw: unknown)` (lines 411–423) parses JSON and runs `clientMessageSchema.safeParse(parsed)`. In `session.ts` (line 303), any failed decode closes the WebSocket with status code `4400` ("invalid message").
   - Schemas are modularly imported from `@protocol/*` (configured via `tsconfig.json` path mapping `@protocol/* -> ../../packages/protocol/src/*`).

2. **Session Composition (`apps/agent-host/src/session.ts`)**:
   - `attachAgentSession(socket, context, options: AgentSessionOptions)` (lines 128–447) orchestrates:
     - `RunCoordinator` (lines 153–163)
     - `PtyManager` (lines 166–171)
     - `DaemonManager` (line 173)
     - `SubagentSupervisor` (lines 174–180)
     - `SharedMemoryEngine` (line 181)
   - `socket.on("message", async (data) => ...)` (lines 259–439) decodes frames and dispatches them to respective subsystem managers.
   - `socket.on("close", () => ...)` (lines 440–446) triggers cleanup (`approvalGate.close()`, `ptyManager.dispose()`, `daemonManager.dispose()`).

3. **Provider Adapters & Streaming Execution (`apps/agent-host/src/providers/types.ts` & `apps/agent-host/src/runs/coordinator.ts`)**:
   - `ProviderAdapter.streamChat(request: ChatRequest, signal?: AbortSignal)` (lines 66–70 of `providers/types.ts`) yields `ProviderDelta` stream items (`text`, `tool_proposal`, `usage`, `error`, `done`).
   - In `RunCoordinator.streamProposal` (lines 842–908 of `coordinator.ts`), cancellation uses `ctx.abort.signal`, causing stream iteration to abort immediately on user cancellation.

4. **Test Suite Status (`npm run test:host` & `npm run typecheck:host`)**:
   - `npm run test:host`: 39 test files, 378 tests passing (100% success rate, duration ~8.1s).
   - `npm run typecheck:host`: `tsc -p apps/agent-host/tsconfig.json` completes with 0 errors.

---

## 2. Logic Chain

### 2.1 Updating `apps/agent-host/src/protocol.ts`
To support voice calling without regressions:
1. Import voice schemas and types from `@protocol/voice` (or `@protocol`):
   ```ts
   import {
     voiceCallStatusSchema,
     voiceCallEndReasonSchema,
     voiceInterruptReasonSchema,
     voiceProfileSchema,
     voiceParticipantSchema,
     voiceCallSessionSchema,
     voiceTranscriptFrameSchema,
     voiceTtsChunkSchema,
     voiceTurnSyncSchema,
     voiceInterruptFrameSchema,
     type VoiceCallStatus,
     type VoiceCallEndReason,
     type VoiceInterruptReason,
     type VoiceProfile,
     type VoiceCallSession,
     type VoiceTranscriptFrame,
     type VoiceTtsChunk,
     type VoiceTurnSync,
     type VoiceInterruptFrame,
   } from "@protocol/voice";
   ```
2. Extend `clientMessageSchema` with discriminated voice client messages:
   - `voice.session.start`: `{ type: "voice.session.start", requestId: idSchema, voiceProfile?: voiceProfileSchema, inputGain?: z.number().min(0).max(2), outputVolume?: z.number().min(0).max(1) }`
   - `voice.session.pause`: `{ type: "voice.session.pause", requestId: idSchema, sessionId: idSchema }`
   - `voice.session.resume`: `{ type: "voice.session.resume", requestId: idSchema, sessionId: idSchema }`
   - `voice.session.end`: `{ type: "voice.session.end", requestId: idSchema, sessionId: idSchema, reason?: voiceCallEndReasonSchema }`
   - `voice.session.mute`: `{ type: "voice.session.mute", requestId: idSchema, sessionId: idSchema, muted: z.boolean() }`
   - `voice.transcript.submit`: `{ type: "voice.transcript.submit", requestId: idSchema, sessionId: idSchema, turnId: idSchema, text: z.string().max(32768), isFinal: z.boolean(), confidence?: z.number().min(0).max(1), waveformBins?: z.array(z.number()).optional() }`
   - `voice.interrupt`: `{ type: "voice.interrupt", requestId: idSchema, sessionId: idSchema, turnId: idSchema.optional(), reason: voiceInterruptReasonSchema, spokenTextSnippet?: z.string().max(4096).optional() }`
   - `voice.audio.chunk`: `{ type: "voice.audio.chunk", requestId: idSchema, sessionId: idSchema, turnId: idSchema.optional(), data: z.string(), format?: z.string().optional() }`
3. Extend `hostMessageSchema` with discriminated voice host messages:
   - `voice.session.ready`: `{ type: "voice.session.ready", requestId: idSchema.optional(), session: voiceCallSessionSchema, at: atSchema }`
   - `voice.session.state`: `{ type: "voice.session.state", sessionId: idSchema, status: voiceCallStatusSchema, at: atSchema, detail?: z.string().max(4096).optional() }`
   - `voice.transcript.event`: `{ type: "voice.transcript.event", frame: voiceTranscriptFrameSchema, at: atSchema }`
   - `voice.tts.chunk`: `{ type: "voice.tts.chunk", chunk: voiceTtsChunkSchema, at: atSchema }`
   - `voice.turn.event`: `{ type: "voice.turn.event", turn: voiceTurnSyncSchema, at: atSchema }`
   - `voice.interrupted`: `{ type: "voice.interrupted", frame: voiceInterruptFrameSchema, at: atSchema }`

### 2.2 Designing `apps/agent-host/src/voice/voiceManager.ts`
The `VoiceSessionManager` class manages the state machine, turns, transcript streaming, and audio playback chunking on the host:

```ts
export interface VoiceSessionManagerOptions {
  workspaceRoot?: string;
  coordinator?: RunCoordinator;
  providerRegistry?: ProviderRegistry;
  profiles?: readonly ModelProfile[];
  send: (message: HostMessage) => void;
  clock?: () => Date;
  generateId?: () => string;
}

export class VoiceSessionManager {
  private readonly sessions = new Map<string, VoiceCallSession>();
  private activeSessionId?: string;
  private activeTurnAbort?: AbortController;
  private activeTurnId?: string;
  private readonly send: (message: HostMessage) => void;
  private readonly clock: () => Date;

  constructor(private readonly options: VoiceSessionManagerOptions) {
    this.send = options.send;
    this.clock = options.clock ?? (() => new Date());
  }

  // 1. Session Lifecycle
  startSession(params: { requestId?: string; voiceProfile?: VoiceProfile; inputGain?: number; outputVolume?: number }): VoiceCallSession;
  pauseSession(sessionId: string): void;
  resumeSession(sessionId: string): void;
  endSession(sessionId: string, reason?: VoiceCallEndReason): void;
  setMute(sessionId: string, muted: boolean): void;

  // 2. Transcript & Turn Ingestion
  submitTranscript(params: {
    requestId: string;
    sessionId: string;
    turnId: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
    waveformBins?: number[];
  }): Promise<void>;

  // 3. Barge-In Interruption
  interrupt(params: {
    requestId: string;
    sessionId: string;
    turnId?: string;
    reason: VoiceInterruptReason;
    spokenTextSnippet?: string;
  }): void;

  // 4. WebSocket Message Dispatcher
  handleClientMessage(msg: ClientMessage): Promise<void>;

  // 5. Query and Cleanup
  getSession(sessionId: string): VoiceCallSession | undefined;
  getActiveSession(): VoiceCallSession | undefined;
  listSessions(): VoiceCallSession[];
  dispose(): void;
}
```

### 2.3 Dispatching Inbound Messages in `apps/agent-host/src/session.ts`
1. Update `AgentSessionOptions` to accept an optional `voiceManager?: VoiceSessionManager`.
2. Instantiate `VoiceSessionManager` in `attachAgentSession`:
   ```ts
   const voiceManager =
     options.voiceManager ??
     new VoiceSessionManager({
       workspaceRoot,
       coordinator,
       providerRegistry: registry,
       profiles,
       send: (msg) => send(msg),
     });
   ```
3. In `socket.on("message", ...)`:
   ```ts
   if (message.type.startsWith("voice.")) {
     void voiceManager.handleClientMessage(message);
     return;
   }
   ```
4. In `socket.on("close", ...)`:
   ```ts
   voiceManager.dispose();
   ```

### 2.4 Barge-In Interruption Coordination Flow
The coordination flow between browser client, agent-host, LLM generation, and speech synthesis:
```
[Client Web Audio / Mic / UI]               [Fastify WebSocket / Session]              [VoiceSessionManager / LLM Stream]
              │                                           │                                             │
 (1) User begins speaking                         │                                             │
     OR clicks Interrupt                          │                                             │
              │                                           │                                             │
 (2) cancel() local TTS                           │                                             │
     send("voice.interrupt") ────────────────────►│                                             │
                                                  │                                             │
                                                  │ (3) Forward to VoiceSessionManager          │
                                                  │────────────────────────────────────────────►│
                                                                                                │ (4) activeTurnAbort.abort()
                                                                                                │     LLM generator breaks immediately
                                                                                                │     Session state -> "listening"
                                                  │◄────────────────────────────────────────────┤
                                                  │ (5) Send "voice.interrupted" & "voice.session.state"
              │◄──────────────────────────────────│
 (6) UI updates to "listening"
     Ready for next utterance turn
```

---

## 3. Caveats
1. **Model Adapter Selection**: In testing environments, `VoiceSessionManager` should use scripted/mock provider adapters (similar to `scriptedAdapter` in `coordinator.test.ts`) so tests run deterministically without external API dependencies.
2. **Audio Chunk Format**: While primary voice communication uses text-streamed TTS tokens (`voice.tts.chunk`) for browser-native Web Speech synthesis, `voice.audio.chunk` is supported in the wire schema for binary audio streaming fallbacks.
3. **Multi-turn History**: `VoiceSessionManager` tracks conversation turn history for the duration of the call session, allowing conversational context preservation between turns.

---

## 4. Conclusion
1. `apps/agent-host` is fully prepared to host the voice subsystem.
2. Extending `protocol.ts` with discriminated voice unions guarantees type safety and strict schema validation across the WebSocket connection.
3. `VoiceSessionManager` cleanly encapsulates voice session state, turn lifecycle, streaming TTS generation, and instantaneous barge-in interruption via `AbortController`.
4. Integrating `VoiceSessionManager` into `session.ts` follows established patterns used by `PtyManager` and `DaemonManager`.

---

## 5. Verification Method

### 5.1 Unit and Integration Test Plan
1. **Voice Manager Unit Suite (`apps/agent-host/test/voice/voiceManager.test.ts` or `src/voice/voiceManager.test.ts`)**:
   - Verify session creation, default profile assignment, and `voice.session.ready` emission.
   - Verify state transitions: `connecting` -> `listening` -> `thinking` -> `speaking` -> `listening`.
   - Verify mute and unmute transitions.
   - Verify interim transcript submission forwards transcript events without starting agent thinking.
   - Verify final transcript submission transitions to `thinking`, streams model response as TTS chunks, and returns to `listening`.
   - Verify barge-in interruption halts active streaming LLM generator, emits `voice.interrupted`, and reverts state to `listening`.
   - Verify session termination sets `endedAt` and status `ended`.
   - Verify `dispose()` cancels running turns and frees resources.

2. **WebSocket Integration Suite (`apps/agent-host/src/server.test.ts` or voice WebSocket tests)**:
   - Connect authenticated WebSocket client.
   - Send `voice.session.start` -> assert `voice.session.ready` and `voice.session.state` (`listening`).
   - Send `voice.transcript.submit` (final) -> assert `voice.session.state` (`thinking`), `voice.tts.chunk` frames, and turn sync.
   - Send `voice.interrupt` during thinking/speaking -> assert `voice.interrupted` frame and state transition to `listening`.
   - Send malformed voice frame -> assert socket closed with code `4400`.

### 5.2 Verification Commands
- Run agent-host tests: `npm run test:host`
- Run agent-host typecheck: `npm run typecheck:host`
- Run protocol tests: `npm run test:protocol`
- Run protocol typecheck: `npm run typecheck:protocol`

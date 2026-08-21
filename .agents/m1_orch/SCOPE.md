# Scope: Milestone 1 — Protocol & Agent-Host Voice Integration

## Architecture
Milestone 1 establishes the bedrock wire protocol and server-side voice session orchestration for NanoForge's Interactive Voice Call System.

```
+---------------------------------------------------------------------------------+
|                        packages/protocol (Pure TS / Zod)                        |
|                                                                                 |
|  - VoiceCallStatus ("idle" | "connecting" | "listening" | "thinking" | ...)     |
|  - VoiceCallSession, VoiceProfile, VoiceParticipant, VoiceTranscriptFrame       |
|  - VoiceTtsChunk, VoiceTurnSync, VoiceInterruptFrame                            |
|  - Client RPC Schemas (voice.session.*, voice.transcript.submit, voice.interrupt) |
|  - Host Event Schemas (voice.session.ready, voice.session.state, voice.tts.*)   |
|  - Helpers: isValidVoiceStateTransition(), createVoiceCallSession()             |
+---------------------------------------------------------------------------------+
                                         ▲
                                         │ Imported into Wire Schemas
                                         ▼
+---------------------------------------------------------------------------------+
|                                apps/agent-host                                  |
|                                                                                 |
|  [src/protocol.ts]                                                              |
|   └── clientMessageSchema & hostMessageSchema extended with voice schemas       |
|                                                                                 |
|  [src/voice/voiceManager.ts]                                                    |
|   └── VoiceSessionManager class                                                 |
|        ├── Session lifecycle: start, pause, resume, end, mute                    |
|        ├── STT transcript submission -> RunCoordinator / Stream generation      |
|        ├── Barge-in engine: abort in-flight stream on voice.interrupt            |
|        └── Frame dispatch and event emitting over WebSocket                     |
|                                                                                 |
|  [src/session.ts]                                                               |
|   └── Fastify WebSocket session message dispatcher integration                  |
+---------------------------------------------------------------------------------+
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Voice Call Protocol & State Machine | Pure TypeScript & Zod schemas for voice sessions, audio frames, transcripts, turns, and interrupt events in `packages/protocol` | M1 | ORIGINAL_REQUEST §R1, R5 |
| F2 | Agent-Host Voice Session Manager | Server-side voice session lifecycle, WebSocket frame validation, and event routing in `apps/agent-host` | M1 | ORIGINAL_REQUEST §R1, R5 |
| F3 | Barge-In Interruption Signal Engine | Cancellation of in-flight LLM token generation and audio streaming upon user speech detection or interrupt button | M1 | ORIGINAL_REQUEST §R3, R5 |

## File Ownership & Code Layout
- `packages/protocol/src/voice.ts` — Voice wire schemas, types, state machine helper functions.
- `packages/protocol/src/index.ts` — Export voice module and all types.
- `packages/protocol/test/voice.test.ts` — Unit tests for voice schemas, serialization, and state machine transitions.
- `apps/agent-host/src/protocol.ts` — Wire protocol schema extensions with voice message unions.
- `apps/agent-host/src/voice/voiceManager.ts` — Voice call session manager for agent-host.
- `apps/agent-host/src/session.ts` — Fastify WebSocket session message dispatcher integration.
- `apps/agent-host/test/voice/voiceManager.test.ts` — Unit & integration tests for agent-host voice manager.

## Interface Contracts

### 1. Protocol Schemas (`packages/protocol/src/voice.ts`)
- **Status Enum**: `"idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended"`
- **End Reason Enum**: `"user_hangup" | "agent_hangup" | "timeout" | "error" | "connection_lost"`
- **Interrupt Reason Enum**: `"user_speech_detected" | "user_manual_button" | "session_closed"`
- **Transcript Kind Enum**: `"interim" | "final"`
- **Timbre Enum**: `"neutral" | "warm" | "crisp" | "expressive"`
- **Entities**:
  - `VoiceProfile`: `{ voiceId, name, rate, pitch, timbre, language }`
  - `VoiceParticipant`: `{ userId, agentId?, agentName }`
  - `VoiceCallSession`: `{ sessionId, status, startedAt, endedAt?, durationSeconds, isMuted, inputGain, outputVolume, voiceProfile, participant, currentTurnId?, totalTurns, endReason? }`
  - `VoiceTranscriptFrame`: `{ sessionId, turnId, speaker ("user"|"agent"), kind, text, confidence, isFinal, timestamp, durationMs?, waveformBins? }`
  - `VoiceTtsChunk`: `{ sessionId, turnId, chunkIndex, textChunk, audioBase64?, mimeType?, isLastChunk, timestamp, durationMs?, waveformBins? }`
  - `VoiceTurnSync`: `{ sessionId, turnId, state, prompt, response?, tokensUsed?, latencyMs?, timestamp }`
  - `VoiceInterruptFrame`: `{ sessionId, turnId, reason, interruptedAtMs, spokenTextSnippet?, timestamp }`
- **Client RPCs**:
  - `voice.session.start`: `{ type, requestId, voiceProfile?, inputGain?, outputVolume? }`
  - `voice.session.pause`: `{ type, requestId, sessionId }`
  - `voice.session.resume`: `{ type, requestId, sessionId }`
  - `voice.session.end`: `{ type, requestId, sessionId, reason? }`
  - `voice.session.mute`: `{ type, requestId, sessionId, muted }`
  - `voice.transcript.submit`: `{ type, requestId, sessionId, turnId, text, isFinal, confidence? }`
  - `voice.interrupt`: `{ type, requestId, sessionId, turnId, reason, spokenTextSnippet? }`
  - `voice.audio.chunk`: `{ type, requestId, sessionId, turnId, data, format? }`
- **Host Events**:
  - `voice.session.ready`: `{ type, requestId?, session, at }`
  - `voice.session.state`: `{ type, sessionId, status, at, detail? }`
  - `voice.transcript.event`: `{ type, frame, at }`
  - `voice.tts.chunk`: `{ type, chunk, at }`
  - `voice.turn.event`: `{ type, turn, at }`
  - `voice.interrupted`: `{ type, frame, at }`
- **Pure Helpers**:
  - `isValidVoiceStateTransition(current: VoiceCallStatus, next: VoiceCallStatus): boolean`
  - `createVoiceCallSession(params): VoiceCallSession`

### 2. Host Integration Contract (`apps/agent-host/src/voice/voiceManager.ts`)
- `VoiceSessionManager`:
  - `startSession(params: VoiceSessionStartParams): VoiceCallSession`
  - `pauseSession(sessionId: string): void`
  - `resumeSession(sessionId: string): void`
  - `endSession(sessionId: string, reason?: VoiceCallEndReason): void`
  - `setMute(sessionId: string, muted: boolean): void`
  - `submitTranscript(params: VoiceTranscriptSubmitParams): Promise<void>`
  - `interrupt(params: VoiceInterruptParams): void`
  - `handleClientMessage(msg: VoiceClientMessage): Promise<void>`
  - `dispose(): void`

## Verification & Acceptance Criteria
- `npm run test:protocol`: 100% passing tests including `voice.test.ts`.
- `npm run test:host`: 100% passing tests including `voiceManager.test.ts`.
- `npm run typecheck:protocol` & `npm run typecheck:host`: 0 errors.
- Clean integration with existing `packages/protocol` and `apps/agent-host` codebase without regressions.

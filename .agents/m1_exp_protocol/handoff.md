# Handoff Report: Voice Call Wire Protocol & Schemas (Milestone 1)

## 1. Observation

### 1.1 Existing Protocol Files & Monorepo Configuration
1. **`packages/protocol/src/index.ts`** (Lines 1–13):
   ```ts
   export * from "./plan";
   export * from "./commands";
   export * from "./routing";
   export * from "./artifacts";
   export * from "./terminal";
   export * from "./subagents";
   export * from "./tasks";
   export * from "./memory";
   ```
   *Observation*: `voice.ts` is currently missing from `packages/protocol/src/index.ts`.

2. **`packages/protocol/vitest.config.ts`** (Lines 1–10):
   ```ts
   import { defineConfig } from "vitest/config";

   export default defineConfig({
     root: __dirname,
     test: {
       environment: "node",
       include: ["src/**/*.test.ts"],
     },
   });
   ```
   *Observation*: Test runner includes all `src/**/*.test.ts` files inside `packages/protocol`. All existing test suites (`subagents.test.ts`, `tasks.test.ts`, `memory.test.ts`, `terminal.test.ts`, `plan.test.ts`, `commands.test.ts`) are located in `packages/protocol/src/`.

3. **`packages/protocol/tsconfig.json`** (Lines 1–15):
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "Bundler",
       "lib": ["ES2022"],
       "strict": true,
       "noEmit": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true,
       "types": ["node"]
     },
     "include": ["src"]
   }
   ```
   *Observation*: Typescript compilation target is `ES2022`, module resolution is `Bundler`, and `include` is `["src"]`.

4. **Baseline Test & Typecheck Execution**:
   - `npm run test:protocol` exited with code `0`: 10 passed test files (239 passed tests).
   - `npm run typecheck:protocol` (`tsc -p packages/protocol/tsconfig.json`) exited with code `0`.

5. **`packages/protocol/src/voice.ts`** (Initial draft):
   Contains basic schemas (`voiceCallStatusSchema`, `voiceCallSessionSchema`, `voiceTranscriptFrameSchema`, `voiceTtsChunkSchema`, etc.), but lacks:
   - Standard error codes (`VOICE_ERROR_CODES`, `VoiceErrorCode`)
   - Bounds and default constants (`DEFAULT_MIC_GAIN`, `DEFAULT_SPEAKER_VOLUME`, `MIN_MIC_GAIN`, `MAX_MIC_GAIN`, etc.)
   - Audio visual data schemas (`audioVisualDataSchema`)
   - Host error event schema (`voiceErrorEventSchema`)
   - Safe parse and message validation helpers (`parseVoiceClientMessage`, `safeParseVoiceClientMessage`, `parseVoiceHostEvent`, `safeParseVoiceHostEvent`, `isVoiceClientMessage`, `isVoiceHostEvent`)
   - Value clamping helpers (`clampGain`, `clampVolume`)
   - Entity factory helpers (`createVoiceProfile`, `createVoiceParticipant`, `createVoiceTranscriptFrame`, `createVoiceTtsChunk`, `createVoiceTurnSync`, `createVoiceInterruptFrame`)
   - State transition helpers and query predicates (`canTransitionVoiceState`, `isVoiceCallActive`, `isVoiceCallTerminal`, `canAcceptVoiceInput`, `canInterruptAgent`)

6. **Interface Requirements from `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `SCOPE.md`**:
   - Status Enums: `"idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended"`
   - End Reason Enums: `"user_hangup" | "agent_hangup" | "timeout" | "error" | "connection_lost"`
   - Interrupt Reason Enums: `"user_speech_detected" | "user_manual_button" | "session_closed"`
   - Transcript Kind: `"interim" | "final"`
   - Timbre Enum: `"neutral" | "warm" | "crisp" | "expressive"`
   - Speaker Enum: `"user" | "agent"`
   - Turn States: `"started" | "transcribing" | "thinking" | "speaking" | "completed" | "interrupted" | "error"`
   - Client Messages:
     - `voice.session.start`: `{ requestId, voiceProfile?, participant?, inputGain?, outputVolume? }`
     - `voice.session.pause`: `{ requestId, sessionId }`
     - `voice.session.resume`: `{ requestId, sessionId }`
     - `voice.session.end`: `{ requestId, sessionId, reason? }`
     - `voice.session.mute`: `{ requestId, sessionId, muted }`
     - `voice.session.gain`: `{ requestId, sessionId, inputGain?, outputVolume? }`
     - `voice.transcript.submit`: `{ requestId, sessionId, turnId, text, isFinal, confidence? }`
     - `voice.interrupt`: `{ requestId, sessionId, turnId, reason, spokenTextSnippet? }`
     - `voice.audio.chunk`: `{ requestId, sessionId, turnId, data, format? }`
   - Host Events:
     - `voice.session.ready`: `{ type: "voice.session.ready", requestId?, session, at }`
     - `voice.session.state`: `{ type: "voice.session.state", requestId?, sessionId, status, at, detail? }`
     - `voice.transcript.event`: `{ type: "voice.transcript.event", frame, at }`
     - `voice.tts.chunk`: `{ type: "voice.tts.chunk", chunk, at }`
     - `voice.turn.event`: `{ type: "voice.turn.event", turn, at }`
     - `voice.interrupted`: `{ type: "voice.interrupted", frame, at }`
     - `voice.error`: `{ type: "voice.error", requestId?, sessionId?, code, message, at }`

---

## 2. Logic Chain

1. **Pure Isomorphic Architecture Guarantee**:
   From Observation 1.3 and 1.5, `packages/protocol` is shared across the browser client (`src/`), desktop electron launcher, and Fastify server (`apps/agent-host/`). Therefore, `voice.ts` must NOT import any Node.js core modules (`node:fs`, `node:net`, `node:child_process`) or browser DOM APIs (`SpeechRecognition`, `AudioContext`, `MediaStream`). It must rely strictly on Zod and standard TypeScript constructs.

2. **Strict Wire Serialization & Deserialization**:
   From Observation 1.6, both `apps/agent-host/src/protocol.ts` and the frontend client (`useVoiceCall.ts`) exchange messages over WebSockets. Having discriminated unions (`voiceClientMessageSchema` with discriminator `"type"` and `voiceHostEventSchema` with discriminator `"type"`) ensures deterministic dispatch and automatic TypeScript type narrowing in switch statements.

3. **State Machine Completeness & Idempotency**:
   From Observation 1.6, voice calls transition between 7 states (`idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `ended`).
   - Self-transitions (`s -> s`) must always evaluate to `true` (idempotent state confirmation).
   - Barge-in interrupts must allow transitioning from `speaking` or `thinking` directly back to `listening` or `muted`.
   - Hardware mute toggles must allow entering `muted` from `connecting`, `listening`, `thinking`, or `speaking`, and resuming from `muted` back to `listening`, `thinking`, or `speaking`.
   - Call termination (`ended`) must be reachable from any state.
   - Returning to `idle` or re-initiating `connecting` must be valid from `ended`.

4. **Co-located Testing Pattern**:
   From Observation 1.2, all unit tests in `packages/protocol` reside in `packages/protocol/src/*.test.ts` to match `vitest.config.ts`. Creating `packages/protocol/src/voice.test.ts` will seamlessly integrate with `npm run test:protocol` and `npm test`.

---

## 3. Caveats

1. **Hardware / Device-Specific Types**:
   Audio binary buffers and hardware stream objects (`MediaStream`, `AudioContext`, `AnalyserNode`) belong strictly to the frontend engine (`src/services/audioEngine.ts`) and must NOT be imported into `packages/protocol/src/voice.ts`. The wire protocol represents audio chunks as base64-encoded strings (`audioBase64`) or numerical FFT bins (`waveformBins`).
2. **Clock Source**:
   Timestamp generation in helper functions uses `new Date().toISOString()`, which is universally supported in all JavaScript runtimes (Browser, Node, Deno, Bun).

---

## 4. Conclusion & Proposed Implementation

The following complete implementations are proposed for Milestone 1.

### 4.1 Proposed `packages/protocol/src/voice.ts`
```typescript
/**
 * Voice Call Wire Protocol, State Machine, & Validation Schemas.
 *
 * Provides isomorphic Zod schemas, TypeScript types, and pure helper utilities
 * for interactive voice call sessions, transcripts, TTS chunks, barge-in interrupts,
 * and WebSocket wire frames.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Status Enums & Identifiers                                      */
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

export const voiceTranscriptKindSchema = z.enum(["interim", "final"]);
export type VoiceTranscriptKind = z.infer<typeof voiceTranscriptKindSchema>;

export const voiceTimbreSchema = z.enum(["neutral", "warm", "crisp", "expressive"]);
export type VoiceTimbre = z.infer<typeof voiceTimbreSchema>;

export const voiceSpeakerSchema = z.enum(["user", "agent"]);
export type VoiceSpeaker = z.infer<typeof voiceSpeakerSchema>;

export const voiceTurnStateSchema = z.enum([
  "started",
  "transcribing",
  "thinking",
  "speaking",
  "completed",
  "interrupted",
  "error",
]);
export type VoiceTurnState = z.infer<typeof voiceTurnStateSchema>;

/* ------------------------------------------------------------------ */
/* 2. Constants & Protocol Error Codes                                */
/* ------------------------------------------------------------------ */

export const VOICE_ERROR_CODES = {
  ERR_VOICE_SESSION_NOT_FOUND: "ERR_VOICE_SESSION_NOT_FOUND",
  ERR_VOICE_INVALID_STATE_TRANSITION: "ERR_VOICE_INVALID_STATE_TRANSITION",
  ERR_VOICE_ALREADY_ACTIVE: "ERR_VOICE_ALREADY_ACTIVE",
  ERR_VOICE_ALREADY_MUTED: "ERR_VOICE_ALREADY_MUTED",
  ERR_VOICE_NOT_MUTED: "ERR_VOICE_NOT_MUTED",
  ERR_VOICE_INTERRUPT_FAILED: "ERR_VOICE_INTERRUPT_FAILED",
  ERR_VOICE_AUDIO_STREAM_ERROR: "ERR_VOICE_AUDIO_STREAM_ERROR",
  ERR_VOICE_SYNTHESIS_ERROR: "ERR_VOICE_SYNTHESIS_ERROR",
  ERR_VOICE_RECOGNITION_ERROR: "ERR_VOICE_RECOGNITION_ERROR",
  ERR_VOICE_DEVICE_PERMISSION_DENIED: "ERR_VOICE_DEVICE_PERMISSION_DENIED",
} as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];

export const DEFAULT_VOICE_RATE = 1.0;
export const DEFAULT_VOICE_PITCH = 1.0;
export const DEFAULT_VOICE_TIMBRE: VoiceTimbre = "neutral";
export const DEFAULT_VOICE_LANGUAGE = "en-US";
export const DEFAULT_MIC_GAIN = 1.0;
export const DEFAULT_SPEAKER_VOLUME = 1.0;
export const MIN_MIC_GAIN = 0.0;
export const MAX_MIC_GAIN = 2.0;
export const MIN_SPEAKER_VOLUME = 0.0;
export const MAX_SPEAKER_VOLUME = 1.0;
export const MAX_TRANSCRIPT_LENGTH = 16384;

/* ------------------------------------------------------------------ */
/* 3. Core Entity Schemas                                             */
/* ------------------------------------------------------------------ */

export const voiceProfileSchema = z.object({
  voiceId: z.string().min(1).default("default-voice"),
  name: z.string().min(1).default("Agent Voice"),
  rate: z.number().min(0.1).max(10.0).default(DEFAULT_VOICE_RATE),
  pitch: z.number().min(0.0).max(2.0).default(DEFAULT_VOICE_PITCH),
  timbre: voiceTimbreSchema.default(DEFAULT_VOICE_TIMBRE),
  language: z.string().min(1).default(DEFAULT_VOICE_LANGUAGE),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const voiceParticipantSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().max(128).optional(),
  agentId: z.string().optional(),
  agentName: z.string().min(1).max(128).default("NanoForge Agent"),
  avatarUrl: z.string().optional(),
});
export type VoiceParticipant = z.infer<typeof voiceParticipantSchema>;

export const voiceCallSessionSchema = z.object({
  sessionId: z.string().uuid(),
  status: voiceCallStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationSeconds: z.number().nonnegative().default(0),
  isMuted: z.boolean().default(false),
  inputGain: z.number().min(MIN_MIC_GAIN).max(MAX_MIC_GAIN).default(DEFAULT_MIC_GAIN),
  outputVolume: z.number().min(MIN_SPEAKER_VOLUME).max(MAX_SPEAKER_VOLUME).default(DEFAULT_SPEAKER_VOLUME),
  voiceProfile: voiceProfileSchema.default({
    voiceId: "default-voice",
    name: "Agent Voice",
    rate: DEFAULT_VOICE_RATE,
    pitch: DEFAULT_VOICE_PITCH,
    timbre: DEFAULT_VOICE_TIMBRE,
    language: DEFAULT_VOICE_LANGUAGE,
  }),
  participant: voiceParticipantSchema,
  currentTurnId: z.string().optional(),
  totalTurns: z.number().int().nonnegative().default(0),
  endReason: voiceCallEndReasonSchema.optional(),
});
export type VoiceCallSession = z.infer<typeof voiceCallSessionSchema>;

export const voiceTranscriptFrameSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  speaker: voiceSpeakerSchema,
  kind: voiceTranscriptKindSchema,
  text: z.string().max(MAX_TRANSCRIPT_LENGTH),
  confidence: z.number().min(0).max(1).default(1.0),
  isFinal: z.boolean(),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  waveformBins: z.array(z.number()).optional(),
});
export type VoiceTranscriptFrame = z.infer<typeof voiceTranscriptFrameSchema>;

export const voiceTtsChunkSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  textChunk: z.string(),
  audioBase64: z.string().optional(),
  mimeType: z.string().default("audio/wav").optional(),
  isLastChunk: z.boolean().default(false),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  waveformBins: z.array(z.number()).optional(),
});
export type VoiceTtsChunk = z.infer<typeof voiceTtsChunkSchema>;

export const voiceTurnSyncSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  state: voiceTurnStateSchema,
  prompt: z.string(),
  response: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional(),
  timestamp: z.string().datetime(),
});
export type VoiceTurnSync = z.infer<typeof voiceTurnSyncSchema>;

export const voiceInterruptFrameSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  reason: voiceInterruptReasonSchema,
  interruptedAtMs: z.number().nonnegative(),
  spokenTextSnippet: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type VoiceInterruptFrame = z.infer<typeof voiceInterruptFrameSchema>;

export const audioVisualDataSchema = z.object({
  timeDomainData: z.array(z.number()),
  frequencyData: z.array(z.number()),
  rmsVolume: z.number().min(0.0).max(1.0),
});
export type AudioVisualData = z.infer<typeof audioVisualDataSchema>;

/* ------------------------------------------------------------------ */
/* 4. Client RPC Message Schemas (Client -> Host)                     */
/* ------------------------------------------------------------------ */

export const voiceSessionStartMsgSchema = z.object({
  type: z.literal("voice.session.start"),
  requestId: z.string().min(1),
  voiceProfile: voiceProfileSchema.partial().optional(),
  participant: voiceParticipantSchema.partial().optional(),
  inputGain: z.number().min(MIN_MIC_GAIN).max(MAX_MIC_GAIN).optional(),
  outputVolume: z.number().min(MIN_SPEAKER_VOLUME).max(MAX_SPEAKER_VOLUME).optional(),
});
export type VoiceSessionStartMsg = z.infer<typeof voiceSessionStartMsgSchema>;

export const voiceSessionPauseMsgSchema = z.object({
  type: z.literal("voice.session.pause"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
});
export type VoiceSessionPauseMsg = z.infer<typeof voiceSessionPauseMsgSchema>;

export const voiceSessionResumeMsgSchema = z.object({
  type: z.literal("voice.session.resume"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
});
export type VoiceSessionResumeMsg = z.infer<typeof voiceSessionResumeMsgSchema>;

export const voiceSessionEndMsgSchema = z.object({
  type: z.literal("voice.session.end"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  reason: voiceCallEndReasonSchema.optional(),
});
export type VoiceSessionEndMsg = z.infer<typeof voiceSessionEndMsgSchema>;

export const voiceSessionMuteMsgSchema = z.object({
  type: z.literal("voice.session.mute"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  muted: z.boolean(),
});
export type VoiceSessionMuteMsg = z.infer<typeof voiceSessionMuteMsgSchema>;

export const voiceSessionGainMsgSchema = z.object({
  type: z.literal("voice.session.gain"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  inputGain: z.number().min(MIN_MIC_GAIN).max(MAX_MIC_GAIN).optional(),
  outputVolume: z.number().min(MIN_SPEAKER_VOLUME).max(MAX_SPEAKER_VOLUME).optional(),
});
export type VoiceSessionGainMsg = z.infer<typeof voiceSessionGainMsgSchema>;

export const voiceTranscriptSubmitMsgSchema = z.object({
  type: z.literal("voice.transcript.submit"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  text: z.string().max(MAX_TRANSCRIPT_LENGTH),
  isFinal: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});
export type VoiceTranscriptSubmitMsg = z.infer<typeof voiceTranscriptSubmitMsgSchema>;

export const voiceInterruptMsgSchema = z.object({
  type: z.literal("voice.interrupt"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  reason: voiceInterruptReasonSchema,
  spokenTextSnippet: z.string().optional(),
});
export type VoiceInterruptMsg = z.infer<typeof voiceInterruptMsgSchema>;

export const voiceAudioChunkMsgSchema = z.object({
  type: z.literal("voice.audio.chunk"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  turnId: z.string().min(1),
  data: z.string(),
  format: z.string().optional(),
});
export type VoiceAudioChunkMsg = z.infer<typeof voiceAudioChunkMsgSchema>;

export const voiceClientMessageSchema = z.discriminatedUnion("type", [
  voiceSessionStartMsgSchema,
  voiceSessionPauseMsgSchema,
  voiceSessionResumeMsgSchema,
  voiceSessionEndMsgSchema,
  voiceSessionMuteMsgSchema,
  voiceSessionGainMsgSchema,
  voiceTranscriptSubmitMsgSchema,
  voiceInterruptMsgSchema,
  voiceAudioChunkMsgSchema,
]);
export type VoiceClientMessage = z.infer<typeof voiceClientMessageSchema>;

/* ------------------------------------------------------------------ */
/* 5. Host Event Schemas (Host -> Client)                             */
/* ------------------------------------------------------------------ */

export const voiceSessionReadyEventSchema = z.object({
  type: z.literal("voice.session.ready"),
  requestId: z.string().optional(),
  session: voiceCallSessionSchema,
  at: z.string().datetime(),
});
export type VoiceSessionReadyEvent = z.infer<typeof voiceSessionReadyEventSchema>;

export const voiceSessionStateEventSchema = z.object({
  type: z.literal("voice.session.state"),
  requestId: z.string().optional(),
  sessionId: z.string().uuid(),
  status: voiceCallStatusSchema,
  at: z.string().datetime(),
  detail: z.string().optional(),
});
export type VoiceSessionStateEvent = z.infer<typeof voiceSessionStateEventSchema>;

export const voiceTranscriptEventSchema = z.object({
  type: z.literal("voice.transcript.event"),
  frame: voiceTranscriptFrameSchema,
  at: z.string().datetime(),
});
export type VoiceTranscriptEvent = z.infer<typeof voiceTranscriptEventSchema>;

export const voiceTtsChunkEventSchema = z.object({
  type: z.literal("voice.tts.chunk"),
  chunk: voiceTtsChunkSchema,
  at: z.string().datetime(),
});
export type VoiceTtsChunkEvent = z.infer<typeof voiceTtsChunkEventSchema>;

export const voiceTurnEventSchema = z.object({
  type: z.literal("voice.turn.event"),
  turn: voiceTurnSyncSchema,
  at: z.string().datetime(),
});
export type VoiceTurnEvent = z.infer<typeof voiceTurnEventSchema>;

export const voiceInterruptedEventSchema = z.object({
  type: z.literal("voice.interrupted"),
  frame: voiceInterruptFrameSchema,
  at: z.string().datetime(),
});
export type VoiceInterruptedEvent = z.infer<typeof voiceInterruptedEventSchema>;

export const voiceErrorEventSchema = z.object({
  type: z.literal("voice.error"),
  requestId: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  code: z.string(),
  message: z.string(),
  at: z.string().datetime(),
});
export type VoiceErrorEvent = z.infer<typeof voiceErrorEventSchema>;

export const voiceHostEventSchema = z.discriminatedUnion("type", [
  voiceSessionReadyEventSchema,
  voiceSessionStateEventSchema,
  voiceTranscriptEventSchema,
  voiceTtsChunkEventSchema,
  voiceTurnEventSchema,
  voiceInterruptedEventSchema,
  voiceErrorEventSchema,
]);
export type VoiceHostEvent = z.infer<typeof voiceHostEventSchema>;

/* ------------------------------------------------------------------ */
/* 6. State Transition Engine & Helper Functions                      */
/* ------------------------------------------------------------------ */

const VALID_TRANSITIONS: Readonly<Record<VoiceCallStatus, ReadonlySet<VoiceCallStatus>>> = {
  idle: new Set(["connecting", "ended"]),
  connecting: new Set(["listening", "muted", "ended", "idle"]),
  listening: new Set(["thinking", "speaking", "muted", "ended", "idle"]),
  thinking: new Set(["speaking", "listening", "muted", "ended", "idle"]),
  speaking: new Set(["listening", "thinking", "muted", "ended", "idle"]),
  muted: new Set(["listening", "thinking", "speaking", "ended", "idle"]),
  ended: new Set(["connecting", "idle"]),
};

export function isValidVoiceStateTransition(
  current: VoiceCallStatus,
  next: VoiceCallStatus
): boolean {
  if (current === next) return true;
  const allowed = VALID_TRANSITIONS[current];
  return allowed ? allowed.has(next) : false;
}
export const canTransitionVoiceState = isValidVoiceStateTransition;

export function isVoiceCallActive(status: VoiceCallStatus): boolean {
  return status !== "idle" && status !== "ended";
}

export function isVoiceCallTerminal(status: VoiceCallStatus): boolean {
  return status === "ended";
}

export function canAcceptVoiceInput(status: VoiceCallStatus): boolean {
  return status === "listening";
}

export function canInterruptAgent(status: VoiceCallStatus): boolean {
  return status === "speaking" || status === "thinking";
}

export function clampGain(gain: number): number {
  return Math.min(MAX_MIC_GAIN, Math.max(MIN_MIC_GAIN, Number.isFinite(gain) ? gain : DEFAULT_MIC_GAIN));
}

export function clampVolume(volume: number): number {
  return Math.min(MAX_SPEAKER_VOLUME, Math.max(MIN_SPEAKER_VOLUME, Number.isFinite(volume) ? volume : DEFAULT_SPEAKER_VOLUME));
}

export function createVoiceProfile(params?: Partial<VoiceProfile>): VoiceProfile {
  return voiceProfileSchema.parse({
    voiceId: params?.voiceId ?? "default-voice",
    name: params?.name ?? "Agent Voice",
    rate: params?.rate ?? DEFAULT_VOICE_RATE,
    pitch: params?.pitch ?? DEFAULT_VOICE_PITCH,
    timbre: params?.timbre ?? DEFAULT_VOICE_TIMBRE,
    language: params?.language ?? DEFAULT_VOICE_LANGUAGE,
  });
}

export function createVoiceParticipant(params?: Partial<VoiceParticipant>): VoiceParticipant {
  return voiceParticipantSchema.parse({
    userId: params?.userId ?? "user-default",
    userName: params?.userName,
    agentId: params?.agentId,
    agentName: params?.agentName ?? "NanoForge Agent",
    avatarUrl: params?.avatarUrl,
  });
}

export function createVoiceCallSession(params?: Partial<VoiceCallSession>): VoiceCallSession {
  const sessionId = params?.sessionId ?? crypto.randomUUID();
  const startedAt = params?.startedAt ?? new Date().toISOString();

  return voiceCallSessionSchema.parse({
    sessionId,
    status: params?.status ?? "connecting",
    startedAt,
    endedAt: params?.endedAt,
    durationSeconds: params?.durationSeconds ?? 0,
    isMuted: params?.isMuted ?? false,
    inputGain: params?.inputGain !== undefined ? clampGain(params.inputGain) : DEFAULT_MIC_GAIN,
    outputVolume: params?.outputVolume !== undefined ? clampVolume(params.outputVolume) : DEFAULT_SPEAKER_VOLUME,
    voiceProfile: createVoiceProfile(params?.voiceProfile),
    participant: createVoiceParticipant(params?.participant),
    currentTurnId: params?.currentTurnId,
    totalTurns: params?.totalTurns ?? 0,
    endReason: params?.endReason,
  });
}

export function createVoiceTranscriptFrame(params: {
  sessionId: string;
  turnId: string;
  speaker: VoiceSpeaker;
  kind: VoiceTranscriptKind;
  text: string;
  confidence?: number;
  isFinal: boolean;
  timestamp?: string;
  durationMs?: number;
  waveformBins?: number[];
}): VoiceTranscriptFrame {
  return voiceTranscriptFrameSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    speaker: params.speaker,
    kind: params.kind,
    text: params.text,
    confidence: params.confidence ?? 1.0,
    isFinal: params.isFinal,
    timestamp: params.timestamp ?? new Date().toISOString(),
    durationMs: params.durationMs,
    waveformBins: params.waveformBins,
  });
}

export function createVoiceTtsChunk(params: {
  sessionId: string;
  turnId: string;
  chunkIndex: number;
  textChunk: string;
  audioBase64?: string;
  mimeType?: string;
  isLastChunk?: boolean;
  timestamp?: string;
  durationMs?: number;
  waveformBins?: number[];
}): VoiceTtsChunk {
  return voiceTtsChunkSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    chunkIndex: params.chunkIndex,
    textChunk: params.textChunk,
    audioBase64: params.audioBase64,
    mimeType: params.mimeType ?? "audio/wav",
    isLastChunk: params.isLastChunk ?? false,
    timestamp: params.timestamp ?? new Date().toISOString(),
    durationMs: params.durationMs,
    waveformBins: params.waveformBins,
  });
}

export function createVoiceTurnSync(params: {
  sessionId: string;
  turnId: string;
  state: VoiceTurnState;
  prompt: string;
  response?: string;
  tokensUsed?: number;
  latencyMs?: number;
  timestamp?: string;
}): VoiceTurnSync {
  return voiceTurnSyncSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
    prompt: params.prompt,
    response: params.response,
    tokensUsed: params.tokensUsed,
    latencyMs: params.latencyMs,
    timestamp: params.timestamp ?? new Date().toISOString(),
  });
}

export function createVoiceInterruptFrame(params: {
  sessionId: string;
  turnId: string;
  reason: VoiceInterruptReason;
  interruptedAtMs: number;
  spokenTextSnippet?: string;
  timestamp?: string;
}): VoiceInterruptFrame {
  return voiceInterruptFrameSchema.parse({
    sessionId: params.sessionId,
    turnId: params.turnId,
    reason: params.reason,
    interruptedAtMs: params.interruptedAtMs,
    spokenTextSnippet: params.spokenTextSnippet,
    timestamp: params.timestamp ?? new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* 7. Wire Parsing and Validation Utilities                           */
/* ------------------------------------------------------------------ */

export function parseVoiceClientMessage(raw: unknown): VoiceClientMessage {
  return voiceClientMessageSchema.parse(raw);
}

export function safeParseVoiceClientMessage(
  raw: unknown
): ReturnType<typeof voiceClientMessageSchema.safeParse> {
  return voiceClientMessageSchema.safeParse(raw);
}

export function parseVoiceHostEvent(raw: unknown): VoiceHostEvent {
  return voiceHostEventSchema.parse(raw);
}

export function safeParseVoiceHostEvent(
  raw: unknown
): ReturnType<typeof voiceHostEventSchema.safeParse> {
  return voiceHostEventSchema.safeParse(raw);
}

export function isVoiceClientMessage(raw: unknown): raw is VoiceClientMessage {
  return voiceClientMessageSchema.safeParse(raw).success;
}

export function isVoiceHostEvent(raw: unknown): raw is VoiceHostEvent {
  return voiceHostEventSchema.safeParse(raw).success;
}
```

### 4.2 Proposed `packages/protocol/src/index.ts` Update
```typescript
/**
 * Public protocol surface shared between the web control plane and the
 * agent host. Pure types + pure functions only — no Node APIs.
 */
export * from "./plan";
export * from "./commands";
export * from "./routing";
export * from "./artifacts";
export * from "./terminal";
export * from "./subagents";
export * from "./tasks";
export * from "./memory";
export * from "./voice";
```

### 4.3 Proposed `packages/protocol/src/voice.test.ts`
```typescript
import { describe, expect, it } from "vitest";
import {
  voiceCallStatusSchema,
  voiceCallEndReasonSchema,
  voiceInterruptReasonSchema,
  voiceTranscriptKindSchema,
  voiceTimbreSchema,
  voiceSpeakerSchema,
  voiceTurnStateSchema,
  voiceProfileSchema,
  voiceParticipantSchema,
  voiceCallSessionSchema,
  voiceTranscriptFrameSchema,
  voiceTtsChunkSchema,
  voiceTurnSyncSchema,
  voiceInterruptFrameSchema,
  audioVisualDataSchema,
  voiceSessionStartMsgSchema,
  voiceSessionPauseMsgSchema,
  voiceSessionResumeMsgSchema,
  voiceSessionEndMsgSchema,
  voiceSessionMuteMsgSchema,
  voiceSessionGainMsgSchema,
  voiceTranscriptSubmitMsgSchema,
  voiceInterruptMsgSchema,
  voiceAudioChunkMsgSchema,
  voiceClientMessageSchema,
  voiceSessionReadyEventSchema,
  voiceSessionStateEventSchema,
  voiceTranscriptEventSchema,
  voiceTtsChunkEventSchema,
  voiceTurnEventSchema,
  voiceInterruptedEventSchema,
  voiceErrorEventSchema,
  voiceHostEventSchema,
  isValidVoiceStateTransition,
  canTransitionVoiceState,
  isVoiceCallActive,
  isVoiceCallTerminal,
  canAcceptVoiceInput,
  canInterruptAgent,
  clampGain,
  clampVolume,
  createVoiceProfile,
  createVoiceParticipant,
  createVoiceCallSession,
  createVoiceTranscriptFrame,
  createVoiceTtsChunk,
  createVoiceTurnSync,
  createVoiceInterruptFrame,
  parseVoiceClientMessage,
  safeParseVoiceClientMessage,
  parseVoiceHostEvent,
  safeParseVoiceHostEvent,
  isVoiceClientMessage,
  isVoiceHostEvent,
  VOICE_ERROR_CODES,
  DEFAULT_VOICE_RATE,
  DEFAULT_VOICE_PITCH,
  DEFAULT_VOICE_TIMBRE,
  DEFAULT_VOICE_LANGUAGE,
  DEFAULT_MIC_GAIN,
  DEFAULT_SPEAKER_VOLUME,
  MIN_MIC_GAIN,
  MAX_MIC_GAIN,
  MIN_SPEAKER_VOLUME,
  MAX_SPEAKER_VOLUME,
  type VoiceCallStatus,
  type VoiceCallSession,
} from "./voice";

describe("Voice Protocol & Schemas Suite", () => {
  const sampleUuid1 = "123e4567-e89b-12d3-a456-426614174000";
  const sampleTimestamp = "2026-08-15T12:00:00.000Z";

  describe("Enums, Constants & Error Codes", () => {
    it("validates all 7 canonical VoiceCallStatus values", () => {
      const statuses: VoiceCallStatus[] = [
        "idle",
        "connecting",
        "listening",
        "thinking",
        "speaking",
        "muted",
        "ended",
      ];
      for (const s of statuses) {
        expect(voiceCallStatusSchema.parse(s)).toBe(s);
      }
      expect(() => voiceCallStatusSchema.parse("invalid_status")).toThrow();
    });

    it("validates end reasons and interrupt reasons", () => {
      const endReasons = ["user_hangup", "agent_hangup", "timeout", "error", "connection_lost"];
      for (const r of endReasons) {
        expect(voiceCallEndReasonSchema.parse(r)).toBe(r);
      }
      expect(() => voiceCallEndReasonSchema.parse("killed")).toThrow();

      const interruptReasons = ["user_speech_detected", "user_manual_button", "session_closed"];
      for (const r of interruptReasons) {
        expect(voiceInterruptReasonSchema.parse(r)).toBe(r);
      }
      expect(() => voiceInterruptReasonSchema.parse("unknown")).toThrow();
    });

    it("validates transcript kind, timbre, speaker, and turn states", () => {
      expect(voiceTranscriptKindSchema.parse("interim")).toBe("interim");
      expect(voiceTranscriptKindSchema.parse("final")).toBe("final");

      expect(voiceTimbreSchema.parse("neutral")).toBe("neutral");
      expect(voiceTimbreSchema.parse("warm")).toBe("warm");
      expect(voiceTimbreSchema.parse("crisp")).toBe("crisp");
      expect(voiceTimbreSchema.parse("expressive")).toBe("expressive");

      expect(voiceSpeakerSchema.parse("user")).toBe("user");
      expect(voiceSpeakerSchema.parse("agent")).toBe("agent");

      const turnStates = ["started", "transcribing", "thinking", "speaking", "completed", "interrupted", "error"];
      for (const s of turnStates) {
        expect(voiceTurnStateSchema.parse(s)).toBe(s);
      }
    });

    it("exports standard constants and error codes", () => {
      expect(DEFAULT_VOICE_RATE).toBe(1.0);
      expect(DEFAULT_VOICE_PITCH).toBe(1.0);
      expect(DEFAULT_VOICE_TIMBRE).toBe("neutral");
      expect(DEFAULT_VOICE_LANGUAGE).toBe("en-US");
      expect(DEFAULT_MIC_GAIN).toBe(1.0);
      expect(DEFAULT_SPEAKER_VOLUME).toBe(1.0);
      expect(MIN_MIC_GAIN).toBe(0.0);
      expect(MAX_MIC_GAIN).toBe(2.0);
      expect(MIN_SPEAKER_VOLUME).toBe(0.0);
      expect(MAX_SPEAKER_VOLUME).toBe(1.0);
      expect(VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND).toBe("ERR_VOICE_SESSION_NOT_FOUND");
      expect(VOICE_ERROR_CODES.ERR_VOICE_INVALID_STATE_TRANSITION).toBe("ERR_VOICE_INVALID_STATE_TRANSITION");
    });
  });

  describe("Core Entity Schemas", () => {
    it("parses valid VoiceProfile with defaults and bounds", () => {
      const profile = voiceProfileSchema.parse({});
      expect(profile.voiceId).toBe("default-voice");
      expect(profile.name).toBe("Agent Voice");
      expect(profile.rate).toBe(1.0);
      expect(profile.pitch).toBe(1.0);
      expect(profile.timbre).toBe("neutral");
      expect(profile.language).toBe("en-US");

      expect(() => voiceProfileSchema.parse({ rate: -1 })).toThrow();
      expect(() => voiceProfileSchema.parse({ pitch: 3.0 })).toThrow();
    });

    it("parses valid VoiceParticipant", () => {
      const participant = voiceParticipantSchema.parse({
        userId: "user-123",
        userName: "Alice",
      });
      expect(participant.userId).toBe("user-123");
      expect(participant.agentName).toBe("NanoForge Agent");
    });

    it("parses complete VoiceCallSession", () => {
      const session: VoiceCallSession = {
        sessionId: sampleUuid1,
        status: "listening",
        startedAt: sampleTimestamp,
        durationSeconds: 15,
        isMuted: false,
        inputGain: 1.2,
        outputVolume: 0.9,
        voiceProfile: {
          voiceId: "nova",
          name: "Nova Crisp",
          rate: 1.1,
          pitch: 1.0,
          timbre: "crisp",
          language: "en-US",
        },
        participant: {
          userId: "user-123",
          agentName: "Agent-1",
        },
        totalTurns: 2,
      };
      const parsed = voiceCallSessionSchema.parse(session);
      expect(parsed.sessionId).toBe(sampleUuid1);
      expect(parsed.inputGain).toBe(1.2);
    });

    it("parses VoiceTranscriptFrame", () => {
      const frame = voiceTranscriptFrameSchema.parse({
        sessionId: sampleUuid1,
        turnId: "turn-1",
        speaker: "user",
        kind: "interim",
        text: "Hello agent",
        confidence: 0.95,
        isFinal: false,
        timestamp: sampleTimestamp,
      });
      expect(frame.confidence).toBe(0.95);
      expect(frame.speaker).toBe("user");
    });

    it("parses VoiceTtsChunk", () => {
      const chunk = voiceTtsChunkSchema.parse({
        sessionId: sampleUuid1,
        turnId: "turn-1",
        chunkIndex: 0,
        textChunk: "Hello there! How can I assist?",
        isLastChunk: true,
        timestamp: sampleTimestamp,
      });
      expect(chunk.chunkIndex).toBe(0);
      expect(chunk.isLastChunk).toBe(true);
      expect(chunk.mimeType).toBe("audio/wav");
    });

    it("parses VoiceTurnSync", () => {
      const turn = voiceTurnSyncSchema.parse({
        sessionId: sampleUuid1,
        turnId: "turn-1",
        state: "speaking",
        prompt: "Check system status",
        response: "System is operating normally.",
        tokensUsed: 45,
        latencyMs: 320,
        timestamp: sampleTimestamp,
      });
      expect(turn.tokensUsed).toBe(45);
      expect(turn.latencyMs).toBe(320);
    });

    it("parses VoiceInterruptFrame", () => {
      const frame = voiceInterruptFrameSchema.parse({
        sessionId: sampleUuid1,
        turnId: "turn-1",
        reason: "user_speech_detected",
        interruptedAtMs: 1420,
        spokenTextSnippet: "Stop that",
        timestamp: sampleTimestamp,
      });
      expect(frame.reason).toBe("user_speech_detected");
      expect(frame.interruptedAtMs).toBe(1420);
    });

    it("parses AudioVisualData", () => {
      const data = audioVisualDataSchema.parse({
        timeDomainData: [128, 130, 126],
        frequencyData: [10, 40, 90],
        rmsVolume: 0.45,
      });
      expect(data.rmsVolume).toBe(0.45);
      expect(data.timeDomainData.length).toBe(3);
    });
  });

  describe("Client RPC Messages", () => {
    it("validates all Client Message types and discriminated union", () => {
      const startMsg = voiceClientMessageSchema.parse({
        type: "voice.session.start",
        requestId: "req-1",
        inputGain: 1.0,
      });
      expect(startMsg.type).toBe("voice.session.start");

      const pauseMsg = voiceClientMessageSchema.parse({
        type: "voice.session.pause",
        requestId: "req-2",
        sessionId: sampleUuid1,
      });
      expect(pauseMsg.type).toBe("voice.session.pause");

      const resumeMsg = voiceClientMessageSchema.parse({
        type: "voice.session.resume",
        requestId: "req-3",
        sessionId: sampleUuid1,
      });
      expect(resumeMsg.type).toBe("voice.session.resume");

      const endMsg = voiceClientMessageSchema.parse({
        type: "voice.session.end",
        requestId: "req-4",
        sessionId: sampleUuid1,
        reason: "user_hangup",
      });
      expect(endMsg.type).toBe("voice.session.end");

      const muteMsg = voiceClientMessageSchema.parse({
        type: "voice.session.mute",
        requestId: "req-5",
        sessionId: sampleUuid1,
        muted: true,
      });
      expect(muteMsg.type).toBe("voice.session.mute");

      const gainMsg = voiceClientMessageSchema.parse({
        type: "voice.session.gain",
        requestId: "req-6",
        sessionId: sampleUuid1,
        inputGain: 1.5,
        outputVolume: 0.8,
      });
      expect(gainMsg.type).toBe("voice.session.gain");

      const submitMsg = voiceClientMessageSchema.parse({
        type: "voice.transcript.submit",
        requestId: "req-7",
        sessionId: sampleUuid1,
        turnId: "turn-1",
        text: "Run tests",
        isFinal: true,
      });
      expect(submitMsg.type).toBe("voice.transcript.submit");

      const interruptMsg = voiceClientMessageSchema.parse({
        type: "voice.interrupt",
        requestId: "req-8",
        sessionId: sampleUuid1,
        turnId: "turn-1",
        reason: "user_manual_button",
      });
      expect(interruptMsg.type).toBe("voice.interrupt");

      const audioMsg = voiceClientMessageSchema.parse({
        type: "voice.audio.chunk",
        requestId: "req-9",
        sessionId: sampleUuid1,
        turnId: "turn-1",
        data: "base64audio...",
      });
      expect(audioMsg.type).toBe("voice.audio.chunk");
    });
  });

  describe("Host Event Messages", () => {
    it("validates all Host Event types and discriminated union", () => {
      const session = createVoiceCallSession({ sessionId: sampleUuid1 });

      const readyEvent = voiceHostEventSchema.parse({
        type: "voice.session.ready",
        requestId: "req-1",
        session,
        at: sampleTimestamp,
      });
      expect(readyEvent.type).toBe("voice.session.ready");

      const stateEvent = voiceHostEventSchema.parse({
        type: "voice.session.state",
        sessionId: sampleUuid1,
        status: "speaking",
        at: sampleTimestamp,
      });
      expect(stateEvent.type).toBe("voice.session.state");

      const transcriptEvent = voiceHostEventSchema.parse({
        type: "voice.transcript.event",
        frame: createVoiceTranscriptFrame({
          sessionId: sampleUuid1,
          turnId: "turn-1",
          speaker: "agent",
          kind: "final",
          text: "Task completed",
          isFinal: true,
        }),
        at: sampleTimestamp,
      });
      expect(transcriptEvent.type).toBe("voice.transcript.event");

      const ttsEvent = voiceHostEventSchema.parse({
        type: "voice.tts.chunk",
        chunk: createVoiceTtsChunk({
          sessionId: sampleUuid1,
          turnId: "turn-1",
          chunkIndex: 0,
          textChunk: "Hello",
        }),
        at: sampleTimestamp,
      });
      expect(ttsEvent.type).toBe("voice.tts.chunk");

      const turnEvent = voiceHostEventSchema.parse({
        type: "voice.turn.event",
        turn: createVoiceTurnSync({
          sessionId: sampleUuid1,
          turnId: "turn-1",
          state: "completed",
          prompt: "Hello",
        }),
        at: sampleTimestamp,
      });
      expect(turnEvent.type).toBe("voice.turn.event");

      const interruptedEvent = voiceHostEventSchema.parse({
        type: "voice.interrupted",
        frame: createVoiceInterruptFrame({
          sessionId: sampleUuid1,
          turnId: "turn-1",
          reason: "user_speech_detected",
          interruptedAtMs: 500,
        }),
        at: sampleTimestamp,
      });
      expect(interruptedEvent.type).toBe("voice.interrupted");

      const errorEvent = voiceHostEventSchema.parse({
        type: "voice.error",
        sessionId: sampleUuid1,
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: "Session expired",
        at: sampleTimestamp,
      });
      expect(errorEvent.type).toBe("voice.error");
    });
  });

  describe("State Transition Engine & Helper Functions", () => {
    it("validates permissible and forbidden voice state transitions", () => {
      // Valid transitions
      expect(isValidVoiceStateTransition("idle", "connecting")).toBe(true);
      expect(isValidVoiceStateTransition("connecting", "listening")).toBe(true);
      expect(isValidVoiceStateTransition("listening", "thinking")).toBe(true);
      expect(isValidVoiceStateTransition("thinking", "speaking")).toBe(true);
      expect(isValidVoiceStateTransition("speaking", "listening")).toBe(true);
      expect(isValidVoiceStateTransition("speaking", "muted")).toBe(true);
      expect(isValidVoiceStateTransition("muted", "listening")).toBe(true);
      expect(isValidVoiceStateTransition("listening", "ended")).toBe(true);
      expect(isValidVoiceStateTransition("ended", "connecting")).toBe(true);

      // Idempotent self-transitions
      expect(isValidVoiceStateTransition("listening", "listening")).toBe(true);
      expect(isValidVoiceStateTransition("speaking", "speaking")).toBe(true);

      // Forbidden transitions
      expect(isValidVoiceStateTransition("idle", "speaking")).toBe(false);
      expect(isValidVoiceStateTransition("idle", "thinking")).toBe(false);
      expect(isValidVoiceStateTransition("ended", "speaking")).toBe(false);

      // Alias check
      expect(canTransitionVoiceState("connecting", "listening")).toBe(true);
    });

    it("verifies state query predicates", () => {
      expect(isVoiceCallActive("listening")).toBe(true);
      expect(isVoiceCallActive("speaking")).toBe(true);
      expect(isVoiceCallActive("idle")).toBe(false);
      expect(isVoiceCallActive("ended")).toBe(false);

      expect(isVoiceCallTerminal("ended")).toBe(true);
      expect(isVoiceCallTerminal("speaking")).toBe(false);

      expect(canAcceptVoiceInput("listening")).toBe(true);
      expect(canAcceptVoiceInput("muted")).toBe(false);
      expect(canAcceptVoiceInput("speaking")).toBe(false);

      expect(canInterruptAgent("speaking")).toBe(true);
      expect(canInterruptAgent("thinking")).toBe(true);
      expect(canInterruptAgent("idle")).toBe(false);
    });

    it("clamps gains and volumes properly", () => {
      expect(clampGain(1.5)).toBe(1.5);
      expect(clampGain(-0.5)).toBe(0.0);
      expect(clampGain(3.5)).toBe(2.0);
      expect(clampGain(NaN)).toBe(1.0);

      expect(clampVolume(0.7)).toBe(0.7);
      expect(clampVolume(-0.2)).toBe(0.0);
      expect(clampVolume(1.5)).toBe(1.0);
      expect(clampVolume(NaN)).toBe(1.0);
    });

    it("creates default and customized entities via factories", () => {
      const profile = createVoiceProfile({ rate: 1.2 });
      expect(profile.rate).toBe(1.2);
      expect(profile.timbre).toBe("neutral");

      const participant = createVoiceParticipant({ userName: "Bob" });
      expect(participant.userName).toBe("Bob");

      const session = createVoiceCallSession({ inputGain: 1.8 });
      expect(session.inputGain).toBe(1.8);
      expect(typeof session.sessionId).toBe("string");
    });

    it("tests wire parsing & safe parsing utilities", () => {
      const rawClient = {
        type: "voice.session.start",
        requestId: "req-100",
      };
      expect(isVoiceClientMessage(rawClient)).toBe(true);
      expect(parseVoiceClientMessage(rawClient).type).toBe("voice.session.start");
      expect(safeParseVoiceClientMessage(rawClient).success).toBe(true);

      const rawHost = {
        type: "voice.session.state",
        sessionId: sampleUuid1,
        status: "listening",
        at: sampleTimestamp,
      };
      expect(isVoiceHostEvent(rawHost)).toBe(true);
      expect(parseVoiceHostEvent(rawHost).type).toBe("voice.session.state");
      expect(safeParseVoiceHostEvent(rawHost).success).toBe(true);

      expect(isVoiceClientMessage({ type: "invalid" })).toBe(false);
      expect(isVoiceHostEvent({ type: "invalid" })).toBe(false);
    });
  });
});
```

---

## 5. Verification Method

To verify the protocol implementation once applied:

1. **Protocol Test Suite**:
   ```bash
   npm run test:protocol
   ```
   *Expected outcome*: All test suites pass including `packages/protocol/src/voice.test.ts` with 0 failures.

2. **TypeScript Typecheck**:
   ```bash
   npm run typecheck:protocol
   ```
   *Expected outcome*: 0 TypeScript compiler errors.

3. **Workspace Full Build & Integration**:
   ```bash
   npm run build
   ```
   *Expected outcome*: Clean build with 0 bundle or type errors across packages and apps.

4. **Invalidation Conditions**:
   - Introducing any Node.js runtime module (`fs`, `path`, `process`, `net`) into `packages/protocol/src/voice.ts`.
   - Modifying wire message names from the frozen spec (`voice.session.start`, `voice.session.pause`, `voice.session.resume`, `voice.session.end`, `voice.session.mute`, `voice.session.gain`, `voice.transcript.submit`, `voice.interrupt`, `voice.audio.chunk`).
   - Breaking state transition idempotency or active call predicate logic.

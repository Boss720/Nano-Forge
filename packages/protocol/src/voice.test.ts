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
  isVoiceSessionActive,
  isVoiceCallTerminal,
  isVoiceSessionTerminal,
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
  MAX_TRANSCRIPT_LENGTH,
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
      expect(() => voiceCallStatusSchema.parse("")).toThrow();
      expect(() => voiceCallStatusSchema.parse(123)).toThrow();
    });

    it("validates end reasons and interrupt reasons", () => {
      const endReasons = ["user_hangup", "agent_hangup", "timeout", "error", "connection_lost"];
      for (const r of endReasons) {
        expect(voiceCallEndReasonSchema.parse(r)).toBe(r);
      }
      expect(() => voiceCallEndReasonSchema.parse("killed")).toThrow();
      expect(() => voiceCallEndReasonSchema.parse("")).toThrow();

      const interruptReasons = ["user_speech_detected", "user_manual_button", "session_closed"];
      for (const r of interruptReasons) {
        expect(voiceInterruptReasonSchema.parse(r)).toBe(r);
      }
      expect(() => voiceInterruptReasonSchema.parse("unknown")).toThrow();
      expect(() => voiceInterruptReasonSchema.parse("")).toThrow();
    });

    it("validates transcript kind, timbre, speaker, and turn states", () => {
      expect(voiceTranscriptKindSchema.parse("interim")).toBe("interim");
      expect(voiceTranscriptKindSchema.parse("final")).toBe("final");
      expect(() => voiceTranscriptKindSchema.parse("draft")).toThrow();

      expect(voiceTimbreSchema.parse("neutral")).toBe("neutral");
      expect(voiceTimbreSchema.parse("warm")).toBe("warm");
      expect(voiceTimbreSchema.parse("crisp")).toBe("crisp");
      expect(voiceTimbreSchema.parse("expressive")).toBe("expressive");
      expect(() => voiceTimbreSchema.parse("deep")).toThrow();

      expect(voiceSpeakerSchema.parse("user")).toBe("user");
      expect(voiceSpeakerSchema.parse("agent")).toBe("agent");
      expect(() => voiceSpeakerSchema.parse("bot")).toThrow();

      const turnStates = ["started", "transcribing", "thinking", "speaking", "completed", "interrupted", "error"];
      for (const s of turnStates) {
        expect(voiceTurnStateSchema.parse(s)).toBe(s);
      }
      expect(() => voiceTurnStateSchema.parse("cancelled")).toThrow();
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
      expect(MAX_TRANSCRIPT_LENGTH).toBe(16384);

      expect(VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND).toBe("ERR_VOICE_SESSION_NOT_FOUND");
      expect(VOICE_ERROR_CODES.ERR_VOICE_INVALID_STATE_TRANSITION).toBe("ERR_VOICE_INVALID_STATE_TRANSITION");
      expect(VOICE_ERROR_CODES.ERR_VOICE_ALREADY_ACTIVE).toBe("ERR_VOICE_ALREADY_ACTIVE");
      expect(VOICE_ERROR_CODES.ERR_VOICE_ALREADY_MUTED).toBe("ERR_VOICE_ALREADY_MUTED");
      expect(VOICE_ERROR_CODES.ERR_VOICE_NOT_MUTED).toBe("ERR_VOICE_NOT_MUTED");
      expect(VOICE_ERROR_CODES.ERR_VOICE_INTERRUPT_FAILED).toBe("ERR_VOICE_INTERRUPT_FAILED");
      expect(VOICE_ERROR_CODES.ERR_VOICE_AUDIO_STREAM_ERROR).toBe("ERR_VOICE_AUDIO_STREAM_ERROR");
      expect(VOICE_ERROR_CODES.ERR_VOICE_SYNTHESIS_ERROR).toBe("ERR_VOICE_SYNTHESIS_ERROR");
      expect(VOICE_ERROR_CODES.ERR_VOICE_RECOGNITION_ERROR).toBe("ERR_VOICE_RECOGNITION_ERROR");
      expect(VOICE_ERROR_CODES.ERR_VOICE_DEVICE_PERMISSION_DENIED).toBe("ERR_VOICE_DEVICE_PERMISSION_DENIED");
    });
  });

  describe("Core Entity Schemas & Validation Bounds", () => {
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
      expect(() => voiceProfileSchema.parse({ voiceId: "" })).toThrow();
      expect(() => voiceProfileSchema.parse({ name: "" })).toThrow();
    });

    it("parses valid VoiceParticipant", () => {
      const participant = voiceParticipantSchema.parse({
        userId: "user-123",
        userName: "Alice",
      });
      expect(participant.userId).toBe("user-123");
      expect(participant.userName).toBe("Alice");
      expect(participant.agentName).toBe("NanoForge Agent");

      expect(() => voiceParticipantSchema.parse({ userId: "" })).toThrow();
    });

    it("parses complete VoiceCallSession with boundaries", () => {
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

      // Boundary errors
      expect(() => voiceCallSessionSchema.parse({ ...session, sessionId: "not-a-uuid" })).toThrow();
      expect(() => voiceCallSessionSchema.parse({ ...session, durationSeconds: -5 })).toThrow();
      expect(() => voiceCallSessionSchema.parse({ ...session, inputGain: -0.1 })).toThrow();
      expect(() => voiceCallSessionSchema.parse({ ...session, inputGain: 2.5 })).toThrow();
      expect(() => voiceCallSessionSchema.parse({ ...session, outputVolume: -0.1 })).toThrow();
      expect(() => voiceCallSessionSchema.parse({ ...session, outputVolume: 1.5 })).toThrow();
      expect(() => voiceCallSessionSchema.parse({ ...session, totalTurns: -1 })).toThrow();
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
        waveformBins: [10, 25, 40],
      });
      expect(frame.confidence).toBe(0.95);
      expect(frame.speaker).toBe("user");
      expect(frame.waveformBins).toEqual([10, 25, 40]);

      expect(() => voiceTranscriptFrameSchema.parse({ ...frame, confidence: -0.1 })).toThrow();
      expect(() => voiceTranscriptFrameSchema.parse({ ...frame, confidence: 1.5 })).toThrow();
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

      expect(() => voiceTtsChunkSchema.parse({ ...chunk, chunkIndex: -1 })).toThrow();
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

      expect(() => voiceTurnSyncSchema.parse({ ...turn, tokensUsed: -10 })).toThrow();
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

      expect(() => voiceInterruptFrameSchema.parse({ ...frame, interruptedAtMs: -1 })).toThrow();
    });

    it("parses AudioVisualData", () => {
      const data = audioVisualDataSchema.parse({
        timeDomainData: [128, 130, 126],
        frequencyData: [10, 40, 90],
        rmsVolume: 0.45,
      });
      expect(data.rmsVolume).toBe(0.45);
      expect(data.timeDomainData.length).toBe(3);

      expect(() => audioVisualDataSchema.parse({ ...data, rmsVolume: -0.1 })).toThrow();
      expect(() => audioVisualDataSchema.parse({ ...data, rmsVolume: 1.1 })).toThrow();
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
      expect(isValidVoiceStateTransition("idle", "idle")).toBe(true);

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
      expect(isVoiceSessionActive("thinking")).toBe(true);
      expect(isVoiceSessionActive("idle")).toBe(false);

      expect(isVoiceCallTerminal("ended")).toBe(true);
      expect(isVoiceCallTerminal("speaking")).toBe(false);
      expect(isVoiceSessionTerminal("ended")).toBe(true);
      expect(isVoiceSessionTerminal("connecting")).toBe(false);

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

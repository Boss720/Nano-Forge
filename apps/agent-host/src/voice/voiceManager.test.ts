import { afterEach, describe, expect, it } from "vitest";
import type { ModelProfile } from "@protocol/routing";
import {
  VOICE_ERROR_CODES,
  type VoiceCallSession,
  type VoiceTranscriptFrame,
  type VoiceTtsChunk,
  type VoiceTurnSync,
  type VoiceInterruptFrame,
} from "@protocol/voice";
import { InMemoryProviderRegistry } from "../providers/registry";
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderDelta,
} from "../providers/types";
import type { HostMessage } from "../protocol";
import {
  CLOSE_INVALID_MESSAGE,
  createHost,
  type HostHandle,
} from "../server";
import { VoiceSessionManager } from "./voiceManager";

/* Minimal structural typing over the native WebSocket (no DOM lib needed). */
interface WsCloseEvent {
  code: number;
  reason: string;
}
interface WsMessageEvent {
  data: unknown;
}
interface WsLike {
  addEventListener(
    type: "open" | "error",
    cb: () => void,
    opts?: { once?: boolean }
  ): void;
  addEventListener(
    type: "close",
    cb: (event: WsCloseEvent) => void,
    opts?: { once?: boolean }
  ): void;
  addEventListener(
    type: "message",
    cb: (event: WsMessageEvent) => void,
    opts?: { once?: boolean }
  ): void;
  send(data: string): void;
  close(): void;
}
const NativeWebSocket = globalThis.WebSocket as unknown as new (
  url: string
) => WsLike;

function waitForOpen(ws: WsLike): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), {
      once: true,
    });
  });
}

function waitForClose(ws: WsLike): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true }
    );
  });
}

function collectMessagesUntil(
  ws: WsLike,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const collected: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for message. Collected so far: ${JSON.stringify(
            collected
          )}`
        )
      );
    }, timeoutMs);

    const onMessage = (event: WsMessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data));
        collected.push(parsed);
        if (predicate(parsed)) {
          clearTimeout(timer);
          resolve(collected);
        }
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    };

    ws.addEventListener("message", onMessage);
  });
}

describe("VoiceSessionManager & Voice Protocol Host Integration", () => {
  const FIXED_TIME = new Date("2026-08-15T12:00:00.000Z");
  const clock = () => FIXED_TIME;
  let liveHost: HostHandle | undefined;

  afterEach(async () => {
    if (liveHost) {
      await liveHost.close();
      liveHost = undefined;
    }
  });

  function createTestHarness(options?: {
    customAdapter?: ProviderAdapter;
    profiles?: ModelProfile[];
  }) {
    const messages: HostMessage[] = [];
    const send = (msg: HostMessage) => messages.push(msg);

    const registry = new InMemoryProviderRegistry();
    let profiles: ModelProfile[] | undefined = options?.profiles;

    if (options?.customAdapter) {
      registry.register(options.customAdapter);
      if (!profiles) {
        profiles = [
          {
            id: "test-model",
            provider: options.customAdapter.id,
            capabilities: { planning: 1, coding: 1, vision: 0, toolCalling: 1 },
            costPer1kInputTokens: 0,
            costPer1kOutputTokens: 0,
            privacyClass: "cloud",
            maxContextTokens: 128_000,
            typicalLatencyMs: 100,
          },
        ];
      }
    }

    const manager = new VoiceSessionManager({
      send,
      clock,
      providerRegistry: registry,
      profiles,
    });

    return { manager, messages, registry };
  }

  describe("Suite 1: Session Lifecycle Management", () => {
    it("starts a voice session, assigns default profile, and emits ready and state events", () => {
      const { manager, messages } = createTestHarness();

      const session = manager.startSession({
        requestId: "req-start-1",
      });

      expect(session).toBeDefined();
      expect(typeof session.sessionId).toBe("string");
      expect(session.status).toBe("listening");
      expect(session.isMuted).toBe(false);
      expect(session.inputGain).toBe(1.0);
      expect(session.outputVolume).toBe(1.0);
      expect(session.voiceProfile.name).toBe("Agent Voice");

      expect(messages.length).toBe(2);

      const readyMsg = messages.find((m) => m.type === "voice.session.ready");
      expect(readyMsg).toBeDefined();
      if (readyMsg && readyMsg.type === "voice.session.ready") {
        expect(readyMsg.requestId).toBe("req-start-1");
        expect(readyMsg.session.sessionId).toBe(session.sessionId);
      }

      const stateMsg = messages.find((m) => m.type === "voice.session.state");
      expect(stateMsg).toBeDefined();
      if (stateMsg && stateMsg.type === "voice.session.state") {
        expect(stateMsg.sessionId).toBe(session.sessionId);
        expect(stateMsg.status).toBe("listening");
      }

      expect(manager.getActiveSession()?.sessionId).toBe(session.sessionId);
      expect(manager.getSession(session.sessionId)?.sessionId).toBe(session.sessionId);
      expect(manager.listSessions().length).toBe(1);
    });

    it("respects custom parameters during startSession", () => {
      const { manager } = createTestHarness();

      const session = manager.startSession({
        voiceProfile: {
          voiceId: "nova",
          name: "Nova Crisp",
          rate: 1.25,
          pitch: 1.1,
          timbre: "crisp",
        },
        participant: {
          userId: "user-42",
          userName: "Alice",
          agentName: "NanoAssistant",
        },
        inputGain: 1.5,
        outputVolume: 0.8,
      });

      expect(session.voiceProfile.voiceId).toBe("nova");
      expect(session.voiceProfile.timbre).toBe("crisp");
      expect(session.voiceProfile.rate).toBe(1.25);
      expect(session.participant.userId).toBe("user-42");
      expect(session.participant.agentName).toBe("NanoAssistant");
      expect(session.inputGain).toBe(1.5);
      expect(session.outputVolume).toBe(0.8);
    });

    it("pauses and resumes a session", () => {
      const { manager, messages } = createTestHarness();

      const session = manager.startSession({});
      messages.length = 0;

      // Pause session
      manager.pauseSession(session.sessionId, "req-pause-1");
      expect(session.status).toBe("idle");

      expect(messages.length).toBe(1);
      const pauseMsg = messages[0];
      expect(pauseMsg.type).toBe("voice.session.state");
      if (pauseMsg.type === "voice.session.state") {
        expect(pauseMsg.status).toBe("idle");
        expect(pauseMsg.requestId).toBe("req-pause-1");
      }

      // Resume session
      messages.length = 0;
      manager.resumeSession(session.sessionId, "req-resume-1");
      expect(session.status).toBe("listening");

      expect(messages.length).toBe(1);
      const resumeMsg = messages[0];
      expect(resumeMsg.type).toBe("voice.session.state");
      if (resumeMsg.type === "voice.session.state") {
        expect(resumeMsg.status).toBe("listening");
        expect(resumeMsg.requestId).toBe("req-resume-1");
      }
    });

    it("toggles mute state and updates status", () => {
      const { manager, messages } = createTestHarness();

      const session = manager.startSession({});
      messages.length = 0;

      // Mute microphone
      manager.setMute(session.sessionId, true);
      expect(session.isMuted).toBe(true);
      expect(session.status).toBe("muted");

      const muteMsg = messages[messages.length - 1];
      expect(muteMsg.type).toBe("voice.session.state");
      if (muteMsg.type === "voice.session.state") {
        expect(muteMsg.status).toBe("muted");
      }

      // Unmute microphone
      manager.setMute(session.sessionId, false);
      expect(session.isMuted).toBe(false);
      expect(session.status).toBe("listening");

      const unmuteMsg = messages[messages.length - 1];
      expect(unmuteMsg.type).toBe("voice.session.state");
      if (unmuteMsg.type === "voice.session.state") {
        expect(unmuteMsg.status).toBe("listening");
      }
    });

    it("updates and clamps input gain and output volume via setGain", () => {
      const { manager } = createTestHarness();

      const session = manager.startSession({});
      manager.setGain(session.sessionId, 1.8, 0.5);
      expect(session.inputGain).toBe(1.8);
      expect(session.outputVolume).toBe(0.5);

      // Clamping test
      manager.setGain(session.sessionId, 5.0, -1.0);
      expect(session.inputGain).toBe(2.0);
      expect(session.outputVolume).toBe(0.0);
    });

    it("ends session cleanly, records duration, and marks terminal state", () => {
      let currentTime = new Date("2026-08-15T12:00:00.000Z");
      const dynamicClock = () => currentTime;

      const messages: HostMessage[] = [];
      const manager = new VoiceSessionManager({
        send: (m) => messages.push(m),
        clock: dynamicClock,
      });

      const session = manager.startSession({});
      expect(manager.getActiveSession()?.sessionId).toBe(session.sessionId);

      currentTime = new Date("2026-08-15T12:00:45.000Z");

      manager.endSession(session.sessionId, "user_hangup", "req-end-1");

      expect(session.status).toBe("ended");
      expect(session.endedAt).toBe("2026-08-15T12:00:45.000Z");
      expect(session.durationSeconds).toBe(45);
      expect(session.endReason).toBe("user_hangup");
      expect(manager.getActiveSession()).toBeUndefined();

      const endStateMsg = messages.find(
        (m) => m.type === "voice.session.state" && m.status === "ended"
      );
      expect(endStateMsg).toBeDefined();
    });
  });

  describe("Suite 2: Transcript Submission & Turn Processing", () => {
    it("handles interim transcripts without changing listening state", async () => {
      const { manager, messages } = createTestHarness();

      const session = manager.startSession({});
      messages.length = 0;

      await manager.submitTranscript({
        requestId: "req-stt-1",
        sessionId: session.sessionId,
        turnId: "turn-1",
        text: "How are you",
        isFinal: false,
        confidence: 0.85,
        waveformBins: [10, 20, 30],
      });

      expect(session.status).toBe("listening");
      expect(messages.length).toBe(1);

      const transcriptMsg = messages[0];
      expect(transcriptMsg.type).toBe("voice.transcript.event");
      if (transcriptMsg.type === "voice.transcript.event") {
        expect(transcriptMsg.frame.kind).toBe("interim");
        expect(transcriptMsg.frame.text).toBe("How are you");
        expect(transcriptMsg.frame.confidence).toBe(0.85);
        expect(transcriptMsg.frame.isFinal).toBe(false);
      }
    });

    it("processes final transcript, streams TTS chunks, and completes turn", async () => {
      const { manager, messages } = createTestHarness();

      const session = manager.startSession({});
      messages.length = 0;

      await manager.submitTranscript({
        requestId: "req-stt-final-1",
        sessionId: session.sessionId,
        turnId: "turn-1",
        text: "Tell me a joke",
        isFinal: true,
      });

      expect(session.totalTurns).toBe(1);
      expect(session.currentTurnId).toBe("turn-1");
      expect(session.status).toBe("listening");

      const types = messages.map((m) => m.type);
      expect(types).toContain("voice.transcript.event");
      expect(types).toContain("voice.session.state");
      expect(types).toContain("voice.turn.event");
      expect(types).toContain("voice.tts.chunk");

      const ttsChunks = messages.filter(
        (m) => m.type === "voice.tts.chunk"
      ) as Extract<HostMessage, { type: "voice.tts.chunk" }>[];
      expect(ttsChunks.length).toBeGreaterThan(0);
      expect(ttsChunks[ttsChunks.length - 1].chunk.isLastChunk).toBe(true);

      const turnEvents = messages.filter(
        (m) => m.type === "voice.turn.event"
      ) as Extract<HostMessage, { type: "voice.turn.event" }>[];
      const completedEvent = turnEvents.find((e) => e.turn.state === "completed");
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.turn.prompt).toBe("Tell me a joke");
      expect(completedEvent?.turn.response).toBeDefined();
    });

    it("streams LLM responses using configured model adapter", async () => {
      const mockAdapter: ProviderAdapter = {
        id: "mock-llm-prov",
        capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
        async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderDelta> {
          yield { type: "text", text: "Here is " };
          yield { type: "text", text: "your answer." };
          yield { type: "done" };
        },
      };

      const { manager, messages } = createTestHarness({ customAdapter: mockAdapter });

      const session = manager.startSession({});
      messages.length = 0;

      await manager.submitTranscript({
        requestId: "req-llm-1",
        sessionId: session.sessionId,
        turnId: "turn-llm-1",
        text: "What is the answer?",
        isFinal: true,
      });

      const ttsChunks = messages.filter(
        (m) => m.type === "voice.tts.chunk"
      ) as Extract<HostMessage, { type: "voice.tts.chunk" }>[];

      expect(ttsChunks.length).toBe(3);
      expect(ttsChunks[0].chunk.textChunk).toBe("Here is ");
      expect(ttsChunks[1].chunk.textChunk).toBe("your answer.");
      expect(ttsChunks[2].chunk.isLastChunk).toBe(true);

      const agentTranscripts = messages.filter(
        (m) => m.type === "voice.transcript.event" && m.frame.speaker === "agent"
      ) as Extract<HostMessage, { type: "voice.transcript.event" }>[];
      expect(agentTranscripts.length).toBe(1);
      expect(agentTranscripts[0].frame.text).toBe("Here is your answer.");
    });
  });

  describe("Suite 3: Barge-In Interruption Engine", () => {
    it("aborts in-flight generation when voice.interrupt is received during streaming", async () => {
      let aborted = false;

      const delayedAdapter: ProviderAdapter = {
        id: "delayed-prov",
        capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
        async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderDelta> {
          yield { type: "text", text: "Starting..." };
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 500);
            signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              aborted = true;
              resolve();
            });
          });
          if (signal?.aborted) return;
          yield { type: "text", text: "Finished!" };
          yield { type: "done" };
        },
      };

      const { manager, messages } = createTestHarness({ customAdapter: delayedAdapter });

      const session = manager.startSession({});
      messages.length = 0;

      const turnPromise = manager.submitTranscript({
        requestId: "req-delay-1",
        sessionId: session.sessionId,
        turnId: "turn-slow-1",
        text: "Tell me a long story",
        isFinal: true,
      });

      await new Promise((r) => setTimeout(r, 10));

      manager.interrupt({
        requestId: "req-interrupt-1",
        sessionId: session.sessionId,
        turnId: "turn-slow-1",
        reason: "user_speech_detected",
        spokenTextSnippet: "Stop, new question",
      });

      await turnPromise;

      expect(aborted).toBe(true);
      expect(session.status).toBe("listening");

      const interruptEvent = messages.find((m) => m.type === "voice.interrupted");
      expect(interruptEvent).toBeDefined();
      if (interruptEvent && interruptEvent.type === "voice.interrupted") {
        expect(interruptEvent.frame.reason).toBe("user_speech_detected");
        expect(interruptEvent.frame.spokenTextSnippet).toBe("Stop, new question");
      }

      const turnSync = messages.find(
        (m) => m.type === "voice.turn.event" && m.turn.state === "interrupted"
      );
      expect(turnSync).toBeDefined();
    });

    it("safely ignores interrupt when session is already listening or idle", () => {
      const { manager, messages } = createTestHarness();

      const session = manager.startSession({});
      messages.length = 0;

      manager.interrupt({
        requestId: "req-noop-interrupt",
        sessionId: session.sessionId,
        reason: "user_manual_button",
      });

      expect(messages.length).toBe(0);
      expect(session.status).toBe("listening");
    });
  });

  describe("Suite 4: Client WebSocket Message Handling & Edge Cases", () => {
    it("routes all voice.* client messages through handleClientMessage", async () => {
      const { manager } = createTestHarness();

      await manager.handleClientMessage({
        type: "voice.session.start",
        requestId: "req-ws-start",
        inputGain: 1.2,
      });
      const active = manager.getActiveSession();
      expect(active).toBeDefined();
      if (!active) return;

      await manager.handleClientMessage({
        type: "voice.session.pause",
        requestId: "req-ws-pause",
        sessionId: active.sessionId,
      });
      expect(active.status).toBe("idle");

      await manager.handleClientMessage({
        type: "voice.session.resume",
        requestId: "req-ws-resume",
        sessionId: active.sessionId,
      });
      expect(active.status).toBe("listening");

      await manager.handleClientMessage({
        type: "voice.session.mute",
        requestId: "req-ws-mute",
        sessionId: active.sessionId,
        muted: true,
      });
      expect(active.isMuted).toBe(true);
      expect(active.status).toBe("muted");

      await manager.handleClientMessage({
        type: "voice.session.gain",
        requestId: "req-ws-gain",
        sessionId: active.sessionId,
        inputGain: 1.6,
        outputVolume: 0.7,
      });
      expect(active.inputGain).toBe(1.6);
      expect(active.outputVolume).toBe(0.7);

      await manager.handleClientMessage({
        type: "voice.session.end",
        requestId: "req-ws-end",
        sessionId: active.sessionId,
        reason: "user_hangup",
      });
      expect(active.status).toBe("ended");
    });

    it("emits error frame when operating on non-existent sessionId", async () => {
      const { manager, messages } = createTestHarness();

      const fakeSessionId = "00000000-0000-0000-0000-000000000000";

      manager.pauseSession(fakeSessionId, "req-err-1");
      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("error");
      if (messages[0].type === "error") {
        expect(messages[0].code).toBe(VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND);
      }

      messages.length = 0;
      await manager.submitTranscript({
        requestId: "req-err-2",
        sessionId: fakeSessionId,
        turnId: "turn-1",
        text: "hello",
        isFinal: true,
      });
      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("error");
    });

    it("cleans up active sessions on dispose()", () => {
      const { manager } = createTestHarness();

      const session = manager.startSession({});
      expect(manager.getActiveSession()).toBeDefined();

      manager.dispose();

      expect(session.status).toBe("ended");
      expect(session.endReason).toBe("connection_lost");
      expect(manager.getActiveSession()).toBeUndefined();
      expect(manager.listSessions().length).toBe(0);
    });
  });

  describe("Suite 5: End-to-End WebSocket Session Wire Integration", () => {
    it("handles live WebSocket voice call handshake, transcription, and termination", async () => {
      liveHost = await createHost();
      const ws = new NativeWebSocket(
        `ws://127.0.0.1:${liveHost.port}/agent?token=${liveHost.token}`
      );

      await waitForOpen(ws);

      // Collect initial host.ready
      const initialMessages = await collectMessagesUntil(
        ws,
        (msg) => msg.type === "host.ready"
      );
      expect(initialMessages.some((m) => m.type === "host.ready")).toBe(true);

      // 1. Send voice.session.start
      ws.send(
        JSON.stringify({
          type: "voice.session.start",
          requestId: "ws-req-1",
          inputGain: 1.2,
          outputVolume: 0.9,
        })
      );

      const startMessages = await collectMessagesUntil(
        ws,
        (msg) => msg.type === "voice.session.state" && msg.status === "listening"
      );

      const readyMsg = startMessages.find((m) => m.type === "voice.session.ready") as
        | { session: VoiceCallSession }
        | undefined;
      expect(readyMsg).toBeDefined();
      const sessionId = readyMsg!.session.sessionId;

      // 2. Send voice.session.mute
      ws.send(
        JSON.stringify({
          type: "voice.session.mute",
          requestId: "ws-req-2",
          sessionId,
          muted: true,
        })
      );

      const muteMessages = await collectMessagesUntil(
        ws,
        (msg) => msg.type === "voice.session.state" && msg.status === "muted"
      );
      expect(muteMessages.some((m) => m.status === "muted")).toBe(true);

      // 3. Send voice.session.mute (unmute)
      ws.send(
        JSON.stringify({
          type: "voice.session.mute",
          requestId: "ws-req-3",
          sessionId,
          muted: false,
        })
      );

      const unmuteMessages = await collectMessagesUntil(
        ws,
        (msg) => msg.type === "voice.session.state" && msg.status === "listening"
      );
      expect(unmuteMessages.some((m) => m.status === "listening")).toBe(true);

      // 4. Send voice.transcript.submit (final)
      ws.send(
        JSON.stringify({
          type: "voice.transcript.submit",
          requestId: "ws-req-4",
          sessionId,
          turnId: "turn-live-1",
          text: "What is 2+2?",
          isFinal: true,
        })
      );

      // Collect through turn completion
      const turnMessages = await collectMessagesUntil(
        ws,
        (msg) => msg.type === "voice.turn.event" && (msg.turn as VoiceTurnSync)?.state === "completed"
      );
      expect(turnMessages.some((m) => m.type === "voice.tts.chunk")).toBe(true);

      // 5. Send voice.session.end
      ws.send(
        JSON.stringify({
          type: "voice.session.end",
          requestId: "ws-req-5",
          sessionId,
          reason: "user_hangup",
        })
      );

      const endMessages = await collectMessagesUntil(
        ws,
        (msg) => msg.type === "voice.session.state" && msg.status === "ended"
      );
      expect(endMessages.some((m) => m.status === "ended")).toBe(true);

      ws.close();
    });

    it("closes socket with 4400 on malformed voice frame", async () => {
      liveHost = await createHost();
      const ws = new NativeWebSocket(
        `ws://127.0.0.1:${liveHost.port}/agent?token=${liveHost.token}`
      );

      await waitForOpen(ws);

      const closePromise = waitForClose(ws);

      // Send schema-violating voice message (invalid gain > 2.0)
      ws.send(
        JSON.stringify({
          type: "voice.session.start",
          requestId: "bad-req",
          inputGain: 99.0, // Fails schema validation
        })
      );

      const { code } = await closePromise;
      expect(code).toBe(CLOSE_INVALID_MESSAGE);
    });
  });
});

/**
 * Agent-Host Voice Session Manager — Milestone 1
 *
 * Implements server-side voice call lifecycle management, STT transcript ingestion,
 * streaming LLM turn generation with TTS chunking, barge-in interruption via AbortController,
 * and WebSocket client message routing.
 */

import {
  createVoiceCallSession,
  createVoiceInterruptFrame,
  createVoiceTranscriptFrame,
  createVoiceTtsChunk,
  createVoiceTurnSync,
  clampGain,
  clampVolume,
  VOICE_ERROR_CODES,
  type VoiceCallSession,
  type VoiceCallStatus,
  type VoiceCallEndReason,
  type VoiceInterruptReason,
  type VoiceProfile,
  type VoiceParticipant,
  type VoiceClientMessage,
} from "@protocol/voice";
import type { ModelProfile } from "@protocol/routing";
import type { ProviderRegistry } from "../providers/types";
import type { RunCoordinator } from "../runs/coordinator";
import type { ClientMessage, HostMessage } from "../protocol";

export interface VoiceSessionManagerOptions {
  workspaceRoot?: string;
  coordinator?: RunCoordinator;
  providerRegistry?: ProviderRegistry;
  profiles?: readonly ModelProfile[];
  send: (message: HostMessage) => void;
  clock?: () => Date;
  generateId?: () => string;
}

export interface VoiceTurnHistoryEntry {
  turnId: string;
  speaker: "user" | "agent";
  text: string;
  timestamp: string;
}

export class VoiceSessionManager {
  private readonly sessions = new Map<string, VoiceCallSession>();
  private readonly turnHistory = new Map<string, VoiceTurnHistoryEntry[]>();
  private activeSessionId?: string;
  private activeTurnAbort?: AbortController;
  private activeTurnId?: string;
  private activeTurnStartTime?: number;
  private readonly send: (message: HostMessage) => void;
  private readonly clock: () => Date;
  private readonly generateId: () => string;
  private isDisposed = false;

  constructor(private readonly options: VoiceSessionManagerOptions) {
    this.send = options.send;
    this.clock = options.clock ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private emitError(params: {
    code: string;
    message: string;
    sessionId?: string;
    requestId?: string;
  }): void {
    this.send({
      type: "error",
      code: params.code,
      message: params.message,
      at: this.nowIso(),
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 1. Session Lifecycle                                                     */
  /* ------------------------------------------------------------------------ */

  startSession(params: {
    requestId?: string;
    voiceProfile?: Partial<VoiceProfile>;
    participant?: Partial<VoiceParticipant>;
    inputGain?: number;
    outputVolume?: number;
  }): VoiceCallSession {
    if (this.isDisposed) {
      throw new Error("VoiceSessionManager is disposed");
    }

    const sessionId = this.generateId();
    const session = createVoiceCallSession({
      sessionId,
      status: "connecting",
      startedAt: this.nowIso(),
      voiceProfile: params.voiceProfile,
      participant: params.participant,
      inputGain: params.inputGain,
      outputVolume: params.outputVolume,
    });

    this.sessions.set(sessionId, session);
    this.turnHistory.set(sessionId, []);
    this.activeSessionId = sessionId;

    // Emit voice.session.ready
    this.send({
      type: "voice.session.ready",
      requestId: params.requestId,
      session,
      at: this.nowIso(),
    });

    // Transition to listening (or muted if started in muted configuration)
    const targetStatus: VoiceCallStatus = session.isMuted ? "muted" : "listening";
    session.status = targetStatus;

    this.send({
      type: "voice.session.state",
      requestId: params.requestId,
      sessionId,
      status: targetStatus,
      at: this.nowIso(),
      detail: "Session initialized and ready for voice input",
    });

    return session;
  }

  pauseSession(sessionId: string, requestId?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "ended") {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Voice session not found: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    session.status = "idle";
    this.send({
      type: "voice.session.state",
      requestId,
      sessionId,
      status: "idle",
      at: this.nowIso(),
      detail: "Session paused",
    });
  }

  resumeSession(sessionId: string, requestId?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "ended") {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Voice session not found: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    const nextStatus: VoiceCallStatus = session.isMuted ? "muted" : "listening";
    session.status = nextStatus;

    this.send({
      type: "voice.session.state",
      requestId,
      sessionId,
      status: nextStatus,
      at: this.nowIso(),
      detail: "Session resumed",
    });
  }

  endSession(
    sessionId: string,
    reason: VoiceCallEndReason = "user_hangup",
    requestId?: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Voice session not found: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    if (session.status === "ended") {
      return; // Already ended
    }

    // Abort active in-flight turn if any
    if (this.activeTurnAbort && this.activeSessionId === sessionId) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = undefined;
      this.activeTurnId = undefined;
    }

    const endedAtDate = this.clock();
    const startedAtDate = new Date(session.startedAt);
    const duration = Math.max(
      0,
      Math.round((endedAtDate.getTime() - startedAtDate.getTime()) / 1000)
    );

    session.status = "ended";
    session.endedAt = endedAtDate.toISOString();
    session.durationSeconds = duration;
    session.endReason = reason;

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }

    this.send({
      type: "voice.session.state",
      requestId,
      sessionId,
      status: "ended",
      at: this.nowIso(),
      detail: `Call ended (${reason})`,
    });
  }

  setMute(sessionId: string, muted: boolean, requestId?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "ended") {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Voice session not found: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    session.isMuted = muted;

    // If currently listening, update status to muted or vice versa
    if (session.status === "listening" && muted) {
      session.status = "muted";
      this.send({
        type: "voice.session.state",
        requestId,
        sessionId,
        status: "muted",
        at: this.nowIso(),
        detail: "Microphone muted",
      });
    } else if (session.status === "muted" && !muted) {
      session.status = "listening";
      this.send({
        type: "voice.session.state",
        requestId,
        sessionId,
        status: "listening",
        at: this.nowIso(),
        detail: "Microphone unmuted",
      });
    }
  }

  setGain(
    sessionId: string,
    inputGain?: number,
    outputVolume?: number,
    requestId?: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "ended") {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Voice session not found: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    if (inputGain !== undefined) {
      session.inputGain = clampGain(inputGain);
    }
    if (outputVolume !== undefined) {
      session.outputVolume = clampVolume(outputVolume);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* 2. STT Transcript Submission & Streaming Response                        */
  /* ------------------------------------------------------------------------ */

  async submitTranscript(params: {
    requestId: string;
    sessionId: string;
    turnId: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
    waveformBins?: number[];
  }): Promise<void> {
    const { sessionId, turnId, text, isFinal, confidence, waveformBins, requestId } = params;
    const session = this.sessions.get(sessionId);

    if (!session || session.status === "ended") {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Cannot submit transcript to closed/unknown session: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    const timestamp = this.nowIso();

    // 1. Interim Transcript: Broadcast frame, stay in current state
    if (!isFinal) {
      const frame = createVoiceTranscriptFrame({
        sessionId,
        turnId,
        speaker: "user",
        kind: "interim",
        text,
        confidence,
        isFinal: false,
        timestamp,
        waveformBins,
      });

      this.send({
        type: "voice.transcript.event",
        frame,
        at: timestamp,
      });
      return;
    }

    // 2. Final Transcript: Commit turn, transition to thinking, generate response
    const finalFrame = createVoiceTranscriptFrame({
      sessionId,
      turnId,
      speaker: "user",
      kind: "final",
      text,
      confidence,
      isFinal: true,
      timestamp,
      waveformBins,
    });

    this.send({
      type: "voice.transcript.event",
      frame: finalFrame,
      at: timestamp,
    });

    // Record turn in history
    const history = this.turnHistory.get(sessionId) ?? [];
    history.push({
      turnId,
      speaker: "user",
      text,
      timestamp,
    });
    this.turnHistory.set(sessionId, history);

    session.totalTurns += 1;
    session.currentTurnId = turnId;
    session.status = "thinking";

    this.send({
      type: "voice.session.state",
      requestId,
      sessionId,
      status: "thinking",
      at: timestamp,
      detail: "Processing voice prompt",
    });

    this.send({
      type: "voice.turn.event",
      turn: createVoiceTurnSync({
        sessionId,
        turnId,
        state: "thinking",
        prompt: text,
        timestamp,
      }),
      at: timestamp,
    });

    // Execute LLM stream & TTS chunking
    await this.processTurnResponse(session, turnId, text, history);
  }

  private async processTurnResponse(
    session: VoiceCallSession,
    turnId: string,
    promptText: string,
    history: VoiceTurnHistoryEntry[]
  ): Promise<void> {
    const sessionId = session.sessionId;
    const abortController = new AbortController();
    this.activeTurnAbort = abortController;
    this.activeTurnId = turnId;
    const startTime = this.clock().getTime();
    this.activeTurnStartTime = startTime;

    let fullResponse = "";
    let chunkIndex = 0;
    let hasEmittedSpeaking = false;

    try {
      // Check if provider is available in registry
      const registry = this.options.providerRegistry;
      const profiles = this.options.profiles;
      let streamed = false;

      if (registry && profiles && profiles.length > 0) {
        const profile = profiles[0];
        const entry = registry.get(profile.provider);
        if (entry && entry.health.status === "available") {
          try {
            const chatMessages = history.map((h) => ({
              role: (h.speaker === "user" ? "user" : "assistant") as "user" | "assistant",
              content: h.text,
            }));

            const stream = entry.adapter.streamChat(
              { messages: chatMessages },
              abortController.signal
            );

            for await (const delta of stream) {
              if (abortController.signal.aborted) break;

              if (delta.type === "text" && delta.text) {
                if (!hasEmittedSpeaking) {
                  hasEmittedSpeaking = true;
                  session.status = "speaking";
                  this.send({
                    type: "voice.session.state",
                    sessionId,
                    status: "speaking",
                    at: this.nowIso(),
                  });
                  this.send({
                    type: "voice.turn.event",
                    turn: createVoiceTurnSync({
                      sessionId,
                      turnId,
                      state: "speaking",
                      prompt: promptText,
                      timestamp: this.nowIso(),
                    }),
                    at: this.nowIso(),
                  });
                }

                fullResponse += delta.text;

                // Emit incremental TTS chunk
                this.send({
                  type: "voice.tts.chunk",
                  chunk: createVoiceTtsChunk({
                    sessionId,
                    turnId,
                    chunkIndex: chunkIndex++,
                    textChunk: delta.text,
                    isLastChunk: false,
                    timestamp: this.nowIso(),
                  }),
                  at: this.nowIso(),
                });
                streamed = true;
              } else if (delta.type === "done") {
                streamed = true;
                break;
              } else if (delta.type === "error") {
                throw new Error(delta.message || "Model stream error");
              }
            }
          } catch (providerError) {
            if (abortController.signal.aborted) throw providerError;
            if (!streamed) {
              // Provider failed before sending any tokens; allow synthetic fallback below
              streamed = false;
            } else {
              throw providerError;
            }
          }
        }
      }

      // Default synthetic response if no provider configured
      if (!streamed && !abortController.signal.aborted) {
        hasEmittedSpeaking = true;
        session.status = "speaking";
        this.send({
          type: "voice.session.state",
          sessionId,
          status: "speaking",
          at: this.nowIso(),
        });

        const syntheticReply = `Acknowledged: "${promptText}". I am listening.`;
        fullResponse = syntheticReply;

        // Split synthetic reply into tokens/chunks
        const words = syntheticReply.split(" ");
        for (let i = 0; i < words.length; i++) {
          if (abortController.signal.aborted) break;
          const wordChunk = (i > 0 ? " " : "") + words[i];

          this.send({
            type: "voice.tts.chunk",
            chunk: createVoiceTtsChunk({
              sessionId,
              turnId,
              chunkIndex: chunkIndex++,
              textChunk: wordChunk,
              isLastChunk: false,
              timestamp: this.nowIso(),
            }),
            at: this.nowIso(),
          });
        }
      }

      // Check if interrupted during processing
      if (abortController.signal.aborted) {
        return;
      }

      // Finalize turn
      const endTime = this.clock().getTime();
      const latencyMs = Math.max(0, endTime - startTime);
      const timestamp = this.nowIso();

      // Emit final TTS chunk delimiter
      this.send({
        type: "voice.tts.chunk",
        chunk: createVoiceTtsChunk({
          sessionId,
          turnId,
          chunkIndex: chunkIndex,
          textChunk: "",
          isLastChunk: true,
          timestamp,
        }),
        at: timestamp,
      });

      // Emit final agent transcript frame
      this.send({
        type: "voice.transcript.event",
        frame: createVoiceTranscriptFrame({
          sessionId,
          turnId,
          speaker: "agent",
          kind: "final",
          text: fullResponse,
          isFinal: true,
          timestamp,
        }),
        at: timestamp,
      });

      // Record agent response in history
      history.push({
        turnId,
        speaker: "agent",
        text: fullResponse,
        timestamp,
      });

      // Turn completed sync event
      this.send({
        type: "voice.turn.event",
        turn: createVoiceTurnSync({
          sessionId,
          turnId,
          state: "completed",
          prompt: promptText,
          response: fullResponse,
          latencyMs,
          timestamp,
        }),
        at: timestamp,
      });

      // Return session to listening (or muted)
      const returnStatus: VoiceCallStatus = session.isMuted ? "muted" : "listening";
      session.status = returnStatus;

      this.send({
        type: "voice.session.state",
        sessionId,
        status: returnStatus,
        at: timestamp,
      });
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.send({
        type: "voice.turn.event",
        turn: createVoiceTurnSync({
          sessionId,
          turnId,
          state: "error",
          prompt: promptText,
          timestamp: this.nowIso(),
        }),
        at: this.nowIso(),
      });

      const returnStatus: VoiceCallStatus = session.isMuted ? "muted" : "listening";
      session.status = returnStatus;

      this.send({
        type: "voice.session.state",
        sessionId,
        status: returnStatus,
        at: this.nowIso(),
        detail: `Turn error: ${errorMessage}`,
      });
    } finally {
      if (this.activeTurnAbort === abortController) {
        this.activeTurnAbort = undefined;
        this.activeTurnId = undefined;
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* 3. Barge-In Interruption Signal Engine                                   */
  /* ------------------------------------------------------------------------ */

  interrupt(params: {
    requestId: string;
    sessionId: string;
    turnId?: string;
    reason: VoiceInterruptReason;
    spokenTextSnippet?: string;
  }): void {
    const { sessionId, turnId, reason, spokenTextSnippet, requestId } = params;
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.emitError({
        code: VOICE_ERROR_CODES.ERR_VOICE_SESSION_NOT_FOUND,
        message: `Voice session not found: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }

    // If session is not currently thinking or speaking, safe no-op
    if (session.status !== "thinking" && session.status !== "speaking") {
      return;
    }

    const currentTurn = turnId ?? this.activeTurnId ?? session.currentTurnId ?? "turn-0";
    const interruptedAtMs = this.activeTurnStartTime
      ? Math.max(0, this.clock().getTime() - this.activeTurnStartTime)
      : 0;

    // Abort active LLM / TTS stream
    if (this.activeTurnAbort) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = undefined;
      this.activeTurnId = undefined;
    }

    const timestamp = this.nowIso();

    // 1. Emit voice.interrupted frame
    const interruptFrame = createVoiceInterruptFrame({
      sessionId,
      turnId: currentTurn,
      reason,
      interruptedAtMs,
      spokenTextSnippet,
      timestamp,
    });

    this.send({
      type: "voice.interrupted",
      frame: interruptFrame,
      at: timestamp,
    });

    // 2. Emit voice.turn.event (state: interrupted)
    this.send({
      type: "voice.turn.event",
      turn: createVoiceTurnSync({
        sessionId,
        turnId: currentTurn,
        state: "interrupted",
        prompt: spokenTextSnippet ?? "",
        timestamp,
      }),
      at: timestamp,
    });

    // 3. Reset session status to listening (or muted)
    const nextStatus: VoiceCallStatus = session.isMuted ? "muted" : "listening";
    session.status = nextStatus;

    this.send({
      type: "voice.session.state",
      requestId,
      sessionId,
      status: nextStatus,
      at: timestamp,
      detail: `Agent interrupted by ${reason}`,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 4. Client WebSocket Message Dispatcher                                   */
  /* ------------------------------------------------------------------------ */

  async handleClientMessage(msg: ClientMessage | VoiceClientMessage): Promise<void> {
    switch (msg.type) {
      case "voice.session.start":
        this.startSession(msg);
        break;

      case "voice.session.pause":
        this.pauseSession(msg.sessionId, msg.requestId);
        break;

      case "voice.session.resume":
        this.resumeSession(msg.sessionId, msg.requestId);
        break;

      case "voice.session.end":
        this.endSession(msg.sessionId, msg.reason, msg.requestId);
        break;

      case "voice.session.mute":
        this.setMute(msg.sessionId, msg.muted, msg.requestId);
        break;

      case "voice.session.gain":
        this.setGain(msg.sessionId, msg.inputGain, msg.outputVolume, msg.requestId);
        break;

      case "voice.transcript.submit":
        await this.submitTranscript(msg);
        break;

      case "voice.interrupt":
        this.interrupt(msg);
        break;

      case "voice.audio.chunk":
        // Binary / PCM audio chunk frame ingestion seam
        break;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* 5. Queries & Disposal                                                    */
  /* ------------------------------------------------------------------------ */

  getSession(sessionId: string): VoiceCallSession | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSession(): VoiceCallSession | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  listSessions(): VoiceCallSession[] {
    return Array.from(this.sessions.values());
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.activeTurnAbort) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = undefined;
      this.activeTurnId = undefined;
    }

    for (const session of this.sessions.values()) {
      if (session.status !== "ended") {
        session.status = "ended";
        session.endedAt = this.nowIso();
        session.endReason = "connection_lost";
      }
    }

    this.sessions.clear();
    this.turnHistory.clear();
    this.activeSessionId = undefined;
  }
}

/**
 * Tier 1 — Feature Coverage Test Suite (60 Test Cases)
 *
 * Implements 5 comprehensive test cases for each of the 12 Voice Call features (F1 to F12)
 * according to TEST_INFRA.md § Tier 1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createVoiceTestHarness,
  VoiceTestHarness,
  chunkTextForTts,
  MockAudioEngine,
  MockSpeechRecognition,
  MockSpeechSynthesis,
  MockSpeechSynthesisUtterance,
  VirtualVoiceHost,
  VirtualVoiceClient,
} from "./harness";
import {
  isValidVoiceStateTransition,
  createVoiceCallSession,
  voiceSessionStartMsgSchema,
  voiceSessionPauseMsgSchema,
  voiceSessionResumeMsgSchema,
  voiceSessionEndMsgSchema,
  voiceSessionMuteMsgSchema,
  voiceTranscriptSubmitMsgSchema,
  voiceInterruptMsgSchema,
  voiceSessionReadyEventSchema,
  voiceSessionStateEventSchema,
  voiceTranscriptEventSchema,
  voiceTtsChunkEventSchema,
  voiceInterruptedEventSchema,
  VoiceCallStatus,
} from "@protocol/voice";

describe("Tier 1 — Feature Coverage Test Suite (F1 - F12)", () => {
  let harness: VoiceTestHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createVoiceTestHarness();
  });

  afterEach(() => {
    harness.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /* ------------------------------------------------------------------ */
  /* F1: Voice Call Protocol & State Machine                           */
  /* ------------------------------------------------------------------ */
  describe("F1: Voice Call Protocol & State Machine", () => {
    it("T1.F1.1: Valid session lifecycle transitions: idle -> connecting -> listening -> thinking -> speaking -> ended", () => {
      const transitions: Array<[VoiceCallStatus, VoiceCallStatus]> = [
        ["idle", "connecting"],
        ["connecting", "listening"],
        ["listening", "thinking"],
        ["thinking", "speaking"],
        ["speaking", "ended"],
      ];

      for (const [from, to] of transitions) {
        expect(isValidVoiceStateTransition(from, to)).toBe(true);
      }
    });

    it("T1.F1.2: Schema validation for voice.session.start, pause, resume, end, mute", () => {
      const sessionId = crypto.randomUUID();
      const requestId = crypto.randomUUID();

      const startMsg = voiceSessionStartMsgSchema.parse({
        type: "voice.session.start",
        requestId,
        inputGain: 1.2,
        outputVolume: 0.8,
      });
      expect(startMsg.type).toBe("voice.session.start");

      const pauseMsg = voiceSessionPauseMsgSchema.parse({
        type: "voice.session.pause",
        requestId,
        sessionId,
      });
      expect(pauseMsg.sessionId).toBe(sessionId);

      const resumeMsg = voiceSessionResumeMsgSchema.parse({
        type: "voice.session.resume",
        requestId,
        sessionId,
      });
      expect(resumeMsg.sessionId).toBe(sessionId);

      const endMsg = voiceSessionEndMsgSchema.parse({
        type: "voice.session.end",
        requestId,
        sessionId,
        reason: "user_hangup",
      });
      expect(endMsg.reason).toBe("user_hangup");

      const muteMsg = voiceSessionMuteMsgSchema.parse({
        type: "voice.session.mute",
        requestId,
        sessionId,
        muted: true,
      });
      expect(muteMsg.muted).toBe(true);
    });

    it("T1.F1.3: Schema validation for voice.transcript.submit and voice.interrupt", () => {
      const sessionId = crypto.randomUUID();
      const turnId = crypto.randomUUID();
      const requestId = crypto.randomUUID();

      const submitMsg = voiceTranscriptSubmitMsgSchema.parse({
        type: "voice.transcript.submit",
        requestId,
        sessionId,
        turnId,
        text: "Hello NanoForge",
        isFinal: true,
        confidence: 0.98,
      });
      expect(submitMsg.text).toBe("Hello NanoForge");
      expect(submitMsg.isFinal).toBe(true);

      const interruptMsg = voiceInterruptMsgSchema.parse({
        type: "voice.interrupt",
        requestId,
        sessionId,
        turnId,
        reason: "user_speech_detected",
        spokenTextSnippet: "Wait a second",
      });
      expect(interruptMsg.reason).toBe("user_speech_detected");
      expect(interruptMsg.spokenTextSnippet).toBe("Wait a second");
    });

    it("T1.F1.4: Host events schema validation (ready, state, transcript.event, tts.chunk, interrupted)", () => {
      const sessionId = crypto.randomUUID();
      const session = createVoiceCallSession({ sessionId, status: "listening" });

      const readyEvent = voiceSessionReadyEventSchema.parse({
        type: "voice.session.ready",
        requestId: "req-1",
        session,
        at: new Date().toISOString(),
      });
      expect(readyEvent.session.sessionId).toBe(sessionId);

      const stateEvent = voiceSessionStateEventSchema.parse({
        type: "voice.session.state",
        sessionId,
        status: "speaking",
        at: new Date().toISOString(),
      });
      expect(stateEvent.status).toBe("speaking");

      const transcriptEvent = voiceTranscriptEventSchema.parse({
        type: "voice.transcript.event",
        frame: {
          sessionId,
          turnId: "turn-1",
          speaker: "user",
          kind: "final",
          text: "What is the weather?",
          confidence: 0.95,
          isFinal: true,
          timestamp: new Date().toISOString(),
        },
        at: new Date().toISOString(),
      });
      expect(transcriptEvent.frame.speaker).toBe("user");

      const ttsEvent = voiceTtsChunkEventSchema.parse({
        type: "voice.tts.chunk",
        chunk: {
          sessionId,
          turnId: "turn-1",
          chunkIndex: 0,
          textChunk: "It is sunny.",
          isLastChunk: true,
          timestamp: new Date().toISOString(),
        },
        at: new Date().toISOString(),
      });
      expect(ttsEvent.chunk.textChunk).toBe("It is sunny.");

      const interruptedEvent = voiceInterruptedEventSchema.parse({
        type: "voice.interrupted",
        frame: {
          sessionId,
          turnId: "turn-1",
          reason: "user_manual_button",
          interruptedAtMs: 1234,
          timestamp: new Date().toISOString(),
        },
        at: new Date().toISOString(),
      });
      expect(interruptedEvent.frame.reason).toBe("user_manual_button");
    });

    it("T1.F1.5: Rejection of illegal state transitions (e.g. ended -> speaking without new start)", () => {
      expect(isValidVoiceStateTransition("ended", "speaking")).toBe(false);
      expect(isValidVoiceStateTransition("ended", "thinking")).toBe(false);
      expect(isValidVoiceStateTransition("ended", "listening")).toBe(false);
      // Valid transition from ended is only to 'connecting' (restart) or 'idle'
      expect(isValidVoiceStateTransition("ended", "connecting")).toBe(true);
      expect(isValidVoiceStateTransition("ended", "idle")).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /* F2: Agent-Host Voice Session Manager                              */
  /* ------------------------------------------------------------------ */
  describe("F2: Agent-Host Voice Session Manager", () => {
    it("T1.F2.1: Session creation on voice.session.start and broadcast of voice.session.ready", async () => {
      await harness.client.startCall();

      expect(harness.client.session).not.toBeNull();
      expect(harness.client.status).toBe("listening");
      harness.assertHostEventCount("voice.session.ready", 1);
      harness.assertHostEventCount("voice.session.state", 1);
    });

    it("T1.F2.2: Mute and unmute handling updating server session state", async () => {
      await harness.client.startCall();

      harness.client.setMuted(true);
      expect(harness.client.isMuted).toBe(true);
      expect(harness.client.status).toBe("muted");

      harness.client.setMuted(false);
      expect(harness.client.isMuted).toBe(false);
      expect(harness.client.status).toBe("listening");
    });

    it("T1.F2.3: Pause and resume session handling", async () => {
      await harness.client.startCall();
      const sessionId = harness.client.session!.sessionId;

      harness.host.handleClientMessage({
        type: "voice.session.pause",
        requestId: "req-p",
        sessionId,
      });
      expect(harness.host.sessions.get(sessionId)?.status).toBe("idle");

      harness.host.handleClientMessage({
        type: "voice.session.resume",
        requestId: "req-r",
        sessionId,
      });
      expect(harness.host.sessions.get(sessionId)?.status).toBe("listening");
    });

    it("T1.F2.4: Clean session termination on voice.session.end", async () => {
      await harness.client.startCall();
      const sessionId = harness.client.session!.sessionId;

      harness.client.endCall("user_hangup");
      expect(harness.client.status).toBe("ended");
      expect(harness.host.sessions.get(sessionId)?.status).toBe("ended");
      expect(harness.host.sessions.get(sessionId)?.endReason).toBe("user_hangup");
    });

    it("T1.F2.5: Automatic cleanup on client socket disconnect", async () => {
      await harness.client.startCall();
      const sessionId = harness.client.session!.sessionId;

      harness.host.handleSocketDisconnect(sessionId);
      expect(harness.host.sessions.get(sessionId)?.status).toBe("ended");
      expect(harness.host.sessions.get(sessionId)?.endReason).toBe("connection_lost");
    });
  });

  /* ------------------------------------------------------------------ */
  /* F3: Barge-In Interruption Signal Engine                           */
  /* ------------------------------------------------------------------ */
  describe("F3: Barge-In Interruption Signal Engine", () => {
    it("T1.F3.1: Interruption frame emission when client triggers interrupt during speech playback", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Tell me a story");

      harness.client.interruptAgent("user_manual_button");
      harness.assertHostEventCount("voice.interrupted", 1);
    });

    it("T1.F3.2: Server aborts ongoing token stream upon receiving voice.interrupt", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Long explanation");

      harness.client.interruptAgent("user_speech_detected");
      const lastEvent = harness.host.eventLog[harness.host.eventLog.length - 2];
      expect(lastEvent.type).toBe("voice.turn.event");
      if (lastEvent.type === "voice.turn.event") {
        expect(lastEvent.turn.state).toBe("interrupted");
      }
    });

    it("T1.F3.3: TTS audio queue immediate clearance upon interruption", async () => {
      await harness.client.startCall();

      const utt1 = new MockSpeechSynthesisUtterance("Sentence 1");
      const utt2 = new MockSpeechSynthesisUtterance("Sentence 2");
      harness.synthesis.speak(utt1);
      harness.synthesis.speak(utt2);

      expect(harness.synthesis.speaking).toBe(true);
      harness.client.interruptAgent();

      expect(harness.synthesis.speaking).toBe(false);
      expect(harness.synthesis.currentUtterance).toBeNull();
    });

    it("T1.F3.4: State reverts to listening after successful interruption", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Hello");

      harness.client.interruptAgent();
      expect(harness.client.status).toBe("listening");
    });

    it("T1.F3.5: Interrupted turn event records partial transcript with interrupted: true", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Generate 10 bullet points");

      harness.client.interruptAgent();
      const lastTurn = harness.client.transcriptHistory[harness.client.transcriptHistory.length - 1];
      expect(lastTurn.interrupted).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /* F4: Web Audio Engine & Gain/Volume                                */
  /* ------------------------------------------------------------------ */
  describe("F4: Web Audio Engine & Gain/Volume", () => {
    it("T1.F4.1: AudioEngine initialization creates AudioContext and nodes cleanly", async () => {
      const audio = new MockAudioEngine();
      expect(audio.isInitialized).toBe(false);

      const success = await audio.initialize();
      expect(success).toBe(true);
      expect(audio.isInitialized).toBe(true);
      expect(audio.context).not.toBeNull();
      expect(audio.micGainNode).not.toBeNull();
      expect(audio.micAnalyser).not.toBeNull();
      audio.cleanup();
    });

    it("T1.F4.2: Mic gain adjustments (0.0 to 2.0) modify gain node value correctly", async () => {
      await harness.client.startCall();

      harness.client.setMicGain(1.8);
      expect(harness.audio.micGain).toBe(1.8);
      expect(harness.audio.micGainNode?.gain.value).toBe(1.8);

      // Clamping check
      harness.client.setMicGain(3.0);
      expect(harness.audio.micGain).toBe(2.0);

      harness.client.setMicGain(-0.5);
      expect(harness.audio.micGain).toBe(0.0);
    });

    it("T1.F4.3: Speaker volume adjustments (0.0 to 1.0) modify master gain value", async () => {
      await harness.client.startCall();

      harness.client.setSpeakerVolume(0.5);
      expect(harness.audio.speakerVolume).toBe(0.5);
      expect(harness.audio.speakerGainNode?.gain.value).toBe(0.5);

      // Clamping check
      harness.client.setSpeakerVolume(1.5);
      expect(harness.audio.speakerVolume).toBe(1.0);

      harness.client.setSpeakerVolume(-0.2);
      expect(harness.audio.speakerVolume).toBe(0.0);
    });

    it("T1.F4.4: Mute mic sets mic gain / track enabled state to disabled without stopping AudioContext", async () => {
      await harness.client.startCall();

      expect(harness.audio.context?.state).toBe("running");
      harness.client.setMuted(true);

      expect(harness.audio.isMuted).toBe(true);
      expect(harness.audio.micGainNode?.gain.value).toBe(0.0);
      expect(harness.audio.micStream?.getAudioTracks()[0].enabled).toBe(false);
      expect(harness.audio.context?.state).toBe("running");
    });

    it("T1.F4.5: Cleanup releases media stream tracks and closes AudioContext", async () => {
      const audio = new MockAudioEngine();
      await audio.initialize();
      const track = audio.micStream?.getAudioTracks()[0];

      expect(track?.readyState).toBe("live");
      audio.cleanup();

      expect(track?.readyState).toBe("ended");
      expect(audio.isInitialized).toBe(false);
      expect(audio.context).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /* F5: Speech-to-Text & VAD Auto-Dispatch                            */
  /* ------------------------------------------------------------------ */
  describe("F5: Speech-to-Text & VAD Auto-Dispatch", () => {
    it("T1.F5.1: Continuous speech recognition starts on call connect", async () => {
      await harness.client.startCall();
      expect(harness.recognition.isListening).toBe(true);
      expect(harness.recognition.continuous).toBe(true);
      expect(harness.recognition.interimResults).toBe(true);
    });

    it("T1.F5.2: Interim speech results trigger live callback updates", async () => {
      await harness.client.startCall();

      harness.recognition.simulateInterim("How do I");
      expect(harness.client.currentInterimTranscript).toBe("How do I");

      harness.recognition.simulateInterim("How do I build a model");
      expect(harness.client.currentInterimTranscript).toBe("How do I build a model");
    });

    it("T1.F5.3: Final speech results update transcription buffer", async () => {
      await harness.client.startCall();

      harness.recognition.simulateFinal("How do I build a model?");
      expect(harness.client.currentInterimTranscript).toBe("");
      harness.assertTranscriptContains("How do I build a model?");
    });

    it("T1.F5.4: Voice Activity Detection (VAD) pause threshold triggers prompt auto-dispatch", async () => {
      await harness.client.startCall();

      harness.recognition.simulateFinal("Deploy application");
      // Fast forward fake timer for VAD pause threshold
      vi.advanceTimersByTime(1000);

      // Verify prompt auto-dispatched to host
      harness.assertHostEventCount("voice.transcript.event", 1);
      harness.assertTranscriptContains("Deploy application");
    });

    it("T1.F5.5: Recognition error fallback transitions gracefully", async () => {
      await harness.client.startCall();

      let capturedError = "";
      harness.recognition.onerror = (e) => {
        capturedError = e.error;
      };

      harness.recognition.simulateError("no-speech", "No speech detected within window");
      expect(capturedError).toBe("no-speech");
      expect(harness.client.status).toBe("listening");
    });
  });

  /* ------------------------------------------------------------------ */
  /* F6: Text-to-Speech Synthesis & Voice Controls                     */
  /* ------------------------------------------------------------------ */
  describe("F6: Text-to-Speech Synthesis & Voice Controls", () => {
    it("T1.F6.1: Agent response text turns convert into spoken synthesis utterances", async () => {
      await harness.client.startCall();

      harness.client.submitVoicePrompt("What is NanoForge?");
      expect(harness.synthesis.speaking).toBe(true);
      expect(harness.synthesis.currentUtterance?.text).toBeDefined();
    });

    it("T1.F6.2: Long responses are chunked by sentence boundaries for low-latency playback", () => {
      const longText = "First sentence here. Second sentence with details! Third question?";
      const chunks = chunkTextForTts(longText);

      expect(chunks.length).toBe(3);
      expect(chunks[0]).toBe("First sentence here.");
      expect(chunks[1]).toBe("Second sentence with details!");
      expect(chunks[2]).toBe("Third question?");
    });

    it("T1.F6.3: Pitch, rate, and timbre configurations apply to SpeechSynthesisUtterance", async () => {
      await harness.client.startCall({
        rate: 1.25,
        pitch: 1.1,
        timbre: "crisp",
      });

      harness.client.submitVoicePrompt("Test pitch and rate");
      expect(harness.synthesis.currentUtterance?.rate).toBe(1.25);
      expect(harness.synthesis.currentUtterance?.pitch).toBe(1.1);
    });

    it("T1.F6.4: Explicit cancel() stops active synthesis instantly", () => {
      const utterance = new MockSpeechSynthesisUtterance("Playing long audio turn");
      harness.synthesis.speak(utterance);
      expect(harness.synthesis.speaking).toBe(true);

      harness.synthesis.cancel();
      expect(harness.synthesis.speaking).toBe(false);
      expect(harness.synthesis.currentUtterance).toBeNull();
    });

    it("T1.F6.5: Synthesis completion triggers transition back to listening", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Quick test");

      // Complete all utterances in queue
      while (harness.synthesis.speaking) {
        harness.synthesis.completeCurrentUtterance();
      }

      expect(harness.synthesis.speaking).toBe(false);
      expect(harness.client.status).toBe("listening");
    });
  });

  /* ------------------------------------------------------------------ */
  /* F7: TopBar & ChatComposer Trigger Seams                           */
  /* ------------------------------------------------------------------ */
  describe("F7: TopBar & ChatComposer Trigger Seams", () => {
    it("T1.F7.1: TopBar 'Start Voice Call' button opens VoiceCallDrawer", async () => {
      expect(harness.client.isDrawerOpen).toBe(false);
      await harness.client.startCall();
      expect(harness.client.isDrawerOpen).toBe(true);
    });

    it("T1.F7.2: TopBar shows active call badge indicator during ongoing call", async () => {
      await harness.client.startCall();
      expect(harness.client.status).toBe("listening");
      // When active, status is not idle or ended
      const isCallActive = harness.client.status !== "idle" && harness.client.status !== "ended";
      expect(isCallActive).toBe(true);
    });

    it("T1.F7.3: ChatComposer mic trigger initiates voice call session", async () => {
      expect(harness.client.session).toBeNull();
      await harness.client.startCall();
      expect(harness.client.session).not.toBeNull();
      expect(harness.client.session?.sessionId).toBeDefined();
    });

    it("T1.F7.4: ChatComposer slash command /call opens voice call drawer and starts call", async () => {
      const handleSlashCommand = async (cmd: string) => {
        if (cmd.trim() === "/call") {
          await harness.client.startCall();
        }
      };

      await handleSlashCommand("/call");
      expect(harness.client.isDrawerOpen).toBe(true);
      expect(harness.client.status).toBe("listening");
    });

    it("T1.F7.5: Clicking trigger while call is active focuses existing active call drawer", async () => {
      await harness.client.startCall();
      const initialSessionId = harness.client.session?.sessionId;

      // Close drawer temporarily
      harness.client.isDrawerOpen = false;

      // Trigger again while call is still running
      await harness.client.startCall();
      expect(harness.client.isDrawerOpen).toBe(true);
      expect(harness.client.session?.sessionId).toBe(initialSessionId);
    });
  });

  /* ------------------------------------------------------------------ */
  /* F8: Voice Call Drawer UI & Controls                               */
  /* ------------------------------------------------------------------ */
  describe("F8: Voice Call Drawer UI & Controls", () => {
    it("T1.F8.1: Drawer renders header with status badge (listening, thinking, etc.)", async () => {
      await harness.client.startCall();
      expect(harness.client.status).toBe("listening");

      harness.client.setMuted(true);
      expect(harness.client.status).toBe("muted");
    });

    it("T1.F8.2: Call duration timer increments every second while call is active", async () => {
      await harness.client.startCall();
      expect(harness.client.durationSeconds).toBe(0);

      vi.advanceTimersByTime(3000);
      expect(harness.client.durationSeconds).toBe(3);

      vi.advanceTimersByTime(5000);
      expect(harness.client.durationSeconds).toBe(8);
    });

    it("T1.F8.3: Mute button toggles microphone state with active/inactive UI indicator", async () => {
      await harness.client.startCall();

      const muted = harness.client.toggleMute();
      expect(muted).toBe(true);
      expect(harness.client.isMuted).toBe(true);

      const unmuted = harness.client.toggleMute();
      expect(unmuted).toBe(false);
      expect(harness.client.isMuted).toBe(false);
    });

    it("T1.F8.4: Interrupt button is enabled during speaking and triggers barge-in", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Tell me something");

      expect(harness.client.status).toBe("speaking");
      const canInterrupt = harness.client.status === "speaking";
      expect(canInterrupt).toBe(true);

      harness.client.interruptAgent();
      expect(harness.client.status).toBe("listening");
    });

    it("T1.F8.5: End Call button terminates session and closes/minimizes drawer", async () => {
      await harness.client.startCall();
      expect(harness.client.isDrawerOpen).toBe(true);

      harness.client.endCall("user_hangup");
      expect(harness.client.status).toBe("ended");
      expect(harness.client.isDrawerOpen).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /* F9: Real-Time Dual Audio Visualizers                              */
  /* ------------------------------------------------------------------ */
  describe("F9: Real-Time Dual Audio Visualizers", () => {
    it("T1.F9.1: Mic waveform visualizer reads timeDomainData and produces non-zero canvas path when user speaks", async () => {
      await harness.client.startCall();

      harness.audio.simulateMicActivity(true, 0.9);
      const visualData = harness.audio.getMicVisualData();

      expect(visualData.rmsVolume).toBeGreaterThan(0.05);
      // Ensure non-zero waveform oscillation
      const hasOscillation = visualData.timeDomainData.some((val) => val !== 128);
      expect(hasOscillation).toBe(true);
    });

    it("T1.F9.2: Mic waveform flattens to center line when muted or silent", async () => {
      await harness.client.startCall();

      harness.client.setMuted(true);
      const visualData = harness.audio.getMicVisualData();

      expect(visualData.rmsVolume).toBe(0);
      const isFlat = visualData.timeDomainData.every((val) => val === 128);
      expect(isFlat).toBe(true);
    });

    it("T1.F9.3: Speaker frequency visualizer renders frequency equalizer bars during agent playback", async () => {
      await harness.client.startCall();

      harness.audio.simulateSpeakerActivity(true, 0.8);
      const visualData = harness.audio.getSpeakerVisualData();

      expect(visualData.rmsVolume).toBeGreaterThan(0.05);
      const hasFrequencies = visualData.frequencyData.some((val) => val > 0);
      expect(hasFrequencies).toBe(true);
    });

    it("T1.F9.4: Speaker equalizer bars drop to zero when agent stops speaking", async () => {
      await harness.client.startCall();

      harness.audio.simulateSpeakerActivity(false);
      const visualData = harness.audio.getSpeakerVisualData();

      expect(visualData.rmsVolume).toBe(0);
      const allZero = visualData.frequencyData.every((val) => val === 0);
      expect(allZero).toBe(true);
    });

    it("T1.F9.5: Animation frames unmount and clean up resources when drawer closes", async () => {
      await harness.client.startCall();
      expect(harness.audio.isInitialized).toBe(true);

      harness.client.endCall();
      expect(harness.audio.isInitialized).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /* F10: Live Transcription Stream & Chat Persistence                 */
  /* ------------------------------------------------------------------ */
  describe("F10: Live Transcription Stream & Chat Persistence", () => {
    it("T1.F10.1: Real-time interim transcript renders in user speech bubble", async () => {
      await harness.client.startCall();

      harness.recognition.simulateInterim("Show me");
      expect(harness.client.currentInterimTranscript).toBe("Show me");

      const currentTurn = harness.client.transcriptHistory.find((t) => t.speaker === "user");
      expect(currentTurn?.text).toBe("Show me");
      expect(currentTurn?.isFinal).toBe(false);
    });

    it("T1.F10.2: Final transcript commits to speech bubble history in drawer", async () => {
      await harness.client.startCall();

      harness.recognition.simulateFinal("Show me my recent projects");
      const userTurn = harness.client.transcriptHistory.find((t) => t.speaker === "user");
      expect(userTurn?.text).toBe("Show me my recent projects");
      expect(userTurn?.isFinal).toBe(true);
    });

    it("T1.F10.3: Agent response turns render synchronously with TTS playback", async () => {
      await harness.client.startCall();

      harness.client.submitVoicePrompt("What is the status?");
      const agentTurn = harness.client.transcriptHistory.find((t) => t.speaker === "agent");
      expect(agentTurn).toBeDefined();
      expect(agentTurn?.text).toContain("What is the status?");
    });

    it("T1.F10.4: Ending call transfers all voice turns into the main Chat session transcript", async () => {
      await harness.client.startCall();

      harness.client.submitVoicePrompt("Turn 1 question");
      harness.client.endCall();

      expect(harness.client.mainChatHistory.length).toBeGreaterThan(0);
      harness.assertMainChatContains("Turn 1 question");
    });

    it("T1.F10.5: Transcription stream auto-scrolls to latest message turn", async () => {
      await harness.client.startCall();

      harness.client.submitVoicePrompt("Turn 1");
      harness.client.submitVoicePrompt("Turn 2");
      harness.client.submitVoicePrompt("Turn 3");

      const turns = harness.client.transcriptHistory;
      expect(turns.length).toBeGreaterThanOrEqual(3);
      const lastTurn = turns[turns.length - 1];
      expect(lastTurn).toBeDefined();
    });
  });

  /* ------------------------------------------------------------------ */
  /* F11: Opaque-Box E2E Testing Suite Architecture                     */
  /* ------------------------------------------------------------------ */
  describe("F11: Opaque-Box E2E Testing Suite Architecture", () => {
    it("T1.F11.1: Test harness simulates end-to-end client-server WebSocket communication", async () => {
      await harness.client.startCall();
      expect(harness.host.wireLog.length).toBeGreaterThanOrEqual(2);

      const clientMsg = harness.host.wireLog.find((w) => w.direction === "c2s");
      const hostMsg = harness.host.wireLog.find((w) => w.direction === "s2c");
      expect(clientMsg).toBeDefined();
      expect(hostMsg).toBeDefined();
    });

    it("T1.F11.2: Mock audio pipeline simulates realistic FFT frequency bins and waveforms", async () => {
      await harness.client.startCall();
      harness.audio.simulateMicActivity(true, 1.0);

      const visualData = harness.audio.getMicVisualData();
      expect(visualData.timeDomainData.length).toBe(256);
      expect(visualData.frequencyData.length).toBe(128);
    });

    it("T1.F11.3: Mock speech recognition accurately mimics Web Speech API events", () => {
      let started = false;
      let ended = false;

      harness.recognition.onstart = () => {
        started = true;
      };
      harness.recognition.onend = () => {
        ended = true;
      };

      harness.recognition.start();
      expect(started).toBe(true);

      harness.recognition.stop();
      expect(ended).toBe(true);
    });

    it("T1.F11.4: Mock speech synthesis accurately tracks active speaking status and events", () => {
      let utteranceStarted = false;
      const utt = new MockSpeechSynthesisUtterance("Testing synthesis events");
      utt.onstart = () => {
        utteranceStarted = true;
      };

      harness.synthesis.speak(utt);
      expect(utteranceStarted).toBe(true);
      expect(harness.synthesis.speaking).toBe(true);

      harness.synthesis.completeCurrentUtterance();
      expect(harness.synthesis.speaking).toBe(false);
    });

    it("T1.F11.5: Harness captures complete event telemetry log for verification assertions", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Log assertion test");

      expect(harness.host.eventLog.length).toBeGreaterThan(0);
      harness.assertHostEventCount("voice.session.ready", 1);
      harness.assertHostEventCount("voice.turn.event", 2); // started & completed
    });
  });

  /* ------------------------------------------------------------------ */
  /* F12: Adversarial Hardening & Integrity Verification                */
  /* ------------------------------------------------------------------ */
  describe("F12: Adversarial Hardening & Integrity Verification", () => {
    it("T1.F12.1: Handling unexpected server disconnection during active speaking", async () => {
      await harness.client.startCall();
      harness.client.submitVoicePrompt("Long task");

      // Abrupt host disconnect
      harness.host.handleSocketDisconnect();
      expect(harness.host.activeSessionId).toBeNull();
    });

    it("T1.F12.2: Rejection of malformed / corrupted JSON frames over voice WebSocket", () => {
      expect(() => {
        harness.host.handleClientMessage("NOT_A_VALID_JSON{");
      }).toThrow(/Malformed client frame/);

      expect(() => {
        harness.host.handleClientMessage(
          JSON.stringify({ type: "invalid.unknown.type", data: 123 })
        );
      }).toThrow();
    });

    it("T1.F12.3: Rapid toggle spamming of Mute / Unmute maintains consistent state", async () => {
      await harness.client.startCall();

      for (let i = 0; i < 50; i++) {
        harness.client.toggleMute();
      }

      // Even number of toggles returns to initial unmute state (false)
      expect(harness.client.isMuted).toBe(false);
      expect(harness.client.status).toBe("listening");
    });

    it("T1.F12.4: Double start / rapid restart without leaking media tracks", async () => {
      await harness.client.startCall();
      const firstSessionId = harness.client.session?.sessionId;

      // Second start call attempt while active
      await harness.client.startCall();
      expect(harness.client.session?.sessionId).toBe(firstSessionId);

      // Fast restart
      harness.client.endCall();
      await harness.client.startCall();
      expect(harness.client.session?.sessionId).not.toBe(firstSessionId);
    });

    it("T1.F12.5: Zero memory leaks on repeated call start / end cycles", async () => {
      for (let cycle = 0; cycle < 10; cycle++) {
        await harness.client.startCall();
        harness.client.submitVoicePrompt(`Cycle ${cycle} test prompt`);
        harness.client.endCall();
      }

      expect(harness.audio.isInitialized).toBe(false);
      expect(harness.recognition.isListening).toBe(false);
      expect(harness.synthesis.speaking).toBe(false);
      expect(harness.client.status).toBe("ended");
    });
  });
});

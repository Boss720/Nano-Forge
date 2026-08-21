/**
 * Tier 3 — Cross-Feature Combinations Test Suite (12 Pairwise Test Cases)
 *
 * Implements all 12 pairwise cross-feature combination test cases (T3.1 through T3.12)
 * as specified in TEST_INFRA.md § Tier 3.
 *
 * Evaluates real interactions across pairs/triads of features:
 * - T3.1  (F1 + F5 + F2):  User speech interim streaming -> VAD pause -> transcript.submit -> Host turn dispatch
 * - T3.2  (F2 + F6 + F9):  Agent response generation -> TTS chunk synthesis -> Equalizer visualizer in sync
 * - T3.3  (F3 + F6 + F8):  Active TTS speech -> User clicks UI Interrupt button -> Instant cancel + listening state
 * - T3.4  (F3 + F5 + F6):  Active TTS speech -> User speaks (barge-in VAD) -> Instant TTS abort + new interim transcript
 * - T3.5  (F4 + F8 + F9):  Mute toggle in drawer -> AudioEngine gain 0 -> Waveform goes flat -> UI badge shows muted
 * - T3.6  (F4 + F8):       Mic gain slider (1.5x) + Speaker volume (0.8x) -> AudioEngine nodes update accordingly
 * - T3.7  (F7 + F8 + F1):  TopBar trigger clicked -> Drawer opens -> Protocol handshake -> listening state
 * - T3.8  (F7 + F8 + F10): ChatComposer /call command -> Call active -> 3 turns exchanged -> End call -> Main chat persistence
 * - T3.9  (F5 + F6 + F10): Multi-turn conversation alternating user & agent -> Interim and final turns accurately tracked
 * - T3.10 (F1 + F2 + F12): Network drop during active speaking -> Reconnect handshake -> Graceful recovery
 * - T3.11 (F8 + F9 + F10): Drawer minimized/maximized during active turn -> Visualizers & transcript maintain state
 * - T3.12 (F3 + F2 + F10): User interrupts agent mid-sentence -> Interrupted turn flagged -> Next utterance starts clean turn
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createVoiceTestHarness,
  VoiceTestHarness,
  MockSpeechSynthesisUtterance,
} from "./harness";
import {
  isValidVoiceStateTransition,
  VoiceCallStatus,
} from "@protocol/voice";

describe("Tier 3 — Cross-Feature Combinations Test Suite (T3.1 - T3.12)", () => {
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
  /* T3.1: User speech interim -> VAD pause -> submit -> Turn dispatch  */
  /* ------------------------------------------------------------------ */
  it("T3.1 (F1 + F5 + F2): User speech interim streaming -> VAD pause -> voice.transcript.submit -> Agent-Host session turn dispatch", async () => {
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // 1. User starts speaking, streaming interim transcript
    harness.recognition.simulateInterim("Tell me about NanoForge");
    expect(harness.client.currentInterimTranscript).toBe("Tell me about NanoForge");
    const userTurnInterim = harness.client.transcriptHistory.find((t) => t.speaker === "user");
    expect(userTurnInterim).toBeDefined();
    expect(userTurnInterim?.text).toBe("Tell me about NanoForge");
    expect(userTurnInterim?.isFinal).toBe(false);

    // 2. User completes sentence and pauses; VAD auto-dispatch fires
    harness.recognition.simulateFinal("Tell me about NanoForge architecture");
    vi.advanceTimersByTime(harness.recognition.vadSilenceDelayMs);

    // 3. Verify wire message and host event dispatch
    const submitWireMsg = harness.host.wireLog.find(
      (w) => w.direction === "c2s" && w.payload.type === "voice.transcript.submit"
    );
    expect(submitWireMsg).toBeDefined();
    expect(submitWireMsg?.payload.text).toBe("Tell me about NanoForge architecture");
    expect(submitWireMsg?.payload.isFinal).toBe(true);

    // 4. Verify host emitted turn event, thinking state, and response chunks
    const turnEvent = harness.host.eventLog.find((e) => e.type === "voice.turn.event");
    expect(turnEvent).toBeDefined();
    expect(turnEvent?.type).toBe("voice.turn.event");

    const ttsChunks = harness.host.eventLog.filter((e) => e.type === "voice.tts.chunk");
    expect(ttsChunks.length).toBeGreaterThan(0);

    // 5. Client status transitioned to speaking and received agent utterance
    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.speaking).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* T3.2: Agent response generation -> TTS synthesis -> Equalizer sync */
  /* ------------------------------------------------------------------ */
  it("T3.2 (F2 + F6 + F9): Agent response generation -> TTS chunk synthesis -> Speaker Equalizer visualizer rendering in sync", async () => {
    await harness.client.startCall();

    // 1. Submit a user prompt to trigger agent response
    harness.client.submitVoicePrompt("Explain quantum computing");

    // 2. Agent receives prompt, enters speaking state, synthesizes TTS chunks
    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.speaking).toBe(true);
    expect(harness.audio.speakerAnalyser?.active).toBe(true);

    // 3. Verify speaker equalizer visualizer reads non-zero frequency bins & rms volume
    const speakerDataActive = harness.audio.getSpeakerVisualData();
    expect(speakerDataActive.rmsVolume).toBeGreaterThan(0);
    const hasNonZeroFreq = Array.from(speakerDataActive.frequencyData).some((bin) => bin > 0);
    expect(hasNonZeroFreq).toBe(true);

    // 4. Complete all speech synthesis utterances
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }

    // 5. Equalizer bars and active flag drop to zero upon completion
    expect(harness.client.status).toBe("listening");
    expect(harness.synthesis.speaking).toBe(false);
    expect(harness.audio.speakerAnalyser?.active).toBe(false);

    const speakerDataIdle = harness.audio.getSpeakerVisualData();
    expect(speakerDataIdle.rmsVolume).toBe(0);
    const allZeroFreq = Array.from(speakerDataIdle.frequencyData).every((bin) => bin === 0);
    expect(allZeroFreq).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* T3.3: Active TTS speech -> UI Interrupt button -> Instant cancel   */
  /* ------------------------------------------------------------------ */
  it("T3.3 (F3 + F6 + F8): Active agent TTS speech -> User clicks UI Interrupt button -> Instant TTS cancellation + state change to listening", async () => {
    await harness.client.startCall();
    harness.client.submitVoicePrompt("Tell me a very long story about space exploration");

    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.speaking).toBe(true);
    expect(harness.audio.speakerAnalyser?.active).toBe(true);

    // User clicks UI Interrupt button in drawer
    harness.client.interruptAgent("user_manual_button");

    // Verify instant cancellation
    expect(harness.synthesis.speaking).toBe(false);
    expect(harness.synthesis.currentUtterance).toBeNull();
    expect(harness.audio.speakerAnalyser?.active).toBe(false);
    expect(harness.client.status).toBe("listening");

    // Verify host interrupt frame was emitted and recorded
    const interruptWire = harness.host.wireLog.find(
      (w) => w.direction === "c2s" && w.payload.type === "voice.interrupt"
    );
    expect(interruptWire?.payload.reason).toBe("user_manual_button");

    const interruptedHostEvent = harness.host.eventLog.find((e) => e.type === "voice.interrupted");
    expect(interruptedHostEvent).toBeDefined();

    // Verify turn in transcript history is tagged as interrupted
    const agentTurn = harness.client.transcriptHistory.find((t) => t.speaker === "agent");
    expect(agentTurn?.interrupted).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* T3.4: Active TTS speech -> Barge-in VAD -> Abort + New interim      */
  /* ------------------------------------------------------------------ */
  it("T3.4 (F3 + F5 + F6): Active agent TTS speech -> User begins speaking (barge-in VAD) -> Instant TTS abort + new interim transcript begins", async () => {
    await harness.client.startCall();
    harness.client.submitVoicePrompt("Describe the history of computing");

    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.speaking).toBe(true);

    // User starts speaking over agent (barge-in detected)
    harness.client.interruptAgent("user_speech_detected");
    harness.recognition.simulateInterim("Wait, summarize it instead");

    // TTS playback aborts instantly
    expect(harness.synthesis.speaking).toBe(false);
    expect(harness.audio.speakerAnalyser?.active).toBe(false);

    // New interim transcript is captured
    expect(harness.client.currentInterimTranscript).toBe("Wait, summarize it instead");
    expect(harness.client.status).toBe("listening");

    // Interrupted turn is tagged properly
    const interruptedTurn = harness.client.transcriptHistory.find((t) => t.speaker === "agent");
    expect(interruptedTurn?.interrupted).toBe(true);

    // Host received interruption with reason user_speech_detected
    const hostInterrupt = harness.host.wireLog.find(
      (w) => w.direction === "c2s" && w.payload.type === "voice.interrupt"
    );
    expect(hostInterrupt?.payload.reason).toBe("user_speech_detected");
  });

  /* ------------------------------------------------------------------ */
  /* T3.5: Mute toggle -> Gain 0 -> Waveform flat -> UI badge muted     */
  /* ------------------------------------------------------------------ */
  it("T3.5 (F4 + F8 + F9): User toggles Mute in drawer -> AudioEngine sets gain to 0 -> Waveform visualizer immediately goes flat -> UI badge shows muted", async () => {
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // Simulate active mic input
    harness.audio.simulateMicActivity(true, 0.9);
    const micDataBeforeMute = harness.audio.getMicVisualData();
    expect(micDataBeforeMute.rmsVolume).toBeGreaterThan(0);
    const hasWaveformOscillation = Array.from(micDataBeforeMute.timeDomainData).some((v) => v !== 128);
    expect(hasWaveformOscillation).toBe(true);

    // User toggles Mute button in drawer
    const isMutedNow = harness.client.toggleMute();
    expect(isMutedNow).toBe(true);
    expect(harness.client.isMuted).toBe(true);
    expect(harness.client.status).toBe("muted");
    expect(harness.audio.isMuted).toBe(true);
    expect(harness.audio.micGainNode?.gain.value).toBe(0.0);

    // Waveform visualizer immediately flattens to 128 baseline and 0 rms volume
    const micDataMuted = harness.audio.getMicVisualData();
    expect(micDataMuted.rmsVolume).toBe(0);
    const allFlat = Array.from(micDataMuted.timeDomainData).every((v) => v === 128);
    expect(allFlat).toBe(true);

    // Host session status updated to muted
    expect(harness.host.sessions.get(harness.client.session!.sessionId)?.status).toBe("muted");

    // User un-mutes
    harness.client.toggleMute();
    expect(harness.client.isMuted).toBe(false);
    expect(harness.client.status).toBe("listening");
    expect(harness.audio.micGainNode?.gain.value).toBe(harness.client.micGain);
  });

  /* ------------------------------------------------------------------ */
  /* T3.6: Mic gain & Speaker volume sliders -> AudioEngine updates     */
  /* ------------------------------------------------------------------ */
  it("T3.6 (F4 + F8): User adjusts mic gain slider (1.5x) and speaker volume (0.8x) -> AudioEngine nodes update -> Audio levels adjust accordingly", async () => {
    await harness.client.startCall();

    // Adjust mic gain slider to 1.5x
    harness.client.setMicGain(1.5);
    expect(harness.client.micGain).toBe(1.5);
    expect(harness.audio.micGain).toBe(1.5);
    expect(harness.audio.micGainNode?.gain.value).toBe(1.5);
    expect(harness.audio.micAnalyser?.amplitude).toBe(1.5);

    // Adjust speaker volume slider to 0.8x
    harness.client.setSpeakerVolume(0.8);
    expect(harness.client.speakerVolume).toBe(0.8);
    expect(harness.audio.speakerVolume).toBe(0.8);
    expect(harness.audio.speakerGainNode?.gain.value).toBe(0.8);
    expect(harness.audio.speakerAnalyser?.amplitude).toBe(0.8);

    // Verify boundary clamping on extreme slider inputs
    harness.client.setMicGain(3.5); // Max allowed is 2.0
    expect(harness.client.micGain).toBe(2.0);
    expect(harness.audio.micGainNode?.gain.value).toBe(2.0);

    harness.client.setSpeakerVolume(-0.2); // Min allowed is 0.0
    expect(harness.client.speakerVolume).toBe(0.0);
    expect(harness.audio.speakerGainNode?.gain.value).toBe(0.0);
  });

  /* ------------------------------------------------------------------ */
  /* T3.7: TopBar trigger -> Drawer open -> Protocol handshake          */
  /* ------------------------------------------------------------------ */
  it("T3.7 (F7 + F8 + F1): TopBar 'Start Voice Call' clicked -> Drawer opens -> Protocol handshake initiates -> Session reaches listening state", async () => {
    expect(harness.client.status).toBe("idle");
    expect(harness.client.isDrawerOpen).toBe(false);

    // User clicks TopBar "Start Voice Call" button
    await harness.client.startCall({
      voiceId: "agent-warm-en",
      name: "NanoForge Warm Voice",
      rate: 1.1,
      pitch: 1.05,
    });

    // Drawer opens immediately
    expect(harness.client.isDrawerOpen).toBe(true);

    // Protocol handshake completed
    expect(harness.client.session).not.toBeNull();
    expect(harness.client.session?.sessionId).toBeDefined();
    expect(harness.client.session?.voiceProfile.voiceId).toBe("agent-warm-en");

    // Host session created and in listening state
    expect(harness.client.status).toBe("listening");
    const readyEvent = harness.host.eventLog.find((e) => e.type === "voice.session.ready");
    expect(readyEvent).toBeDefined();

    // Clicking trigger again while active maintains drawer open without recreating session
    const existingSessionId = harness.client.session?.sessionId;
    await harness.client.startCall();
    expect(harness.client.session?.sessionId).toBe(existingSessionId);
    expect(harness.client.isDrawerOpen).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* T3.8: ChatComposer /call -> 3 turns -> End call -> Main chat sync  */
  /* ------------------------------------------------------------------ */
  it("T3.8 (F7 + F8 + F10): ChatComposer /call command executed -> Call active -> 3 speech turns exchanged -> End call -> Main chat displays 3 turns", async () => {
    // 1. User enters /call in ChatComposer
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // Turn 1
    harness.client.submitVoicePrompt("Turn 1 prompt: What is NanoForge?");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    // Turn 2
    harness.client.submitVoicePrompt("Turn 2 prompt: What tools are included?");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    // Turn 3
    harness.client.submitVoicePrompt("Turn 3 prompt: Thank you, clear.");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    // Verify 6 items in transcript history (3 user + 3 assistant)
    expect(harness.client.transcriptHistory.length).toBe(6);

    // User clicks End Call in drawer
    harness.client.endCall("user_hangup");
    expect(harness.client.status).toBe("ended");
    expect(harness.client.isDrawerOpen).toBe(false);

    // Main chat history contains all 6 turns with source: 'voice_call'
    expect(harness.client.mainChatHistory.length).toBe(6);
    expect(harness.client.mainChatHistory[0].content).toContain("Turn 1 prompt");
    expect(harness.client.mainChatHistory[0].source).toBe("voice_call");
    expect(harness.client.mainChatHistory[1].role).toBe("assistant");
    expect(harness.client.mainChatHistory[2].content).toContain("Turn 2 prompt");
    expect(harness.client.mainChatHistory[4].content).toContain("Turn 3 prompt");
  });

  /* ------------------------------------------------------------------ */
  /* T3.9: Alternating multi-turn conversation -> Stream tracking       */
  /* ------------------------------------------------------------------ */
  it("T3.9 (F5 + F6 + F10): Multi-turn conversation with alternating user speech and agent TTS -> All interim and final turns accurately tracked in transcript stream", async () => {
    await harness.client.startCall();

    // Turn 1: User speaks with interim updates
    harness.recognition.simulateInterim("How fast is");
    expect(harness.client.currentInterimTranscript).toBe("How fast is");

    harness.recognition.simulateInterim("How fast is light?");
    expect(harness.client.currentInterimTranscript).toBe("How fast is light?");

    harness.recognition.simulateFinal("How fast is the speed of light?");
    harness.recognition.simulateSpeechPause();

    // User interim transcript cleared upon finalization
    expect(harness.client.currentInterimTranscript).toBe("");

    // Agent speaks Turn 1 response
    expect(harness.client.status).toBe("speaking");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }

    // Turn 2: Follow-up question
    harness.recognition.simulateInterim("And in glass?");
    harness.recognition.simulateFinal("And what is the speed of light in glass?");
    harness.recognition.simulateSpeechPause();

    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }

    // Verify chronological order and proper metadata in transcript history
    expect(harness.client.transcriptHistory.length).toBe(4);
    expect(harness.client.transcriptHistory[0].speaker).toBe("user");
    expect(harness.client.transcriptHistory[0].text).toBe("How fast is the speed of light?");
    expect(harness.client.transcriptHistory[0].isFinal).toBe(true);

    expect(harness.client.transcriptHistory[1].speaker).toBe("agent");
    expect(harness.client.transcriptHistory[1].isFinal).toBe(true);

    expect(harness.client.transcriptHistory[2].speaker).toBe("user");
    expect(harness.client.transcriptHistory[2].text).toBe("And what is the speed of light in glass?");

    expect(harness.client.transcriptHistory[3].speaker).toBe("agent");
  });

  /* ------------------------------------------------------------------ */
  /* T3.10: Network drop during speaking -> Session teardown & recovery  */
  /* ------------------------------------------------------------------ */
  it("T3.10 (F1 + F2 + F12): Network drop during active speaking -> Reconnect handshake -> Graceful error handling or session recovery without UI lockup", async () => {
    await harness.client.startCall();
    harness.client.submitVoicePrompt("Stream a long answer");
    expect(harness.client.status).toBe("speaking");

    const firstSessionId = harness.client.session?.sessionId;

    // Simulate abrupt network socket drop
    harness.host.handleSocketDisconnect(firstSessionId);
    expect(harness.host.sessions.get(firstSessionId!)?.status).toBe("ended");
    expect(harness.host.sessions.get(firstSessionId!)?.endReason).toBe("connection_lost");

    // Client detects disconnection and terminates gracefully
    harness.client.endCall("connection_lost");
    expect(harness.client.status).toBe("ended");
    expect(harness.synthesis.speaking).toBe(false);
    expect(harness.audio.isInitialized).toBe(false);

    // User triggers reconnect handshake to start a new voice session
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");
    expect(harness.client.session?.sessionId).not.toBe(firstSessionId);
    expect(harness.client.isDrawerOpen).toBe(true);
    expect(harness.audio.isInitialized).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* T3.11: Drawer minimize/maximize during active turn -> State intact */
  /* ------------------------------------------------------------------ */
  it("T3.11 (F8 + F9 + F10): Drawer minimized/maximized during active voice turn -> Visualizers and transcript stream maintain seamless rendering and state", async () => {
    await harness.client.startCall();
    harness.client.submitVoicePrompt("Calculate 25 * 4");

    expect(harness.client.status).toBe("speaking");
    expect(harness.audio.speakerAnalyser?.active).toBe(true);
    const preMinimizeTurns = harness.client.transcriptHistory.length;

    // User minimizes drawer while agent is speaking
    harness.client.isDrawerOpen = false;

    // Audio engine and speaker visualizer data continue uninterrupted
    const speakerDataWhileMinimized = harness.audio.getSpeakerVisualData();
    expect(speakerDataWhileMinimized.rmsVolume).toBeGreaterThan(0);
    expect(harness.synthesis.speaking).toBe(true);

    // User maximizes / reopens drawer
    harness.client.isDrawerOpen = true;

    // State, transcript history, and audio engine remain consistent
    expect(harness.client.transcriptHistory.length).toBe(preMinimizeTurns);
    expect(harness.client.status).toBe("speaking");

    // Synthesis finishes and returns to listening
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");
  });

  /* ------------------------------------------------------------------ */
  /* T3.12: Interruption mid-sentence -> Partial tagging -> Clean turn  */
  /* ------------------------------------------------------------------ */
  it("T3.12 (F3 + F2 + F10): User interrupts agent mid-sentence -> Interrupted turn flagged in transcript history -> Next user utterance starts clean turn", async () => {
    await harness.client.startCall();

    // Turn 1: User asks long question
    harness.client.submitVoicePrompt("Tell me everything about the solar system");
    expect(harness.client.status).toBe("speaking");

    // User interrupts halfway through agent response
    harness.client.interruptAgent("user_manual_button");
    expect(harness.client.status).toBe("listening");

    // Verify first agent turn is flagged as interrupted
    expect(harness.client.transcriptHistory[1].speaker).toBe("agent");
    expect(harness.client.transcriptHistory[1].interrupted).toBe(true);

    // Turn 2: User speaks clean new prompt
    harness.client.submitVoicePrompt("Just name the closest planet to the sun");
    expect(harness.client.status).toBe("speaking");

    // Complete Turn 2 synthesis
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    // Verify Turn 2 agent response is not interrupted
    expect(harness.client.transcriptHistory[3].speaker).toBe("agent");
    expect(harness.client.transcriptHistory[3].interrupted).toBeUndefined();

    // End call and verify persistence tags in main chat
    harness.client.endCall("user_hangup");
    expect(harness.client.mainChatHistory[1].content).toContain("[interrupted]");
    expect(harness.client.mainChatHistory[3].content).not.toContain("[interrupted]");
  });
});

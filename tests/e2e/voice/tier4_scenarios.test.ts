/**
 * Tier 4 — Real-World Application Scenarios Test Suite (6 Workflows)
 *
 * Implements all 6 end-to-end real-world user workflow scenarios (T4.1 through T4.6)
 * as specified in TEST_INFRA.md § Tier 4.
 *
 * Scenarios:
 * - T4.1: Standard Multi-Turn Voice Dialogue Workflow
 * - T4.2: Barge-In Interruption Workflow
 * - T4.3: Mute Toggling & Privacy Workflow
 * - T4.4: Audio Device Tuning & Real-Time Parameter Adjustment
 * - T4.5: Rapid Consecutive Speech Turns & Fast Dialogue
 * - T4.6: Error Recovery, Disconnect & Transcript Persistence Workflow
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

describe("Tier 4 — Real-World Application Scenarios Test Suite (T4.1 - T4.6)", () => {
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
  /* T4.1: Standard Multi-Turn Voice Dialogue Workflow                 */
  /* ------------------------------------------------------------------ */
  it("T4.1: Standard Multi-Turn Voice Dialogue Workflow", async () => {
    // 1. User clicks TopBar 'Start Voice Call'
    expect(harness.client.status).toBe("idle");
    expect(harness.client.isDrawerOpen).toBe(false);

    await harness.client.startCall({
      voiceId: "agent-default-en",
      name: "NanoForge Assistant",
      rate: 1.0,
      pitch: 1.0,
    });

    // 2. Drawer opens, session connects, status indicates 'listening'
    expect(harness.client.isDrawerOpen).toBe(true);
    expect(harness.client.status).toBe("listening");
    expect(harness.client.session?.sessionId).toBeDefined();
    expect(harness.audio.isInitialized).toBe(true);
    expect(harness.recognition.isListening).toBe(true);

    // 3. User asks: "Can you explain the architecture of NanoForge?"
    harness.recognition.simulateInterim("Can you explain");
    expect(harness.client.currentInterimTranscript).toBe("Can you explain");
    harness.recognition.simulateInterim("Can you explain the architecture of NanoForge?");
    expect(harness.client.currentInterimTranscript).toBe("Can you explain the architecture of NanoForge?");

    // STT final result + VAD auto-dispatches prompt
    harness.recognition.simulateFinal("Can you explain the architecture of NanoForge?");
    vi.advanceTimersByTime(harness.recognition.vadSilenceDelayMs);

    // 4. Status switches to thinking -> speaking; TTS synthesizes response
    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.speaking).toBe(true);
    expect(harness.audio.speakerAnalyser?.active).toBe(true);

    // Speaker visualizer reflects non-zero frequency spectrum
    const speakerData1 = harness.audio.getSpeakerVisualData();
    expect(speakerData1.rmsVolume).toBeGreaterThan(0);
    expect(Array.from(speakerData1.frequencyData).some((bin) => bin > 0)).toBe(true);

    // Complete Turn 1 agent response
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");
    expect(harness.audio.speakerAnalyser?.active).toBe(false);

    // 5. User follows up: "What about the protocol layer?"
    harness.recognition.simulateInterim("What about the protocol layer?");
    harness.recognition.simulateFinal("What about the protocol layer?");
    harness.recognition.simulateSpeechPause();

    // Agent responds to follow-up
    expect(harness.client.status).toBe("speaking");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    // 6. User clicks 'End Call'
    harness.client.endCall("user_hangup");
    expect(harness.client.status).toBe("ended");
    expect(harness.client.isDrawerOpen).toBe(false);
    expect(harness.audio.isInitialized).toBe(false);
    expect(harness.recognition.isListening).toBe(false);

    // 7. Conversation cleanly transferred into main chat transcript
    expect(harness.client.mainChatHistory.length).toBe(4);
    expect(harness.client.mainChatHistory[0].role).toBe("user");
    expect(harness.client.mainChatHistory[0].content).toContain("architecture of NanoForge");
    expect(harness.client.mainChatHistory[1].role).toBe("assistant");
    expect(harness.client.mainChatHistory[2].role).toBe("user");
    expect(harness.client.mainChatHistory[2].content).toContain("protocol layer");
    expect(harness.client.mainChatHistory[3].role).toBe("assistant");
  });

  /* ------------------------------------------------------------------ */
  /* T4.2: Barge-In Interruption Workflow                              */
  /* ------------------------------------------------------------------ */
  it("T4.2: Barge-In Interruption Workflow", async () => {
    // 1. User initiates call via ChatComposer /call
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // 2. User speaks long prompt
    const prompt1 = "Give me a long detailed explanation of quantum computing.";
    harness.client.submitVoicePrompt(prompt1);

    // 3. Agent begins long speaking response
    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.speaking).toBe(true);
    expect(harness.audio.speakerAnalyser?.active).toBe(true);

    // Advance 3 seconds of agent speaking
    vi.advanceTimersByTime(3000);
    expect(harness.client.status).toBe("speaking");

    // 4. After 3 seconds, user interrupts by speaking: "Wait, summarize it in one sentence instead."
    harness.client.interruptAgent("user_speech_detected");
    harness.recognition.simulateInterim("Wait, summarize it in one sentence instead.");

    // System instantly stops TTS audio playback, cancels server stream, transitions to listening
    expect(harness.synthesis.speaking).toBe(false);
    expect(harness.synthesis.currentUtterance).toBeNull();
    expect(harness.audio.speakerAnalyser?.active).toBe(false);
    expect(harness.client.status).toBe("listening");

    // Host recorded interruption
    const interruptEvent = harness.host.eventLog.find((e) => e.type === "voice.interrupted");
    expect(interruptEvent).toBeDefined();

    // 5. User finishes new prompt and VAD dispatches
    harness.recognition.simulateFinal("Wait, summarize it in one sentence instead.");
    harness.recognition.simulateSpeechPause();

    // Agent processes interruption and speaks the one-sentence summary
    expect(harness.client.status).toBe("speaking");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    // 6. User confirms: "Thank you, good bye." and ends call
    harness.client.submitVoicePrompt("Thank you, good bye.");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    harness.client.endCall("user_hangup");

    // 7. Verify transcript persistence with interrupted tag on first agent turn
    expect(harness.client.status).toBe("ended");
    const assistantTurnsInChat = harness.client.mainChatHistory.filter((m) => m.role === "assistant");
    expect(assistantTurnsInChat.length).toBe(3);
    expect(assistantTurnsInChat[0].content).toContain("[interrupted]");
    expect(assistantTurnsInChat[1].content).not.toContain("[interrupted]");
  });

  /* ------------------------------------------------------------------ */
  /* T4.3: Mute Toggling & Privacy Workflow                            */
  /* ------------------------------------------------------------------ */
  it("T4.3: Mute Toggling & Privacy Workflow", async () => {
    // 1. Active voice call session in progress
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // 2. User clicks 'Mute' button
    harness.client.toggleMute();
    expect(harness.client.isMuted).toBe(true);
    expect(harness.client.status).toBe("muted");
    expect(harness.audio.isMuted).toBe(true);
    expect(harness.audio.micGainNode?.gain.value).toBe(0.0);

    // Mic visualizer goes completely flat (all 128 pcm values, 0 rmsVolume)
    const mutedVisualData = harness.audio.getMicVisualData();
    expect(mutedVisualData.rmsVolume).toBe(0);
    expect(Array.from(mutedVisualData.timeDomainData).every((val) => val === 128)).toBe(true);
    expect(Array.from(mutedVisualData.frequencyData).every((val) => val === 0)).toBe(true);

    // 3. User speaks while muted; no STT transcription or prompt auto-dispatch should execute
    const initialHistoryLength = harness.client.transcriptHistory.length;
    const initialWireCount = harness.host.wireLog.length;

    harness.recognition.simulateFinal("Can you hear me whispering confidential data?");
    vi.advanceTimersByTime(harness.recognition.vadSilenceDelayMs);

    // No new turns or transcript submissions on the wire while muted
    expect(harness.client.transcriptHistory.length).toBe(initialHistoryLength);
    const newSubmitMsgs = harness.host.wireLog
      .slice(initialWireCount)
      .filter((w) => w.payload.type === "voice.transcript.submit");
    expect(newSubmitMsgs.length).toBe(0);

    // 4. User clicks 'Unmute'
    harness.client.toggleMute();
    expect(harness.client.isMuted).toBe(false);
    expect(harness.client.status).toBe("listening");
    expect(harness.audio.micGainNode?.gain.value).toBe(harness.client.micGain);

    // Mic visualizer reacts again to user voice
    harness.audio.simulateMicActivity(true, 0.8);
    const unmutedVisualData = harness.audio.getMicVisualData();
    expect(unmutedVisualData.rmsVolume).toBeGreaterThan(0);

    // 5. User speaks: "Now I am back, what is the weather?"
    harness.recognition.simulateFinal("Now I am back, what is the weather?");
    harness.recognition.simulateSpeechPause();

    // Agent receives prompt and responds
    expect(harness.client.status).toBe("speaking");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    harness.client.endCall("user_hangup");
    expect(harness.client.mainChatHistory.length).toBe(2);
    expect(harness.client.mainChatHistory[0].content).toBe("Now I am back, what is the weather?");
  });

  /* ------------------------------------------------------------------ */
  /* T4.4: Audio Device Tuning & Real-Time Parameter Adjustment        */
  /* ------------------------------------------------------------------ */
  it("T4.4: Audio Device Tuning & Real-Time Parameter Adjustment", async () => {
    // 1. Active voice call session
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // 2. User adjusts mic gain slider from 1.0 to 1.8 (amplified) and speaker volume from 1.0 to 0.5
    harness.client.setMicGain(1.8);
    harness.client.setSpeakerVolume(0.5);

    // 3. AudioEngine applies gain changes to active AudioContext nodes
    expect(harness.audio.micGainNode?.gain.value).toBe(1.8);
    expect(harness.audio.speakerGainNode?.gain.value).toBe(0.5);

    // 4. Waveform visualizer reflects amplified input amplitude
    harness.audio.simulateMicActivity(true, 0.6); // 0.6 input * 1.8 gain = 1.08 amplitude
    const amplifiedMicData = harness.audio.getMicVisualData();
    expect(amplifiedMicData.rmsVolume).toBeGreaterThan(0);
    expect(harness.audio.micAnalyser?.amplitude).toBeCloseTo(1.08);

    // 5. Agent speaks response at reduced volume (0.5)
    harness.client.submitVoicePrompt("Check audio levels");
    expect(harness.client.status).toBe("speaking");
    expect(harness.synthesis.currentUtterance?.volume).toBe(0.5);
    expect(harness.audio.speakerAnalyser?.amplitude).toBeCloseTo(0.4);

    // 6. Call completes without audio graph errors or distortion
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }
    expect(harness.client.status).toBe("listening");

    harness.client.endCall("user_hangup");
    expect(harness.client.status).toBe("ended");
    expect(harness.audio.isInitialized).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* T4.5: Rapid Consecutive Speech Turns & Fast Dialogue              */
  /* ------------------------------------------------------------------ */
  it("T4.5: Rapid Consecutive Speech Turns & Fast Dialogue", async () => {
    // Fast custom dialogue responder
    const fastHarness = createVoiceTestHarness({
      defaultResponseGenerator: (prompt) => `Quick response to: ${prompt}`,
    });

    await fastHarness.client.startCall();
    expect(fastHarness.client.status).toBe("listening");

    // Question 1: "Current time?"
    fastHarness.client.submitVoicePrompt("Current time?");
    expect(fastHarness.client.status).toBe("speaking");
    while (fastHarness.synthesis.speaking) {
      fastHarness.synthesis.completeCurrentUtterance();
    }
    expect(fastHarness.client.status).toBe("listening");

    // Question 2: "List 3 prime numbers"
    fastHarness.client.submitVoicePrompt("List 3 prime numbers");
    expect(fastHarness.client.status).toBe("speaking");
    while (fastHarness.synthesis.speaking) {
      fastHarness.synthesis.completeCurrentUtterance();
    }
    expect(fastHarness.client.status).toBe("listening");

    // Question 3: "What is 2+2?"
    fastHarness.client.submitVoicePrompt("What is 2+2?");
    expect(fastHarness.client.status).toBe("speaking");
    while (fastHarness.synthesis.speaking) {
      fastHarness.synthesis.completeCurrentUtterance();
    }
    expect(fastHarness.client.status).toBe("listening");

    // All turns correctly sequenced, zero race conditions, transcript perfectly serialized
    expect(fastHarness.client.transcriptHistory.length).toBe(6);
    expect(fastHarness.client.transcriptHistory[0].text).toBe("Current time?");
    expect(fastHarness.client.transcriptHistory[1].text).toContain("Quick response to: Current time?");
    expect(fastHarness.client.transcriptHistory[2].text).toBe("List 3 prime numbers");
    expect(fastHarness.client.transcriptHistory[3].text).toContain("Quick response to: List 3 prime numbers");
    expect(fastHarness.client.transcriptHistory[4].text).toBe("What is 2+2?");
    expect(fastHarness.client.transcriptHistory[5].text).toContain("Quick response to: What is 2+2?");

    fastHarness.client.endCall("user_hangup");
    expect(fastHarness.client.mainChatHistory.length).toBe(6);
    fastHarness.dispose();
  });

  /* ------------------------------------------------------------------ */
  /* T4.6: Error Recovery, Disconnect & Transcript Persistence Workflow */
  /* ------------------------------------------------------------------ */
  it("T4.6: Error Recovery, Disconnect & Transcript Persistence Workflow", async () => {
    // 1. Active voice call with several completed turns
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");

    // Turn 1
    harness.client.submitVoicePrompt("Turn 1 question: Hello assistant");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }

    // Turn 2
    harness.client.submitVoicePrompt("Turn 2 question: Save my progress");
    while (harness.synthesis.speaking) {
      harness.synthesis.completeCurrentUtterance();
    }

    // User starts streaming an in-flight Turn 3
    harness.recognition.simulateInterim("Turn 3 in-flight question...");

    // 2. Simulated unexpected network socket glitch / drop
    const activeSessionId = harness.client.session?.sessionId;
    harness.host.handleSocketDisconnect(activeSessionId);

    // Host session is marked ended due to connection_lost
    expect(harness.host.sessions.get(activeSessionId!)?.status).toBe("ended");
    expect(harness.host.sessions.get(activeSessionId!)?.endReason).toBe("connection_lost");

    // 3. Client gracefully transitions to teardown without freezing UI
    harness.client.endCall("connection_lost");
    expect(harness.client.status).toBe("ended");
    expect(harness.client.isDrawerOpen).toBe(false);

    // 4. Completed turns before the drop are safely saved to main chat session
    expect(harness.client.mainChatHistory.length).toBe(4);
    expect(harness.client.mainChatHistory[0].content).toContain("Turn 1 question");
    expect(harness.client.mainChatHistory[1].content).toContain("agent response");
    expect(harness.client.mainChatHistory[2].content).toContain("Turn 2 question");
    expect(harness.client.mainChatHistory[3].content).toContain("agent response");

    // 5. Re-establishing connection works cleanly from clean slate
    await harness.client.startCall();
    expect(harness.client.status).toBe("listening");
    expect(harness.client.isDrawerOpen).toBe(true);
    expect(harness.client.session?.sessionId).not.toBe(activeSessionId);
    expect(harness.audio.isInitialized).toBe(true);
  });
});

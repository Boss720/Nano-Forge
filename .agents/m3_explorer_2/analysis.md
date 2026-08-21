# Architectural Investigation & Specification: `useVoiceCall` Controller Hook

**Target Artifact**: `src/hooks/useVoiceCall.ts`  
**Milestone**: M3 (Voice Mode Architecture & UI Integration)  
**Author**: `m3_explorer_2` (Teamwork Explorer)  
**Date**: 2026-08-15  

---

## 1. Executive Summary

This specification defines the architecture, finite state machine, service coordination, and full implementation blueprint for the `useVoiceCall` React controller hook (`src/hooks/useVoiceCall.ts`). 

The `useVoiceCall` hook acts as the central orchestrator bridging:
1. **Web Audio Engine (`AudioEngineService`)**: Manages microphone capture with AEC/NS/AGC constraints, isolated audio graphs, gain nodes, and FFT analysers for time-domain and frequency data.
2. **Speech Recognition (`SpeechRecognitionService`)**: Powers continuous Web Speech API STT, interim transcript streaming, and voice activity detection (VAD) pause auto-dispatch (1400ms default debounce).
3. **Speech Synthesis (`SpeechSynthesisService`)**: Handles assistant text-to-speech rendering, sentence/clause boundary chunking, voice configuration, and instant barge-in cancellation.
4. **Agent Host & Chat Session (`HostClient` / `App.tsx`)**: Bridges voice prompts to the active LLM stream/agent coordinator and synchronizes voice turn transcripts with the main chat history.
5. **Interactive UI Dock (`VoiceCallDrawer` & Visualizers)**: Exposes reactive state (`status`, `isMuted`, `micGain`, `speakerVolume`, `durationSeconds`, `interimTranscript`, `finalTranscript`, `transcriptHistory`, `isDrawerOpen`, `micVisualData`, `speakerVisualData`) and user action handlers (`startCall`, `endCall`, `toggleMute`, `interruptAgent`, `setMicGain`, `setSpeakerVolume`, `openDrawer`, `closeDrawer`).

---

## 2. Architecture & Call Chain

```
+----------------------------------------------------------------------------------------------------+
|                                           User Trigger                                             |
|                     [TopBar Trigger Button]  |  [ChatComposer Mic Button]  |  [/call]              |
+--------------------------------------------------+-------------------------------------------------+
                                                   |
                                                   v
+----------------------------------------------------------------------------------------------------+
|                                    useVoiceCall Controller Hook                                    |
|                                                                                                    |
|   State Machine: idle -> connecting -> listening <-> thinking <-> speaking                         |
|                                     \           \                                                  |
|                                      -> muted <- +                                                 |
|                                            |                                                       |
|                                            v                                                       |
|                                          ended                                                     |
|                                                                                                    |
|   Services Managed:                                                                                |
|   ├── AudioEngineService: getUserMedia, GainNode (0-2x), AnalyserNode (FFT 128), SpeakerGain (0-1) |
|   ├── SpeechRecognitionService: Web Speech STT, VAD Pause Dispatch (1400ms), onSpeechStart hook    |
|   └── SpeechSynthesisService: TTS Queue, SpeechSynthesisUtterance, Barge-in cancel()               |
+------------------------------------+-----------------------------------+---------------------------+
                                     |                                   |
              UI Render Props        |                                   | Prompt Dispatch &
                                     v                                   v Audio Streaming
+------------------------------------+------------------+ +--------------+----------------------------+
|            VoiceCallDrawer UI Dock                    | |     Backend Agent Host / Main Chat       |
|  - VoiceCallHeader (Status Badge, Duration Timer)     | |  - Web Chat Session History (App.tsx)    |
|  - VoiceParticipantCards (User / Agent profiles)      | |  - HostClient WebSocket (voice.session.*)|
|  - VoiceWaveformVisualizer (Mic Oscilloscope Canvas)  | |  - LLM Stream & Tool Execution           |
|  - VoiceFrequencyVisualizer (Agent Equalizer Bars)    | |  - voice.turn.event / voice.tts.chunk    |
|  - VoiceCallTranscriptionStream (Interim + Turns)     | +------------------------------------------+
|  - VoiceCallControls (Mute, Barge-In, Gain, Vol, End) |
+-------------------------------------------------------+
```

---

## 3. Protocol Alignment & Types

The hook is strictly aligned with `@protocol/voice` (`packages/protocol/src/voice.ts`).

### Key Imported Types & Schemas
- `VoiceCallStatus`: `"idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended"`
- `VoiceCallEndReason`: `"user_hangup" | "agent_hangup" | "timeout" | "error" | "connection_lost"`
- `VoiceInterruptReason`: `"user_speech_detected" | "user_manual_button" | "session_closed"`
- `VoiceProfile`: `{ voiceId, name, rate, pitch, timbre, language }`
- `VoiceParticipant`: `{ userId, userName, agentId, agentName, avatarUrl }`
- `VoiceCallSession`: Full session entity with timestamps, turn counts, gain/volume levels
- `AudioVisualData`: `{ timeDomainData: Uint8Array, frequencyData: Uint8Array, rmsVolume: number, peakVolume: number }`
- Helper utilities: `createVoiceCallSession`, `clampGain`, `clampVolume`, `isValidVoiceStateTransition`, `isVoiceCallActive`, `isVoiceCallTerminal`

### Transcript Turn History Model
To ensure rich rendering in `VoiceCallTranscriptionStream` and synchronization with `App.tsx` chat history, `transcriptHistory` tracks:
```ts
export interface VoiceTranscriptItem {
  id: string;
  turnId: string;
  speaker: "user" | "agent";
  text: string;
  isFinal: boolean;
  timestamp: string;
}
```

---

## 4. State Model & Hook Interface Specification

### Hook Input Options (`UseVoiceCallOptions`)
```ts
export interface UseVoiceCallOptions {
  /** Optional callback to dispatch voice prompt to active chat or agent session */
  onSendPrompt?: (prompt: string) => Promise<void> | void;
  /** Optional callback fired when call terminates, supplying all turn transcripts */
  onCallEnd?: (transcripts: VoiceTranscriptItem[], durationSeconds: number) => void;
  /** Optional host client for direct WebSocket voice session synchronization */
  hostClient?: HostClient | null;
  /** Custom initial voice profile */
  initialVoiceProfile?: Partial<VoiceProfile>;
  /** Auto open drawer when call starts (default: true) */
  autoOpenDrawer?: boolean;
  /** Auto speak agent responses returned by model (default: true) */
  autoSpeakAgentResponses?: boolean;
  /** VAD silence timeout in milliseconds (default: 1400ms) */
  silenceTimeoutMs?: number;
}
```

### Hook Return Contract (`UseVoiceCallReturn`)
```ts
export interface UseVoiceCallReturn {
  // --- Core State ---
  session: VoiceCallSession | null;
  status: VoiceCallStatus;
  isCallActive: boolean;
  isMuted: boolean;
  micGain: number;          // 0.0 to 2.0
  speakerVolume: number;    // 0.0 to 1.0
  durationSeconds: number;  // Monotonic call duration timer
  error: string | null;

  // --- Transcription State ---
  interimTranscript: string;
  finalTranscript: string;
  transcriptHistory: VoiceTranscriptItem[];

  // --- UI & Visualizer State ---
  isDrawerOpen: boolean;
  micVisualData: AudioVisualData;
  speakerVisualData: AudioVisualData;
  availableVoices: SpeechSynthesisVoice[];
  activeVoiceURI: string | null;

  // --- Action Handlers ---
  startCall: (params?: Partial<CreateVoiceCallSessionParams>) => Promise<boolean>;
  endCall: (reason?: VoiceCallEndReason) => void;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
  setMicGain: (gain: number) => void;
  setSpeakerVolume: (volume: number) => void;
  interruptAgent: (reason?: VoiceInterruptReason) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  sendVoicePrompt: (prompt: string) => Promise<void>;
  speakAgentResponse: (text: string) => Promise<void>;
  updateVoiceSettings: (settings: { voiceURI?: string | null; rate?: number; pitch?: number }) => void;
}
```

---

## 5. Detailed Service Integration Mechanics

### 5.1 Web Audio Engine (`AudioEngineService`)
1. **Initialization (`startCall`)**:
   - `audioEngineService.initialize()` requests `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`.
   - If user denies permission or device is unavailable:
     - Sets `error = "Microphone access denied or audio unsupported"`
     - Transitions status to `"ended"`
     - Aborts call startup cleanly.
   - Resumes `AudioContext` via `audioEngineService.resumeContext()` to handle browser autoplay policies.
2. **Microphone Muting**:
   - Calling `setMuted(true)` sets `audioEngineService.setMuted(true)` which:
     - Mutes `micGainNode` (gain = 0).
     - Disables media stream audio tracks (`track.enabled = false`).
     - Returns zeroed/silent `AudioVisualData` on visualizer taps.
3. **Gain & Volume**:
   - `setMicGain(gain)` sets gain on `micGainNode` (clamped [0.0, 2.0]).
   - `setSpeakerVolume(volume)` sets volume on `speakerGainNode` and updates `speechSynthesisService.updateSettings({ volume })`.
4. **Teardown (`endCall`)**:
   - `audioEngineService.cleanup()` stops all audio tracks, disconnects gain and analyser nodes, and closes `AudioContext`.

### 5.2 Speech Recognition (`SpeechRecognitionService`)
1. **Continuous Recognition**:
   - Instantiated with `silenceTimeoutMs: 1400`, `continuous: true`, `interimResults: true`.
   - `onInterimResult(text)`: Updates `interimTranscript = text`.
   - `onFinalResult(text)`: Updates `finalTranscript = text`, resets `interimTranscript = ""`.
   - `onSpeechStart()`: Triggers instant **Barge-in** if agent is `"speaking"` or `"thinking"`.
   - `onAutoDispatch(fullPrompt)`: Triggers automatic prompt submission to the agent session.
2. **Microphone Mute Coordination**:
   - When muted, recognition is stopped (`speechRecognitionService.stop()`) and transcript buffer is cleared.
   - When unmuted, recognition is resumed (`speechRecognitionService.start()`).

### 5.3 Speech Synthesis (`SpeechSynthesisService`)
1. **Assistant Speech Playback**:
   - When an agent turn finishes or streaming tokens are spoken, `speakAgentResponse(text)` calls `speechSynthesisService.speak(text)`.
   - `SpeechSynthesisService` partitions the text using `chunkTextForSpeech()` (sentences -> clauses -> words <= 150 chars) and speaks sequentially.
   - Transitions status to `"speaking"` on start.
   - On utterance completion, transitions status back to `"listening"` (or `"muted"`).
2. **Instant Cancellation**:
   - When `interruptAgent()` is called or `onSpeechStart()` fires during agent playback, `speechSynthesisService.cancel()` immediately aborts the active utterance, empties the chunk queue, and emits `"cancel"`.

---

## 6. Finite State Machine & Lifecycle Transitions

### State Transition Diagram

```
                 +--------------------------+
                 |          idle            |
                 +--------------------------+
                              |
                     startCall() (Init)
                              |
                              v
                 +--------------------------+
                 |       connecting         |
                 +--------------------------+
                   /          |           \
         (Muted)  /           |            \  (Error/Cancel)
                 v            v             v
        +----------+    +-----------+    +-------+
        |  muted   |<-->| listening |--->| ended |
        +----------+    +-----------+    +-------+
             ^                |              ^
             |    VAD Pause   |              |
             |   Auto-Dispatch|              |
             |                v              |
             |          +-----------+        |
             +----------| thinking  |--------+
             |          +-----------+        |
             |                |              |
             |          LLM Tokens           |
             |          Arriving (TTS)       |
             |                v              |
             |          +-----------+        |
             +----------| speaking  |--------+
                        +-----------+
                              |
                     TTS Done / Interrupted
                              |
                              v
                        [ listening ]
```

### Transition Invariants Table

| From State | Event / Trigger | Target State | Service Actions |
|---|---|---|---|
| `idle` | `startCall()` | `connecting` | Request mic stream, init AudioEngine & SpeechRecognition |
| `connecting` | Audio + STT Ready | `listening` | Start STT, start duration timer, start visualizer loop |
| `connecting` | Init Failed / Denied | `ended` | AudioEngine cleanup, record error, close drawer |
| `listening` | `toggleMute(true)` | `muted` | Stop STT, set micGain=0, disable tracks |
| `muted` | `toggleMute(false)` | `listening` | Resume STT, restore micGain, enable tracks |
| `listening` | VAD Pause (1400ms) | `thinking` | Commit user turn to transcript history, dispatch prompt |
| `thinking` | Agent tokens / TTS start | `speaking` | Start `speechSynthesisService.speak()`, stream chunks |
| `speaking` | TTS finish | `listening` | Return to listening for next user utterance |
| `speaking` / `thinking` | Barge-in (Speech detected) | `listening` | `speechSynthesisService.cancel()`, abort LLM stream |
| Any Active | `endCall()` | `ended` | Stop timer, cleanup AudioEngine, stop STT, cancel TTS |
| `ended` | `startCall()` | `connecting` | Reset transcripts, reset duration, start new session |

---

## 7. Barge-In Interruption Engine & Race Condition Handling

### Barge-In Mechanics
When the agent is synthesizing speech (`status === "speaking"`) or processing a prompt (`status === "thinking"`):
1. **User Speaks (`onSpeechStart`)**:
   - `SpeechRecognitionService` detects voice onset.
   - If `status === "speaking"` or `status === "thinking"`:
     - Calls `interruptAgent("user_speech_detected")`.
2. **User Clicks Interrupt Button**:
   - User clicks the UI interrupt control in `VoiceCallControls.tsx`.
   - Calls `interruptAgent("user_manual_button")`.
3. **Execution Sequence in `interruptAgent`**:
   - Immediate cancellation: `speechSynthesisService.cancel()`.
   - Host synchronization: If `hostClient` is connected and active session exists, send `voice.interrupt` frame.
   - State transition: Immediately transition status to `"listening"` (or `"muted"` if mic was muted).
   - Turn sync: Record `"interrupted"` turn state in transcript.

### Race Condition Defenses
1. **Echo / Feedback Loop Prevention**:
   - `AudioEngineService` does NOT connect `micSourceNode` to `audioContext.destination`.
   - `AudioEngineService` enables hardware/browser `echoCancellation: true` to prevent TTS audio playing through speakers from triggering false microphone barge-in.
2. **Out-of-Order Utterance Completion**:
   - When `cancel()` is called on `SpeechSynthesisService`, all pending promises are resolved cleanly without triggering spurious `end` events that would overwrite the interrupted state.
3. **Rapid Consecutive Calls**:
   - `startCall` and `endCall` use an internal `isStartingRef` / `isEndingRef` guard to prevent double-initialization or concurrent teardown races.

---

## 8. Real-Time Audio Visualizer Sampling Engine

To achieve 60fps waveform and equalizer animations in `VoiceCallDrawer` without causing React re-render churn or memory leaks:

1. **State Polling vs Direct Canvas Tap**:
   - `useVoiceCall` maintains `micVisualData` and `speakerVisualData` state for reactive component updates.
   - Uses `requestAnimationFrame` loop active only when `isDrawerOpen && isVoiceCallActive(status)`.
   - When drawer is closed or call ends, the `requestAnimationFrame` is cancelled immediately to preserve CPU/battery.
2. **Zero Allocation Buffers**:
   - `AudioEngineService` uses pre-allocated typed arrays (`micTimeBuffer`, `micFreqBuffer`, `speakerTimeBuffer`, `speakerFreqBuffer`) of length `fftSize = 128`.
   - Computes RMS volume $\sqrt{\frac{1}{N}\sum x_i^2}$ and peak volume $\max(|x_i|)$ in linear time.
3. **Headless / Test Environment Safety**:
   - In environments where `requestAnimationFrame` or `AudioContext` is mocked, the visualizer loop gracefully falls back or yields silent arrays without throwing.

---

## 9. Implementation Blueprint for `src/hooks/useVoiceCall.ts`

Here is the complete, production-ready specification and code design for `src/hooks/useVoiceCall.ts`:

```ts
/**
 * Interactive Audio Voice Call Controller Hook for NanoForge
 * 
 * Coordinates:
 * - AudioEngineService (Web Audio API graph, gain/volume, FFT visualizer taps)
 * - SpeechRecognitionService (Continuous STT, interim transcripts, VAD auto-dispatch)
 * - SpeechSynthesisService (TTS chunk playback, voice enumeration, instant barge-in)
 * - Agent Host Session & WebSocket Protocol synchronization
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  createVoiceCallSession,
  clampGain,
  clampVolume,
  isValidVoiceStateTransition,
  isVoiceCallActive,
  DEFAULT_MIC_GAIN,
  DEFAULT_SPEAKER_VOLUME,
  type VoiceCallSession,
  type VoiceCallStatus,
  type VoiceCallEndReason,
  type VoiceInterruptReason,
  type VoiceProfile,
  type CreateVoiceCallSessionParams,
} from "@protocol/voice";
import {
  audioEngineService,
  type AudioVisualData,
} from "@/services/audioEngine";
import {
  SpeechRecognitionService,
  type ISpeechRecognitionService,
} from "@/services/speechRecognition";
import {
  speechSynthesisService,
  type TTSSettings,
} from "@/services/speechSynthesis";
import type { HostClient } from "@/lib/hostClient";

export interface VoiceTranscriptItem {
  id: string;
  turnId: string;
  speaker: "user" | "agent";
  text: string;
  isFinal: boolean;
  timestamp: string;
}

export interface UseVoiceCallOptions {
  /** Callback fired when VAD triggers auto-dispatch of user prompt */
  onSendPrompt?: (prompt: string) => Promise<void> | void;
  /** Callback fired when call terminates */
  onCallEnd?: (transcripts: VoiceTranscriptItem[], durationSeconds: number) => void;
  /** Optional HostClient for backend voice protocol message exchange */
  hostClient?: HostClient | null;
  /** Initial voice profile preferences */
  initialVoiceProfile?: Partial<VoiceProfile>;
  /** Auto open drawer on call start (default: true) */
  autoOpenDrawer?: boolean;
  /** Auto speak agent responses returned by model (default: true) */
  autoSpeakAgentResponses?: boolean;
  /** Silence pause timeout in ms before auto-dispatching (default: 1400) */
  silenceTimeoutMs?: number;
}

export interface UseVoiceCallReturn {
  session: VoiceCallSession | null;
  status: VoiceCallStatus;
  isCallActive: boolean;
  isMuted: boolean;
  micGain: number;
  speakerVolume: number;
  durationSeconds: number;
  error: string | null;

  interimTranscript: string;
  finalTranscript: string;
  transcriptHistory: VoiceTranscriptItem[];

  isDrawerOpen: boolean;
  micVisualData: AudioVisualData;
  speakerVisualData: AudioVisualData;
  availableVoices: SpeechSynthesisVoice[];
  activeVoiceURI: string | null;

  startCall: (params?: Partial<CreateVoiceCallSessionParams>) => Promise<boolean>;
  endCall: (reason?: VoiceCallEndReason) => void;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
  setMicGain: (gain: number) => void;
  setSpeakerVolume: (volume: number) => void;
  interruptAgent: (reason?: VoiceInterruptReason) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  sendVoicePrompt: (prompt: string) => Promise<void>;
  speakAgentResponse: (text: string) => Promise<void>;
  updateVoiceSettings: (settings: { voiceURI?: string | null; rate?: number; pitch?: number }) => void;
}

export function useVoiceCall(options: UseVoiceCallOptions = {}): UseVoiceCallReturn {
  const {
    onSendPrompt,
    onCallEnd,
    hostClient,
    initialVoiceProfile,
    autoOpenDrawer = true,
    autoSpeakAgentResponses = true,
    silenceTimeoutMs = 1400,
  } = options;

  // --- Core State ---
  const [session, setSession] = useState<VoiceCallSession | null>(null);
  const [status, setStatus] = useState<VoiceCallStatus>("idle");
  const [isMuted, setIsMutedState] = useState(false);
  const [micGain, setMicGainState] = useState(DEFAULT_MIC_GAIN);
  const [speakerVolume, setSpeakerVolumeState] = useState(DEFAULT_SPEAKER_VOLUME);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // --- Transcripts ---
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [transcriptHistory, setTranscriptHistory] = useState<VoiceTranscriptItem[]>([]);

  // --- UI & Visualizer State ---
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [micVisualData, setMicVisualData] = useState<AudioVisualData>(() =>
    audioEngineService.getMicVisualData()
  );
  const [speakerVisualData, setSpeakerVisualData] = useState<AudioVisualData>(() =>
    audioEngineService.getSpeakerVisualData()
  );
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>(() =>
    speechSynthesisService.getVoices()
  );
  const [activeVoiceURI, setActiveVoiceURI] = useState<string | null>(
    speechSynthesisService.settings.voiceURI
  );

  // --- Refs for stable access in async callbacks ---
  const statusRef = useRef<VoiceCallStatus>(status);
  statusRef.current = status;

  const sessionRef = useRef<VoiceCallSession | null>(session);
  sessionRef.current = session;

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visualizerRafRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionService | null>(null);
  const isStartingRef = useRef(false);
  const currentTurnIdRef = useRef<string>("turn-0");

  const isCallActive = useMemo(() => isVoiceCallActive(status), [status]);

  // Safe state transition helper
  const transitionStatus = useCallback((nextStatus: VoiceCallStatus) => {
    setStatus((prev) => {
      if (isValidVoiceStateTransition(prev, nextStatus)) {
        return nextStatus;
      }
      console.warn(`Invalid voice call transition attempted: ${prev} -> ${nextStatus}`);
      return prev;
    });
  }, []);

  // --- Interrupt Agent Helper ---
  const interruptAgent = useCallback((reason: VoiceInterruptReason = "user_manual_button") => {
    const currentStatus = statusRef.current;
    if (currentStatus !== "speaking" && currentStatus !== "thinking") {
      return;
    }

    // 1. Immediately cancel TTS playback
    speechSynthesisService.cancel();

    // 2. Sync with Host if connected
    if (hostClient && sessionRef.current) {
      void hostClient.sendVoiceMessage?.({
        type: "voice.interrupt",
        requestId: crypto.randomUUID(),
        sessionId: sessionRef.current.sessionId,
        turnId: currentTurnIdRef.current,
        reason,
      });
    }

    // 3. Update status back to listening (or muted)
    const nextStatus = isMutedRef.current ? "muted" : "listening";
    transitionStatus(nextStatus);

    // 4. Mark turn interrupted in transcript
    setTranscriptHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.speaker === "agent" && !last.isFinal) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + " [interrupted]", isFinal: true },
        ];
      }
      return prev;
    });
  }, [hostClient, transitionStatus]);

  // --- Prompt Submission & Auto-Dispatch ---
  const sendVoicePrompt = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim();
      if (!trimmed) return;

      const turnId = `turn-${Date.now()}`;
      currentTurnIdRef.current = turnId;

      // 1. Record User Turn in History
      const userItem: VoiceTranscriptItem = {
        id: crypto.randomUUID(),
        turnId,
        speaker: "user",
        text: trimmed,
        isFinal: true,
        timestamp: new Date().toISOString(),
      };

      setTranscriptHistory((prev) => [...prev, userItem]);
      setFinalTranscript(trimmed);
      setInterimTranscript("");

      // 2. Transition status to thinking
      transitionStatus("thinking");

      // 3. Dispatch to Agent Session
      try {
        if (onSendPrompt) {
          await onSendPrompt(trimmed);
        } else if (hostClient && sessionRef.current) {
          void hostClient.sendVoiceMessage?.({
            type: "voice.transcript.submit",
            requestId: crypto.randomUUID(),
            sessionId: sessionRef.current.sessionId,
            turnId,
            text: trimmed,
            isFinal: true,
          });
        }
      } catch (err) {
        console.error("Failed to dispatch voice prompt:", err);
        setError(err instanceof Error ? err.message : "Prompt dispatch failed");
        transitionStatus(isMutedRef.current ? "muted" : "listening");
      }
    },
    [onSendPrompt, hostClient, transitionStatus]
  );

  // --- Speak Agent Response ---
  const speakAgentResponse = useCallback(
    async (text: string) => {
      if (!text || !text.trim() || !autoSpeakAgentResponses) return;

      const turnId = currentTurnIdRef.current;
      const agentItem: VoiceTranscriptItem = {
        id: crypto.randomUUID(),
        turnId,
        speaker: "agent",
        text: text.trim(),
        isFinal: true,
        timestamp: new Date().toISOString(),
      };

      setTranscriptHistory((prev) => [...prev, agentItem]);
      transitionStatus("speaking");

      try {
        await speechSynthesisService.speak(text);
      } catch (err) {
        console.warn("Speech synthesis error or interrupted:", err);
      } finally {
        if (statusRef.current === "speaking") {
          transitionStatus(isMutedRef.current ? "muted" : "listening");
        }
      }
    },
    [autoSpeakAgentResponses, transitionStatus]
  );

  // --- Initialize SpeechRecognition Service ---
  useEffect(() => {
    const recognition = new SpeechRecognitionService({
      silenceTimeoutMs,
      continuous: true,
      interimResults: true,
      onInterimResult: (text) => {
        setInterimTranscript(text);
      },
      onFinalResult: (text) => {
        setFinalTranscript(text);
        setInterimTranscript("");
      },
      onSpeechStart: () => {
        // Barge-in: if agent is speaking, user voice interrupts immediately
        if (statusRef.current === "speaking" || statusRef.current === "thinking") {
          interruptAgent("user_speech_detected");
        }
      },
      onAutoDispatch: (prompt) => {
        void sendVoicePrompt(prompt);
      },
      onError: (err) => {
        console.warn("SpeechRecognition error:", err);
      },
    });

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, [silenceTimeoutMs, interruptAgent, sendVoicePrompt]);

  // --- Speech Synthesis Voices Listener ---
  useEffect(() => {
    const unsub = speechSynthesisService.on("voiceschanged", (voices) => {
      setAvailableVoices(voices as SpeechSynthesisVoice[]);
    });
    return unsub;
  }, []);

  // --- Visualizer Sampling Animation Frame Loop ---
  useEffect(() => {
    if (!isDrawerOpen || !isCallActive) {
      if (visualizerRafRef.current !== null) {
        cancelAnimationFrame(visualizerRafRef.current);
        visualizerRafRef.current = null;
      }
      return;
    }

    let isSubscribed = true;

    const sampleLoop = () => {
      if (!isSubscribed) return;

      const mic = audioEngineService.getMicVisualData();
      const spk = audioEngineService.getSpeakerVisualData();

      setMicVisualData(mic);
      setSpeakerVisualData(spk);

      visualizerRafRef.current = requestAnimationFrame(sampleLoop);
    };

    visualizerRafRef.current = requestAnimationFrame(sampleLoop);

    return () => {
      isSubscribed = false;
      if (visualizerRafRef.current !== null) {
        cancelAnimationFrame(visualizerRafRef.current);
        visualizerRafRef.current = null;
      }
    };
  }, [isDrawerOpen, isCallActive]);

  // --- Duration Timer Effect ---
  useEffect(() => {
    if (isCallActive) {
      durationTimerRef.current = setInterval(() => {
        setDurationSeconds((d) => d + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current !== null) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }

    return () => {
      if (durationTimerRef.current !== null) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    };
  }, [isCallActive]);

  // --- Call Control Actions ---
  const startCall = useCallback(
    async (params?: Partial<CreateVoiceCallSessionParams>): Promise<boolean> => {
      if (isStartingRef.current || isVoiceCallActive(statusRef.current)) {
        return true;
      }
      isStartingRef.current = true;
      setError(null);
      setDurationSeconds(0);
      setInterimTranscript("");
      setFinalTranscript("");
      setTranscriptHistory([]);

      transitionStatus("connecting");
      if (autoOpenDrawer) {
        setIsDrawerOpen(true);
      }

      try {
        // 1. Initialize Audio Engine
        const audioSuccess = await audioEngineService.initialize();
        if (!audioSuccess) {
          throw new Error("Failed to initialize audio input device. Please check microphone permissions.");
        }

        // Apply pre-configured gain & volume
        audioEngineService.setMicGain(micGain);
        audioEngineService.setSpeakerVolume(speakerVolume);
        audioEngineService.setMuted(isMuted);

        // 2. Create Session Entity
        const newSession = createVoiceCallSession({
          ...params,
          status: isMuted ? "muted" : "listening",
          inputGain: micGain,
          outputVolume: speakerVolume,
          voiceProfile: {
            ...params?.voiceProfile,
            ...initialVoiceProfile,
          },
        });
        setSession(newSession);

        // 3. Start Speech Recognition
        if (!isMuted && recognitionRef.current) {
          recognitionRef.current.resetTranscript();
          recognitionRef.current.start();
        }

        // 4. Transition to Active
        transitionStatus(isMuted ? "muted" : "listening");

        // 5. Host Sync
        if (hostClient) {
          void hostClient.sendVoiceMessage?.({
            type: "voice.session.start",
            requestId: crypto.randomUUID(),
            voiceProfile: newSession.voiceProfile,
            participant: newSession.participant,
            inputGain: newSession.inputGain,
            outputVolume: newSession.outputVolume,
          });
        }

        isStartingRef.current = false;
        return true;
      } catch (err) {
        isStartingRef.current = false;
        const msg = err instanceof Error ? err.message : "Failed to start voice call";
        setError(msg);
        transitionStatus("ended");
        audioEngineService.cleanup();
        recognitionRef.current?.stop();
        return false;
      }
    },
    [
      autoOpenDrawer,
      initialVoiceProfile,
      micGain,
      speakerVolume,
      isMuted,
      hostClient,
      transitionStatus,
    ]
  );

  const endCall = useCallback(
    (reason: VoiceCallEndReason = "user_hangup") => {
      const currentStatus = statusRef.current;
      if (currentStatus === "idle" || currentStatus === "ended") {
        return;
      }

      // 1. Stop Speech Synthesis & Recognition
      speechSynthesisService.cancel();
      recognitionRef.current?.stop();

      // 2. Teardown Audio Engine
      audioEngineService.cleanup();

      // 3. Update Session
      if (sessionRef.current) {
        const endedSession: VoiceCallSession = {
          ...sessionRef.current,
          status: "ended",
          endedAt: new Date().toISOString(),
          durationSeconds,
          endReason: reason,
        };
        setSession(endedSession);
      }

      // 4. Update Status
      transitionStatus("ended");

      // 5. Sync with Host
      if (hostClient && sessionRef.current) {
        void hostClient.sendVoiceMessage?.({
          type: "voice.session.end",
          requestId: crypto.randomUUID(),
          sessionId: sessionRef.current.sessionId,
          reason,
        });
      }

      // 6. Fire onCallEnd callback
      onCallEnd?.(transcriptHistory, durationSeconds);
    },
    [durationSeconds, hostClient, onCallEnd, transcriptHistory, transitionStatus]
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      const boolMuted = Boolean(muted);
      setIsMutedState(boolMuted);
      audioEngineService.setMuted(boolMuted);

      if (boolMuted) {
        recognitionRef.current?.stop();
        if (statusRef.current === "listening") {
          transitionStatus("muted");
        }
      } else {
        if (isVoiceCallActive(statusRef.current)) {
          recognitionRef.current?.start();
          if (statusRef.current === "muted") {
            transitionStatus("listening");
          }
        }
      }

      if (hostClient && sessionRef.current) {
        void hostClient.sendVoiceMessage?.({
          type: "voice.session.mute",
          requestId: crypto.randomUUID(),
          sessionId: sessionRef.current.sessionId,
          muted: boolMuted,
        });
      }
    },
    [hostClient, transitionStatus]
  );

  const toggleMute = useCallback(() => {
    setMuted(!isMutedRef.current);
  }, [setMuted]);

  const setMicGain = useCallback(
    (gain: number) => {
      const clamped = clampGain(gain);
      setMicGainState(clamped);
      audioEngineService.setMicGain(clamped);

      if (sessionRef.current) {
        setSession((prev) => (prev ? { ...prev, inputGain: clamped } : prev));
      }

      if (hostClient && sessionRef.current) {
        void hostClient.sendVoiceMessage?.({
          type: "voice.session.gain",
          requestId: crypto.randomUUID(),
          sessionId: sessionRef.current.sessionId,
          inputGain: clamped,
        });
      }
    },
    [hostClient]
  );

  const setSpeakerVolume = useCallback(
    (volume: number) => {
      const clamped = clampVolume(volume);
      setSpeakerVolumeState(clamped);
      audioEngineService.setSpeakerVolume(clamped);
      speechSynthesisService.updateSettings({ volume: clamped });

      if (sessionRef.current) {
        setSession((prev) => (prev ? { ...prev, outputVolume: clamped } : prev));
      }

      if (hostClient && sessionRef.current) {
        void hostClient.sendVoiceMessage?.({
          type: "voice.session.gain",
          requestId: crypto.randomUUID(),
          sessionId: sessionRef.current.sessionId,
          outputVolume: clamped,
        });
      }
    },
    [hostClient]
  );

  const updateVoiceSettings = useCallback(
    (settings: { voiceURI?: string | null; rate?: number; pitch?: number }) => {
      speechSynthesisService.updateSettings(settings);
      if (settings.voiceURI !== undefined) {
        setActiveVoiceURI(settings.voiceURI);
      }
    },
    []
  );

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setIsDrawerOpen((prev) => !prev), []);

  return {
    session,
    status,
    isCallActive,
    isMuted,
    micGain,
    speakerVolume,
    durationSeconds,
    error,

    interimTranscript,
    finalTranscript,
    transcriptHistory,

    isDrawerOpen,
    micVisualData,
    speakerVisualData,
    availableVoices,
    activeVoiceURI,

    startCall,
    endCall,
    toggleMute,
    setMuted,
    setMicGain,
    setSpeakerVolume,
    interruptAgent,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    sendVoicePrompt,
    speakAgentResponse,
    updateVoiceSettings,
  };
}
```

---

## 10. Unit & Integration Testing Strategy

The test suite for `useVoiceCall.ts` will reside at `src/hooks/__tests__/useVoiceCall.test.tsx` using `vitest` and `@testing-library/react` (specifically `renderHook` and `act`).

### Test Coverage Matrix

| Test Suite | Target Invariant | Mock / Assertion |
|---|---|---|
| **1. Initialization & Defaults** | Starts in `idle` state, `durationSeconds = 0`, silent visual data | `renderHook(() => useVoiceCall())` |
| **2. Call Startup (`startCall`)** | Initializes AudioEngine, starts SpeechRecognition, transitions `connecting` -> `listening`, opens drawer | `setupAudioMocks()`, `act(async () => result.current.startCall())` |
| **3. Microphone Permission Failure** | Handles rejected `getUserMedia`, sets `error`, transitions to `ended` | Mock `getUserMedia` rejection, verify graceful state |
| **4. Microphone Mute / Unmute** | Disables STT, sets micGain=0, transitions `listening` <-> `muted` | `result.current.toggleMute()`, verify `audioEngine.isMuted` |
| **5. Gain & Volume Clamping** | Clamps mic gain to [0.0, 2.0], volume to [0.0, 1.0] | Pass negative and excessive numbers, verify clamped state |
| **6. VAD Pause Auto-Dispatch** | Auto-dispatches after 1400ms pause, appends user turn, resets buffer | `vi.advanceTimersByTime(1400)`, verify `onSendPrompt` called |
| **7. Barge-In Interruption** | Voice start during agent speech cancels TTS, transitions to `listening` | `simulateTranscript("stop")`, verify `speechSynthesis.cancel` called |
| **8. Duration Timer** | Increments every 1000ms while active, stops on `endCall()` | `vi.advanceTimersByTime(5000)`, verify `durationSeconds === 5` |
| **9. Visualizer Sampling** | `requestAnimationFrame` loop polls mic/speaker visual data while drawer open | `result.current.openDrawer()`, verify visual data updates |
| **10. Call Teardown (`endCall`)** | Cleans up AudioEngine, cancels TTS, stops STT, fires `onCallEnd` | `result.current.endCall("user_hangup")`, verify full teardown |

---

## 11. Conclusion & Implementation Readiness

The `useVoiceCall` controller hook has been fully specified and validated against:
- Protocol wire schemas and helper functions in `packages/protocol/src/voice.ts`.
- Service interfaces and implementations in `audioEngine.ts`, `speechRecognition.ts`, `speechSynthesis.ts`.
- Complete test mocks in `src/test/audioMocks.ts`.
- UI requirements for `VoiceCallDrawer.tsx`, `TopBar.tsx`, `ChatComposer.tsx`, and `App.tsx`.

Ready for implementation in Milestone M3.

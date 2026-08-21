/**
 * Interactive Audio Voice Call Controller Hook for NanoForge
 * 
 * Coordinates:
 * - AudioEngineService (Web Audio API graph, gain/volume, FFT visualizer taps)
 * - SpeechRecognitionService (Continuous STT, interim transcripts, VAD auto-dispatch)
 * - SpeechSynthesisService (TTS chunk playback, voice enumeration, instant barge-in)
 * - Agent Host Session & WebSocket Protocol synchronization
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "@/services/speechRecognition";
import {
  speechSynthesisService,
} from "@/services/speechSynthesis";

export interface VoiceTranscriptItem {
  id: string;
  turnId: string;
  speaker: "user" | "agent";
  text: string;
  interimText?: string;
  isFinal: boolean;
  interrupted?: boolean;
  timestamp: string;
}

export interface HostClientVoiceSender {
  sendVoiceMessage?: (msg: Record<string, unknown>) => void;
  [key: string]: unknown;
}

export interface UseVoiceCallOptions {
  /** Callback fired when VAD triggers auto-dispatch of user prompt */
  onSendPrompt?: (prompt: string) => Promise<void> | void;
  /** Callback fired when a dialogue turn completes or is interrupted */
  onCommitTurn?: (turn: { speaker: "user" | "agent"; text: string; interrupted?: boolean }) => void;
  /** Callback fired when call terminates */
  onCallEnd?: (transcripts: VoiceTranscriptItem[], durationSeconds: number) => void;
  /** Optional HostClient for backend voice protocol message exchange */
  hostClient?: HostClientVoiceSender | null;
  /** Active model name or identifier */
  modelName?: string;
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
  // State
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

  // Actions
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
    onCommitTurn,
    onCallEnd,
    hostClient,
    modelName = "NanoForge Agent",
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
    const current = statusRef.current;
    if (isValidVoiceStateTransition(current, nextStatus)) {
      statusRef.current = nextStatus;
      setStatus(nextStatus);
    } else {
      console.warn(`Invalid voice call transition attempted: ${current} -> ${nextStatus}`);
    }
  }, []);

  // --- Interrupt Agent Helper ---
  const interruptAgent = useCallback(
    (reason: VoiceInterruptReason = "user_manual_button") => {
      const currentStatus = statusRef.current;
      if (currentStatus !== "speaking" && currentStatus !== "thinking") {
        return;
      }

      // 1. Immediately cancel TTS playback
      speechSynthesisService.cancel();

      // 2. Sync with Host if connected
      if (hostClient && sessionRef.current) {
        try {
          void hostClient.sendVoiceMessage?.({
            type: "voice.interrupt",
            requestId: crypto.randomUUID(),
            sessionId: sessionRef.current.sessionId,
            turnId: currentTurnIdRef.current,
            reason,
          });
        } catch {}
      }

      // 3. Update status back to listening (or muted)
      const nextStatus = isMutedRef.current ? "muted" : "listening";
      transitionStatus(nextStatus);

      // 4. Mark turn interrupted in transcript
      setTranscriptHistory((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.speaker === "agent") {
          const updated: VoiceTranscriptItem = {
            ...last,
            text: last.text.includes("[interrupted]") ? last.text : `${last.text} [interrupted]`,
            interrupted: true,
            isFinal: true,
          };
          onCommitTurn?.({ speaker: "agent", text: last.text, interrupted: true });
          return [...prev.slice(0, -1), updated];
        }
        return prev;
      });
    },
    [hostClient, onCommitTurn, transitionStatus]
  );

  // --- Prompt Submission & Auto-Dispatch ---
  const sendVoicePrompt = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim();
      if (!trimmed || !isVoiceCallActive(statusRef.current)) return;

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

      onCommitTurn?.({ speaker: "user", text: trimmed });

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
    [onCommitTurn, onSendPrompt, hostClient, transitionStatus]
  );

  // --- Speak Agent Response ---
  const speakAgentResponse = useCallback(
    async (text: string) => {
      if (!text || !text.trim() || !autoSpeakAgentResponses || !isVoiceCallActive(statusRef.current)) return;

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
        onCommitTurn?.({ speaker: "agent", text: text.trim(), interrupted: false });
      } catch (err) {
        console.warn("Speech synthesis error or interrupted:", err);
      } finally {
        if (statusRef.current === "speaking") {
          transitionStatus(isMutedRef.current ? "muted" : "listening");
        }
      }
    },
    [autoSpeakAgentResponses, onCommitTurn, transitionStatus]
  );

  // --- Initialize SpeechRecognition Service ---
  useEffect(() => {
    const recognition = new SpeechRecognitionService({
      silenceTimeoutMs,
      continuous: true,
      interimResults: true,
      onInterimResult: (text) => {
        if (isMutedRef.current) return;
        setInterimTranscript(text);
      },
      onFinalResult: (text) => {
        if (isMutedRef.current) return;
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
        if (isMutedRef.current) return;
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
        setIsDrawerOpen(true);
        return true;
      }
      isStartingRef.current = true;
      setError(null);
      setDurationSeconds(0);
      setInterimTranscript("");
      setFinalTranscript("");
      setTranscriptHistory([]);

      // 1. Create Session Entity immediately in connecting state
      const newSession = createVoiceCallSession({
        ...params,
        status: "connecting",
        inputGain: micGain,
        outputVolume: speakerVolume,
        participant: {
          agentName: modelName,
          ...params?.participant,
        },
        voiceProfile: {
          ...params?.voiceProfile,
          ...initialVoiceProfile,
        },
      });
      setSession(newSession);
      sessionRef.current = newSession;

      transitionStatus("connecting");
      if (autoOpenDrawer) {
        setIsDrawerOpen(true);
      }

      try {
        // 2. Initialize Audio Engine
        const audioSuccess = await audioEngineService.initialize();
        if (statusRef.current === "ended" || statusRef.current === "idle" || !isStartingRef.current) {
          isStartingRef.current = false;
          audioEngineService.cleanup();
          return false;
        }

        if (!audioSuccess) {
          throw new Error("Failed to initialize audio input device. Please check microphone permissions.");
        }

        // Apply pre-configured gain & volume
        audioEngineService.setMicGain(micGain);
        audioEngineService.setSpeakerVolume(speakerVolume);
        audioEngineService.setMuted(isMuted);

        // 3. Update Session to Active Status
        const activeSession: VoiceCallSession = {
          ...newSession,
          status: isMuted ? "muted" : "listening",
        };
        setSession(activeSession);
        sessionRef.current = activeSession;

        // 4. Start Speech Recognition
        if (!isMuted && recognitionRef.current) {
          recognitionRef.current.resetTranscript();
          recognitionRef.current.start();
        }

        // 5. Transition to Active
        transitionStatus(isMuted ? "muted" : "listening");

        // 6. Host Sync
        if (hostClient) {
          try {
            void hostClient.sendVoiceMessage?.({
              type: "voice.session.start",
              requestId: crypto.randomUUID(),
              voiceProfile: newSession.voiceProfile,
              participant: newSession.participant,
              inputGain: newSession.inputGain,
              outputVolume: newSession.outputVolume,
            });
          } catch {}
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
      modelName,
      speakerVolume,
      isMuted,
      hostClient,
      transitionStatus,
    ]
  );

  const endCall = useCallback(
    (reason: VoiceCallEndReason = "user_hangup") => {
      isStartingRef.current = false;
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
        try {
          void hostClient.sendVoiceMessage?.({
            type: "voice.session.end",
            requestId: crypto.randomUUID(),
            sessionId: sessionRef.current.sessionId,
            reason,
          });
        } catch {}
      }

      // 6. Fire onCallEnd callback
      onCallEnd?.(transcriptHistory, durationSeconds);
    },
    [durationSeconds, hostClient, onCallEnd, transcriptHistory, transitionStatus]
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      const boolMuted = Boolean(muted);
      isMutedRef.current = boolMuted;
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
        try {
          void hostClient.sendVoiceMessage?.({
            type: "voice.session.mute",
            requestId: crypto.randomUUID(),
            sessionId: sessionRef.current.sessionId,
            muted: boolMuted,
          });
        } catch {}
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
        try {
          void hostClient.sendVoiceMessage?.({
            type: "voice.session.gain",
            requestId: crypto.randomUUID(),
            sessionId: sessionRef.current.sessionId,
            inputGain: clamped,
          });
        } catch {}
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
        try {
          void hostClient.sendVoiceMessage?.({
            type: "voice.session.gain",
            requestId: crypto.randomUUID(),
            sessionId: sessionRef.current.sessionId,
            outputVolume: clamped,
          });
        } catch {}
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

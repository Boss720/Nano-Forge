import { useEffect } from "react";
import type { VoiceCallSession, VoiceCallStatus, VoiceProfile, VoiceParticipant } from "@protocol/voice";
import type { AudioVisualData } from "@/services/audioEngine";
import type { UseVoiceCallReturn, VoiceTranscriptItem } from "@/hooks/useVoiceCall";
import { VoiceCallHeader } from "./VoiceCallHeader";
import { VoiceParticipantCard } from "./VoiceParticipantCard";
import { VoiceWaveformVisualizer } from "./VoiceWaveformVisualizer";
import { VoiceFrequencyVisualizer } from "./VoiceFrequencyVisualizer";
import { VoiceCallTranscriptionStream } from "./VoiceCallTranscriptionStream";
import { VoiceCallControls } from "./VoiceCallControls";

export interface VoiceCallDrawerProps {
  /** Controls open/close visibility state of the drawer */
  isOpen?: boolean;
  open?: boolean; // alias for isOpen

  /** Optional complete hook return bundle */
  voice?: UseVoiceCallReturn;

  /** Active session state machine object */
  session?: VoiceCallSession | null;
  /** Current voice call status */
  status?: VoiceCallStatus;
  /** Call duration in seconds */
  durationSeconds?: number;
  /** Whether the microphone is currently muted */
  isMuted?: boolean;
  /** Current microphone gain (0.0 to 2.0) */
  micGain?: number;
  /** Current speaker volume (0.0 to 1.0) */
  speakerVolume?: number;
  /** Live interim transcription string */
  interimTranscript?: string;
  /** Historical dialogue turns */
  transcriptHistory?: VoiceTranscriptItem[];
  /** Audio visualizer data tap for user mic */
  micVisualData?: AudioVisualData;
  /** Audio visualizer data tap for agent speaker */
  speakerVisualData?: AudioVisualData;

  // Participant & profile metadata
  participant?: VoiceParticipant;
  voiceProfile?: VoiceProfile;

  // Action Handlers
  onClose?: () => void;
  onEndCall?: () => void;
  onToggleMute?: () => void;
  onSetMicGain?: (gain: number) => void;
  onSetSpeakerVolume?: (volume: number) => void;
  onInterrupt?: () => void;
  className?: string;
}

export function VoiceCallDrawer(props: VoiceCallDrawerProps) {
  const { voice, className = "" } = props;

  // Resolve props from explicit props or voice hook bundle
  const isVisible = props.isOpen ?? props.open ?? voice?.isDrawerOpen ?? false;
  const status: VoiceCallStatus = props.status ?? voice?.status ?? "idle";
  const durationSeconds = props.durationSeconds ?? voice?.durationSeconds ?? 0;
  const isMuted = props.isMuted ?? voice?.isMuted ?? false;
  const micGain = props.micGain ?? voice?.micGain ?? 1.0;
  const speakerVolume = props.speakerVolume ?? voice?.speakerVolume ?? 1.0;
  const interimTranscript = props.interimTranscript ?? voice?.interimTranscript ?? "";
  const transcriptHistory = props.transcriptHistory ?? voice?.transcriptHistory ?? [];

  const defaultSilentVisualData: AudioVisualData = {
    timeDomainData: new Uint8Array(256).fill(128),
    frequencyData: new Uint8Array(128).fill(0),
    rmsVolume: 0,
    peakVolume: 0,
  };

  const micVisualData = props.micVisualData ?? voice?.micVisualData ?? defaultSilentVisualData;
  const speakerVisualData = props.speakerVisualData ?? voice?.speakerVisualData ?? defaultSilentVisualData;

  const session = props.session ?? voice?.session ?? null;
  const participant = props.participant ?? session?.participant;
  const voiceProfile = props.voiceProfile ?? session?.voiceProfile;

  const handleClose = props.onClose ?? voice?.closeDrawer ?? (() => {});
  const handleEndCall = props.onEndCall ?? (() => voice?.endCall("user_hangup"));
  const handleToggleMute = props.onToggleMute ?? voice?.toggleMute ?? (() => {});
  const handleSetMicGain = props.onSetMicGain ?? voice?.setMicGain ?? (() => {});
  const handleSetSpeakerVolume = props.onSetSpeakerVolume ?? voice?.setSpeakerVolume ?? (() => {});
  const handleInterrupt = props.onInterrupt ?? (() => voice?.interruptAgent("user_manual_button"));

  // Keyboard Escape listener
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, handleClose]);

  if (!isVisible) {
    return null;
  }

  const isUserSpeaking = micVisualData.rmsVolume > 0.05 && !isMuted;

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200">
      {/* Backdrop overlay */}
      <div
        data-testid="voice-call-backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
      />

      {/* Drawer Panel */}
      <div
        data-testid="voice-call-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Interactive Voice Call"
        className={`relative z-10 flex h-full w-full flex-col border-l border-border bg-card shadow-2xl transition-all sm:max-w-lg md:max-w-xl animate-in slide-in-from-right duration-250 ${className}`}
      >
        {/* Header */}
        <VoiceCallHeader
          status={status}
          durationSeconds={durationSeconds}
          agentName={participant?.agentName}
          onClose={handleClose}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Participant Profiles */}
          <div className="p-3 border-b border-border/40">
            <VoiceParticipantCard
              participant={participant}
              voiceProfile={voiceProfile}
              status={status}
              isUserSpeaking={isUserSpeaking}
            />
          </div>

          {/* Dual Audio Visualizers Dock */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 border-b border-border/40 bg-secondary/20">
            <VoiceWaveformVisualizer
              visualData={micVisualData}
              isMuted={isMuted}
              height={76}
            />
            <VoiceFrequencyVisualizer
              visualData={speakerVisualData}
              isSpeaking={status === "speaking"}
              height={76}
            />
          </div>

          {/* Live Transcription Stream */}
          <VoiceCallTranscriptionStream
            turns={transcriptHistory}
            interimTranscript={interimTranscript}
            isAgentSpeaking={status === "speaking"}
          />

          {/* Interactive Controls Bar */}
          <VoiceCallControls
            status={status}
            isMuted={isMuted}
            micGain={micGain}
            speakerVolume={speakerVolume}
            onToggleMute={handleToggleMute}
            onInterrupt={handleInterrupt}
            onSetMicGain={handleSetMicGain}
            onSetSpeakerVolume={handleSetSpeakerVolume}
            onEndCall={handleEndCall}
          />
        </div>
      </div>
    </div>
  );
}

import { Mic, MicOff, PhoneOff, Square, Volume2 } from "lucide-react";
import type { VoiceCallStatus } from "@protocol/voice";
import { Slider } from "@/components/ui/slider";

export interface VoiceCallControlsProps {
  status: VoiceCallStatus;
  isMuted: boolean;
  micGain: number; // 0.0 to 2.0
  speakerVolume: number; // 0.0 to 1.0
  onToggleMute: () => void;
  onInterrupt: () => void;
  onSetMicGain: (gain: number) => void;
  onSetSpeakerVolume: (volume: number) => void;
  onEndCall: () => void;
  className?: string;
}

export function VoiceCallControls({
  status,
  isMuted,
  micGain,
  speakerVolume,
  onToggleMute,
  onInterrupt,
  onSetMicGain,
  onSetSpeakerVolume,
  onEndCall,
  className = "",
}: VoiceCallControlsProps) {
  const isEnded = status === "ended";
  const isConnecting = status === "connecting";
  const canInterrupt = status === "speaking" || status === "thinking";

  return (
    <div
      data-testid="voice-call-controls"
      className={`border-t border-border/80 bg-card p-4 ${className}`}
    >
      <div className="flex flex-col gap-3">
        {/* Sliders in full view or tuning drawer */}
        <div className="grid grid-cols-2 gap-4 rounded-md border border-border/40 bg-secondary/30 p-2.5">
          {/* Mic Gain Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Mic className="h-3 w-3" /> Mic Gain
              </span>
              <span className="text-foreground">{micGain.toFixed(2)}x</span>
            </div>
            <Slider
              data-testid="mic-gain-slider"
              value={[micGain]}
              min={0.0}
              max={2.0}
              step={0.05}
              disabled={isEnded}
              onValueChange={([val]) => onSetMicGain(val)}
              aria-label="Microphone Input Gain"
              aria-valuenow={micGain}
              aria-valuemin={0.0}
              aria-valuemax={2.0}
            />
          </div>

          {/* Speaker Volume Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Volume2 className="h-3 w-3" /> Volume
              </span>
              <span className="text-foreground">{Math.round(speakerVolume * 100)}%</span>
            </div>
            <Slider
              data-testid="speaker-volume-slider"
              value={[speakerVolume]}
              min={0.0}
              max={1.0}
              step={0.05}
              disabled={isEnded}
              onValueChange={([val]) => onSetSpeakerVolume(val)}
              aria-label="Speaker Output Volume"
              aria-valuenow={speakerVolume}
              aria-valuemin={0.0}
              aria-valuemax={1.0}
            />
          </div>
        </div>

        {/* Main Action Buttons Bar */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {/* Mute Button */}
          <button
            type="button"
            data-testid="mute-toggle-button"
            onClick={onToggleMute}
            disabled={isEnded || isConnecting}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={isMuted}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-xs font-semibold transition-all active:scale-[0.98] ${
              isMuted
                ? "border-destructive/60 bg-destructive/20 text-red-300 hover:bg-destructive/30"
                : "border-border bg-secondary/80 text-foreground hover:border-primary/50 hover:bg-secondary"
            } disabled:opacity-40`}
          >
            {isMuted ? (
              <>
                <MicOff className="h-4 w-4 text-red-400" />
                <span>Unmute</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4 text-emerald-400" />
                <span>Mute</span>
              </>
            )}
          </button>

          {/* Interrupt / Barge-In Button */}
          <button
            type="button"
            data-testid="interrupt-agent-button"
            onClick={onInterrupt}
            disabled={!canInterrupt}
            aria-label="Interrupt agent speech"
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-xs font-semibold transition-all active:scale-[0.98] ${
              canInterrupt
                ? "border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 animate-pulse"
                : "border-border/60 bg-secondary/40 text-muted-foreground/40 opacity-40 cursor-not-allowed"
            }`}
          >
            <Square className="h-4 w-4" />
            <span>Interrupt</span>
          </button>

          {/* End Call Button */}
          <button
            type="button"
            data-testid="end-call-button"
            onClick={onEndCall}
            disabled={isEnded}
            aria-label="End voice call"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-destructive/80 bg-destructive py-2.5 font-mono text-xs font-semibold text-destructive-foreground transition-all hover:bg-destructive/90 active:scale-[0.98] disabled:opacity-40 shadow-sm"
          >
            <PhoneOff className="h-4 w-4" />
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import { Activity, Loader2, Mic, MicOff, PhoneCall, PhoneOff, Volume2, X } from "lucide-react";
import type { VoiceCallStatus } from "@protocol/voice";

export interface VoiceCallHeaderProps {
  status: VoiceCallStatus;
  durationSeconds: number;
  agentName?: string;
  onClose: () => void;
  className?: string;
}

export function formatCallDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function VoiceCallHeader({
  status,
  durationSeconds,
  agentName = "NanoForge Agent",
  onClose,
  className = "",
}: VoiceCallHeaderProps) {
  const formattedDuration = formatCallDuration(durationSeconds);

  return (
    <div
      data-testid="voice-call-header"
      className={`flex items-center justify-between border-b border-border/80 bg-card px-4 py-3 ${className}`}
    >
      {/* Left: Branding & Agent Details */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary">
          <PhoneCall className="h-4 w-4" />
        </div>
        <div className="leading-none">
          <div className="flex items-center gap-2 font-mono text-[13px] font-bold text-foreground">
            <span>Voice Call</span>
            <span className="text-[11px] font-normal text-muted-foreground">· {agentName}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              data-testid="voice-call-timer"
              role="timer"
              aria-live="off"
              className="font-mono text-[11px] text-muted-foreground"
            >
              {formattedDuration}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Status Pill & Close Action */}
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />

        <button
          type="button"
          data-testid="voice-call-close-button"
          onClick={onClose}
          aria-label="Close voice call drawer"
          className="rounded-md border border-border bg-secondary/60 p-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: VoiceCallStatus }) {
  switch (status) {
    case "connecting":
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] text-amber-300 animate-pulse"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Connecting…
        </span>
      );
    case "listening":
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
          <Mic className="h-3 w-3" />
          Listening
        </span>
      );
    case "thinking":
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 px-2.5 py-0.5 font-mono text-[11px] text-blue-300"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Thinking…
        </span>
      );
    case "speaking":
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/15 px-2.5 py-0.5 font-mono text-[11px] text-primary"
        >
          <Volume2 className="h-3 w-3 animate-bounce" />
          Speaking
        </span>
      );
    case "muted":
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/15 px-2.5 py-0.5 font-mono text-[11px] text-red-300"
        >
          <MicOff className="h-3 w-3 text-red-400" />
          Mic Muted
        </span>
      );
    case "ended":
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
          <PhoneOff className="h-3 w-3" />
          Call Ended
        </span>
      );
    case "idle":
    default:
      return (
        <span
          data-testid="voice-status-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
          <Activity className="h-3 w-3" />
          Idle
        </span>
      );
  }
}

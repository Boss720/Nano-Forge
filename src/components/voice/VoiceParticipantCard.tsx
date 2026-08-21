import { Bot, User, Volume2, Mic } from "lucide-react";
import type { VoiceProfile, VoiceParticipant, VoiceCallStatus } from "@protocol/voice";

export interface VoiceParticipantCardProps {
  participant?: VoiceParticipant;
  voiceProfile?: VoiceProfile;
  status: VoiceCallStatus;
  isUserSpeaking?: boolean;
  className?: string;
}

export function VoiceParticipantCard({
  participant,
  voiceProfile,
  status,
  isUserSpeaking = false,
  className = "",
}: VoiceParticipantCardProps) {
  const isAgentSpeaking = status === "speaking";
  const isUserActive = isUserSpeaking && status !== "muted" && status !== "ended";

  const userName = participant?.userName || "User";
  const agentName = participant?.agentName || "NanoForge Agent";
  const timbre = voiceProfile?.timbre || "neutral";
  const rate = voiceProfile?.rate || 1.0;

  return (
    <div
      data-testid="voice-participant-card"
      className={`grid grid-cols-2 gap-3 p-3.5 rounded-lg border border-border bg-card/60 ${className}`}
    >
      {/* Agent Participant */}
      <div
        data-testid="voice-participant-agent"
        className="flex items-center gap-3 rounded-md border border-border/40 bg-secondary/30 p-2.5"
      >
        <div className="relative">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
              isAgentSpeaking
                ? "border-primary bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            <Bot className="h-5 w-5" />
          </div>
          {isAgentSpeaking && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] text-primary-foreground font-bold">
              <Volume2 className="h-2 w-2" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-mono text-[12px] font-semibold text-foreground truncate max-w-[130px]" title={agentName}>
            {agentName}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
              {timbre} · {rate}x
            </span>
          </div>
        </div>
      </div>

      {/* User Participant */}
      <div
        data-testid="voice-participant-user"
        className="flex items-center gap-3 rounded-md border border-border/40 bg-secondary/30 p-2.5"
      >
        <div className="relative">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
              isUserActive
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-400 ring-offset-2 ring-offset-background animate-pulse"
                : status === "muted"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            <User className="h-5 w-5" />
          </div>
          {isUserActive && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white font-bold">
              <Mic className="h-2 w-2" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-mono text-[12px] font-semibold text-foreground truncate max-w-[130px]" title={userName}>
            {userName}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <span
              className={`font-mono text-[9.5px] ${
                status === "muted"
                  ? "text-destructive font-medium"
                  : isUserActive
                  ? "text-emerald-400 font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {status === "muted" ? "Mic Muted" : isUserActive ? "Speaking" : "Ready"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

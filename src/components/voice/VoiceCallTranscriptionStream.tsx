import { useEffect, useRef } from "react";
import { Bot, Sparkles, User, Volume2, AlertCircle } from "lucide-react";
import type { VoiceTranscriptItem } from "@/hooks/useVoiceCall";

export interface VoiceCallTranscriptionStreamProps {
  /** Historical list of completed speech turns */
  turns: VoiceTranscriptItem[];
  /** Current in-flight interim transcript text (streaming from user microphone) */
  interimTranscript?: string;
  /** Whether agent is currently speaking / synthesizing */
  isAgentSpeaking?: boolean;
  /** Auto-scroll lock behavior (default: true) */
  autoScroll?: boolean;
  className?: string;
}

export function VoiceCallTranscriptionStream({
  turns,
  interimTranscript = "",
  isAgentSpeaking = false,
  autoScroll = true,
  className = "",
}: VoiceCallTranscriptionStreamProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current && typeof bottomRef.current.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns, interimTranscript, autoScroll]);

  const hasContent = turns.length > 0 || Boolean(interimTranscript.trim());

  return (
    <div
      data-testid="voice-transcription-stream"
      role="log"
      aria-live="polite"
      aria-label="Live Voice Call Transcript"
      className={`flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin ${className}`}
    >
      {!hasContent && (
        <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center text-muted-foreground/70">
          <Sparkles className="mb-2 h-6 w-6 text-muted-foreground/40" />
          <p className="font-mono text-xs">Ready for voice input</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">
            Speak into your mic or wait for agent response
          </p>
        </div>
      )}

      {turns.map((turn, index) => {
        const isUser = turn.speaker === "user";
        const isInterrupted = Boolean(turn.interrupted || turn.text.includes("[interrupted]"));

        return (
          <div
            key={turn.id || `turn-${index}`}
            className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
          >
            <div
              data-testid={isUser ? "transcript-bubble-user" : "transcript-bubble-agent"}
              role="article"
              aria-label={isUser ? "User speech turn" : "Agent speech turn"}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm transition-all ${
                isUser
                  ? "rounded-tr-sm bg-primary text-primary-foreground font-medium"
                  : "rounded-tl-sm border border-border/80 bg-secondary/80 text-foreground font-normal"
              }`}
            >
              <div className="flex items-center gap-1.5 pb-1 font-mono text-[10px] opacity-75">
                {isUser ? (
                  <>
                    <User className="h-3 w-3" />
                    <span>You</span>
                  </>
                ) : (
                  <>
                    <Bot className="h-3 w-3" />
                    <span>Agent</span>
                  </>
                )}
                {turn.timestamp && (
                  <span className="opacity-60">
                    · {new Date(turn.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </div>

              <div className="break-words whitespace-pre-wrap">
                {turn.text.replace(/\[interrupted\]/g, "").trim()}
              </div>

              {isInterrupted && (
                <div className="mt-1.5">
                  <span
                    data-testid="interrupted-badge"
                    className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9.5px] text-amber-300 font-semibold"
                  >
                    <AlertCircle className="h-2.5 w-2.5" />
                    [interrupted]
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Streaming Interim User Speech Bubble */}
      {Boolean(interimTranscript.trim()) && (
        <div className="flex flex-col items-end">
          <div
            data-testid="transcript-bubble-interim"
            role="status"
            aria-live="polite"
            aria-label="Interim transcription"
            className="max-w-[85%] rounded-2xl rounded-tr-sm border border-primary/50 bg-primary/20 px-3.5 py-2.5 text-xs italic text-primary shadow-sm animate-pulse"
          >
            <div className="flex items-center gap-1.5 pb-1 font-mono text-[10px] not-italic opacity-80">
              <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" />
              <span>Transcribing…</span>
            </div>
            <div className="break-words whitespace-pre-wrap">{interimTranscript.trim()}</div>
          </div>
        </div>
      )}

      {/* Agent Speaking Indicator */}
      {isAgentSpeaking && !interimTranscript && (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-primary">
          <Volume2 className="h-3.5 w-3.5 animate-bounce" />
          <span>Agent is speaking…</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

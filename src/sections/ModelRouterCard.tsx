import { useState } from "react";
import {
  GitBranch,
  Pin,
  PinOff,
  Sparkles,
  ShieldAlert,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface CandidateScoreEntry {
  modelId: string;
  provider: string;
  tier: number; // 0: Local, 1: Cheap Free, 2: Strong Free, 3: Scarce
  isFree: boolean;
  capabilityFloorMatch: boolean;
  qualityScore: number; // 0 - 1
  reliabilityScore: number; // 0 - 1
  speedScore: number; // 0 - 1
  scarcityPenalty: number; // 0 - 1
  totalScore: number; // 0 - 100
  health: "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "OFFLINE";
  cooldownRemainingSeconds?: number;
  quota?: {
    remainingRequests?: number;
    remainingTokens?: number;
  };
}

export interface CompactHandoffSummary {
  targetModel: string;
  tokenCount: number;
  wordCount: number;
  activeStep?: string;
  decisions: string[];
  modifiedFiles: string[];
}

export interface ModelRouterCardProps {
  primaryModel: string;
  tierName?: string;
  estimatedCostUsd: number;
  reason: string;
  pinnedModel?: string | null;
  freeFirstEnabled: boolean;
  candidates?: CandidateScoreEntry[];
  handoff?: CompactHandoffSummary;
  onToggleFreeFirst?: (enabled: boolean) => void;
  onSelectPinModel?: (modelId: string | null) => void;
  className?: string;
}

export function ModelRouterCard({
  primaryModel,
  tierName = "Tier 0 (Local)",
  estimatedCostUsd,
  reason,
  pinnedModel = null,
  freeFirstEnabled,
  candidates = [],
  handoff,
  onToggleFreeFirst,
  onSelectPinModel,
  className,
}: ModelRouterCardProps) {
  const [showCandidates, setShowCandidates] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);

  const isPinned = Boolean(pinnedModel);

  return (
    <section
      aria-label="Model router telemetry"
      className={cn("rounded-lg border border-border bg-card p-3 shadow-sm", className)}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs font-semibold text-foreground">
            capability-floor router
          </span>
          <Badge
            variant={tierName.includes("Local") || tierName.includes("Free") ? "secondary" : "outline"}
            className="text-[10px]"
          >
            {tierName}
          </Badge>
        </div>

        {/* Free-First Mode Switch */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={freeFirstEnabled}
            aria-label="Toggle Free-First mode"
            onClick={() => onToggleFreeFirst?.(!freeFirstEnabled)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono transition-colors",
              freeFirstEnabled
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium"
                : "bg-secondary text-muted-foreground border border-border"
            )}
          >
            <Sparkles className="h-2.5 w-2.5" />
            <span>Free-First: {freeFirstEnabled ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* Selected Model Details */}
      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2 truncate">
            <span
              className="truncate font-mono text-[13px] font-semibold text-foreground"
              title={primaryModel}
            >
              {primaryModel}
            </span>
            {isPinned ? (
              <button
                type="button"
                onClick={() => onSelectPinModel?.(null)}
                title="Unpin model (switch to AUTO)"
                className="flex items-center gap-0.5 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] text-primary hover:bg-primary/25"
              >
                <Pin className="h-2.5 w-2.5" /> pinned
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectPinModel?.(primaryModel)}
                title="Pin this model"
                className="flex items-center gap-0.5 rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground hover:text-foreground"
              >
                <PinOff className="h-2.5 w-2.5" /> auto
              </button>
            )}
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {estimatedCostUsd === 0 ? "free ($0.00)" : `est. $${estimatedCostUsd.toFixed(4)}`}
          </span>
        </div>

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">{reason}</p>
      </div>

      {/* Candidate Score Matrix Toggle */}
      {candidates.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => setShowCandidates(!showCandidates)}
            className="flex w-full items-center justify-between font-mono text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-primary" />
              <span>Candidate Evaluations ({candidates.length})</span>
            </span>
            {showCandidates ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showCandidates && (
            <div className="mt-2 space-y-1 overflow-x-auto rounded border border-border bg-secondary/30 p-2 font-mono text-[10px]">
              <div className="grid grid-cols-12 gap-1 font-semibold text-muted-foreground border-b border-border/50 pb-1">
                <span className="col-span-5">Model</span>
                <span className="col-span-2 text-center">Tier</span>
                <span className="col-span-2 text-center">Score</span>
                <span className="col-span-3 text-right">Status</span>
              </div>
              {candidates.map((c) => {
                const isSelected = c.modelId === primaryModel;
                return (
                  <div
                    key={c.modelId}
                    className={cn(
                      "grid grid-cols-12 gap-1 items-center py-1 transition-colors",
                      isSelected && "text-primary font-medium"
                    )}
                  >
                    <span className="col-span-5 truncate" title={c.modelId}>
                      {c.modelId}
                    </span>
                    <span className="col-span-2 text-center">
                      T{c.tier} {c.isFree ? "Free" : "Paid"}
                    </span>
                    <span className="col-span-2 text-center font-bold">
                      {Math.round(c.totalScore)}
                    </span>
                    <div className="col-span-3 flex items-center justify-end gap-1">
                      {c.cooldownRemainingSeconds ? (
                        <span className="flex items-center gap-0.5 text-amber-400">
                          <Clock className="h-2.5 w-2.5" /> {c.cooldownRemainingSeconds}s
                        </span>
                      ) : c.health === "HEALTHY" ? (
                        <span className="text-emerald-400">● ok</span>
                      ) : (
                        <span className="text-destructive flex items-center gap-0.5">
                          <ShieldAlert className="h-2.5 w-2.5" /> {c.health.toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Compact Handoff Inspector */}
      {handoff && (
        <div className="mt-2 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => setShowHandoff(!showHandoff)}
            className="flex w-full items-center justify-between font-mono text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <FileText className="h-3 w-3 text-primary" />
              <span>Compact Handoff ({handoff.tokenCount} tokens / {handoff.wordCount} words)</span>
            </span>
            {showHandoff ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showHandoff && (
            <div className="mt-2 space-y-1.5 rounded border border-border bg-secondary/30 p-2.5 text-[11px] font-mono">
              <div className="flex justify-between text-muted-foreground">
                <span>Target: {handoff.targetModel}</span>
                <span>Active Step: {handoff.activeStep || "none"}</span>
              </div>
              {handoff.decisions.length > 0 && (
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Decisions:</span>
                  <ul className="list-disc pl-4 text-foreground/90">
                    {handoff.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {handoff.modifiedFiles.length > 0 && (
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Modified Files:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {handoff.modifiedFiles.map((f, i) => (
                      <span key={i} className="rounded bg-secondary px-1.5 py-0.5 text-[9.5px]">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import {
  Activity,
  CheckCircle2,
  Cpu,
  Layers,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export interface ProviderHealthInfo {
  provider: string;
  displayName: string;
  status: "healthy" | "degraded" | "unavailable";
  modelsCount: number;
  activeCooldowns?: number;
  isLocal?: boolean;
}

export interface RouterTelemetryStats {
  totalRouted: number;
  freeTierPercentage: number;
  avgLatencyMs: number;
  failoverCount: number;
  activeCooldowns: number;
  providers: ProviderHealthInfo[];
}

export interface RouterTelemetryDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: RouterTelemetryStats;
}

export function RouterTelemetryDashboard({
  open,
  onOpenChange,
  stats,
}: RouterTelemetryDashboardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <DialogTitle className="font-mono text-base font-bold">
              Model Router Telemetry & Fleet Overview
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Real-time capability-floor routing metrics, zero-cost savings, and provider availability.
          </DialogDescription>
        </DialogHeader>

        {/* 4 Summary Stat Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mt-2">
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-mono">Free Priority</span>
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-foreground">
              {stats.freeTierPercentage}%
            </div>
            <span className="text-[10px] text-muted-foreground">zero-cost routed</span>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-mono">Total Routed</span>
              <Layers className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-foreground">
              {stats.totalRouted}
            </div>
            <span className="text-[10px] text-muted-foreground">decisions logged</span>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-mono">Avg Latency</span>
              <Zap className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-foreground">
              {stats.avgLatencyMs}ms
            </div>
            <span className="text-[10px] text-muted-foreground">decision time</span>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-mono">429 Failovers</span>
              <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-foreground">
              {stats.failoverCount}
            </div>
            <span className="text-[10px] text-muted-foreground">0 data loss</span>
          </div>
        </div>

        {/* Provider Fleet Status Matrix */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-foreground">
              Provider Fleet Health
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {stats.activeCooldowns === 0
                ? "No active rate-limit cooldowns"
                : `${stats.activeCooldowns} active cooldown(s)`}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {stats.providers.map((p) => {
              const isHealthy = p.status === "healthy";
              const isDegraded = p.status === "degraded";

              return (
                <div
                  key={p.provider}
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/20 p-2.5 font-mono text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <span>{p.displayName}</span>
                      {p.isLocal && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1">
                          local
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10.5px] text-muted-foreground">
                      {p.modelsCount} model(s) available
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {isHealthy ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> online
                      </span>
                    ) : isDegraded ? (
                      <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                        <Activity className="h-3.5 w-3.5" /> cooldown
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        offline
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

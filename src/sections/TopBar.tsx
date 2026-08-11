import { KeyRound, Settings, Zap } from "lucide-react";
import type { ConnectionState, UsageTotals } from "@/types";

interface Props {
  connection: ConnectionState;
  usage: UsageTotals;
  onOpenSettings: () => void;
}

export function TopBar({ connection, usage, onOpenSettings }: Props) {
  const connected = connection.status === "connected";
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      {/* mark */}
      <div className="flex items-center gap-2.5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" fill="hsl(32 100% 55%)" stroke="hsl(22 100% 50%)" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        <div className="leading-none">
          <div className="font-mono text-[13px] font-bold tracking-[0.18em] text-foreground">NANOFORGE</div>
          <div className="micro-label mt-0.5">agent console · nano-gpt.com</div>
        </div>
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* plan chip */}
      <a
        href="https://nano-gpt.com/subscription"
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-2.5 py-1.5 transition-colors hover:border-primary/50"
      >
        <Zap className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] text-foreground/90">Nano-GPT Subscription</span>
        <span className="micro-label normal-case tracking-normal group-hover:text-primary">1 key → 1,104 models</span>
      </a>

      <div className="flex-1" />

      {/* usage */}
      <div className="hidden items-center gap-4 font-mono text-[11px] text-muted-foreground md:flex">
        <span>
          <span className="text-foreground">{usage.requests}</span> runs
        </span>
        <span>
          <span className="text-foreground">{fmt(usage.input + usage.output)}</span> tok
        </span>
        <span>
          ≈ <span className="text-primary">${usage.costUsd.toFixed(4)}</span>
        </span>
      </div>

      {/* connection */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-2.5 py-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            connected ? "bg-emerald-400" : connection.status === "checking" ? "pulse-dot bg-primary" : "bg-muted-foreground/50"
          }`}
        />
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-[11px] text-foreground/80">
          {connected ? "key active" : connection.status === "checking" ? "checking…" : "demo mode"}
        </span>
      </div>

      <button
        onClick={onOpenSettings}
        className="rounded-md border border-border bg-secondary/60 p-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        aria-label="Settings"
      >
        <Settings className="h-4 w-4" />
      </button>
    </header>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

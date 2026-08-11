import { useEffect, useRef, useState } from "react";
import {
  Ban, Bot, Brain, Check, ChevronDown, ChevronRight, CircleDollarSign, Clock, FileEdit, FileSearch,
  Play, SendHorizonal, Settings2, ShieldAlert, Square, TerminalSquare, X,
} from "lucide-react";
import type { GenerationPrefs, Message, NanoModel, Patch, ToolCall, ToolRun, ToolRunState } from "@/types";
import { AGENT_SYSTEM_PROMPT } from "@/lib/catalog";
import { estimateTokens } from "@/lib/context";
import { RichText } from "@/components/RichText";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

interface Props {
  messages: Message[];
  running: boolean;
  model: NanoModel | undefined;
  connected: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onPatchDecision: (messageId: string, decision: "applied" | "rejected") => void;
  genPrefs: GenerationPrefs;
  onGenPrefsChange: (prefs: GenerationPrefs) => void;
  /**
   * Module 2 Task 7 (optional): supervised terminal jobs reported by the
   * local agent host. Absent/empty when no host session exists — the panel
   * then renders exactly as before.
   */
  toolRuns?: ToolRun[];
  /** Stop (cancel) one terminal job; typically wired to HostClient.cancelRun. */
  onToolStop?: (toolRunId: string) => void;
}

const TOOL_ICON: Record<ToolCall["kind"], typeof Brain> = {
  think: Brain,
  read_file: FileSearch,
  edit_file: FileEdit,
  run_command: TerminalSquare,
  search: FileSearch,
};

/** Compact "3.2k" / "256k" formatting for the context meter. */
function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function ChatPanel({ messages, running, model, connected, onSend, onStop, onPatchDecision, genPrefs, onGenPrefsChange, toolRuns, onToolStop }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    onSend(text);
  };

  // Task 1.2: live context meter — estimate over the same system+history the
  // send path packs (via buildContext), plus the current draft since it
  // becomes the next user message on send.
  const budgetTokens = model ? model.contextK * 1000 : 0;
  const usedTokens =
    estimateTokens(AGENT_SYSTEM_PROMPT) +
    messages.reduce((sum, m) => (m.role === "system" || !m.content ? sum : sum + estimateTokens(m.content)), 0) +
    estimateTokens(draft);
  const usedPct = budgetTokens > 0 ? (usedTokens / budgetTokens) * 100 : 0;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      {/* transcript */}
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {messages.length === 0 && <EmptyState onPick={onSend} connected={connected} />}
        {messages.map((m) => (
          <MessageView key={m.id} m={m} onPatchDecision={onPatchDecision} />
        ))}
        {toolRuns && toolRuns.length > 0 && (
          <div className="max-w-[85%] space-y-2">
            {toolRuns.map((t) => (
              <ToolRunCard key={t.id} t={t} onStop={onToolStop} />
            ))}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border bg-card/60 px-5 py-3">
        <div className="rounded-lg border border-input bg-secondary/40 transition-colors focus-within:border-primary/60">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder={
              connected
                ? "Describe the change — the agent plans, edits, and verifies…"
                : "Demo mode — try: “add rate limiting to the server”"
            }
            className="w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-primary">
              {model?.name ?? "no model"}
            </span>
            <span className="micro-label normal-case tracking-normal">
              {connected ? "live · nano-gpt.com/api/v1" : "demo script · no tokens burned"}
            </span>
            {budgetTokens > 0 && (
              <span className="flex items-center gap-1.5" title="estimated context usage vs model window">
                <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary sm:w-24">
                  <span
                    className={`block h-full transition-all ${usedPct > 85 ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, usedPct)}%` }}
                  />
                </span>
                <span className="hidden font-mono text-[10px] text-muted-foreground md:block">
                  {fmtK(usedTokens)} / {fmtK(budgetTokens)}
                </span>
              </span>
            )}
            <div className="flex-1" />
            <GenSettings genPrefs={genPrefs} onChange={onGenPrefsChange} />
            <span className="micro-label hidden sm:block">⏎ send · ⇧⏎ newline</span>
            {running ? (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-1.5 font-mono text-[11.5px] text-red-300 transition-colors hover:bg-destructive/25"
              >
                <Square className="h-3 w-3" /> stop
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                <Play className="h-3 w-3" /> run agent
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ onPick, connected }: { onPick: (t: string) => void; connected: boolean }) {
  const starters = [
    { title: "Add rate limiting to the server", desc: "Watch the full plan → read → edit → verify loop with a reviewable diff." },
    { title: "Document the API in README.md", desc: "Smaller change — the agent scopes it to one file." },
    { title: "Refactor server.ts to use routes", desc: "Live mode: streamed from your nano-gpt key." },
  ];
  return (
    <div className="mx-auto max-w-lg pt-14 text-center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="mx-auto ember-glow rounded-lg" aria-hidden>
        <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" fill="hsl(32 100% 55%)" stroke="hsl(22 100% 50%)" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <h1 className="mt-4 font-mono text-[15px] font-bold tracking-[0.2em] text-foreground">FORGE A CHANGE</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        An agent console wired to <span className="text-foreground">nano-gpt.com</span> — one subscription key,
        1,104 models, OpenAI-compatible streaming. {connected ? "Your key is live." : "No key yet — the demo script runs the loop for free."}
      </p>
      <div className="mt-6 space-y-2 text-left">
        {starters.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.title)}
            className="group w-full rounded-lg border border-border bg-card px-3.5 py-3 transition-colors hover:border-primary/50"
          >
            <div className="flex items-center gap-2 font-mono text-[12px] text-foreground">
              <SendHorizonal className="h-3 w-3 text-primary" />
              {s.title}
            </div>
            <div className="mt-1 pl-5 text-[11.5px] text-muted-foreground">{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ m, onPatchDecision }: { m: Message; onPatchDecision: Props["onPatchDecision"] }) {
  // Task 2.2: edit-verify auto-turns render collapsed; a pending patch (if the
  // verification reply emitted a follow-up diff) stays fully visible with
  // working Apply/Reject.
  if (m.auto) return <AutoTurnView m={m} onPatchDecision={onPatchDecision} />;
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-lg border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[85%] space-y-2">
      {m.toolCalls?.map((t) => <ToolCard key={t.id} t={t} />)}
      {m.patch && <PatchCard p={m.patch} onDecision={(d) => onPatchDecision(m.id, d)} />}
      {m.content && (
        <div className="text-foreground/85">
          <RichText text={m.content} />
          {m.streaming && <span className="caret-blink ml-0.5 inline-block h-3.5 w-[7px] bg-primary align-middle" />}
        </div>
      )}
      {m.usage && (
        <div className="flex items-center gap-1.5 pt-0.5 font-mono text-[10.5px] text-muted-foreground">
          <CircleDollarSign className="h-3 w-3" />
          {m.model} · {m.usage.input.toLocaleString()} in / {m.usage.output.toLocaleString()} out · ≈ ${m.usage.costUsd.toFixed(5)}
        </div>
      )}
    </div>
  );
}

/** Task 2.3: generation-settings popover (temperature + max-tokens cap). */
function GenSettings({ genPrefs, onChange }: { genPrefs: GenerationPrefs; onChange: (p: GenerationPrefs) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Generation settings"
          title={`temperature ${genPrefs.temperature.toFixed(2)} · max ${genPrefs.maxTokens} tokens`}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 border-border bg-card p-3.5">
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="micro-label">temperature</span>
              <span className="font-mono text-[11px] text-foreground">{genPrefs.temperature.toFixed(2)}</span>
            </div>
            <Slider
              value={[genPrefs.temperature]}
              min={0}
              max={1.5}
              step={0.05}
              onValueChange={([v]) => onChange({ ...genPrefs, temperature: v })}
              aria-label="Temperature"
            />
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground">
              <span>precise</span>
              <span>creative</span>
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="micro-label">max tokens</span>
              <span className="font-mono text-[11px] text-foreground">{genPrefs.maxTokens.toLocaleString()}</span>
            </div>
            <Slider
              value={[genPrefs.maxTokens]}
              min={256}
              max={8192}
              step={256}
              onValueChange={([v]) => onChange({ ...genPrefs, maxTokens: v })}
              aria-label="Max tokens"
            />
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground">
              <span>256</span>
              <span>8,192</span>
            </div>
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Saved per model · applied to the next live request.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Task 2.2: a collapsed, system-style transcript row for an edit-verify
 * auto-turn. The prompt/reply text hides behind an expander; a pending
 * follow-up patch is always rendered in full so the user can Apply/Reject.
 */
function AutoTurnView({ m, onPatchDecision }: { m: Message; onPatchDecision: Props["onPatchDecision"] }) {
  const [open, setOpen] = useState(false);
  const snippet = m.content.replace(/\s+/g, " ").trim().slice(0, 72);
  return (
    <div className="max-w-[85%] space-y-2">
      <div className="rounded-md border border-border/60 bg-card/40">
        <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
          <Bot className={`h-3.5 w-3.5 ${m.streaming ? "pulse-dot text-primary" : "text-muted-foreground"}`} />
          <span className="micro-label">auto-verify · {m.role === "user" ? "prompt" : "reply"}</span>
          {snippet && (
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground/70">{snippet}</span>
          )}
          {!snippet && <div className="flex-1" />}
          {m.streaming && <span className="h-2 w-2 rounded-full bg-primary pulse-dot" />}
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        {open && m.content && (
          <div className="border-t border-border/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            {m.role === "user" ? <pre className="whitespace-pre-wrap font-mono">{m.content}</pre> : <RichText text={m.content} />}
          </div>
        )}
      </div>
      {m.patch && <PatchCard p={m.patch} onDecision={(d) => onPatchDecision(m.id, d)} />}
      {m.usage && (
        <div className="flex items-center gap-1.5 pt-0.5 font-mono text-[10.5px] text-muted-foreground">
          <CircleDollarSign className="h-3 w-3" />
          {m.model} · {m.usage.input.toLocaleString()} in / {m.usage.output.toLocaleString()} out · ≈ ${m.usage.costUsd.toFixed(5)}
        </div>
      )}
    </div>
  );
}

function ToolCard({ t }: { t: ToolCall }) {  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[t.kind];
  return (
    <div className="rounded-md border border-border bg-card/70">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <Icon className={`h-3.5 w-3.5 ${t.status === "running" ? "pulse-dot text-primary" : "text-muted-foreground"}`} />
        <span className="font-mono text-[11.5px] text-foreground/90">{t.title}</span>
        <span className="micro-label">{t.kind}</span>
        <div className="flex-1" />
        {t.durationMs != null && <span className="font-mono text-[10px] text-muted-foreground">{t.durationMs}ms</span>}
        {t.status === "done" ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : t.status === "error" ? (
          <X className="h-3 w-3 text-red-400" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-primary pulse-dot" />
        )}
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{t.detail}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Module 2 Task 7: supervised terminal tool cards (host-driven)      */
/* ------------------------------------------------------------------ */

const TOOL_RUN_LABEL: Record<ToolRunState, string> = {
  queued: "queued",
  approval_required: "approval required",
  running: "running",
  done: "done",
  error: "error",
  cancelled: "cancelled",
};

function ToolRunStatusIcon({ state }: { state: ToolRunState }) {
  switch (state) {
    case "queued":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "approval_required":
      return <ShieldAlert className="h-3 w-3 text-amber-400" />;
    case "running":
      return <span className="h-2 w-2 rounded-full bg-primary pulse-dot" />;
    case "done":
      return <Check className="h-3 w-3 text-emerald-400" />;
    case "error":
      return <X className="h-3 w-3 text-red-400" />;
    case "cancelled":
      return <Ban className="h-3 w-3 text-muted-foreground" />;
  }
}

/**
 * One host-supervised terminal job. Structured `executable + args[]` only
 * (never a shell string); Stop is offered while the job can still be halted
 * and is wired to the host cancel callback.
 */
function ToolRunCard({ t, onStop }: { t: ToolRun; onStop?: (toolRunId: string) => void }) {
  const [open, setOpen] = useState(t.state === "running" || t.state === "error");
  const stoppable = t.state === "queued" || t.state === "running" || t.state === "approval_required";
  return (
    <div className="rounded-md border border-border bg-card/70" data-testid={`tool-run-${t.id}`} data-state={t.state}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <TerminalSquare className={`h-3.5 w-3.5 shrink-0 ${t.state === "running" ? "pulse-dot text-primary" : "text-muted-foreground"}`} />
          <span className="shrink-0 font-mono text-[11.5px] text-foreground/90">{t.executable}</span>
          <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
            {t.args.join(" ")}
          </span>
          <span className={`micro-label shrink-0 ${t.state === "approval_required" ? "text-amber-400" : ""}`}>
            {TOOL_RUN_LABEL[t.state]}
          </span>
        </button>
        {stoppable && onStop && (
          <button
            aria-label={`Stop ${t.executable}`}
            onClick={() => onStop(t.id)}
            className="flex shrink-0 items-center gap-1 rounded border border-destructive/50 bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-red-300 transition-colors hover:bg-destructive/25"
          >
            <Square className="h-2.5 w-2.5" /> stop
          </button>
        )}
        {t.exitCode != null && (
          <span className={`shrink-0 font-mono text-[10px] ${t.exitCode === 0 ? "text-muted-foreground" : "text-red-400"}`}>
            exit {t.exitCode}
          </span>
        )}
        <ToolRunStatusIcon state={t.state} />
        <button onClick={() => setOpen(!open)} aria-label="Toggle details" className="shrink-0">
          {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div>
            <span className="micro-label normal-case tracking-normal">cwd </span>
            {t.cwd}
          </div>
          {t.policyReason && (
            <div className="flex items-center gap-1 text-amber-400/90">
              <ShieldAlert className="h-3 w-3" /> policy: {t.policyReason}
            </div>
          )}
          {t.output && (
            <pre className="scrollbar-thin max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px]">
              {t.output}
            </pre>
          )}
          {t.truncated && (
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80">
              … output truncated by host cap
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatchCard({ p, onDecision }: { p: Patch; onDecision: (d: "applied" | "rejected") => void }) {
  const adds = p.lines.filter((l) => l.type === "add").length;
  const dels = p.lines.filter((l) => l.type === "del").length;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-card px-2.5 py-1.5">
        <FileEdit className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11.5px] text-foreground">{p.file}</span>
        <span className="font-mono text-[10.5px] text-emerald-400">+{adds}</span>
        <span className="font-mono text-[10.5px] text-red-400">−{dels}</span>
        <div className="flex-1" />
        {p.status === "pending" ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => onDecision("applied")}
              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10.5px] text-emerald-300 hover:bg-emerald-500/20"
            >
              <Check className="h-3 w-3" /> apply
            </button>
            <button
              onClick={() => onDecision("rejected")}
              className="flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[10.5px] text-red-300 hover:bg-red-500/20"
            >
              <X className="h-3 w-3" /> reject
            </button>
          </div>
        ) : (
          <span className={`font-mono text-[10.5px] uppercase tracking-wider ${p.status === "applied" ? "text-emerald-400" : "text-red-400"}`}>
            {p.status}
          </span>
        )}
      </div>
      <pre className="scrollbar-thin max-h-64 overflow-auto bg-black/40 p-2.5 font-mono text-[11.5px] leading-[1.55]">
        {p.lines.map((l, i) => (
          <div
            key={i}
            className={
              l.type === "add"
                ? "bg-emerald-500/10 text-emerald-300"
                : l.type === "del"
                  ? "bg-red-500/10 text-red-300/90 line-through decoration-red-400/40"
                  : "text-muted-foreground"
            }
          >
            <span className="mr-2 inline-block w-3 select-none text-right opacity-60">
              {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
            </span>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

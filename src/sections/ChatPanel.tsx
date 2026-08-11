import { useEffect, useRef, useState } from "react";
import {
  Brain, Check, ChevronDown, ChevronRight, CircleDollarSign, FileEdit, FileSearch,
  Play, SendHorizonal, Square, TerminalSquare, X,
} from "lucide-react";
import type { Message, NanoModel, Patch, ToolCall } from "@/types";
import { AGENT_SYSTEM_PROMPT } from "@/lib/catalog";
import { estimateTokens } from "@/lib/context";
import { RichText } from "@/components/RichText";

interface Props {
  messages: Message[];
  running: boolean;
  model: NanoModel | undefined;
  connected: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onPatchDecision: (messageId: string, decision: "applied" | "rejected") => void;
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

export function ChatPanel({ messages, running, model, connected, onSend, onStop, onPatchDecision }: Props) {
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

function ToolCard({ t }: { t: ToolCall }) {
  const [open, setOpen] = useState(false);
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

import { useEffect, useState } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, Palette, PlugZap, Puzzle, Trash2, Unplug, X, Zap } from "lucide-react";
import type { ConnectionState } from "@/types";
import { formatQuote } from "@/lib/x402";
import { ThemeCustomizer } from "@/sections/settings/ThemeCustomizer";

/** Final roadmap phase (Task C): dismissible MCP interop note. Dismissal persists. */
const LS_MCP_NOTE_KEY = "nanoforge.mcp-note-dismissed";

interface Props {
  open: boolean;
  onClose: () => void;
  connection: ConnectionState;
  onConnect: (apiKey: string, baseUrl: string) => void;
  onDisconnect: () => void;
  /** Task 3.1: wipe `nanoforge.v1` and reset sessions/usage/files to fresh defaults. */
  onClearHistory: () => void;
  /**
   * Agent platform (Task 14): opens the IntegrationsPanel (rules / skills /
   * MCP servers). Optional — when omitted (no local host), no entry point is
   * rendered and the connect flow is unchanged.
   */
  onOpenIntegrations?: () => void;
  /** Milestone 4: Open Theme Customizer callback */
  onOpenTheme?: () => void;
  initialTab?: "connection" | "theme";
}

export function ConnectDialog({
  open,
  onClose,
  connection,
  onConnect,
  onDisconnect,
  onClearHistory,
  onOpenIntegrations,
  onOpenTheme,
  initialTab = "connection",
}: Props) {
  const [tab, setTab] = useState<"connection" | "theme">(initialTab);
  const [key, setKey] = useState(connection.apiKey);
  const [base, setBase] = useState(connection.baseUrl);
  const [show, setShow] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mcpNoteDismissed, setMcpNoteDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS_MCP_NOTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const checking = connection.status === "checking";

  const dismissMcpNote = () => {
    setMcpNoteDismissed(true);
    try {
      localStorage.setItem(LS_MCP_NOTE_KEY, "1");
    } catch {
      /* blocked storage — note just reappears next session */
    }
  };

  // Task 0.3 (defect #3): re-sync local fields from the live connection every
  // time the dialog opens, so a disconnected/stale key never reappears.
  useEffect(() => {
    if (open) {
      setKey(connection.apiKey);
      setBase(connection.baseUrl);
      setConfirmClear(false);
      setTab(initialTab);
    }
  }, [open, connection.apiKey, connection.baseUrl, initialTab]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className={`w-full ${tab === "theme" ? "max-w-2xl max-h-[90vh] flex flex-col" : "max-w-md"} rounded-lg border border-border bg-card shadow-2xl transition-all`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-1.5 font-mono text-[13px] font-semibold tracking-wide text-foreground">
            {tab === "connection" ? (
              <>
                <KeyRound className="h-4 w-4 text-primary" />
                <span>Connect nano-gpt.com</span>
              </>
            ) : (
              <>
                <Palette className="h-4 w-4 text-primary" />
                <span>Theme &amp; Appearance</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 p-0.5 ml-2 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => setTab("connection")}
              className={`rounded px-2 py-0.5 transition-colors ${
                tab === "connection" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Connection
            </button>
            <button
              type="button"
              onClick={() => setTab("theme")}
              className={`rounded px-2 py-0.5 transition-colors ${
                tab === "theme" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Theme
            </button>
          </div>

          <div className="flex-1" />
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {tab === "theme" ? (
          <div className="scrollbar-thin overflow-y-auto p-4 flex-1">
            <ThemeCustomizer onClose={onClose} />
          </div>
        ) : (
          <>
            <div className="space-y-4 px-4 py-4">
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Connect a <span className="text-foreground">Nano-GPT API key</span> to use its OpenAI-compatible
                endpoint. The key is held in memory for this browser session; requests go directly from your machine
                to the configured base URL.
              </p>

              <div className="space-y-1.5">
                <label className="micro-label block">API key</label>
                <div className="flex items-center gap-1 rounded-md border border-input bg-secondary/40 px-2.5">
                  <input
                    type={show ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="paste key from nano-gpt.com → API Keys"
                    className="w-full bg-transparent py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                  <button onClick={() => setShow(!show)} className="text-muted-foreground hover:text-foreground" aria-label="Toggle key visibility">
                    {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="micro-label block">Base URL</label>
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/40 px-2.5 py-2 font-mono text-[12px] text-foreground outline-none"
                />
              </div>

              {connection.error && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
                  {connection.error}
                </div>
              )}

              {/* Final phase (Task B): the key was rejected with HTTP 402 — the
                  endpoint offers x402 accountless pay-per-request. `x402 === null`
                  means 402 with no parseable quote → generic copy. */}
              {connection.status === "error" && connection.x402 !== undefined && (
                <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="flex-1">
                    <span className="text-foreground">Accountless mode available.</span> This key wasn't accepted, but the
                    endpoint answered with an x402 payment quote
                    {connection.x402 ? (
                      <>
                        {" "}— <span className="font-mono text-primary">{formatQuote(connection.x402)}</span>
                      </>
                    ) : (
                      " (no price details returned)"
                    )}
                    . You can pay per request without an account — no key needed — or fix the key above for
                    subscription access. Details at{" "}
                    <a href="https://nano-gpt.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      nano-gpt.com <ExternalLink className="inline h-3 w-3 align-[-1px]" />
                    </a>
                    .
                  </p>
                </div>
              )}

              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">No subscription?</span> Pay-as-you-go works too — same endpoint, same
                key flow, per-model pricing from a pre-funded wallet.
              </div>

              {/* Final phase (Task C): dismissible MCP interop note. */}
              {!mcpNoteDismissed && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  <p className="flex-1">
                    <span className="text-foreground">Using Claude Code or Cursor?</span> The same nano-gpt key works
                    over MCP — setup in the{" "}
                    <a href="https://nano-gpt.com/mcp" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      MCP docs <ExternalLink className="inline h-3 w-3 align-[-1px]" />
                    </a>
                    .
                  </p>
                  <button
                    onClick={dismissMcpNote}
                    className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss MCP note"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <a
                href="https://nano-gpt.com/api"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-3 w-3" /> get a key
              </a>
              {/* Agent platform (Task 14): entry point to the integrations panel.
                  Rendered only when the wiring layer provides the handler. */}
              {onOpenIntegrations && (
                <button
                  type="button"
                  onClick={onOpenIntegrations}
                  title="Rules packs, skills, and MCP servers"
                  className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
                >
                  <Puzzle className="h-3 w-3" /> integrations
                </button>
              )}
              {/* Theme customizer switch */}
              <button
                type="button"
                onClick={() => {
                  if (onOpenTheme) {
                    onOpenTheme();
                  } else {
                    setTab("theme");
                  }
                }}
                title="Customize UI theme and colors"
                className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
              >
                <Palette className="h-3 w-3" /> theme
              </button>
              {/* Task 3.1: wipe persisted sessions/usage/files — two-step confirm. */}
              <button
                type="button"
                onClick={() => {
                  if (confirmClear) {
                    onClearHistory();
                    setConfirmClear(false);
                  } else {
                    setConfirmClear(true);
                  }
                }}
                onBlur={() => setConfirmClear(false)}
                title="Delete all saved sessions, usage, and workspace state"
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                  confirmClear
                    ? "border-destructive/60 bg-destructive/15 text-red-300"
                    : "border-transparent text-muted-foreground hover:border-destructive/40 hover:text-red-300"
                }`}
              >
                <Trash2 className="h-3 w-3" />
                {confirmClear ? "confirm clear?" : "clear history"}
              </button>
              <div className="flex-1" />
              {connection.status === "connected" && (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 font-mono text-[11.5px] text-red-300 hover:bg-destructive/10"
                >
                  <Unplug className="h-3.5 w-3.5" /> disconnect
                </button>
              )}
              <button
                type="button"
                onClick={() => onConnect(key.trim(), base.trim().replace(/\/$/, ""))}
                disabled={!key.trim() || checking}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                {checking ? "testing…" : "test & connect"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

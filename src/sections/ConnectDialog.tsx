import { useEffect, useState } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, PlugZap, Trash2, Unplug, X } from "lucide-react";
import type { ConnectionState } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  connection: ConnectionState;
  onConnect: (apiKey: string, baseUrl: string) => void;
  onDisconnect: () => void;
  /** Task 3.1: wipe `nanoforge.v1` and reset sessions/usage/files to fresh defaults. */
  onClearHistory: () => void;
}

export function ConnectDialog({ open, onClose, connection, onConnect, onDisconnect, onClearHistory }: Props) {
  const [key, setKey] = useState(connection.apiKey);
  const [base, setBase] = useState(connection.baseUrl);
  const [show, setShow] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const checking = connection.status === "checking";

  // Task 0.3 (defect #3): re-sync local fields from the live connection every
  // time the dialog opens, so a disconnected/stale key never reappears.
  useEffect(() => {
    if (open) {
      setKey(connection.apiKey);
      setBase(connection.baseUrl);
      setConfirmClear(false);
    }
  }, [open, connection.apiKey, connection.baseUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <KeyRound className="h-4 w-4 text-primary" />
          <span className="font-mono text-[13px] font-semibold tracking-wide text-foreground">Connect nano-gpt.com</span>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Your <span className="text-foreground">Nano-GPT subscription</span> key unlocks the full catalog —
            656 text, 198 image, 143 video models — through one OpenAI-compatible endpoint. The key stays in this
            browser's local storage; requests go straight from your machine to nano-gpt.com.
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

          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="text-foreground">No subscription?</span> Pay-as-you-go works too — same endpoint, same
            key flow, per-model pricing from a pre-funded wallet.
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <a
            href="https://nano-gpt.com/api"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" /> get a key
          </a>
          {/* Task 3.1: wipe persisted sessions/usage/files — two-step confirm. */}
          <button
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
              onClick={onDisconnect}
              className="flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 font-mono text-[11.5px] text-red-300 hover:bg-destructive/10"
            >
              <Unplug className="h-3.5 w-3.5" /> disconnect
            </button>
          )}
          <button
            onClick={() => onConnect(key.trim(), base.trim().replace(/\/$/, ""))}
            disabled={!key.trim() || checking}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            {checking ? "testing…" : "test & connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

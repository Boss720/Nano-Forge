import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  FolderLock,
  HardDrive,
  KeyRound,
  Loader2,
  Palette,
  PlugZap,
  Puzzle,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
  Zap,
} from "lucide-react";
import type { ConnectionState } from "@/types";
import { formatQuote } from "@/lib/x402";
import { ThemeCustomizer } from "@/sections/settings/ThemeCustomizer";
import { getAttachmentSnapshotStore } from "@/lib/attachments/snapshots";

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
  initialTab?: "connection" | "theme" | "workspace";
  /** Phase 3: Reviewed local writes opt-in settings */
  activeWorkspaceRoot?: string;
  allowWorkspaceWrites?: boolean;
  onToggleWorkspaceWrites?: (enabled: boolean) => void;
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
  activeWorkspaceRoot,
  allowWorkspaceWrites = false,
  onToggleWorkspaceWrites,
}: Props) {
  const [tab, setTab] = useState<"connection" | "theme" | "workspace">(initialTab);
  const [key, setKey] = useState(connection.apiKey);
  const [base, setBase] = useState(connection.baseUrl);
  const [show, setShow] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmingEnableWrites, setConfirmingEnableWrites] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheClearedNotice, setCacheClearedNotice] = useState(false);
  const [mcpNoteDismissed, setMcpNoteDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS_MCP_NOTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const checking = connection.status === "checking";

  const handleClearAttachmentCache = async () => {
    setClearingCache(true);
    try {
      const store = getAttachmentSnapshotStore();
      await store.clear();
      setCacheClearedNotice(true);
      setTimeout(() => setCacheClearedNotice(false), 3000);
    } catch {
      /* ignore storage errors */
    } finally {
      setClearingCache(false);
    }
  };

  const dismissMcpNote = () => {
    setMcpNoteDismissed(true);
    try {
      localStorage.setItem(LS_MCP_NOTE_KEY, "1");
    } catch {
      /* blocked storage — note just reappears next session */
    }
  };

  // Re-sync local fields from live connection every time dialog opens
  useEffect(() => {
    if (open) {
      setKey(connection.apiKey);
      setBase(connection.baseUrl);
      setConfirmClear(false);
      setConfirmingEnableWrites(false);
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
            {tab === "connection" && (
              <>
                <KeyRound className="h-4 w-4 text-primary" />
                <span>Connect nano-gpt.com</span>
              </>
            )}
            {tab === "theme" && (
              <>
                <Palette className="h-4 w-4 text-primary" />
                <span>Theme &amp; Appearance</span>
              </>
            )}
            {tab === "workspace" && (
              <>
                <FolderLock className="h-4 w-4 text-primary" />
                <span>Local Workspace &amp; Writes</span>
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
              onClick={() => setTab("workspace")}
              className={`rounded px-2 py-0.5 transition-colors ${
                tab === "workspace" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Workspace
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
        ) : tab === "workspace" ? (
          <>
            <div className="space-y-4 px-4 py-4">
              <div className="space-y-1.5">
                <label className="micro-label flex items-center gap-1.5 text-foreground font-semibold">
                  <HardDrive className="h-3.5 w-3.5 text-primary" /> Active Workspace Folder
                </label>
                <div
                  data-testid="active-workspace-root-display"
                  className="rounded-md border border-input bg-secondary/40 px-3 py-2 font-mono text-[12px] text-foreground break-all"
                >
                  {activeWorkspaceRoot || "No active local workspace folder"}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/20 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="enable-reviewed-local-writes"
                    className="font-medium text-[13px] text-foreground cursor-pointer select-none"
                  >
                    Enable reviewed local writes
                  </label>
                  <input
                    id="enable-reviewed-local-writes"
                    type="checkbox"
                    checked={allowWorkspaceWrites}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setConfirmingEnableWrites(true);
                      } else {
                        setConfirmingEnableWrites(false);
                        onToggleWorkspaceWrites?.(false);
                      }
                    }}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                  />
                </div>

                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  When enabled, accepting patches in chat will modify files on disk in the selected folder:{" "}
                  <span className="font-mono text-foreground font-semibold break-all">
                    {activeWorkspaceRoot || "the selected folder"}
                  </span>
                  . Each write requires your explicit review and performs SHA-256 conflict detection before modifying the
                  disk. This setting resets to disabled after restart.
                </p>

                {confirmingEnableWrites && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2.5">
                    <div className="flex items-center gap-2 text-amber-200 font-semibold text-[12px]">
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span>Confirm Local Workspace Writes</span>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-amber-200/90">
                      Allow reviewed local writes? Accepted patches will modify files in{" "}
                      <span className="font-mono text-foreground font-semibold break-all">
                        {activeWorkspaceRoot || "the selected workspace root"}
                      </span>
                      . Are you sure you want to enable this for the current session?
                    </p>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setConfirmingEnableWrites(false)}
                        className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingEnableWrites(false);
                          onToggleWorkspaceWrites?.(true);
                        }}
                        className="rounded-md bg-amber-500 px-3 py-1 font-mono text-[11px] font-semibold text-black hover:bg-amber-400"
                      >
                        Enable Reviewed Writes
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                  <span>
                    Host-side enforcement: Local writes are strictly guarded by the agent host process (
                    <code className="text-foreground">NANOFORGE_ALLOW_WORKSPACE_WRITES</code>). The frontend setting alone
                    cannot force disk writes if the host daemon was started without write permissions.
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[13px] text-foreground">Attachment Snapshot Cache</span>
                  <button
                    type="button"
                    disabled={clearingCache}
                    onClick={handleClearAttachmentCache}
                    className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary"
                  >
                    {clearingCache ? "Clearing..." : "Clear local attachment cache"}
                  </button>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Remove locally cached file snapshots from browser IndexedDB storage to free space and prune sensitive attachment history.
                </p>
                {cacheClearedNotice && (
                  <p className="text-[11.5px] text-emerald-400 font-medium">Local attachment cache cleared successfully.</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setTab("connection")}
                className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
              >
                <KeyRound className="h-3 w-3" /> connection
              </button>
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
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-primary px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground hover:opacity-90"
              >
                Done
              </button>
            </div>
          </>
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
              {/* Workspace local writes settings switch */}
              <button
                type="button"
                onClick={() => setTab("workspace")}
                title="Local workspace and reviewed write settings"
                className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
              >
                <FolderLock className="h-3 w-3" /> workspace
              </button>
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { ConnectionState, GenerationPrefs, Message, Patch, Session, ToolCall, UsageTotals, VirtualFile } from "@/types";
import { DEFAULT_GEN_PREFS } from "@/types";
import { FALLBACK_MODELS, AGENT_SYSTEM_PROMPT, VIRTUAL_PROJECT } from "@/lib/catalog";
import { DEFAULT_BASE_URL, fetchModels, streamChat, validateKey } from "@/lib/nanogpt";
import { runDemoAgent } from "@/lib/demoAgent";
import { patchSessionMessage } from "@/lib/sessionReducer";
import { applyRunUsage, runCost } from "@/lib/usage";
import { applyPatch, revertPatch } from "@/lib/vfs";
import { buildContext } from "@/lib/context";
import { extractPatch } from "@/lib/patchParse";
import { countAutoTurns, shouldAutoVerify, verificationPrompt } from "@/lib/agentLoop";
import { createDebouncedSaver, loadState, STORAGE_KEY } from "@/lib/persist";
import { downloadSessionMarkdown } from "@/lib/exporter";
import { useMediaQuery } from "@/hooks/use-media-query";
import { HighlightedCode } from "@/components/RichText";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { TopBar } from "@/sections/TopBar";
import { Sidebar } from "@/sections/Sidebar";
import { ChatPanel } from "@/sections/ChatPanel";
import { ModelPanel } from "@/sections/ModelPanel";
import { ConnectDialog } from "@/sections/ConnectDialog";

const uid = () => Math.random().toString(36).slice(2, 10);
const LS_KEY = "nanoforge.connection";
const LS_GENPREFS_KEY = "nanoforge.genprefs";

function loadConnection(): ConnectionState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { apiKey?: string; baseUrl?: string };
      if (saved.apiKey) {
        return {
          apiKey: saved.apiKey,
          baseUrl: saved.baseUrl ?? DEFAULT_BASE_URL,
          status: "connected",
          liveModels: false,
        };
      }
    }
  } catch { /* ignore */ }
  return { apiKey: "", baseUrl: DEFAULT_BASE_URL, status: "disconnected", liveModels: false };
}

function newSession(model: string): Session {
  return { id: uid(), title: "new run", messages: [], model, createdAt: Date.now() };
}

/** Task 2.3: per-model generation prefs, shape `{ [modelId]: { temperature, maxTokens } }`. */
function loadGenPrefs(): Record<string, GenerationPrefs> {
  try {
    const raw = localStorage.getItem(LS_GENPREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<GenerationPrefs>>;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, GenerationPrefs> = {};
    for (const [modelId, p] of Object.entries(parsed)) {
      if (p && typeof p.temperature === "number" && typeof p.maxTokens === "number") {
        out[modelId] = { temperature: p.temperature, maxTokens: p.maxTokens };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Task 3.1 hydration caveats:
 * - hydrated `files` REPLACE `VIRTUAL_PROJECT` wholesale (no merge) — the
 *   persisted vfs already reflects every applied patch.
 * - `streaming: true` flags are stripped: a mid-stream reload has no live
 *   producer, and a stuck flag would pin the transcript in "running" visuals.
 * - patches are NOT re-applied on load — their persisted statuses are
 *   display-only truth (`Patch.lines` are self-contained, so revert still
 *   works after hydration).
 * - `countAutoTurns` derives the auto-turn budget from the message list, so
 *   hydrated transcripts keep their edit-verify history for free.
 */
function hydratePersisted(): { sessions: Session[]; usage: UsageTotals; files: VirtualFile[] } | null {
  const state = loadState();
  if (!state) return null;
  const sessions = state.sessions.map((s) => ({
    ...s,
    messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
  }));
  return { sessions, usage: state.usage, files: state.files };
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>(loadConnection);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[3].id); // kimi-k2-0905
  // Task 3.1: lazy initializers hydrate from `nanoforge.v1` with fallbacks.
  const [hydrated] = useState(hydratePersisted);
  const [sessions, setSessions] = useState<Session[]>(() =>
    hydrated && hydrated.sessions.length > 0 ? hydrated.sessions : [newSession(FALLBACK_MODELS[3].id)],
  );
  // activeId is not persisted; validate against the hydrated session list and
  // fall back to the first session.
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [usage, setUsage] = useState<UsageTotals>(() => hydrated?.usage ?? { input: 0, output: 0, costUsd: 0, requests: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<string | null>(null);
  // Task 1.1: the virtual workspace lives in state so applied patches are
  // visible in the sidebar / file viewer.
  const [files, setFiles] = useState<VirtualFile[]>(() => hydrated?.files ?? VIRTUAL_PROJECT);
  // Task 2.3: per-model generation prefs (temperature / maxTokens), persisted
  // to localStorage under `nanoforge.genprefs`. The active model's prefs are a
  // plain lookup, so switching models instantly restores its saved settings.
  const [genPrefsMap, setGenPrefsMap] = useState<Record<string, GenerationPrefs>>(loadGenPrefs);
  const genPrefs = genPrefsMap[selectedModel] ?? DEFAULT_GEN_PREFS;

  // Task 3.2: below `lg` (1024px) the two rails become overlay drawers.
  // `(max-width: 1023px)` mirrors Tailwind's lg breakpoint exactly.
  const isNarrow = useMediaQuery("(max-width: 1023px)");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  // Task 3.3: Ctrl/Cmd+K model quick-switcher.
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const handleGenPrefsChange = useCallback(
    (p: GenerationPrefs) => {
      setGenPrefsMap((prev) => {
        const next = { ...prev, [selectedModel]: p };
        try {
          localStorage.setItem(LS_GENPREFS_KEY, JSON.stringify(next));
        } catch {
          /* quota / blocked storage — prefs just won't persist */
        }
        return next;
      });
    },
    [selectedModel],
  );

  const abortRef = useRef<AbortController | null>(null);
  const demoCancelledRef = useRef(false);

  const session = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const model = useMemo(() => models.find((m) => m.id === selectedModel), [models, selectedModel]);
  const connected = connection.status === "connected";

  // Task 3.1: ONE debounced saver for the app lifetime. Any change to
  // sessions/usage/files coalesces into a single write 500ms later.
  const [saver] = useState(() => createDebouncedSaver(500));
  useEffect(() => {
    saver({ sessions, usage, files });
  }, [saver, sessions, usage, files]);
  // Flush pending state on tab close / unmount so the last edit is never lost.
  useEffect(() => {
    window.addEventListener("beforeunload", saver.flush);
    return () => {
      window.removeEventListener("beforeunload", saver.flush);
      saver.flush();
    };
  }, [saver]);

  // Pull the live catalog whenever a key is active.
  useEffect(() => {
    if (!connected) return;
    fetchModels(connection.baseUrl, connection.apiKey).then((list) => {
      setModels(list);
      setConnection((c) => ({ ...c, liveModels: list.some((m) => m.live) }));
      if (!list.some((m) => m.id === selectedModel)) setSelectedModel(list[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, connection.apiKey, connection.baseUrl]);

  // Task 3.2: never leave a drawer open when the viewport grows past lg —
  // the inline rails take over and the triggers disappear.
  useEffect(() => {
    if (!isNarrow) {
      setSidebarOpen(false);
      setModelsOpen(false);
    }
  }, [isNarrow]);

  // Task 3.3: global Ctrl/Cmd+K toggles the model quick-switcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Task 0.2: callers MUST pass the session id captured at send time — never
  // `activeId` — so streaming deltas can't leak into a session the user
  // switched to mid-run.
  const patchMessage = useCallback(
    (sessionId: string, msgId: string, fn: (m: Message) => Message) => {
      setSessions((prev) => patchSessionMessage(prev, sessionId, msgId, fn));
    },
    [],
  );

  // Task 0.3: errored runs (`{ errored: true }`) do not increment
  // `usage.requests`.
  const finishRun = useCallback(
    (sessionId: string, msgId: string, out: { input: number; output: number }, opts?: { errored?: boolean }) => {
      const m = model;
      const cost = runCost(m, out.input, out.output);
      patchMessage(sessionId, msgId, (msg) => ({
        ...msg,
        streaming: false,
        usage: { input: out.input, output: out.output, costUsd: cost },
        model: m?.name ?? selectedModel,
      }));
      setUsage((u) => applyRunUsage(u, { input: out.input, output: out.output, costUsd: cost }, opts));
      setRunning(false);
    },
    [model, selectedModel, patchMessage],
  );

  const handleSend = useCallback(
    (text: string, opts?: { auto?: boolean }) => {
      if (running || !session) return;
      // Task 0.2: capture the SENDING session's id — every streaming patch
      // below targets this id, so switching sessions mid-run cannot leak
      // deltas into the newly active session.
      const sid = session.id;
      // Task 2.2: auto (edit-verify) turns keep role user/assistant — NOT
      // "system" — so the history filter below keeps them in the wire context.
      const auto = opts?.auto === true;
      const userMsg: Message = { id: uid(), role: "user", content: text, ts: Date.now(), ...(auto ? { auto } : {}) };
      const agentMsg: Message = {
        id: uid(),
        role: "assistant",
        content: "",
        streaming: true,
        ts: Date.now(),
        ...(auto ? { auto } : {}),
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== sid
            ? s
            : {
                ...s,
                title: s.messages.length === 0 ? text.slice(0, 34) : s.title,
                model: selectedModel,
                messages: [...s.messages, userMsg, agentMsg],
              },
        ),
      );
      setRunning(true);

      if (!connected) {
        demoCancelledRef.current = false;
        runDemoAgent(
          text,
          {
            onToolCall: (t: ToolCall) =>
              patchMessage(sid, agentMsg.id, (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), t] })),
            onToolUpdate: (id, status, durationMs) =>
              patchMessage(sid, agentMsg.id, (m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((t) => (t.id === id ? { ...t, status, durationMs } : t)),
              })),
            onPatch: (p: Patch) => patchMessage(sid, agentMsg.id, (m) => ({ ...m, patch: p })),
            onDelta: (d) => patchMessage(sid, agentMsg.id, (m) => ({ ...m, content: m.content + d })),
            onDone: (u) => finishRun(sid, agentMsg.id, u),
          },
          () => demoCancelledRef.current,
        );
        return;
      }

      // Task 1.2: budget-aware context — system prompt always first, 25% of
      // the model's window reserved for output, history packed newest→oldest.
      const history = session.messages.filter((m) => m.role !== "system" && m.content);
      const budgetTokens = (model?.contextK ?? 128) * 1000;
      const wire = buildContext([...history, userMsg], AGENT_SYSTEM_PROMPT, budgetTokens);
      const controller = new AbortController();
      abortRef.current = controller;
      // Task 2.1: accumulate the full reply so `onDone` can scan it for a
      // ```diff fence (message state holds the same text, but reading it here
      // would need a round-trip through React state).
      let streamed = "";
      streamChat(
        connection.baseUrl,
        connection.apiKey,
        selectedModel,
        wire,
        {
          onDelta: (d) => {
            streamed += d;
            patchMessage(sid, agentMsg.id, (m) => ({ ...m, content: m.content + d }));
          },
          onDone: (u) => {
            abortRef.current = null;
            // Task 2.1 / 2.2: attach an extracted patch so PatchCard renders
            // with working Apply/Reject. A follow-up diff from a verification
            // reply arrives as a NEW pending patch; the loop then pauses until
            // the user applies it again (see agentLoop.ts).
            const patch = extractPatch(streamed);
            if (patch) {
              patchMessage(sid, agentMsg.id, (m) => ({ ...m, patch }));
            }
            finishRun(sid, agentMsg.id, u);
          },
          onError: (err) => {
            abortRef.current = null;
            patchMessage(sid, agentMsg.id, (m) => ({ ...m, content: m.content + `\n\n**Error:** ${err}` }));
            finishRun(sid, agentMsg.id, { input: 0, output: 0 }, { errored: true });
          },
        },
        controller.signal,
        { temperature: genPrefs.temperature, maxTokens: genPrefs.maxTokens },
      );
    },
    [running, session, connected, selectedModel, model, connection, patchMessage, finishRun, genPrefs],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    demoCancelledRef.current = true;
    setRunning(false);
    setSessions((prev) =>
      prev.map((s) => ({
        ...s,
        messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false, content: m.content + "\n\n*stopped by user*" } : m)),
      })),
    );
  }, []);

  const handleConnect = useCallback(async (apiKey: string, baseUrl: string) => {
    setConnection((c) => ({ ...c, apiKey, baseUrl, status: "checking", error: undefined }));
    const result = await validateKey(baseUrl, apiKey);
    const status = result.ok ? "connected" : "error";
    setConnection({ apiKey, baseUrl, status, error: result.error, liveModels: false });
    if (result.ok) {
      localStorage.setItem(LS_KEY, JSON.stringify({ apiKey, baseUrl }));
      setSettingsOpen(false);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setConnection({ apiKey: "", baseUrl: DEFAULT_BASE_URL, status: "disconnected", liveModels: false });
    setModels(FALLBACK_MODELS);
  }, []);

  const handleNewSession = useCallback(() => {
    const s = newSession(selectedModel);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }, [selectedModel]);

  // Task 3.1: "Clear history" — wipe `nanoforge.v1` and reset sessions /
  // usage / files to fresh defaults. The persist effect then re-saves the
  // clean state (so the key holds an empty snapshot, not stale data).
  const handleClearHistory = useCallback(() => {
    saver.cancel();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* blocked storage */
    }
    const s = newSession(selectedModel);
    setSessions([s]);
    setActiveId(s.id);
    setUsage({ input: 0, output: 0, costUsd: 0, requests: 0 });
    setFiles(VIRTUAL_PROJECT);
    setViewerFile(null);
  }, [saver, selectedModel]);

  // Task 3.3: session mutations always addressed by explicit id (same
  // cross-session discipline as patchMessage).
  const handleRenameSession = useCallback((id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      if (sessions.length <= 1) return; // guard: never delete the last session
      const next = sessions.filter((s) => s.id !== id);
      setSessions(next);
      if (activeId === id) setActiveId(next[0].id);
    },
    [sessions, activeId],
  );

  // Task 3.3: export the active session transcript as a Markdown download.
  const handleExport = useCallback(() => {
    if (session) downloadSessionMarkdown(session);
  }, [session]);

  // Task 1.1: Apply/Reject mutates the virtual filesystem for real.
  // The vfs transition is derived from the patch's CURRENT status, so
  // double-clicks / repeat decisions are no-ops and can never corrupt files:
  //   pending  → applied : applyPatch
  //   applied  → rejected: revertPatch
  //   pending  → rejected: status only (files untouched)
  //
  // Task 2.2: applying a patch in LIVE mode fires an automatic verification
  // turn (capped by MAX_AUTO_TURNS via countAutoTurns). Never fires in demo
  // mode or on reject — both gated by shouldAutoVerify.
  const handlePatchDecision = useCallback(
    (messageId: string, decision: "applied" | "rejected") => {
      if (!session) return;
      const patch = session.messages.find((m) => m.id === messageId)?.patch;
      if (!patch || patch.status === decision) return;
      let nextFiles: VirtualFile[] | null = null;
      if (decision === "applied") {
        nextFiles = applyPatch(files, patch);
        setFiles(nextFiles);
      } else if (patch.status === "applied") {
        setFiles((prev) => revertPatch(prev, patch));
      }
      setSessions((prev) =>
        patchSessionMessage(prev, session.id, messageId, (m) =>
          m.patch ? { ...m, patch: { ...m.patch, status: decision } } : m,
        ),
      );

      const mode = connected ? "live" : "demo";
      const autoTurnsUsed = countAutoTurns(session.messages);
      if (nextFiles && shouldAutoVerify("applied", mode, autoTurnsUsed)) {
        const content = nextFiles.find((f) => f.path === patch.file)?.content ?? "";
        handleSend(verificationPrompt(patch.file, content), { auto: true });
      }
    },
    [session, files, connected, handleSend],
  );

  const activeViewer = files.find((f) => f.path === viewerFile);
  const providers = useMemo(() => Array.from(new Set(models.map((m) => m.provider))).sort(), [models]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar
        connection={connection}
        usage={usage}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenModels={() => setModelsOpen(true)}
        onExport={handleExport}
        canExport={!!session && session.messages.length > 0}
      />
      <div className="flex min-h-0 flex-1">
        {/* inline rails — lg and up only; below lg the drawers take over */}
        <Sidebar
          className="hidden lg:flex"
          sessions={sessions}
          activeId={session?.id ?? ""}
          onSelect={setActiveId}
          onNew={handleNewSession}
          files={files}
          activeFile={viewerFile ?? ""}
          onFileSelect={(p) => setViewerFile(p)}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
        />
        <ChatPanel
          messages={session?.messages ?? []}
          running={running}
          model={model}
          connected={connected}
          onSend={handleSend}
          onStop={handleStop}
          onPatchDecision={handlePatchDecision}
          genPrefs={genPrefs}
          onGenPrefsChange={handleGenPrefsChange}
        />
        <ModelPanel
          className="hidden lg:flex"
          models={models}
          selected={selectedModel}
          onSelect={setSelectedModel}
          live={connection.liveModels}
        />
      </div>

      {/* Task 3.2: overlay drawers for < lg. Triggers only exist below lg, and
          the isNarrow effect force-closes them when the viewport widens. */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="gap-0 border-border bg-card p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Sessions &amp; workspace</SheetTitle>
          </SheetHeader>
          <Sidebar
            className="h-full w-full border-r-0"
            sessions={sessions}
            activeId={session?.id ?? ""}
            onSelect={(id) => {
              setActiveId(id);
              setSidebarOpen(false);
            }}
            onNew={() => {
              handleNewSession();
              setSidebarOpen(false);
            }}
            files={files}
            activeFile={viewerFile ?? ""}
            onFileSelect={(p) => {
              setViewerFile(p);
              setSidebarOpen(false);
            }}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={modelsOpen} onOpenChange={setModelsOpen}>
        <SheetContent side="right" className="gap-0 border-border bg-card p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Model catalog</SheetTitle>
          </SheetHeader>
          <ModelPanel
            className="h-full w-full border-l-0"
            models={models}
            selected={selectedModel}
            onSelect={(id) => {
              setSelectedModel(id);
              setModelsOpen(false);
            }}
            live={connection.liveModels}
          />
        </SheetContent>
      </Sheet>

      <ConnectDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        connection={connection}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onClearHistory={handleClearHistory}
      />

      {/* Task 3.3: Ctrl/Cmd+K model quick-switcher — same catalog data and
          provider grouping as ModelPanel; cmdk provides the fuzzy filter. */}
      <CommandDialog
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        title="Switch model"
        description="Search the model catalog and press Enter to switch"
        className="border-border bg-card"
      >
        <CommandInput placeholder="search models…" />
        <CommandList className="scrollbar-thin">
          <CommandEmpty className="font-mono text-[12px] text-muted-foreground">no models match</CommandEmpty>
          {providers.map((p) => (
            <CommandGroup heading={p} key={p}>
              {models
                .filter((m) => m.provider === p)
                .map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.id}`}
                    onSelect={() => {
                      setSelectedModel(m.id);
                      setSwitcherOpen(false);
                    }}
                    className="font-mono text-[12px]"
                  >
                    <span className={m.id === selectedModel ? "text-primary" : "text-foreground"}>{m.name}</span>
                    {m.id === selectedModel && <Check className="h-3 w-3 text-primary" />}
                    <CommandShortcut>
                      {m.priceEstimated ? "~" : ""}${m.inputPrice.toFixed(2)}/${m.outputPrice.toFixed(2)} · {m.contextK}k
                    </CommandShortcut>
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>

      {/* file viewer overlay */}
      {activeViewer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" onClick={() => setViewerFile(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="font-mono text-[12px] text-foreground">{activeViewer.path}</span>
              <span className="micro-label">{activeViewer.language}</span>
              <div className="flex-1" />
              <button onClick={() => setViewerFile(null)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="scrollbar-thin flex-1 overflow-auto bg-black/30 p-4 font-mono text-[12px] leading-relaxed text-foreground/85">
              <code>
                <HighlightedCode code={activeViewer.content} lang={activeViewer.language} />
              </code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

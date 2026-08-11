import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
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

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>(loadConnection);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[3].id); // kimi-k2-0905
  const [sessions, setSessions] = useState<Session[]>(() => [newSession(FALLBACK_MODELS[3].id)]);
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [usage, setUsage] = useState<UsageTotals>({ input: 0, output: 0, costUsd: 0, requests: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<string | null>(null);
  // Task 1.1: the virtual workspace lives in state so applied patches are
  // visible in the sidebar / file viewer.
  const [files, setFiles] = useState<VirtualFile[]>(VIRTUAL_PROJECT);
  // Task 2.3: per-model generation prefs (temperature / maxTokens), persisted
  // to localStorage under `nanoforge.genprefs`. The active model's prefs are a
  // plain lookup, so switching models instantly restores its saved settings.
  const [genPrefsMap, setGenPrefsMap] = useState<Record<string, GenerationPrefs>>(loadGenPrefs);
  const genPrefs = genPrefsMap[selectedModel] ?? DEFAULT_GEN_PREFS;

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar connection={connection} usage={usage} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={sessions}
          activeId={session?.id ?? ""}
          onSelect={setActiveId}
          onNew={handleNewSession}
          files={files}
          activeFile={viewerFile ?? ""}
          onFileSelect={(p) => setViewerFile(p)}
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
        <ModelPanel models={models} selected={selectedModel} onSelect={setSelectedModel} live={connection.liveModels} />
      </div>

      <ConnectDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        connection={connection}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

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
              {activeViewer.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

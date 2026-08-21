import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { ConnectionState, GenerationPrefs, Message, Patch, Session, ToolCall, UsageRun, UsageTotals, VirtualFile } from "@/types";
import { DEFAULT_GEN_PREFS } from "@/types";
import { FALLBACK_MODELS, AGENT_SYSTEM_PROMPT, VIRTUAL_PROJECT } from "@/lib/catalog";
import { DEFAULT_BASE_URL, fetchModels, streamChat, validateKey } from "@/lib/nanogpt";
import { formatQuote } from "@/lib/x402";
import { runDemoAgent } from "@/lib/demoAgent";
import { patchSessionMessage } from "@/lib/sessionReducer";
import { applyRunUsage, runCost } from "@/lib/usage";
import { appendRun } from "@/lib/usageLog";
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
import { CostDashboard } from "@/sections/CostDashboard";
// Agent platform wiring (Tasks 3/7/10/14/17): every host-driven surface is
// derived from useHostSession and stays null/empty while the host is absent
// (default), so the demo/direct-NanoGPT UI is byte-identical to before.
import { PlanPanel } from "@/sections/PlanPanel";
import { BrowserPermissionDialog } from "@/sections/BrowserPermissionDialog";
import { IntegrationsPanel } from "@/sections/IntegrationsPanel";
import { VisualEvidenceCard } from "@/sections/VisualEvidenceCard";
import { ArtifactDock } from "@/sections/ArtifactDock";
import { SubagentsPanel } from "@/sections/SubagentsPanel";
import { ThemeCustomizer } from "@/sections/settings/ThemeCustomizer";
import { useArtifacts } from "@/hooks/useArtifacts";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { VoiceCallDrawer } from "@/components/voice/VoiceCallDrawer";
import { useHostSession, type UseHostSessionOptions } from "@/lib/hostSession";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Final phase (Task A): the image panel is lazy-loaded so it stays out of the
// already-large main bundle (recharts). The chunk loads on first open.
const ImagePanel = lazy(() => import("@/sections/ImagePanel"));

const uid = () => Math.random().toString(36).slice(2, 10);
const LS_KEY = "nanoforge.connection";
const LS_GENPREFS_KEY = "nanoforge.genprefs";
/** Final phase (Task D): quick-switcher renders at most this many cmdk items. */
const MAX_SWITCHER_ITEMS = 50;

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
function hydratePersisted(): { sessions: Session[]; usage: UsageTotals; files: VirtualFile[]; runs: UsageRun[] } | null {
  const state = loadState();
  if (!state) return null;
  const sessions = state.sessions.map((s) => ({
    ...s,
    messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
  }));
  // `runs` is additive (persist v1, optional): saves written before the cost
  // dashboard existed load with `runs === undefined` → default to empty.
  return { sessions, usage: state.usage, files: state.files, runs: state.runs ?? [] };
}

export default function App({ hostSession }: { hostSession?: UseHostSessionOptions } = {}) {
  // Agent platform: host session state. `hostSession` is a wiring seam for
  // tests / the future plan composer — production callers pass nothing and
  // the persisted settings (default: disabled) apply.
  const host = useHostSession(hostSession);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
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
  // Final phase (Task A): per-run usage log feeding the cost dashboard.
  const [runs, setRuns] = useState<UsageRun[]>(() => hydrated?.runs ?? []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [costsOpen, setCostsOpen] = useState(false);
  // Final phase (Task A): image generation panel (lazy chunk, dialog).
  const [imagesOpen, setImagesOpen] = useState(false);
  // Milestone 3: subagent swarm control plane dock
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<string | null>(null);

  // Phase 1: Dedicated Artifact Dock Manager
  const artifactsManager = useArtifacts();
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
  // Task D: controlled query drives the ~50-item window (cmdk then fuzzy-
  // re-ranks the windowed items — all `includes` matches pass its filter).
  const [switcherQuery, setSwitcherQuery] = useState("");

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
    saver({ sessions, usage, files, runs });
  }, [saver, sessions, usage, files, runs]);
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
      // Task A: record the run for the cost dashboard — same cost figure that
      // was folded into the aggregate; errored runs are logged for audit but
      // don't count as requests (mirrors applyRunUsage via usageLog.fold).
      setRuns((prev) =>
        appendRun(prev, {
          id: crypto.randomUUID(),
          ts: Date.now(),
          modelId: selectedModel,
          input: out.input,
          output: out.output,
          costUsd: cost,
          ...(opts?.errored ? { errored: true } : {}),
        }),
      );
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
            onPatch: (p: Patch) => {
              patchMessage(sid, agentMsg.id, (m) => ({ ...m, patch: p }));
              artifactsManager.addPatchArtifact(p);
            },
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
      // Final phase (Task B): on a 402, `onX402` (fired BEFORE `onError`)
      // composes the accountless-payment message here; `onError` then renders
      // it verbatim instead of the generic error line, so the user sees ONE
      // coherent message rather than two stacked ones.
      let x402Content: string | null = null;
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
              artifactsManager.addPatchArtifact(patch);
            }
            finishRun(sid, agentMsg.id, u);
          },
          onX402: (err) => {
            x402Content =
              `**Accountless payment required (HTTP 402).** This request needs a per-request payment` +
              (err.quote ? ` of **${formatQuote(err.quote)}**` : "") +
              `. Pay per request without an account, or add a subscription key in Settings to skip per-request payments.`;
          },
          onError: (err) => {
            abortRef.current = null;
            patchMessage(sid, agentMsg.id, (m) => ({
              ...m,
              content: m.content + (x402Content ? `\n\n${x402Content}` : `\n\n**Error:** ${err}`),
            }));
            finishRun(sid, agentMsg.id, { input: 0, output: 0 }, { errored: true });
          },
        },
        controller.signal,
        { temperature: genPrefs.temperature, maxTokens: genPrefs.maxTokens },
      );
    },
    [running, session, connected, selectedModel, model, connection, patchMessage, finishRun, genPrefs],
  );

  // Milestone 3: Voice Call Controller Hook
  const voice = useVoiceCall({
    modelName: model?.name ?? selectedModel,
    onSendPrompt: (prompt) => {
      handleSend(prompt);
    },
    onCommitTurn: (turn) => {
      if (!session) return;
      const turnMsg: Message = {
        id: uid(),
        role: turn.speaker === "user" ? "user" : "assistant",
        content: turn.interrupted ? `${turn.text} [interrupted]` : turn.text,
        ts: Date.now(),
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === session.id
            ? {
                ...s,
                title: s.messages.length === 0 ? turn.text.slice(0, 34) : s.title,
                messages: [...s.messages, turnMsg],
              }
            : s
        )
      );
    },
  });

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
    setConnection((c) => ({ ...c, apiKey, baseUrl, status: "checking", error: undefined, x402: undefined }));
    const result = await validateKey(baseUrl, apiKey);
    const status = result.ok ? "connected" : "error";
    // Final phase (Task B): keep the x402 quote (possibly null) on the
    // connection so ConnectDialog can surface accountless mode on a 402.
    setConnection({ apiKey, baseUrl, status, error: result.error, liveModels: false, x402: result.x402 });
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
    setRuns([]);
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

  // Task D: window the quick-switcher. Rendering ~1,100 cmdk items at once
  // makes opening/typing sluggish, so the list is pre-filtered by the
  // controlled query and capped at MAX_SWITCHER_ITEMS before cmdk ever sees
  // it. cmdk still applies its own fuzzy filter/ranking to the windowed
  // items — safe because every `includes` match also satisfies cmdk's
  // subsequence match, so no windowed item is dropped. Ranking puts
  // name-prefix matches first, then id-prefix, then any substring match.
  // Provider grouping is preserved by grouping the windowed result.
  const switcher = useMemo(() => {
    const q = switcherQuery.trim().toLowerCase();
    if (!q) {
      return { items: models.slice(0, MAX_SWITCHER_ITEMS), total: models.length, truncated: models.length > MAX_SWITCHER_ITEMS };
    }
    const rank = (m: (typeof models)[number]) => {
      const name = m.name.toLowerCase();
      const id = m.id.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (id.startsWith(q)) return 1;
      return 2;
    };
    const matches = models
      .filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { items: matches.slice(0, MAX_SWITCHER_ITEMS), total: matches.length, truncated: matches.length > MAX_SWITCHER_ITEMS };
  }, [models, switcherQuery]);
  const switcherProviders = useMemo(
    () => Array.from(new Set(switcher.items.map((m) => m.provider))).sort(),
    [switcher.items],
  );
  // Reset the query each time the switcher opens (it also opens via the
  // global Ctrl/Cmd+K handler, bypassing onOpenChange).
  useEffect(() => {
    if (switcherOpen) setSwitcherQuery("");
  }, [switcherOpen]);

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
        onOpenCosts={() => setCostsOpen(true)}
        onOpenImages={() => setImagesOpen(true)}
        onOpenArtifacts={artifactsManager.toggleDock}
        artifactCount={artifactsManager.artifacts.length}
        onOpenSubagents={() => setSubagentsOpen((o) => !o)}
        subagentCount={host.subagents.filter((a) => a.state === "running").length || host.subagents.length}
        onOpenTheme={() => setThemeOpen(true)}
        onOpenVoiceCall={voice.openDrawer}
        isVoiceCallActive={voice.isCallActive}
        voiceCallStatus={voice.status}
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
          toolRuns={host.toolRuns}
          onToolStop={host.stopToolRun}
          onTriggerVoiceCall={() => {
            if (voice.isCallActive) {
              voice.openDrawer();
            } else {
              void voice.startCall();
            }
          }}
          isVoiceCallActive={voice.isCallActive}
        />
        {/* Phase 1: Dedicated Artifact Viewer Dock */}
        {artifactsManager.isOpen && artifactsManager.artifacts.length > 0 && (
          <aside data-testid="artifact-rail" className="hidden min-h-0 w-[440px] shrink-0 flex-col lg:flex">
            <ArtifactDock
              artifacts={artifactsManager.artifacts}
              activeArtifactId={artifactsManager.activeArtifactId}
              onSelectArtifact={artifactsManager.selectArtifact}
              onClose={artifactsManager.closeDock}
              onSendFeedback={artifactsManager.handleFeedback}
            />
          </aside>
        )}
        {/* Milestone 3: Dedicated Subagents Swarm Control Plane Dock */}
        {subagentsOpen && (
          <aside data-testid="subagents-rail" className="hidden min-h-0 w-[480px] shrink-0 flex-col lg:flex">
            <SubagentsPanel
              session={host}
              onClose={() => setSubagentsOpen(false)}
              onSelectArtifact={(p) => setViewerFile(p)}
            />
          </aside>
        )}
        {/* Agent platform (Tasks 3 + 9): plan inspector side rail, mounted
            only while a plan (or run evidence) exists — host-driven, so the
            default host-absent UI never renders it. PlanPanel keeps its own
            approval ledger; App only forwards its explicit callbacks. */}
        {(host.plan || host.evidence) && (
          <aside data-testid="plan-rail" className="hidden min-h-0 w-80 shrink-0 flex-col lg:flex">
            {host.plan && (
              <PlanPanel
                plan={host.plan}
                className="min-h-0 flex-1"
                onApproveStep={host.approveStep}
                onRunApproved={host.runApproved}
                onPause={host.pause}
                onCancel={host.cancel}
              />
            )}
            {host.evidence && (
              <div className="scrollbar-thin max-h-[45%] shrink-0 overflow-y-auto border-l border-t border-border bg-card/40 p-2">
                <VisualEvidenceCard assertions={host.evidence.assertions} diff={host.evidence.diff} />
              </div>
            )}
          </aside>
        )}
        <ModelPanel
          className="hidden lg:flex"
          models={models}
          selected={selectedModel}
          onSelect={setSelectedModel}
          live={connection.liveModels}
          routeDecision={host.routeDecision ?? undefined}
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
            routeDecision={host.routeDecision ?? undefined}
          />
        </SheetContent>
      </Sheet>

      {/* Milestone 3: Subagent Swarm drawer for mobile/narrow screens */}
      <Sheet open={subagentsOpen && isNarrow} onOpenChange={setSubagentsOpen}>
        <SheetContent side="right" className="gap-0 border-border bg-card p-0 sm:max-w-xl w-full">
          <SheetHeader className="sr-only">
            <SheetTitle>Subagent Swarm Control Plane</SheetTitle>
          </SheetHeader>
          <SubagentsPanel
            session={host}
            onClose={() => setSubagentsOpen(false)}
            onSelectArtifact={(p) => {
              setViewerFile(p);
              setSubagentsOpen(false);
            }}
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
        onOpenIntegrations={() => setIntegrationsOpen(true)}
        onOpenTheme={() => {
          setSettingsOpen(false);
          setThemeOpen(true);
        }}
      />

      {/* Milestone 4: Theme & Palette Customizer Modal */}
      <Dialog open={themeOpen} onOpenChange={setThemeOpen}>
        <DialogContent className="scrollbar-thin max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-[13px] tracking-wide">Theme &amp; Visual Palette</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Customize presets, accent colors, surface contrast, and border radius in real-time.
            </DialogDescription>
          </DialogHeader>
          <ThemeCustomizer onClose={() => setThemeOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Agent platform (Task 14): rules packs / skills / MCP servers. Rows
          come from the host session (empty → "none configured" until the host
          protocol grows integration frames). */}
      <Dialog open={integrationsOpen} onOpenChange={setIntegrationsOpen}>
        <DialogContent className="scrollbar-thin max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-[13px] tracking-wide">Integrations</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Rules packs, skills, and MCP servers managed by the local agent host.
            </DialogDescription>
          </DialogHeader>
          <IntegrationsPanel
            plugins={[]}
            rulesPacks={host.integrations.rulesPacks}
            skills={host.integrations.skills}
            mcpServers={host.integrations.mcpServers}
            onToggleRulesPack={host.toggleRulesPack}
            onToggleSkill={host.toggleSkill}
            onToggleMcpServer={host.toggleMcpServer}
            onTogglePlugin={() => {}}
          />
        </DialogContent>
      </Dialog>

      {/* Agent platform (Task 10): two-level browser permission prompts,
          driven by the host session bridge. Renders nothing while idle. */}
      <BrowserPermissionDialog request={host.permissionPending} onDecide={host.decidePermission} />

      {/* Task 3.3: Ctrl/Cmd+K model quick-switcher — same catalog data and
          provider grouping as ModelPanel; cmdk provides the fuzzy filter.
          Task D: only a windowed slice (≤ MAX_SWITCHER_ITEMS) is rendered —
          see the `switcher` memo above. */}
      <CommandDialog
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        title="Switch model"
        description="Search the model catalog and press Enter to switch"
        className="border-border bg-card"
      >
        <CommandInput placeholder="search models…" value={switcherQuery} onValueChange={setSwitcherQuery} />
        <CommandList className="scrollbar-thin">
          <CommandEmpty className="font-mono text-[12px] text-muted-foreground">no models match</CommandEmpty>
          {switcherProviders.map((p) => (
            <CommandGroup heading={p} key={p}>
              {switcher.items
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
        {switcher.truncated && (
          <div className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
            showing {switcher.items.length} of {switcher.total} — keep typing to narrow
          </div>
        )}
      </CommandDialog>

      {/* Final phase (Task B): cost dashboard over the per-run usage log. */}
      <CostDashboard open={costsOpen} onOpenChange={setCostsOpen} runs={runs} models={models} usage={usage} />

      {/* Final phase (Task A): image generation panel — lazy chunk, mounted
          only after first open so it never touches the initial bundle. */}
      {imagesOpen && (
        <Suspense fallback={null}>
          <ImagePanel
            open={imagesOpen}
            onOpenChange={setImagesOpen}
            baseUrl={connection.baseUrl}
            apiKey={connection.apiKey}
            connected={connected}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </Suspense>
      )}

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

      {/* Milestone 3: Interactive Audio Voice Call Drawer */}
      <VoiceCallDrawer
        isOpen={voice.isDrawerOpen}
        voice={voice}
        onClose={voice.closeDrawer}
      />
    </div>
  );
}

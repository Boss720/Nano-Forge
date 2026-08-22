import { useCallback, useRef, useState } from "react";
import type {
  ConnectionState,
  ChatAttachment,
  ChatAttachmentDraft,
  ChatSendInput,
  GenerationPrefs,
  Message,
  Model,
  Patch,
  Session,
  ToolCall,
  UsageRun,
  UsageTotals,
  VirtualFile,
} from "@/types";
import { AGENT_SYSTEM_PROMPT } from "@/lib/catalog";
import { streamChat } from "@/lib/nanogpt";
import { formatQuote } from "@/lib/x402";
import { runDemoAgent } from "@/lib/demoAgent";
import { patchSessionMessage } from "@/lib/sessionReducer";
import { applyRunUsage, runCost } from "@/lib/usage";
import { appendRun } from "@/lib/usageLog";
import { applyPatch, revertPatch } from "@/lib/vfs";
import { buildContextWithAttachments } from "@/lib/context";
import { getAttachmentSnapshotStore, type AttachmentSnapshotStore } from "@/lib/attachments/snapshots";
import { attachmentMetadata } from "@/lib/attachments/validation";
import { extractPatch } from "@/lib/patchParse";
import { countAutoTurns, shouldAutoVerify, verificationPrompt } from "@/lib/agentLoop";

export interface UseAgentOrchestrationProps {
  session?: Session;
  connected: boolean;
  connection: ConnectionState;
  selectedModel: string;
  model?: Model;
  genPrefs: GenerationPrefs;
  files: VirtualFile[];
  setFiles: React.Dispatch<React.SetStateAction<VirtualFile[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setUsage: React.Dispatch<React.SetStateAction<UsageTotals>>;
  setRuns: React.Dispatch<React.SetStateAction<UsageRun[]>>;
  artifactsManager: {
    addPatchArtifact: (p: Patch) => void;
  };
  /** Injectable for deterministic tests; defaults to IndexedDB in browsers. */
  attachmentSnapshots?: AttachmentSnapshotStore;
  /** Host-backed file reads/writes used by the reviewed local-write path. */
  readWorkspaceFile?: (path: string) => Promise<{ path: string; content: string; language: string; size: number } | null>;
  writeWorkspaceFile?: (path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }) => Promise<unknown>;
  /** Virtual patches are the safe default; App opts into disk writes explicitly. */
  workspaceWriteCapability?: "virtual" | "live";
}

export function useAgentOrchestration({
  session,
  connected,
  connection,
  selectedModel,
  model,
  genPrefs,
  files,
  setFiles,
  setSessions,
  setUsage,
  setRuns,
  artifactsManager,
  attachmentSnapshots,
  readWorkspaceFile,
  writeWorkspaceFile,
  workspaceWriteCapability = "virtual",
}: UseAgentOrchestrationProps) {
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const demoCancelledRef = useRef(false);
  const snapshots = attachmentSnapshots ?? getAttachmentSnapshotStore();

  const patchMessage = useCallback(
    (sessionId: string, msgId: string, fn: (m: Message) => Message) => {
      setSessions((prev) => patchSessionMessage(prev, sessionId, msgId, fn));
    },
    [setSessions],
  );

  const finishRun = useCallback(
    (
      sessionId: string,
      msgId: string,
      out: { input: number; output: number },
      opts?: { errored?: boolean },
    ) => {
      const m = model;
      const cost = runCost(m, out.input, out.output);
      patchMessage(sessionId, msgId, (msg) => ({
        ...msg,
        streaming: false,
        usage: { input: out.input, output: out.output, costUsd: cost },
        model: m?.name ?? selectedModel,
      }));
      setUsage((u) => applyRunUsage(u, { input: out.input, output: out.output, costUsd: cost }, opts));
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
    [model, selectedModel, patchMessage, setUsage, setRuns],
  );

  const handleSend = useCallback(
    (input: string | ChatSendInput, opts?: { auto?: boolean }) => {
      if (running || !session) return;
      const { text, attachments = [] } = typeof input === "string" ? { text: input, attachments: [] } : input;
      const sid = session.id;
      const auto = opts?.auto === true;
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        ts: Date.now(),
        ...(attachments.length > 0 ? { attachments: attachments.map((attachment) => attachmentMetadata(attachment)) } : {}),
        ...(auto ? { auto } : {}),
      };
      const agentMsg: Message = {
        id: crypto.randomUUID(),
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

      void persistAttachmentSnapshots(attachments, snapshots).then(async (persisted) => {
        if (attachments.length > 0) {
          patchMessage(sid, userMsg.id, (message) => ({ ...message, attachments: persisted }));
        }

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

        const history = session.messages.filter((m) => m.role !== "system" && m.content);
        const budgetTokens = (model?.contextK ?? 128) * 1000;
        const contextResult = await buildContextWithAttachments(
          [...history, { ...userMsg, attachments: persisted }],
          AGENT_SYSTEM_PROMPT,
          budgetTokens,
          snapshots,
        );
        if (contextResult.updates.length > 0) {
          patchMessage(sid, userMsg.id, (message) => ({
            ...message,
            attachments: mergeAttachmentUpdates(message.attachments ?? [], contextResult.updates),
          }));
        }
        const wire = contextResult.context;
        const controller = new AbortController();
        abortRef.current = controller;
        let streamed = "";
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
      }).catch((error) => {
        patchMessage(sid, agentMsg.id, (message) => ({
          ...message,
          content: `${message.content}\n\n**Error:** ${error instanceof Error ? error.message : String(error)}`,
        }));
        finishRun(sid, agentMsg.id, { input: 0, output: 0 }, { errored: true });
      });
    },
    [
      running,
      session,
      connected,
      selectedModel,
      model,
      connection,
      patchMessage,
      finishRun,
      genPrefs,
      artifactsManager,
      setSessions,
      snapshots,
    ],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    demoCancelledRef.current = true;
    setRunning(false);
    setSessions((prev) =>
      prev.map((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.streaming ? { ...m, streaming: false, content: m.content + "\n\n*stopped by user*" } : m,
        ),
      })),
    );
  }, [setSessions]);

  const handlePatchDecision = useCallback(
    (messageId: string, decision: "applied" | "rejected") => {
      if (!session) return;
      const patch = session.messages.find((m) => m.id === messageId)?.patch;
      if (!patch || patch.status === decision) return;
      void (async () => {
        let workingFiles = files;
        const liveWorkspaceWrite = workspaceWriteCapability === "live";
        if (liveWorkspaceWrite && writeWorkspaceFile && readWorkspaceFile) {
          const current = await readWorkspaceFile(patch.file);
          if (current) {
            const existing = workingFiles.findIndex((file) => file.path === patch.file);
            const hydrated: VirtualFile = { path: current.path, content: current.content, language: current.language };
            workingFiles = existing === -1
              ? [...workingFiles, hydrated]
              : workingFiles.map((file, index) => (index === existing ? hydrated : file));
          } else if (!workingFiles.some((file) => file.path === patch.file)) {
            workingFiles = [...workingFiles, { path: patch.file, content: "", language: "text" }];
          }
        }

        const nextFiles = decision === "applied"
          ? applyPatch(workingFiles, patch)
          : patch.status === "applied" ? revertPatch(workingFiles, patch) : workingFiles;
        const nextContent = nextFiles.find((file) => file.path === patch.file)?.content;
        if (liveWorkspaceWrite && writeWorkspaceFile && nextContent !== undefined) {
          await writeWorkspaceFile(patch.file, nextContent);
        }

        if (decision === "applied" || patch.status === "applied") setFiles(nextFiles);
        setSessions((prev) =>
          patchSessionMessage(prev, session.id, messageId, (m) =>
            m.patch ? { ...m, patch: { ...m.patch, status: decision } } : m,
          ),
        );

        const mode = connected ? "live" : "demo";
        const autoTurnsUsed = countAutoTurns(session.messages);
        if (decision === "applied" && shouldAutoVerify("applied", mode, autoTurnsUsed)) {
          handleSend(verificationPrompt(patch.file, nextContent ?? ""), { auto: true });
        }
      })().catch((error) => {
        patchMessage(session.id, messageId, (message) => ({
          ...message,
          content: `${message.content}\n\n**Write not applied:** ${error instanceof Error ? error.message : String(error)}`,
        }));
      });

    },
    [
      session,
      files,
      connected,
      handleSend,
      setFiles,
      setSessions,
      patchMessage,
      readWorkspaceFile,
      writeWorkspaceFile,
      workspaceWriteCapability,
    ],
  );

  return {
    running,
    handleSend,
    handleStop,
    handlePatchDecision,
    patchMessage,
    finishRun,
  };
}

async function persistAttachmentSnapshots(
  attachments: ChatAttachmentDraft[],
  snapshots: AttachmentSnapshotStore,
): Promise<ChatAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.status !== "ready" || attachment.content === undefined) return attachmentMetadata(attachment);
      try {
        await snapshots.save(attachment.snapshotId, attachment.content);
        return attachmentMetadata(attachment);
      } catch (error) {
        return {
          ...attachmentMetadata(attachment),
          status: "error" as const,
          error: error instanceof Error ? error.message : "Could not save attachment snapshot.",
        };
      }
    }),
  );
}

function mergeAttachmentUpdates(
  attachments: ChatAttachment[],
  updates: Array<{ id: string; includedBytes: number; truncated?: boolean; status: ChatAttachment["status"]; error?: string }>,
): ChatAttachment[] {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return attachments.map((attachment) => {
    const update = byId.get(attachment.id);
    return update ? { ...attachment, ...update } : attachment;
  });
}

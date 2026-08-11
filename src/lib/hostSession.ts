/**
 * Agent platform — host session wiring (UI integration pass).
 *
 * Owns everything the web UI derives from the OPTIONAL local agent host:
 * the inspected execution plan, terminal tool-run cards, the router's route
 * decision, browser-permission prompts, and visual-verification evidence.
 * With the host absent (`enabled: false`, the default) every piece of state
 * stays null/empty and App renders exactly the pre-platform UI.
 *
 * Wire conventions (UI side — the host honors these; keep in sync with
 * `apps/agent-host/`):
 *
 *  1. `runId === plan.id`. A plan submitted via `submitPlan` executes as the
 *     run of the same id; `run.state` events with that runId update the
 *     plan's UI state and per-step statuses. PlanPanel's Run control
 *     (re)submits the approved plan — there is no separate `run.start`
 *     frame in the client protocol.
 *
 *  2. Task 10 browser-step convention: a plan step whose `affectedScopes`
 *     contains an entry of the form `browser:<origin>` (e.g.
 *     `browser:https://shop.example`) involves managed-browser actions on
 *     that origin. Approving such a step in PlanPanel routes through the
 *     origin permission prompt FIRST — the host grant (`approval.grant`)
 *     is sent only after the user allows; a deny sends `approval.deny`.
 *     Sensitive actions (submit/purchase/auth/download) are deliberately
 *     NOT pre-prompted here: the permission reducer's one-shot invariant
 *     (each sensitive approval is consumed by exactly one action, never
 *     persisted) makes an approve-time pre-grant meaningless. They prompt
 *     at runtime via `browser.sensitive` run events instead.
 *
 *  3. Runtime browser permission requests arrive as `run.event` frames:
 *       event: "browser.origin"     detail: JSON { origin, url? }
 *       event: "browser.sensitive"  detail: JSON { action, origin, detail? }
 *     Decisions flow back through the fixed client API as
 *     `grantApproval`/`denyApproval` with synthetic step ids:
 *       `browser/origin/<origin>`                (navigation)
 *       `browser/sensitive/<action>@<origin>`    (one-shot sensitive action)
 *     Session origin grants auto-resolve repeat navigations without a
 *     prompt (grant sent immediately); a sensitive action ALWAYS prompts.
 *
 *  4. Router decisions arrive as `run.event` "route.decision" with detail
 *     JSON `{ decision, pendingFallback?, preApprovedFallbacks? }`.
 *     Fallback approve/reject map to grant/deny with the synthetic step id
 *     `route/fallback/<modelId>`.
 *
 *  5. Visual-verification evidence arrives as `run.event` "visual.evidence"
 *     with detail JSON `{ assertions?, diff? }` (VisualEvidenceCard props).
 *
 *  6. Integrations (rules packs / skills / MCP servers, Task 14) have no
 *     protocol frames yet: rows start empty ("none configured") and the
 *     toggles are documented no-ops until the host protocol grows them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionPlan, PlanStep, PlanStepStatus, ToolRun } from "@/types";
import { HostClient, type HostMessage } from "@/lib/hostClient";
import {
  useBrowserPermissions,
  type BrowserPermissionDecision,
  type BrowserPermissionRequest,
  type SensitiveActionKind,
} from "@/sections/BrowserPermissionDialog";
import type { RouteDecision, RouteDecisionCardProps } from "@/sections/RouteDecisionCard";
import type { McpServerRow, RulesPackRow, SkillRow } from "@/sections/IntegrationsPanel";
import type { VisualAssertionResult, VisualDiffResult } from "@/sections/VisualEvidenceCard";

/* ------------------------------------------------------------------ */
/* Settings (additive, OFF by default)                                 */
/* ------------------------------------------------------------------ */

export interface HostSettings {
  /** Master switch — false unless the user runs a local agent host. */
  enabled: boolean;
  /** Loopback port printed by the host on startup. */
  port?: number;
  /** Single-use bearer token (never persisted by HostClient itself). */
  token?: string;
}

export const HOST_SETTINGS_KEY = "nanoforge.host";

export const DEFAULT_HOST_SETTINGS: HostSettings = { enabled: false };

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Never throws; absent/corrupt payload → the disabled default. */
export function loadHostSettings(storage: Storage | undefined = defaultStorage()): HostSettings {
  try {
    const raw = storage?.getItem(HOST_SETTINGS_KEY);
    if (!raw) return DEFAULT_HOST_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<HostSettings>;
    return {
      enabled: parsed.enabled === true,
      ...(typeof parsed.port === "number" ? { port: parsed.port } : {}),
      ...(typeof parsed.token === "string" ? { token: parsed.token } : {}),
    };
  } catch {
    return DEFAULT_HOST_SETTINGS;
  }
}

/* ------------------------------------------------------------------ */
/* Wire convention constants                                           */
/* ------------------------------------------------------------------ */

/** Task 10: `affectedScopes` entry prefix marking a managed-browser step. */
export const BROWSER_SCOPE_PREFIX = "browser:";

/** run.event names the host uses to reach the UI. */
export const HOST_RUN_EVENTS = {
  browserOrigin: "browser.origin",
  browserSensitive: "browser.sensitive",
  routeDecision: "route.decision",
  visualEvidence: "visual.evidence",
} as const;

/** Synthetic step ids used when permission/router decisions map onto the
 *  fixed approval.grant / approval.deny frames. */
export const BROWSER_ORIGIN_STEP_PREFIX = "browser/origin/";
export const BROWSER_SENSITIVE_STEP_PREFIX = "browser/sensitive/";
export const ROUTE_FALLBACK_STEP_PREFIX = "route/fallback/";

/** Task 10: extract the browser origin from a plan step, if it is one. */
export function browserScopeOrigin(step: PlanStep): string | null {
  for (const scope of step.affectedScopes ?? []) {
    if (scope.startsWith(BROWSER_SCOPE_PREFIX)) {
      const origin = scope.slice(BROWSER_SCOPE_PREFIX.length).trim();
      if (origin) return origin;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Derived state types                                                 */
/* ------------------------------------------------------------------ */

/** Structural subset of HostClient the session depends on — injectable so
 *  tests (and future transports) never open a real socket. */
export interface HostClientLike {
  connect(): Promise<void>;
  close(): void;
  onEvent(handler: (msg: HostMessage) => void): () => void;
  submitPlan(plan: ExecutionPlan): Promise<void>;
  grantApproval(runId: string, stepId: string): Promise<void>;
  denyApproval(runId: string, stepId: string): Promise<void>;
  pauseRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
}

export interface HostIntegrationsState {
  rulesPacks: RulesPackRow[];
  skills: SkillRow[];
  mcpServers: McpServerRow[];
}

export const EMPTY_INTEGRATIONS: HostIntegrationsState = {
  rulesPacks: [],
  skills: [],
  mcpServers: [],
};

export interface HostEvidence {
  assertions?: VisualAssertionResult[];
  diff?: VisualDiffResult | null;
}

export type HostConnectionStatus = "off" | "connecting" | "connected" | "error";

interface RouteDecisionState {
  runId: string;
  decision: RouteDecision;
  pendingFallback: string | null;
  preApprovedFallbacks: string[];
}

export interface HostSession {
  enabled: boolean;
  status: HostConnectionStatus;
  lastError: string | null;
  plan: ExecutionPlan | null;
  toolRuns: ToolRun[];
  /** Ready-to-spread props for ModelPanel's routeDecision slot. */
  routeDecision: RouteDecisionCardProps | null;
  integrations: HostIntegrationsState;
  evidence: HostEvidence | null;
  permissionPending: BrowserPermissionRequest | null;
  /** Wiring seam for the (future) plan composer and tests: install/replace
   *  the inspected plan. Passing null clears the plan rail and its evidence. */
  setPlan(plan: ExecutionPlan | null): void;
  approveStep(planId: string, stepId: string): void;
  runApproved(planId: string): void;
  pause(planId: string): void;
  cancel(planId: string): void;
  stopToolRun(toolRunId: string): void;
  decidePermission(decision: BrowserPermissionDecision): void;
  /** Task 14: integration toggles ride a future protocol extension — no-ops. */
  toggleRulesPack: (id: string, enabled: boolean) => void;
  toggleSkill: (id: string, enabled: boolean) => void;
  toggleMcpServer: (id: string, enabled: boolean) => void;
}

export interface UseHostSessionOptions {
  /** Overrides the persisted settings (tests / wiring seam). */
  settings?: HostSettings;
  /** Injectable client factory — production uses the real HostClient. */
  createClient?: (opts: { port: number; token: string }) => HostClientLike;
  /** Wiring seam: called with the live session API after every render
   *  (tests / the future plan composer). */
  onApi?: (api: HostSession) => void;
}

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                  */
/* ------------------------------------------------------------------ */

const isPlanStepStatus = (v: unknown): v is PlanStepStatus =>
  v === "pending" || v === "running" || v === "succeeded" || v === "failed" || v === "blocked";

const SENSITIVE_ACTIONS: readonly string[] = ["submit_form", "purchase", "authentication", "download"];
const isSensitiveAction = (v: unknown): v is SensitiveActionKind =>
  typeof v === "string" && SENSITIVE_ACTIONS.includes(v);

function parseJsonDetail<T>(detail: string | undefined): T | null {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null; // untrusted host payload — drop malformed frames silently
  }
}

function parseRouteDecision(v: unknown): RouteDecision | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  if (
    typeof d.primary !== "string" ||
    !Array.isArray(d.fallbacks) ||
    !d.fallbacks.every((f) => typeof f === "string") ||
    typeof d.estimatedCostUsd !== "number" ||
    typeof d.reason !== "string" ||
    typeof d.pinned !== "boolean"
  ) {
    return null;
  }
  return d as unknown as RouteDecision;
}

/** Insert or merge one tool-run card (keyed by tool id). */
function upsertToolRun(prev: ToolRun[], next: ToolRun): ToolRun[] {
  const i = prev.findIndex((t) => t.id === next.id);
  if (i === -1) return [...prev, next];
  const copy = prev.slice();
  copy[i] = { ...prev[i], ...next };
  return copy;
}

const originGrantKey = (origin: string) => `origin|${origin}`;
const sensitiveGrantKey = (action: string, origin: string) => `sensitive|${action}@${origin}`;

interface PendingGrant {
  runId: string;
  stepId: string;
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function useHostSession(options?: UseHostSessionOptions): HostSession {
  const settings = options?.settings ?? loadHostSettings();
  const createClient = options?.createClient;
  const enabled = settings.enabled === true && typeof settings.port === "number" && !!settings.token;
  /** Identity of the desired connection; null when the host is disabled. */
  const connKey = enabled ? `${settings.port}:${settings.token}` : null;

  const [plan, setPlanState] = useState<ExecutionPlan | null>(null);
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [route, setRoute] = useState<RouteDecisionState | null>(null);
  const [evidence, setEvidence] = useState<HostEvidence | null>(null);
  const [integrations] = useState<HostIntegrationsState>(EMPTY_INTEGRATIONS);
  // Connect lifecycle: the connection effect below writes this ONLY from
  // async promise callbacks (react-hooks/set-state-in-effect); `status` is
  // derived rather than stored.
  const [connectOutcome, setConnectOutcome] = useState<{ key: string; error: string | null } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const status: HostConnectionStatus = !connKey
    ? "off"
    : !connectOutcome || connectOutcome.key !== connKey
      ? "connecting"
      : connectOutcome.error
        ? "error"
        : "connected";

  const perms = useBrowserPermissions();

  const clientRef = useRef<HostClientLike | null>(null);
  const toolRunOwners = useRef(new Map<string, string>()); // toolId -> runId
  const pendingGrants = useRef(new Map<string, PendingGrant>()); // perm key -> grant
  // Latest-value refs keep the single host subscription stable (mounted once
  // per connection) while still reading fresh React state inside handlers.
  const latest = useRef({ perms, plan });
  useEffect(() => {
    latest.current = { perms, plan };
  });

  /* ------------------------- outbound helpers ------------------------- */

  const sendGrant = useCallback((runId: string, stepId: string, approved: boolean) => {
    const client = clientRef.current;
    if (!client) return;
    const p = approved ? client.grantApproval(runId, stepId) : client.denyApproval(runId, stepId);
    void p.catch(() => {
      /* host vanished mid-decision — the run.state/error stream surfaces it */
    });
  }, []);

  /**
   * Origin permission gate (Task 10): session/once grants resolve without a
   * prompt; anything else queues the grant behind the origin dialog.
   * Sensitive actions never take this path — they always prompt.
   */
  const requestOriginGrant = useCallback(
    (runId: string, stepId: string, origin: string, url?: string) => {
      const s = latest.current.perms.state;
      if (s.sessionAllowedOrigins.includes(origin)) {
        sendGrant(runId, stepId, true);
        return;
      }
      if (s.onceAllowedOrigins.includes(origin)) {
        // Route through the reducer so the one-shot grant is consumed (it
        // resolves silently, no prompt), then grant immediately.
        latest.current.perms.requestPermission({ kind: "origin", origin, url: url ?? origin });
        sendGrant(runId, stepId, true);
        return;
      }
      pendingGrants.current.set(originGrantKey(origin), { runId, stepId });
      latest.current.perms.requestPermission({ kind: "origin", origin, url: url ?? origin });
    },
    [sendGrant],
  );

  /* ------------------------- inbound events --------------------------- */

  const handleRunEvent = useCallback(
    (msg: Extract<HostMessage, { type: "run.event" }>) => {
      if (msg.event === HOST_RUN_EVENTS.browserOrigin) {
        const d = parseJsonDetail<{ origin?: unknown; url?: unknown }>(msg.detail);
        if (typeof d?.origin === "string" && d.origin) {
          requestOriginGrant(
            msg.runId,
            BROWSER_ORIGIN_STEP_PREFIX + d.origin,
            d.origin,
            typeof d.url === "string" ? d.url : undefined,
          );
        }
        return;
      }
      if (msg.event === HOST_RUN_EVENTS.browserSensitive) {
        const d = parseJsonDetail<{ action?: unknown; origin?: unknown; detail?: unknown }>(msg.detail);
        if (typeof d?.origin === "string" && d.origin && isSensitiveAction(d.action)) {
          // Sensitive actions ALWAYS prompt (reducer invariant) — an existing
          // origin grant must not auto-resolve this.
          pendingGrants.current.set(sensitiveGrantKey(d.action, d.origin), {
            runId: msg.runId,
            stepId: `${BROWSER_SENSITIVE_STEP_PREFIX}${d.action}@${d.origin}`,
          });
          latest.current.perms.requestPermission({
            kind: "sensitive",
            action: d.action,
            origin: d.origin,
            ...(typeof d.detail === "string" ? { detail: d.detail } : {}),
          });
        }
        return;
      }
      if (msg.event === HOST_RUN_EVENTS.routeDecision) {
        const d = parseJsonDetail<{
          decision?: unknown;
          pendingFallback?: unknown;
          preApprovedFallbacks?: unknown;
        }>(msg.detail);
        const decision = parseRouteDecision(d?.decision);
        if (decision) {
          setRoute({
            runId: msg.runId,
            decision,
            pendingFallback: typeof d?.pendingFallback === "string" ? d.pendingFallback : null,
            preApprovedFallbacks: Array.isArray(d?.preApprovedFallbacks)
              ? d.preApprovedFallbacks.filter((f): f is string => typeof f === "string")
              : [],
          });
        }
        return;
      }
      if (msg.event === HOST_RUN_EVENTS.visualEvidence) {
        const d = parseJsonDetail<{ assertions?: unknown; diff?: unknown }>(msg.detail);
        setEvidence({
          assertions: Array.isArray(d?.assertions) ? (d.assertions as VisualAssertionResult[]) : [],
          diff: (d?.diff ?? null) as VisualDiffResult | null,
        });
        return;
      }
      // Unknown run events are forward-compatible noise — ignore.
    },
    [requestOriginGrant],
  );

  const handleHostMessage = useCallback(
    (msg: HostMessage) => {
      switch (msg.type) {
        case "run.state":
          // Convention: runId === plan.id (see module docstring).
          setPlanState((prev) => {
            if (!prev || prev.id !== msg.runId) return prev;
            return {
              ...prev,
              state: msg.state,
              steps: prev.steps.map((s) => {
                const st = msg.stepStates?.[s.id];
                return isPlanStepStatus(st) ? { ...s, status: st } : s;
              }),
            };
          });
          break;
        case "tool.approval_required":
          toolRunOwners.current.set(msg.toolId, msg.runId);
          setToolRuns((prev) =>
            upsertToolRun(prev, {
              id: msg.toolId,
              executable: msg.executable,
              args: msg.args,
              cwd: msg.cwd,
              state: "approval_required",
              policyReason: msg.policyReason,
            }),
          );
          break;
        case "tool.output":
          toolRunOwners.current.set(msg.toolId, msg.runId);
          setToolRuns((prev) => {
            const existing = prev.find((t) => t.id === msg.toolId);
            // The host may stream output for auto-allowed tools that never
            // produced an approval_required frame — create the card lazily,
            // using the tool id as the display label in that case.
            const base: ToolRun =
              existing ?? { id: msg.toolId, executable: msg.toolId, args: [], cwd: "", state: "running" };
            return upsertToolRun(prev, {
              ...base,
              output: (base.output ?? "") + msg.chunk,
              ...(msg.state ? { state: msg.state } : {}),
              ...(msg.exitCode !== undefined ? { exitCode: msg.exitCode } : {}),
              ...(msg.truncated !== undefined ? { truncated: msg.truncated } : {}),
            });
          });
          break;
        case "run.event":
          handleRunEvent(msg);
          break;
        case "error":
          setLastError(`${msg.code}: ${msg.message}`);
          break;
      }
    },
    [handleRunEvent],
  );

  /* ------------------------- connection ------------------------------- */

  useEffect(() => {
    if (!connKey) return; // host disabled — nothing to connect, status derives to "off"
    const port = settings.port as number;
    const token = settings.token as string;
    const client = (createClient ?? ((o: { port: number; token: string }) => new HostClient(o)))({
      port,
      token,
    });
    clientRef.current = client;
    const unsubscribe = client.onEvent(handleHostMessage);
    let cancelled = false;
    // setState only inside these async callbacks — never synchronously in the
    // effect body (react-hooks/set-state-in-effect).
    client.connect().then(
      () => {
        if (cancelled) return;
        setConnectOutcome({ key: connKey, error: null });
        setLastError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setConnectOutcome({ key: connKey, error: message });
        setLastError(message);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
      client.close();
      clientRef.current = null;
    };
    // settings primitives only — a new settings object with the same values
    // must NOT reconnect.
  }, [connKey, settings.port, settings.token, createClient, handleHostMessage]);

  /* ------------------------- actions ---------------------------------- */

  const setPlan = useCallback((next: ExecutionPlan | null) => {
    setPlanState(next);
    if (!next) {
      // Run evidence belongs to a plan/run; clearing the plan clears it too.
      setEvidence(null);
      setRoute(null);
    }
  }, []);

  const approveStep = useCallback(
    (planId: string, stepId: string) => {
      const current = latest.current.plan;
      const step = current && current.id === planId ? current.steps.find((s) => s.id === stepId) : undefined;
      const origin = step ? browserScopeOrigin(step) : null;
      if (origin) {
        // Task 10: the approval of a browser step routes through the origin
        // permission prompt FIRST; the host grant follows the user's decision
        // (see decidePermission). Chat text never reaches this path — only
        // PlanPanel's explicit Approve button calls it.
        requestOriginGrant(planId, stepId, origin, origin);
        return;
      }
      sendGrant(planId, stepId, true);
    },
    [requestOriginGrant, sendGrant],
  );

  const runApproved = useCallback((planId: string) => {
    const current = latest.current.plan;
    const client = clientRef.current;
    if (!current || current.id !== planId || !client) return;
    // Convention: (re)submitting the approved plan starts/resumes its run.
    void client.submitPlan(current).catch(() => {});
  }, []);

  const pause = useCallback((planId: string) => {
    void clientRef.current?.pauseRun(planId).catch(() => {});
  }, []);

  const cancel = useCallback((planId: string) => {
    void clientRef.current?.cancelRun(planId).catch(() => {});
  }, []);

  const stopToolRun = useCallback((toolRunId: string) => {
    const client = clientRef.current;
    if (!client) return;
    // The protocol cancels whole runs; map the card back to its owning run.
    const runId = toolRunOwners.current.get(toolRunId) ?? toolRunId;
    void client.cancelRun(runId).catch(() => {});
  }, []);

  const decidePermission = useCallback(
    (decision: BrowserPermissionDecision) => {
      perms.decide(decision); // the reducer keeps the grants ledger
      const key =
        decision.kind === "origin"
          ? originGrantKey(decision.origin)
          : sensitiveGrantKey(decision.action, decision.origin);
      const pend = pendingGrants.current.get(key);
      pendingGrants.current.delete(key);
      if (!pend) return; // prompt had no host grant attached (defensive)
      const approved = decision.kind === "origin" ? decision.decision !== "deny" : decision.approved;
      sendGrant(pend.runId, pend.stepId, approved);
    },
    [perms, sendGrant],
  );

  // Task 14: no integration protocol frames exist yet — toggles are no-ops.
  const noopToggle = useCallback(() => {}, []);

  /* ------------------------- derived props ---------------------------- */

  const routeDecision: RouteDecisionCardProps | null = route
    ? {
        decision: route.decision,
        pendingFallback: route.pendingFallback,
        preApprovedFallbacks: route.preApprovedFallbacks,
        onApproveFallback: (modelId) => sendGrant(route.runId, ROUTE_FALLBACK_STEP_PREFIX + modelId, true),
        onRejectFallback: (modelId) => sendGrant(route.runId, ROUTE_FALLBACK_STEP_PREFIX + modelId, false),
      }
    : null;

  const api: HostSession = {
    enabled,
    status,
    // a stale error from a previous connection must not surface once disabled
    lastError: connKey ? lastError : null,
    plan,
    toolRuns,
    routeDecision,
    integrations,
    evidence,
    permissionPending: perms.pending,
    setPlan,
    approveStep,
    runApproved,
    pause,
    cancel,
    stopToolRun,
    decidePermission,
    toggleRulesPack: noopToggle,
    toggleSkill: noopToggle,
    toggleMcpServer: noopToggle,
  };

  const onApi = options?.onApi;
  useEffect(() => {
    onApi?.(api);
  });

  return api;
}

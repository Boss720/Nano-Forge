# NanoForge: LLM Router Subsystem Architecture (`packages/llm-router`)

**Document Version:** 1.0.0  
**Status:** Approved Architecture Blueprint  
**Subsystem:** `@nanoforge/llm-router` (Layer 1 Monorepo Package)

---

## 1. Executive Summary & Design Principles

The `packages/llm-router` package provides a vendor-independent, capability-floor model orchestration layer for NanoForge. It decouples the agent runtime from specific model APIs, automatically selects the most economical model capable of satisfying a given task's complexity floor, tracks provider rate limits and quotas in real time, and facilitates transparent failover without conversational context replay.

### 1.1 Core Principles

1. **Free-First Economy:** Local inference (Ollama) and zero-cost cloud tiers (Gemini free, Groq free, OpenRouter free) are prioritized by default. Paid models are gated and require explicit user authorization.
2. **Capability-Floor Routing:** Tasks are matched to the least scarce/least expensive model meeting the required capability threshold, reserving high-capability models (Tier 3) for deep reasoning and system architecture.
3. **Model-Independent State & Compact Handoff:** Agent state (`AgentState`) is stored independently of any LLM provider's message history. On model switches or rate limits, compact markdown handoffs resume execution without token-wasting transcript replays.
4. **Zero-Circular-Dependency Monorepo Position:**
   ```
   Layer 0: @nanoforge/protocol
      │
      ▼
   Layer 1: @nanoforge/llm-router
      │                  │
      ▼                  ▼
   Layer 2: @nanoforge/core   Layer 2: @nanoforge/agent-host
      │                  │
      └─────────┬────────┘
                ▼
   Layer 3: @nanoforge/sdk
   ```

---

## 2. Universal Provider Contract (`LLMProvider`)

Every LLM backend implements a normalized `LLMProvider` interface, insulating the rest of NanoForge from vendor-specific REST or WebSocket protocols.

### 2.1 Interface Definition

```typescript
export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  
  /** Discover available models and current capabilities. */
  listModels(): Promise<ModelDescriptor[]>;
  
  /** Probe provider availability and network liveness. */
  healthCheck(): Promise<ProviderHealth>;
  
  /** Execute non-streaming completion. */
  generate(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
  
  /** Execute streaming completion emitting normalized deltas. */
  stream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMEvent>;
  
  /** Optional quota and rate limit status probe. */
  getQuota?(): Promise<QuotaState>;
}
```

### 2.2 Normalized Types

#### `ModelDescriptor` Catalog Schema
```typescript
export type Availability = "available" | "degraded" | "unavailable" | "unknown";

export interface Pricing {
  inputCostPer1k: number;
  outputCostPer1k: number;
  isFree: boolean;
  currency: "USD";
}

export interface ModelDescriptor {
  providerId: string;
  modelId: string;
  displayName: string;
  availability: Availability;
  pricing: Pricing;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: {
    coding: boolean;
    reasoning: boolean;
    vision: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
    streaming: boolean;
  };
  estimatedQuality: {
    coding: number;         // 0.0 - 1.0
    reasoning: number;      // 0.0 - 1.0
    debugging: number;      // 0.0 - 1.0
    planning: number;       // 0.0 - 1.0
    summarization: number;  // 0.0 - 1.0
    classification: number; // 0.0 - 1.0
  };
  runtime: {
    latency: number;
    tokensPerSecond: number;
    successRate: number;
    recentFailures: number;
    rateLimitedUntil: number | null;
    remainingQuota: number | null; // null if unknown; NEVER fabricate
  };
}
```

#### Streaming Events (`LLMEvent`)
```typescript
export type LLMEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "error" };
```

#### Normalized Error Hierarchy (`LLMProviderError`)
```typescript
export class LLMProviderError extends Error {
  constructor(
    public readonly code:
      | "RATE_LIMIT"
      | "TIMEOUT"
      | "INVALID_TOOL_CALL"
      | "CONTEXT_TOO_LARGE"
      | "LOW_CONFIDENCE"
      | "TEST_FAILURE"
      | "MALFORMED_OUTPUT"
      | "PROVIDER_OFFLINE"
      | "AUTHENTICATION_ERROR"
      | "QUOTA_EXHAUSTED",
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMProviderError";
  }
}
```

---

## 3. Provider Adapters

### 3.1 Local Inference Adapter: Ollama (`ollama.ts`)
- **Transport:** HTTP JSON / NDJSON.
- **Base URL:** Configurable (`http://127.0.0.1:11434`).
- **Discovery:** `GET /api/tags` enumerates locally installed models and tags capabilities (e.g. `qwen2.5-coder` receives `coding: true, reasoning: true`).
- **Generation & Streaming:** `POST /api/chat` with `stream: true` reads line-delimited JSON chunks.
- **Tool Calling:** Employs Ollama's native tool calling payload format.
- **Resilience:** Probes `GET /api/version` with a 1500ms timeout. If offline (`ECONNREFUSED`), the adapter transitions to `PROVIDER_OFFLINE` gracefully without crashing the daemon.

### 3.2 Cloud Adapters

#### Google Gemini Adapter (`gemini.ts`)
- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model}:{action}?key={apiKey}`.
- **Wire Mapping:** System prompts map to `systemInstruction`, user/assistant history maps to `contents` (`user` vs `model`), and tools map to `functionDeclarations`.
- **Rate Limit Handling:** HTTP 429 (`RESOURCE_EXHAUSTED`) is mapped to `LLMProviderError('RATE_LIMIT')` with exponential backoff.

#### Groq Fast Inference Adapter (`groq.ts`)
- **Endpoint:** `https://api.groq.com/openai/v1/chat/completions`.
- **Wire Mapping:** OpenAI-compatible SSE format with ultra-low latency streaming.
- **Quota Tracking:** Parses `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, and `retry-after` response headers directly into the model's runtime metadata.

#### OpenRouter Aggregator Adapter (`openrouter.ts`)
- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions`.
- **Attribution Headers:** Sends `HTTP-Referer: https://nanoforge.dev` and `X-Title: NanoForge`.
- **Free Catalog:** Filters dynamic model catalogs for models with the `:free` suffix (e.g. `meta-llama/llama-3.1-8b-instruct:free`).

#### Generic OpenAI-Compatible Adapter (`openaiCompatible.ts`)
- **Endpoint:** Configurable `baseUrl` (e.g. LM Studio `http://127.0.0.1:1234/v1`, vLLM, LocalAI).
- **Wire Mapping:** Standard `/v1/models` and `/v1/chat/completions` SSE streams.

---

## 4. Model Registry & Dynamic Quota Tracking

### 4.1 Model Tiers

Models are classified into four architectural tiers:
- **Tier 0 (Local / Zero Scarcity):** Local Ollama models (`qwen2.5-coder:7b`, `llama3.2`). Zero cost, offline capable, maximum privacy.
- **Tier 1 (Cheap / Abundant Free):** Gemini Flash Lite (free tier), Groq free tier. High throughput, low latency.
- **Tier 2 (Strong Free):** Gemini Flash, OpenRouter high-capability free models. Competent coding and multi-step reasoning.
- **Tier 3 (Scarce High-Capability):** Gemini Pro, Claude 3.5 Sonnet, GPT-4o. Reserved for system architecture, complex multi-file refactoring, and critical security audits.

### 4.2 Dynamic Health & Cooldown State Machine

The registry maintains a dynamic status for each model descriptor:
- `HEALTHY`: Normal operations.
- `DEGRADED`: High latency (>3x baseline) or intermittent failures (<80% success).
- `RATE_LIMITED`: Actively cooling down from HTTP 429.
- `OFFLINE`: Daemon unreachable or network unavailable.

**Cooldown Strategy:** On HTTP 429, the router sets `rateLimitedUntil = Date.now() + cooldownMs`. Cooldowns scale exponentially on repeated hits (5s $\to$ 15s $\to$ 60s $\to$ 300s). The model is temporarily excluded from candidate pools until cooldown expiration.

### 4.3 Quota Tracking & Non-Fabrication Rule

- If a provider exposes quota headers (Groq, OpenRouter), the values are recorded in `runtime.remainingQuota`.
- If a provider does NOT expose quota headers, `runtime.remainingQuota` is explicitly set to `null`. NanoForge strictly prohibits fabricating fake quota numbers.
- **Scarcity Calculation:**
  $$\text{ScarcityPenalty} = \begin{cases} 0 & \text{if abundant, local, or unknown} \\ \frac{\text{Limit} - \text{Remaining}}{\text{Limit}} \times 20 & \text{if remaining is known} \end{cases}$$

---

## 5. Task Classification & Capability-Floor Router

### 5.1 Complexity Classes & Capability Floors

Incoming tasks are evaluated by the `TaskClassifier`:
1. `TRIVIAL` (Floor: 0.1): Variable renaming, formatting, simple file existence checks.
2. `LIGHT` (Floor: 0.3): Documentation lookups, simple edits, basic summarization.
3. `STANDARD` (Floor: 0.6): Single-file feature implementation, unit test authoring, standard bug fixing.
4. `COMPLEX` (Floor: 0.8): Multi-file refactoring, race condition debugging, architectural planning.
5. `CRITICAL` (Floor: 0.9): Security auditing, system architecture design, mission-critical integration.

### 5.2 Deterministic Economy Scoring Engine

Candidate selection follows a two-stage evaluation:

#### Stage 1: Hard Invariant Filter
A candidate is excluded if:
- Provider is `OFFLINE` or in active `RATE_LIMITED` cooldown.
- Task requires local privacy (`privacyRequired === "local"`) and candidate is cloud-hosted.
- Task requires vision (`needsVision === true`) and candidate lacks `capabilities.vision`.
- Task requires tools and candidate lacks `capabilities.toolCalling`.
- Estimated prompt + output tokens exceed candidate's `contextWindow`.
- Candidate's quality score falls below the task's complexity floor.
- Model is paid and `allowPaidFallback` is `false`.

#### Stage 2: Scoring Formula
Eligible models are scored using a deterministic formula:
$$\text{Score} = (\text{Quality} \times 40) + (\text{Reliability} \times 15) + (\text{Speed} \times 10) + (\text{FreeBonus} \times 25) - \text{ScarcityPenalty} - \text{LatencyPenalty}$$

Where:
- $\text{FreeBonus} = 25$ if `pricing.isFree === true`, else $0$.
- $\text{LatencyPenalty} = \min(15, \frac{\text{typicalLatencyMs}}{1000} \times 2)$.

**Tie-Breaking:** Score (descending) $\to$ Cost (ascending) $\to$ Model ID (alphabetical).

---

## 6. Model-Independent AgentState & Compact Handoff

### 6.1 `AgentState` Schema

To decouple execution state from provider chat history, `AgentState` captures task progress structurally:

```typescript
export interface AgentState {
  objective: string;
  requirements: string[];
  constraints: string[];
  repositorySummary: string;
  plan: {
    pending: PlanTask[];
    active: PlanTask[];
    completed: PlanTask[];
    failed: PlanTask[];
  };
  decisions: Array<{ id: string; decision: string; rationale: string; at: string }>;
  relevantFiles: string[];
  changes: Array<{ path: string; action: "created" | "modified" | "deleted"; sha256: string }>;
  toolResults: Array<{ toolId: string; status: "success" | "error"; summary: string }>;
  tests: Array<{ suite: string; passed: number; failed: number; errors?: string[] }>;
  errors: Array<{ code: string; message: string; fatal: boolean }>;
  modelHistory: Array<{ modelId: string; tokensUsed: number; costUsd: number }>;
}
```

### 6.2 Compact Handoff Packet (`handoff.ts`)

When switching models or failing over from a rate limit, the router generates a structured markdown handoff packet rather than replaying full chat history:

```markdown
# TASK HANDOFF REPORT

## OBJECTIVE
[Original user objective and constraints]

## COMPLETED
- Step 1: Validated repository structure
- Step 2: Implemented provider interface in packages/llm-router/src/providers/types.ts

## CURRENT TASK
- Step 3: Implement Ollama local provider adapter

## RELEVANT FILES
- packages/llm-router/src/providers/types.ts (Modified, SHA: 8a7f...)
- packages/llm-router/src/providers/ollama.ts (Created)

## DECISIONS MADE
- Enforced NDJSON line streaming parser for Ollama chat endpoint.
- Free-first routing enabled; paid cloud fallback disabled.

## KNOWN FAILURES & COOLDOWNS
- gemini-2.0-flash-lite experienced HTTP 429 rate limit (cooling down for 60s).

## NEXT ACTION
- Author unit tests in packages/llm-router/src/providers/ollama.test.ts verifying offline ECONNREFUSED handling.
```

### 6.3 Automated HTTP 429 Failover Lifecycle

```
[Agent Step N: Model A (Gemini)]
           │
           ▼
HTTP 429 Resource Exhausted
           │
           ▼
[Router Error Handler]
├── Mark Model A "RATE_LIMITED" (cooldown = 15s)
├── Generate Compact Handoff from AgentState
├── Select Best Alternate Candidate -> Model B (Groq / Ollama)
           │
           ▼
[Agent Step N: Model B (Fallback)]
├── Receives Compact Handoff Packet
├── Executes Step N successfully
└── Run proceeds with ZERO state loss and ZERO task restart
```

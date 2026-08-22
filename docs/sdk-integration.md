# NanoForge Programmatic SDK Integration Guide

> Authoritative guide for embedding `@nanoforge/sdk` into `nano-gpt.com` and distributed backend services.

---

## 1. Overview & Architecture

NanoForge provides `@nanoforge/sdk` to allow programmatic control over local and remote NanoForge agent host daemons. The SDK enables `nano-gpt.com` web applications, background workers, and CI runners to:

1. **Orchestrate Autonomous Agents**: Generate and submit DAG execution plans.
2. **Stream Real-time Tool Outputs**: Consume incremental stdout/stderr streams and state transitions via standard TypeScript `AsyncIterable<RunEvent>`.
3. **Enforce Interactive Policy Gates**: Intercept dangerous commands and prompt users for approvals or apply rule-based automated policies.
4. **Manage Multi-Agent Swarms**: Spawn, monitor, and coordinate subagent trees (up to 3 levels of depth).
5. **Supervise Long-Running Daemons & Timers**: Manage background tasks with execution timeouts and circular ring buffers.

---

## 2. Server-Side Integration (`nano-gpt.com` Backend)

### 2.1 Establishing Daemon Connections

```typescript
import { NanoForgeClient } from "@nanoforge/sdk";

export class AgentHostManager {
  private client: NanoForgeClient;

  constructor(hostPort = 4040, token: string) {
    this.client = new NanoForgeClient({
      hostUrl: `ws://127.0.0.1:${hostPort}/agent`,
      token,
      autoReconnect: true,
      maxReconnectAttempts: 10,
      timeoutMs: 15000,
    });
  }

  public async initialize(): Promise<void> {
    await this.client.connect();
    console.log("[nano-gpt] Successfully connected to NanoForge Agent Host daemon.");
  }

  public getClient(): NanoForgeClient {
    return this.client;
  }
}
```

### 2.2 Streaming Agent Execution to HTTP/SSE Clients

```typescript
import { Request, Response } from "express";
import { NanoForgeClient, SubmittedPlan } from "@nanoforge/sdk";

export async function handleAgentRunStream(
  client: NanoForgeClient,
  plan: SubmittedPlan,
  res: Response
) {
  // Set Server-Sent Events (SSE) headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    for await (const event of client.streamRun(plan)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}
```

---

## 3. Client-Side Integration (Browser / Workbench)

### 3.1 Direct WebSocket Control Plane

```typescript
import { NanoForgeClient } from "@nanoforge/sdk";

export async function initializeWorkbenchSession() {
  const client = new NanoForgeClient({
    hostUrl: "ws://127.0.0.1:4040/agent",
    token: sessionStorage.getItem("nanoforge_token") || undefined,
  });

  await client.connect();

  // Listen for tool approval requests
  client.on("approval_required", (req) => {
    const userApproved = window.confirm(
      `Agent requests execution of "${req.request.executable}". Reason: ${req.reason}. Allow?`
    );
    if (userApproved) {
      void client.grantApproval(req.requestId);
    } else {
      void client.denyApproval(req.requestId, "User declined execution");
    }
  });

  return client;
}
```

---

## 4. Subagent Swarms & Multi-Agent Workflows

### 4.1 Spawning Subagents Programmatically

```typescript
// Define and spawn a specialized specialist subagent
const subagent = await client.invokeSubagent({
  name: "security_auditor",
  archetype: "specialist",
  task: "Scan codebase for hardcoded API keys and credentials",
  isolation: "inherit",
  budgetTokens: 50000,
  timeoutSeconds: 300,
});

console.log(`Subagent spawned: ${subagent.id} (State: ${subagent.state})`);
```

### 4.2 Inter-Agent Message Routing

```typescript
// Send coordination message from supervisor to subagent
await client.sendMessage(
  {
    recipientId: subagent.id,
    content: "Please prioritize src/lib/nanogpt.ts in your scan.",
  },
  "supervisor-main"
);
```

---

## 5. Security & Isolation Invariants

When integrating `@nanoforge/sdk`:

1. **Origin Verification**: The Fastify Agent Host daemon enforces strict loopback origin validation. Third-party web origins are rejected with close code `4401`.
2. **Token Rotation**: Pass single-use 192-bit base64url crypto tokens per session.
3. **Workspace Confinement**: Operations outside the workspace root are blocked with `SecurityError`.
4. **Subagent Depth Limits**: Subagent creation exceeding 3 tiers is blocked with `SEC-SUB-05`.
5. **Approval Gates**: Mutating commands require explicit `client.grantApproval(requestId)`.

---

## 6. Testing & CI Integration

Run the SDK unit tests:

```bash
pnpm run test:sdk
```

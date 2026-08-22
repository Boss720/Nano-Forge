# @nanoforge/sdk

> Isomorphic programmatic TypeScript client SDK for NanoForge Agent Host

`@nanoforge/sdk` provides a typed, async-stream-first interface for connecting to the NanoForge agent host daemon, dispatching DAG execution plans, streaming real-time run events, managing tool approval gates, and orchestrating subagent swarms.

---

## Installation

```bash
pnpm add @nanoforge/sdk
# or
npm install @nanoforge/sdk
```

---

## Quickstart

```typescript
import { NanoForgeClient } from "@nanoforge/sdk";

// 1. Initialize the client
const client = new NanoForgeClient({
  hostUrl: "ws://127.0.0.1:4040/agent",
  token: process.env.NANOFORGE_TOKEN,
  autoReconnect: true,
});

// 2. Connect to the agent host
await client.connect();

// 3. Create an agent session
const session = await client.createSession({
  title: "Database Migration",
  model: "kimi-k2-0905",
});

// 4. Stream real-time run execution
const plan = {
  id: "plan-migration-01",
  goal: "Add UUID column to users table and update schema",
  steps: [
    { id: "step-1", title: "Analyze schema", action: "inspect schema.sql" },
    { id: "step-2", title: "Apply migration", action: "run migration script", approvalRequired: true },
    { id: "step-3", title: "Verify migration", action: "run tests", dependsOn: ["step-2"] },
  ],
};

for await (const event of session.streamRun(plan)) {
  if (event.type === "tool.output") {
    console.log(`[${event.stream}]:`, event.chunk);
  } else if (event.type === "run.state") {
    console.log(`State transition: ${event.state}`);
  }
}
```

---

## Core API Reference

### `NanoForgeClient`

#### Constructor Options: `NanoForgeClientOptions`
- `hostUrl: string` (required): WebSocket / HTTP endpoint of the agent host (e.g. `ws://127.0.0.1:4040/agent`).
- `token?: string`: 192-bit cryptographic authentication token.
- `autoReconnect?: boolean`: Automatically reconnect on unexpected disconnects (default: `false`).
- `reconnectIntervalMs?: number`: Reconnection backoff interval (default: `1000ms`).
- `maxReconnectAttempts?: number`: Maximum reconnection attempts (default: `5`).
- `timeoutMs?: number`: Timeout for synchronous RPC operations (default: `10000ms`).

#### Connection Methods
- `client.connect(): Promise<void>`: Establishes the WebSocket connection and verifies authentication.
- `client.disconnect(): Promise<void>`: Gracefully terminates the connection.
- `client.isConnected(): boolean`: Returns `true` if WebSocket connection is open.
- `client.ping(): Promise<number>`: Sends a ping frame and returns round-trip latency in ms.

#### Execution & Streaming
- `client.createSession(options?: SessionOptions): Promise<AgentSession>`: Creates a managed agent session.
- `client.getSession(sessionId: string): AgentSession | undefined`: Retrieves an active session by ID.
- `client.submitPlan(plan: SubmittedPlan | ExecutionPlan): Promise<string>`: Submits an execution plan.
- `client.streamRun(plan: SubmittedPlan | ExecutionPlan): AsyncIterable<RunEvent>`: Submits and streams real-time events.

#### Tool Approvals & Policy Gates
- `client.grantApproval(requestId: string): Promise<void>`: Grants approval for a paused tool execution.
- `client.denyApproval(requestId: string, reason?: string): Promise<void>`: Denies tool execution.
- `client.sendToolResponse(requestId: string, approved: boolean, reason?: string): Promise<void>`: Sends structured decision.

#### Workspace Operations
- `client.readDir(path: string): Promise<WorkspaceDirEntry[]>`
- `client.readFile(path: string): Promise<{ content: string; language: string; size: number }>`
- `client.writeFile(path: string, content: string): Promise<boolean>`
- `client.stat(path: string): Promise<WorkspaceFileStat>`
- `client.search(query: string, options?: SearchOptions): Promise<SearchMatch[]>`
- `client.gitStatus(): Promise<GitFileStatus[]>`

#### Subagent Swarm Operations
- `client.invokeSubagent(params, parentId?)`
- `client.manageSubagents(params, callerId?)`
- `client.sendMessage(params, senderId)`
- `client.defineSubagent(params)`

#### Background Daemons & Scheduling
- `client.manageTask(params)`
- `client.createSchedule(params, creatorSubagentId?)`

#### Memory & State Store
- `client.setMemory(params, authorInfo?)`
- `client.getMemory(params)`
- `client.queryMemory(params)`
- `client.deleteMemory(params)`

---

## Event Subscriptions

`NanoForgeClient` implements a type-safe event emitter:

```typescript
client.on("connect", () => console.log("Connected to host"));
client.on("disconnect", ({ code, reason }) => console.log(`Disconnected (${code}): ${reason}`));
client.on("error", (err) => console.error("Client error:", err));

client.on("approval_required", async (req: ToolCallRequest) => {
  console.log(`Approval required for tool ${req.request.executable}: ${req.reason}`);
  if (req.request.executable === "git") {
    await client.grantApproval(req.requestId);
  } else {
    await client.denyApproval(req.requestId, "Untrusted executable");
  }
});
```

---

## Error Handling

The SDK defines strongly typed error classes:

- `NanoForgeError`: Base error class.
- `ConnectionError`: Network / socket connection failure.
- `AuthenticationError`: Invalid or expired authentication token (Code 4401).
- `ProtocolError`: Protocol schema or wire violation (Code 4400).
- `TimeoutError`: Synchronous RPC timeout.
- `ApprovalDeniedError`: Tool approval rejected by policy or user.

---

## License

Private & Proprietary. All rights reserved.

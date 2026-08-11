/**
 * Authenticated local agent host — Module 2, Task 4.
 *
 * Loopback-only Fastify server. The browser control plane connects over a
 * single-use authenticated WebSocket:
 *   ws://127.0.0.1:<ephemeral-port>/agent?token=<single-use-token>
 *
 * Security contract enforced here:
 * - binds ONLY 127.0.0.1, on an ephemeral port by default;
 * - cryptographic tokens, each consumable exactly once (`tokenStore.consume`);
 * - missing / malformed / unknown / reused tokens close the socket with 4401;
 * - every inbound frame is validated against the Zod protocol (protocol.ts);
 *   violations close the socket with 4400.
 *
 * `createHost()` is the test/programmatic factory. Executed directly
 * (`npm run start:host` / tsx) it reads PORT and TOKEN from the environment
 * (generating an ephemeral port and a fresh token when unset) and prints the
 * connection URL.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { attachAgentSession, type AgentSessionOptions } from "./session";
import {
  decodeClientMessage,
  type HostMessage,
  type RunState,
} from "./protocol";

export const HOST_VERSION = "0.1.0";

/** WebSocket close codes used by this host. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_INVALID_MESSAGE = 4400;

/** Tokens are 192-bit random values, base64url-encoded (32 chars). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const TOKEN_BYTES = 24;

/* ------------------------------------------------------------------------ */
/* Single-use token store                                                   */
/* ------------------------------------------------------------------------ */

export interface TokenStore {
  /** Mint a fresh single-use token and register it. */
  issue(): string;
  /** Register an externally supplied token; rejects malformed values. */
  register(token: string): string;
  /**
   * Consume a token: returns true exactly once for a registered token, then
   * never again. Malformed, unknown, or reused tokens return false.
   */
  consume(token: unknown): boolean;
  /** Number of currently outstanding (unconsumed) tokens. */
  readonly size: number;
}

export function createTokenStore(maxOutstanding = 64): TokenStore {
  const outstanding = new Set<string>();
  return {
    issue() {
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      return this.register(token);
    },
    register(token: string) {
      if (!TOKEN_PATTERN.test(token)) {
        throw new Error("refusing to register a malformed token");
      }
      if (outstanding.size >= maxOutstanding) {
        const oldest = outstanding.values().next().value;
        if (oldest !== undefined) outstanding.delete(oldest);
      }
      outstanding.add(token);
      return token;
    },
    consume(token: unknown) {
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
      if (!outstanding.has(token)) return false;
      outstanding.delete(token);
      return true;
    },
    get size() {
      return outstanding.size;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Host factory                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Protocol attachment: installs the message loop on an authenticated socket.
 * The default is the wave-1 scaffold ({@link attachAgentProtocol}); the
 * Task 20 composition (`composition.ts`) injects a RunCoordinator-backed
 * session through this seam instead.
 */
export type ProtocolAttachment = (
  socket: WebSocket,
  context: { hostId: string },
) => void;

export interface HostOptions {
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Pre-shared token (e.g. from env); a fresh one is generated otherwise. */
  token?: string;
  /** Enable Fastify's logger. */
  logger?: boolean;
  /** Authenticated-socket handler; defaults to {@link attachAgentProtocol}. */
  attach?: ProtocolAttachment;
  /** Configuration for the real coordinator/workspace session. */
  session?: AgentSessionOptions;
}

export interface HostHandle {
  app: FastifyInstance;
  /** Actual bound port (resolved after listen). */
  port: number;
  /** The single-use token for the first connection. */
  token: string;
  /** Token store (tests mint extra tokens via `tokenStore.issue()`). */
  tokenStore: TokenStore;
  /** Stable id of this host instance, sent in `host.ready`. */
  hostId: string;
  /** Close all sockets and shut the server down. */
  close(): Promise<void>;
}

export async function createHost(options: HostOptions = {}): Promise<HostHandle> {
  const app = Fastify({ logger: options.logger ?? false });
  const tokenStore = createTokenStore();
  const token =
    options.token !== undefined
      ? tokenStore.register(options.token)
      : tokenStore.issue();
  const hostId = randomUUID();
  const sockets = new Set<WebSocket>();

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, version: HOST_VERSION }));

  app.get("/agent", { websocket: true }, (socket, req) => {
    const queryToken = new URL(req.url ?? "/agent", "http://127.0.0.1")
      .searchParams.get("token");
    if (!tokenStore.consume(queryToken)) {
      socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    if (options.attach) {
      options.attach(socket, { hostId });
    } else {
      attachAgentSession(socket, { hostId }, options.session);
    }
  });

  await app.listen({ host: "127.0.0.1", port: options.port ?? 0 });
  const address = app.server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : (options.port ?? 0);

  return {
    app,
    port,
    token,
    tokenStore,
    hostId,
    async close() {
      for (const socket of sockets) {
        try {
          socket.terminate();
        } catch {
          /* already closed */
        }
      }
      await app.close();
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Protocol attachment                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Minimal validated message loop. The full run coordinator arrives in Task
 * 18; this scaffold accepts `plan.submit` (queues a run and reports
 * `run.state`), answers `ping`, acknowledges pause/cancel via `run.event`,
 * and enforces the protocol contract on every frame.
 */
export function attachAgentProtocol(
  socket: WebSocket,
  context: { hostId: string },
): void {
  const runStates = new Map<string, RunState>();

  const send = (message: HostMessage): void => {
    const payload = JSON.stringify(message);
    // The ws socket may still be CONNECTING when the route handler runs;
    // queue the frame until the upgrade completes instead of dropping it.
    if (socket.readyState === socket.OPEN) socket.send(payload);
    else socket.once("open", () => socket.send(payload));
  };
  const now = () => new Date().toISOString();

  send({ type: "host.ready", version: HOST_VERSION, hostId: context.hostId, at: now() });

  socket.on("message", (data: unknown) => {
    const decoded = decodeClientMessage(data);
    if (!decoded.ok) {
      socket.close(CLOSE_INVALID_MESSAGE, "invalid message");
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case "ping":
        send({ type: "pong", at: now() });
        break;
      case "plan.submit": {
        const runId = randomUUID();
        runStates.set(runId, "queued");
        send({ type: "run.state", runId, state: "queued", at: now() });
        break;
      }
      case "run.pause":
      case "run.resume":
      case "run.cancel": {
        const known = runStates.has(message.runId);
        if (message.type === "run.cancel" && known) {
          runStates.set(message.runId, "cancelled");
          send({
            type: "run.state",
            runId: message.runId,
            state: "cancelled",
            at: now(),
          });
        } else {
          send({
            type: "run.event",
            runId: message.runId,
            event: known ? `${message.type}.requested` : "unknown_run",
            at: now(),
          });
        }
        break;
      }
      case "approval.grant":
      case "approval.deny":
      case "tool.response":
        // Consumed by the run coordinator (Task 18); validated here only.
        break;
    }
  });
}

/* ------------------------------------------------------------------------ */
/* Standalone entry point                                                   */
/* ------------------------------------------------------------------------ */

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const host = await createHost({
    port: process.env.PORT ? Number(process.env.PORT) : 0,
    token: process.env.TOKEN,
    logger: true,
  });
  console.log(
    `agent-host v${HOST_VERSION} listening: ws://127.0.0.1:${host.port}/agent?token=${host.token}`,
  );
}

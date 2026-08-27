import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkspaceActivateResult,
  WorkspaceChooseResult,
  WorkspaceRecentListResult,
} from "@protocol/workspace";
import { WorkspaceBrokerClient, WorkspaceBrokerError } from "@/lib/workspaceBrokerClient";

export type WorkspaceBrokerClientLike = Pick<WorkspaceBrokerClient, "activate" | "choose" | "listRecents">;

export interface WorkspaceBrokerMetadata {
  /** The loopback launcher origin hosting the broker HTTP routes. Ephemeral; never persist it. */
  baseUrl?: string;
  token?: string;
  generation?: number;
}

export interface WorkspaceBrokerState {
  status: "ready" | "connecting" | "unavailable" | "unsupported";
  message?: string;
}

export interface UseWorkspaceBrokerOptions {
  /** Injectable for tests and future host-session handoff wiring. */
  client?: WorkspaceBrokerClientLike;
  /** Ephemeral launcher metadata. When omitted, the current launcher URL is inspected. */
  metadata?: WorkspaceBrokerMetadata | null;
}

function launcherMetadataFromLocation(): WorkspaceBrokerMetadata | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const token = query.get("token");
  // A token on its own is not enough: hostPort is the launcher contract and
  // avoids treating arbitrary embedded pages as privileged local launchers.
  if (!token || !query.get("hostPort")) return null;
  return { baseUrl: window.location.origin, token };
}

function brokerErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceBrokerError && error.code === "picker_cancelled") return "Folder selection cancelled.";
  if (error instanceof Error) return error.message;
  return "The local folder service could not complete that request.";
}

export function useWorkspaceBroker(options: UseWorkspaceBrokerOptions = {}) {
  const metadata = options.metadata === undefined ? launcherMetadataFromLocation() : options.metadata;
  const brokerBaseUrl = metadata?.baseUrl ?? "";
  const brokerToken = metadata?.token ?? "";
  const client = useMemo<WorkspaceBrokerClientLike | null>(() => {
    if (options.client) return options.client;
    if (!brokerToken || !brokerBaseUrl) return null;
    return new WorkspaceBrokerClient({ baseUrl: brokerBaseUrl, token: brokerToken });
  }, [brokerBaseUrl, brokerToken, options.client]);
  const [state, setState] = useState<WorkspaceBrokerState>(() => client
    ? { status: "ready" }
    : { status: "unsupported", message: "Open local folders from the NanoForge launcher." });
  const [recents, setRecents] = useState<WorkspaceRecentListResult["workspaces"]>([]);

  useEffect(() => {
    setState(client ? { status: "ready" } : { status: "unsupported", message: "Open local folders from the NanoForge launcher." });
  }, [client]);

  const listRecents = useCallback(async () => {
    if (!client) return [];
    try {
      const result = await client.listRecents();
      setRecents(result.workspaces);
      return result.workspaces;
    } catch (error) {
      setState({ status: "unavailable", message: brokerErrorMessage(error) });
      return [];
    }
  }, [client]);

  useEffect(() => { void listRecents(); }, [listRecents]);

  const choose = useCallback(async (): Promise<WorkspaceChooseResult | null> => {
    if (!client) {
      setState({ status: "unsupported", message: "Open local folders from the NanoForge launcher." });
      return null;
    }
    setState({ status: "connecting", message: "Waiting for the folder picker…" });
    try {
      const result = await client.choose();
      setState({ status: "ready" });
      void listRecents();
      return result;
    } catch (error) {
      const cancelled = error instanceof WorkspaceBrokerError && error.code === "picker_cancelled";
      setState(cancelled ? { status: "ready", message: "Folder selection cancelled." } : { status: "unavailable", message: brokerErrorMessage(error) });
      return null;
    }
  }, [client, listRecents]);

  const activate = useCallback(async (workspaceId: string): Promise<WorkspaceActivateResult | null> => {
    if (!client) {
      setState({ status: "unsupported", message: "Open local folders from the NanoForge launcher." });
      return null;
    }
    setState({ status: "connecting", message: "Opening local folder…" });
    try {
      const result = await client.activate(workspaceId);
      setState({ status: "ready" });
      void listRecents();
      return result;
    } catch (error) {
      setState({ status: "unavailable", message: brokerErrorMessage(error) });
      return null;
    }
  }, [client, listRecents]);

  return { available: client !== null, state, recents, choose, activate, listRecents };
}

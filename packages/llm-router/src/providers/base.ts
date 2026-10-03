/**
 * @file packages/llm-router/src/providers/base.ts
 * Base LLM provider abstraction and standardized error handler.
 */

import {
  LLMEvent,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ProviderHealth,
  QuotaState,
} from "../types.js";
import {
  ProviderError,
  ProviderUnavailableError,
  TimeoutError,
  mapHttpError,
} from "../errors.js";

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

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract listModels(): Promise<ModelDescriptor[]>;
  abstract healthCheck(): Promise<ProviderHealth>;
  abstract generate(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
  abstract stream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMEvent>;

  getQuota?(): Promise<QuotaState>;

  /**
   * Helper to normalize network/fetch errors into standard ProviderError subclasses.
   */
  public handleError(err: unknown): ProviderError {
    if (err instanceof ProviderError) {
      return err;
    }

    // Check if error contains HTTP status
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
    ) {
      const httpErr = err as {
        status: number;
        message?: string;
        headers?: Record<string, string | undefined> | Headers;
      };
      return mapHttpError(
        httpErr.status,
        httpErr.message || `HTTP ${httpErr.status}`,
        httpErr.headers,
        err,
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : (err as { name?: string })?.name;

    // Timeout detection
    if (message.toLowerCase().includes("timeout") || errName === "TimeoutError") {
      return new TimeoutError(`Request timed out: ${message}`, 1000, err);
    }

    // Abort detection (DOMException with name AbortError, or aborted message)
    if (errName === "AbortError" || message.toLowerCase().includes("aborted")) {
      return new ProviderError("Request was aborted", "TIMEOUT", false, undefined, undefined, undefined, err);
    }

    // Connection refused / DNS failure / offline / fetch failed
    if (
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.toLowerCase().includes("failed to fetch") ||
      message.toLowerCase().includes("fetch failed") ||
      (err instanceof TypeError && message.toLowerCase().includes("fetch"))
    ) {
      return new ProviderUnavailableError(`Provider endpoint unreachable: ${message}`, 5000, err);
    }

    return new ProviderUnavailableError(`Provider invocation failed: ${message}`, 5000, err);
  }
}

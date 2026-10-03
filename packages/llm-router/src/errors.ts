/**
 * @file packages/llm-router/src/errors.ts
 * Standardized error hierarchy and HTTP error mapping for LLM providers.
 */

export type LLMErrorCode =
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  | "CONTEXT_TOO_LARGE"
  | "AUTHENTICATION_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "INVALID_TOOL_CALL"
  | "PROVIDER_OFFLINE"
  | "LOW_CONFIDENCE"
  | "TEST_FAILURE"
  | "MALFORMED_OUTPUT";

export const ALL_LLM_ERROR_CODES: ReadonlySet<LLMErrorCode> = new Set<LLMErrorCode>([
  "RATE_LIMIT",
  "QUOTA_EXHAUSTED",
  "CONTEXT_TOO_LARGE",
  "AUTHENTICATION_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "INVALID_REQUEST",
  "INVALID_TOOL_CALL",
  "PROVIDER_OFFLINE",
  "LOW_CONFIDENCE",
  "TEST_FAILURE",
  "MALFORMED_OUTPUT",
]);

/**
 * Base class for all LLM provider errors.
 */
export class ProviderError extends Error {
  public readonly code: LLMErrorCode;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly providerId?: string;
  public readonly modelId?: string;
  public override readonly cause?: unknown;

  constructor(
    message: string,
    code: LLMErrorCode,
    retryable: boolean,
    retryAfterMs?: number,
    providerId?: string,
    modelId?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.providerId = providerId;
    this.modelId = modelId;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Rate limit hit (HTTP 429). Retryable with exponential backoff / retry-after delay.
 */
export class RateLimitError extends ProviderError {
  constructor(message: string, retryAfterMs = 15000, cause?: unknown) {
    super(message, "RATE_LIMIT", true, retryAfterMs, undefined, undefined, cause);
    this.name = "RateLimitError";
  }
}

/**
 * Provider quota/credits exhausted. Non-retryable without billing intervention.
 */
export class QuotaExhaustedError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, "QUOTA_EXHAUSTED", false, undefined, undefined, undefined, cause);
    this.name = "QuotaExhaustedError";
  }
}

/**
 * Context window length exceeded. Non-retryable without context compaction.
 */
export class ContextLengthExceededError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONTEXT_TOO_LARGE", false, undefined, undefined, undefined, cause);
    this.name = "ContextLengthExceededError";
  }
}

/**
 * Authentication failure (HTTP 401/403 or invalid API key). Non-retryable.
 */
export class AuthenticationError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, "AUTHENTICATION_ERROR", false, undefined, undefined, undefined, cause);
    this.name = "AuthenticationError";
  }
}

/**
 * Network failure (connection refused, DNS failure, socket timeout). Retryable.
 */
export class NetworkError extends ProviderError {
  constructor(message: string, retryAfterMs = 5000, cause?: unknown) {
    super(message, "NETWORK_ERROR", true, retryAfterMs, undefined, undefined, cause);
    this.name = "NetworkError";
  }
}

/**
 * Invalid request payload, schema mismatch, or bad model parameters. Non-retryable.
 */
export class InvalidRequestError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, "INVALID_REQUEST", false, undefined, undefined, undefined, cause);
    this.name = "InvalidRequestError";
  }
}

/**
 * Provider or local inference daemon offline / unavailable (HTTP 500, 502, 503). Retryable.
 */
export class ProviderUnavailableError extends ProviderError {
  constructor(message: string, retryAfterMs = 5000, cause?: unknown) {
    super(message, "PROVIDER_OFFLINE", true, retryAfterMs, undefined, undefined, cause);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * Request timed out. Retryable.
 */
export class TimeoutError extends ProviderError {
  constructor(message: string, retryAfterMs = 1000, cause?: unknown) {
    super(message, "TIMEOUT", true, retryAfterMs, undefined, undefined, cause);
    this.name = "TimeoutError";
  }
}

/**
 * Tool call was rejected or malformed. Non-retryable.
 */
export class InvalidToolCallError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, "INVALID_TOOL_CALL", false, undefined, undefined, undefined, cause);
    this.name = "InvalidToolCallError";
  }
}

/**
 * Provider returned malformed output or unexpected structure. Non-retryable.
 */
export class MalformedOutputError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, "MALFORMED_OUTPUT", false, undefined, undefined, undefined, cause);
    this.name = "MalformedOutputError";
  }
}

/**
 * Backward compatibility facade for existing LLMProviderError references.
 * Supports both (code, message, retryable, retryAfterMs, cause) and (message, code, retryable...).
 */
export class LLMProviderError extends ProviderError {
  constructor(
    codeOrMessage: LLMErrorCode | string,
    messageOrCode?: string | LLMErrorCode,
    retryable: boolean = false,
    retryAfterMs?: number,
    cause?: unknown,
  ) {
    if (
      typeof codeOrMessage === "string" &&
      typeof messageOrCode === "string" &&
      ALL_LLM_ERROR_CODES.has(codeOrMessage as LLMErrorCode)
    ) {
      super(messageOrCode, codeOrMessage as LLMErrorCode, retryable, retryAfterMs, undefined, undefined, cause);
    } else {
      super(
        codeOrMessage,
        (messageOrCode as LLMErrorCode) || "INVALID_REQUEST",
        retryable,
        retryAfterMs,
        undefined,
        undefined,
        cause,
      );
    }
    this.name = "LLMProviderError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static [Symbol.hasInstance](instance: unknown): boolean {
    return instance instanceof ProviderError;
  }
}

/**
 * Case-insensitive header extractor for Headers instance or plain header record.
 */
function getHeader(
  headers: Record<string, string | undefined> | Headers | undefined,
  headerName: string,
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(headerName) ?? (headers as Headers).get(headerName.toLowerCase()) ?? undefined;
  }
  const lowerName = headerName.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof val === "string") {
      return val;
    }
  }
  return undefined;
}

/**
 * Maps HTTP response status codes and headers to standardized ProviderError subclasses.
 */
export function mapHttpError(
  status: number,
  message: string,
  headers?: Record<string, string | undefined> | Headers,
  cause?: unknown,
): ProviderError {
  // 429: Rate Limit
  if (status === 429) {
    let retryAfterMs = 15000;
    const retryHeader = getHeader(headers, "retry-after");
    if (retryHeader) {
      const trimmed = retryHeader.trim();
      if (/^\d+$/.test(trimmed)) {
        retryAfterMs = parseInt(trimmed, 10) * 1000;
      } else if (/[a-zA-Z]/.test(trimmed)) {
        const dateMs = Date.parse(trimmed);
        if (!isNaN(dateMs)) {
          const diff = dateMs - Date.now();
          retryAfterMs = Math.max(0, diff);
        }
      }
    }
    return new RateLimitError(message, retryAfterMs, cause);
  }

  // 401, 403: Authentication / Forbidden
  if (status === 401 || status === 403) {
    return new AuthenticationError(message, cause);
  }

  // 408, 504: Timeouts
  if (status === 408 || status === 504) {
    return new NetworkError(message, 5000, cause);
  }

  // 500, 502, 503: Provider Offline / Unavailable
  if (status === 500 || status === 502 || status === 503) {
    return new ProviderUnavailableError(message, 5000, cause);
  }

  // 400: Context length exceeded or invalid request
  if (status === 400) {
    const lower = message.toLowerCase();
    const isContextLength =
      lower.includes("context") ||
      lower.includes("token limit") ||
      lower.includes("maximum tokens") ||
      lower.includes("too many tokens") ||
      lower.includes("prompt is too long") ||
      lower.includes("too long");
    if (isContextLength) {
      return new ContextLengthExceededError(message, cause);
    }
    return new InvalidRequestError(message, cause);
  }

  // Any other 5xx status
  if (status >= 500) {
    return new ProviderUnavailableError(message, 5000, cause);
  }

  // Default for other 4xx or unexpected status
  return new InvalidRequestError(message, cause);
}

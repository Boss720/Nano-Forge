/**
 * @file packages/llm-router/src/providers/__tests__/adversarial.test.ts
 * Adversarial test suite stress-testing error hierarchy, mapHttpError,
 * and BaseLLMProvider.handleError against malicious, malformed, and edge-case inputs.
 */

import { describe, expect, it } from "vitest";
import { BaseLLMProvider } from "../base.js";
import {
  ALL_LLM_ERROR_CODES,
  AuthenticationError,
  ContextLengthExceededError,
  InvalidRequestError,
  InvalidToolCallError,
  LLMProviderError,
  MalformedOutputError,
  mapHttpError,
  NetworkError,
  ProviderError,
  ProviderUnavailableError,
  QuotaExhaustedError,
  RateLimitError,
  TimeoutError,
} from "../../errors.js";
import { ModelDescriptor } from "../../types.js";

class TestLLMProvider extends BaseLLMProvider {
  readonly id = "adversarial-tester";
  readonly name = "Adversarial Tester";

  async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }
  async healthCheck() {
    return { healthy: true, latencyMs: 0, checkedAt: Date.now() };
  }
  async generate(): Promise<never> {
    throw new Error("stub");
  }
  async *stream() {
    yield { type: "done" as const, finishReason: "stop" as const };
  }
}

describe("Adversarial Challenge: 429 Rate Limit Edge Cases", () => {
  it("handles negative retry-after header gracefully without producing negative or zero delay", () => {
    const err = mapHttpError(429, "Too Many Requests", { "retry-after": "-10" });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.retryable).toBe(true);
    // CONTRACT ASSERTION: Negative duration is invalid under RFC 7231 (delay-seconds = 1*DIGIT)
    // and must fall back to default backoff (15000ms), NOT evaluate to 0ms (which causes thundering herd)
    expect(err.retryAfterMs).toBe(15000);
  });

  it("handles negative two-digit retry-after without multi-year lockout (e.g. '-32')", () => {
    const err = mapHttpError(429, "Rate limited", { "retry-after": "-32" });
    // Under V8 Date.parse, "-32" is parsed as year 2032!
    // This erroneously produces ~166 billion ms (~5.26 years) lockout.
    // CONTRACT ASSERTION: Must fall back to default 15000ms, never multi-year lockout.
    expect(err.retryAfterMs).toBe(15000);
  });

  it("handles non-numeric string retry-after ('tomorrow') gracefully", () => {
    const err = mapHttpError(429, "Too Many Requests", { "retry-after": "tomorrow" });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe("RATE_LIMIT");
    // "tomorrow" cannot be parsed as seconds or valid HTTP date, must fallback to default 15000ms
    expect(err.retryAfterMs).toBe(15000);
  });

  it("handles past HTTP date string safely without negative delays", () => {
    const pastDate = new Date(Date.now() - 3600000).toUTCString(); // 1 hour in past
    const err = mapHttpError(429, "Too Many Requests", { "retry-after": pastDate });
    expect(err).toBeInstanceOf(RateLimitError);
    // Math.max(0, diff) ensures past dates produce 0ms delay rather than negative numbers
    expect(err.retryAfterMs).toBe(0);
  });

  it("handles future HTTP date string correctly", () => {
    const futureDate = new Date(Date.now() + 45000).toUTCString();
    const err = mapHttpError(429, "Too Many Requests", { "retry-after": futureDate });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBeGreaterThan(40000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(46000);
  });

  it("handles missing retry-after header and undefined headers object", () => {
    const errMissing = mapHttpError(429, "Rate limited", {});
    expect(errMissing).toBeInstanceOf(RateLimitError);
    expect(errMissing.retryAfterMs).toBe(15000);

    const errUndefined = mapHttpError(429, "Rate limited", undefined);
    expect(errUndefined).toBeInstanceOf(RateLimitError);
    expect(errUndefined.retryAfterMs).toBe(15000);
  });

  it("handles zero retry-after header ('0')", () => {
    const err = mapHttpError(429, "Rate limited", { "retry-after": "0" });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(0);
  });

  it("handles whitespace and trimmed retry-after header values", () => {
    const err = mapHttpError(429, "Rate limited", { "retry-after": "  30  " });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(30000);
  });

  it("handles empty or blank retry-after headers safely", () => {
    const errEmpty = mapHttpError(429, "Rate limited", { "retry-after": "" });
    expect(errEmpty.retryAfterMs).toBe(15000);

    const errSpaces = mapHttpError(429, "Rate limited", { "retry-after": "    " });
    expect(errSpaces.retryAfterMs).toBe(15000);
  });

  it("handles non-standard retry-after formats safely (e.g. '30s', '1.5')", () => {
    const errS = mapHttpError(429, "Rate limited", { "retry-after": "30s" });
    // "30s" is not pure digits and not a date, fallback to 15000ms
    expect(errS.retryAfterMs).toBe(15000);

    const errFloat = mapHttpError(429, "Rate limited", { "retry-after": "1.5" });
    // "1.5" is not integer seconds, should fall back to 15000ms, not 0ms
    expect(errFloat.retryAfterMs).toBe(15000);
  });

  it("handles case-insensitive header lookups across Headers instance and plain object", () => {
    const upperObj = mapHttpError(429, "Rate limited", { "RETRY-AFTER": "12" });
    expect(upperObj.retryAfterMs).toBe(12000);

    const mixedObj = mapHttpError(429, "Rate limited", { "Retry-After": "14" });
    expect(mixedObj.retryAfterMs).toBe(14000);

    const headersInstance = new Headers();
    headersInstance.set("retry-after", "22");
    const errHeaders = mapHttpError(429, "Rate limited", headersInstance);
    expect(errHeaders.retryAfterMs).toBe(22000);
  });
});

describe("Adversarial Challenge: Error Inheritance & Polymorphism", () => {
  const allSubclasses = [
    { name: "RateLimitError", instance: new RateLimitError("rate limit") },
    { name: "QuotaExhaustedError", instance: new QuotaExhaustedError("quota") },
    { name: "ContextLengthExceededError", instance: new ContextLengthExceededError("context") },
    { name: "AuthenticationError", instance: new AuthenticationError("auth") },
    { name: "NetworkError", instance: new NetworkError("network") },
    { name: "InvalidRequestError", instance: new InvalidRequestError("invalid") },
    { name: "ProviderUnavailableError", instance: new ProviderUnavailableError("unavailable") },
    { name: "TimeoutError", instance: new TimeoutError("timeout") },
    { name: "InvalidToolCallError", instance: new InvalidToolCallError("tool") },
    { name: "MalformedOutputError", instance: new MalformedOutputError("output") },
  ];

  it("ensures all error subclasses are instances of ProviderError", () => {
    for (const { name, instance } of allSubclasses) {
      expect(instance instanceof ProviderError, `${name} should be instanceof ProviderError`).toBe(true);
      expect(instance).toBeInstanceOf(ProviderError);
    }
  });

  it("ensures all error subclasses are instances of Error", () => {
    for (const { name, instance } of allSubclasses) {
      expect(instance instanceof Error, `${name} should be instanceof Error`).toBe(true);
      expect(instance).toBeInstanceOf(Error);
      expect(instance.stack).toBeDefined();
    }
  });

  it("ensures all error subclasses satisfy `err instanceof LLMProviderError` via Symbol.hasInstance shim", () => {
    for (const { name, instance } of allSubclasses) {
      expect(instance instanceof LLMProviderError, `${name} should be instanceof LLMProviderError`).toBe(true);
    }
    const rawProviderError = new ProviderError("raw", "INVALID_REQUEST", false);
    expect(rawProviderError instanceof LLMProviderError).toBe(true);
  });

  it("ensures LLMProviderError itself inherits from ProviderError and Error", () => {
    const legacy1 = new LLMProviderError("RATE_LIMIT", "rate limit legacy", true, 5000);
    expect(legacy1 instanceof Error).toBe(true);
    expect(legacy1 instanceof ProviderError).toBe(true);
    expect(legacy1 instanceof LLMProviderError).toBe(true);
    expect(legacy1.code).toBe("RATE_LIMIT");
    expect(legacy1.retryable).toBe(true);
    expect(legacy1.retryAfterMs).toBe(5000);

    const legacy2 = new LLMProviderError("Message first", "INVALID_REQUEST", false);
    expect(legacy2 instanceof Error).toBe(true);
    expect(legacy2 instanceof ProviderError).toBe(true);
    expect(legacy2 instanceof LLMProviderError).toBe(true);
    expect(legacy2.code).toBe("INVALID_REQUEST");
    expect(legacy2.message).toBe("Message first");
  });

  it("ensures non-ProviderError errors do NOT satisfy instanceof LLMProviderError", () => {
    expect(new Error("plain error") instanceof LLMProviderError).toBe(false);
    expect(new TypeError("type error") instanceof LLMProviderError).toBe(false);
    expect({} instanceof LLMProviderError).toBe(false);
    expect((null as unknown) instanceof LLMProviderError).toBe(false);
    expect((undefined as unknown) instanceof LLMProviderError).toBe(false);
  });

  it("validates that all codes match ALL_LLM_ERROR_CODES", () => {
    for (const { instance } of allSubclasses) {
      expect(ALL_LLM_ERROR_CODES.has(instance.code)).toBe(true);
    }
  });
});

describe("Adversarial Challenge: BaseLLMProvider.handleError", () => {
  const provider = new TestLLMProvider();

  it("handles null without throwing", () => {
    const result = provider.handleError(null);
    expect(result).toBeInstanceOf(ProviderError);
    expect(result).toBeInstanceOf(ProviderUnavailableError);
    expect(result.message).toContain("null");
    expect(result.retryable).toBe(true);
  });

  it("handles undefined without throwing", () => {
    const result = provider.handleError(undefined);
    expect(result).toBeInstanceOf(ProviderError);
    expect(result).toBeInstanceOf(ProviderUnavailableError);
    expect(result.message).toContain("undefined");
    expect(result.retryable).toBe(true);
  });

  it("handles plain strings without throwing", () => {
    const resGeneric = provider.handleError("Service went down unexpectedly");
    expect(resGeneric).toBeInstanceOf(ProviderError);
    expect(resGeneric.message).toContain("Service went down unexpectedly");

    const resTimeout = provider.handleError("Gateway timeout");
    expect(resTimeout).toBeInstanceOf(TimeoutError);
    expect(resTimeout.retryable).toBe(true);

    const resAborted = provider.handleError("Request was aborted by caller");
    expect(resAborted).toBeInstanceOf(ProviderError);
    expect(resAborted.retryable).toBe(false);

    const resConn = provider.handleError("connect ECONNREFUSED");
    expect(resConn).toBeInstanceOf(ProviderUnavailableError);
    expect(resConn.retryable).toBe(true);
  });

  it("handles arbitrary non-Error objects without throwing", () => {
    // Empty object
    const resEmpty = provider.handleError({});
    expect(resEmpty).toBeInstanceOf(ProviderError);

    // Object with custom status number
    const resStatus = provider.handleError({ status: 429, message: "Too Many Requests" });
    expect(resStatus).toBeInstanceOf(RateLimitError);
    expect(resStatus.code).toBe("RATE_LIMIT");

    // Object with string status (should not throw, falls through to message)
    const resStringStatus = provider.handleError({ status: "500", message: "Internal Error" });
    expect(resStringStatus).toBeInstanceOf(ProviderError);

    // Object with non-standard properties
    const resWeird = provider.handleError({ foo: "bar", errCode: 1234 });
    expect(resWeird).toBeInstanceOf(ProviderError);

    // Circular object
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const resCirc = provider.handleError(circular);
    expect(resCirc).toBeInstanceOf(ProviderError);
  });

  it("handles AbortError (DOMException and custom) as non-retryable", () => {
    const domAbort = new DOMException("The user aborted a request.", "AbortError");
    const res1 = provider.handleError(domAbort);
    expect(res1).toBeInstanceOf(ProviderError);
    expect(res1.code).toBe("TIMEOUT");
    expect(res1.retryable).toBe(false);

    const customAbort = new Error("aborted by signal");
    const res2 = provider.handleError(customAbort);
    expect(res2).toBeInstanceOf(ProviderError);
    expect(res2.retryable).toBe(false);
  });

  it("handles TypeError and fetch failures as retryable ProviderUnavailableError", () => {
    const fetchErr = new TypeError("Failed to fetch");
    const res1 = provider.handleError(fetchErr);
    expect(res1).toBeInstanceOf(ProviderUnavailableError);
    expect(res1.retryable).toBe(true);
    expect(res1.code).toBe("PROVIDER_OFFLINE");

    const fetchFailed = new TypeError("fetch failed");
    const res2 = provider.handleError(fetchFailed);
    expect(res2).toBeInstanceOf(ProviderUnavailableError);
    expect(res2.retryable).toBe(true);

    const otherTypeErr = new TypeError("Cannot read properties of null (reading 'data')");
    const res3 = provider.handleError(otherTypeErr);
    expect(res3).toBeInstanceOf(ProviderUnavailableError);
    expect(res3.retryable).toBe(true);
  });
});

describe("Adversarial Challenge: Abnormal Vendor Responses & Fuzzing", () => {
  it("handles unusual HTTP status codes safely", () => {
    // 0 / negative
    const res0 = mapHttpError(0, "Zero status");
    expect(res0).toBeInstanceOf(InvalidRequestError);

    const resNeg = mapHttpError(-1, "Negative status");
    expect(resNeg).toBeInstanceOf(InvalidRequestError);

    // Non-error HTTP status passed to mapHttpError (200, 204, 301)
    const res200 = mapHttpError(200, "OK");
    expect(res200).toBeInstanceOf(InvalidRequestError);

    const res301 = mapHttpError(301, "Moved Permanently");
    expect(res301).toBeInstanceOf(InvalidRequestError);

    // Unknown 4xx
    const res418 = mapHttpError(418, "I'm a teapot");
    expect(res418).toBeInstanceOf(InvalidRequestError);
    expect(res418.retryable).toBe(false);

    // Unknown 5xx
    const res599 = mapHttpError(599, "Network Connect Timeout Error");
    expect(res599).toBeInstanceOf(ProviderUnavailableError);
    expect(res599.retryable).toBe(true);

    // Huge status
    const resHuge = mapHttpError(99999, "Extreme status");
    expect(resHuge).toBeInstanceOf(ProviderUnavailableError);
  });

  it("robustly detects context length errors regardless of message casing or variation", () => {
    const variations = [
      "CONTEXT LENGTH EXCEEDED",
      "Maximum tokens limit reached",
      "Request exceeds token limit",
      "Model prompt is too long",
      "too many tokens in the input prompt",
      "Input is simply too long",
    ];

    for (const msg of variations) {
      const err = mapHttpError(400, msg);
      expect(err).toBeInstanceOf(ContextLengthExceededError);
      expect(err.code).toBe("CONTEXT_TOO_LARGE");
      expect(err.retryable).toBe(false);
    }
  });

  it("handles massive strings and unicode characters safely", () => {
    const hugeMessage = "A".repeat(100_000);
    const err = mapHttpError(500, hugeMessage);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(err.message.length).toBe(100_000);

    const unicodeMsg = "🔥⚡ 異常発生 \u0000 Null byte test \uFFFF";
    const errUnicode = mapHttpError(400, unicodeMsg);
    expect(errUnicode).toBeInstanceOf(InvalidRequestError);
    expect(errUnicode.message).toBe(unicodeMsg);
  });

  it("preserves exotic causes (bigint, symbol, cyclic object)", () => {
    const causeSym = Symbol("test");
    const errSym = mapHttpError(500, "Symbol cause", undefined, causeSym);
    expect(errSym.cause).toBe(causeSym);

    const causeBigInt = 9007199254740991n;
    const errBigInt = mapHttpError(500, "BigInt cause", undefined, causeBigInt);
    expect(errBigInt.cause).toBe(causeBigInt);
  });
});

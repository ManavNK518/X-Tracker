import { ProviderError } from "./errors";

export interface RetryOptions {
  /** Total attempts including the first. Always bounded. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Decides whether an error is retryable. Defaults to ProviderError.options.retryable. */
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
}

export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });

/** Exponential backoff with full jitter: delay = random(0, min(max, base * 2^n)). */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random = Math.random): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * ceiling);
}

export function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) return error.options.retryable;
  return false;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts, 10));
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const sleep = options.sleep ?? ((ms: number) => defaultSleep(ms, options.signal));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryable(error) || options.signal?.aborted) break;
      let delayMs = backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs, options.random);
      // Respect provider-specified reset times when they fall within the cap.
      if (error instanceof ProviderError && error.options.rateLimitResetAt) {
        const untilReset = error.options.rateLimitResetAt.getTime() - Date.now();
        if (untilReset > options.maxDelayMs) break; // do not block for long windows; surface instead
        delayMs = Math.max(delayMs, untilReset);
      }
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** Runs a promise with a timeout; the AbortController is aborted on timeout. */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>, label = "operation"): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${ms}ms`)), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

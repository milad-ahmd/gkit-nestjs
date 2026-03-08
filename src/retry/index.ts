/**
 * Retry module — configurable retry with backoff strategies.
 *
 * Mirrors the Go gkit/pkg/retry package.
 * Supports fixed, exponential, and jittered backoff, a StopError escape hatch,
 * and an onRetry hook.
 */

// ---------------------------------------------------------------------------
// Backoff

/** Returns the delay in milliseconds before the next attempt (0-indexed attempt). */
export type BackoffFn = (attempt: number) => number;

export class Backoff {
  /** Constant delay between every attempt. */
  static fixed(delayMs: number): BackoffFn {
    return () => delayMs;
  }

  /**
   * Truncated exponential backoff.
   *   delay(n) = min(initial * multiplier^n, max)
   */
  static exponential(initialMs: number, multiplier: number, maxMs: number): BackoffFn {
    return (attempt: number): number => {
      const d = initialMs * Math.pow(multiplier, attempt);
      return maxMs > 0 ? Math.min(d, maxMs) : d;
    };
  }

  /**
   * Wraps any BackoffFn with full jitter:
   *   sleep = random_between(0, computed_delay)
   * Prevents thundering-herd on correlated failures.
   */
  static withJitter(backoff: BackoffFn): BackoffFn {
    return (attempt: number): number => {
      const base = backoff(attempt);
      if (base <= 0) return 0;
      return Math.random() * base;
    };
  }
}

/** Sensible default exponential backoff: 100 ms initial, x2 multiplier, 30 s cap. */
export const DefaultExponential: BackoffFn = Backoff.exponential(100, 2, 30_000);

// ---------------------------------------------------------------------------
// StopError

/**
 * Throw a StopError inside the retry function to abort the retry loop
 * immediately without further attempts. The wrapped cause is re-thrown.
 */
export class StopError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'StopError';
    this.cause = cause;
  }
}

/** Convenience factory — mirrors Go's retry.Stop(err). */
export function stop(cause: unknown): StopError {
  return new StopError(cause);
}

// ---------------------------------------------------------------------------
// MaxAttemptsError

/** Thrown when all retry attempts are exhausted. */
export class MaxAttemptsError extends Error {
  readonly attempts: number;
  readonly last: unknown;

  constructor(attempts: number, last: unknown) {
    super(
      `retry: exhausted after ${attempts} attempts: ${
        last instanceof Error ? last.message : String(last)
      }`,
    );
    this.name = 'MaxAttemptsError';
    this.attempts = attempts;
    this.last = last;
  }
}

export function isMaxAttemptsError(err: unknown): err is MaxAttemptsError {
  return err instanceof MaxAttemptsError;
}

// ---------------------------------------------------------------------------
// Options

export interface RetryOptions {
  /** Maximum number of attempts including the first. Default: 3. */
  maxAttempts?: number;
  /** Backoff function returning delay in ms. Default: no delay. */
  backoff?: BackoffFn;
  /**
   * Called before each retry (not the first attempt).
   * attempt is 1-based index of the completed attempt that failed.
   */
  onRetry?: (attempt: number, err: unknown) => void;
}

// ---------------------------------------------------------------------------
// retry<T>

/**
 * Calls fn up to maxAttempts times, waiting between attempts according to
 * the configured backoff. Returns the first successful result or throws
 * MaxAttemptsError on exhaustion.
 *
 * Throw StopError inside fn to abort retrying immediately.
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffFn = opts.backoff ?? Backoff.fixed(0);

  if (maxAttempts < 1) {
    throw new Error('retry: maxAttempts must be >= 1');
  }

  let last: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // StopError — abort immediately, re-throw the original cause.
      if (err instanceof StopError) {
        throw err.cause;
      }

      last = err;

      if (attempt < maxAttempts - 1) {
        opts.onRetry?.(attempt + 1, err);

        const delayMs = backoffFn(attempt);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }
  }

  throw new MaxAttemptsError(maxAttempts, last);
}

// ---------------------------------------------------------------------------
// Internal helpers

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

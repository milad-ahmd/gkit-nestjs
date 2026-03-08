/**
 * Circuit Breaker — protects downstream dependencies from cascading failures.
 *
 * Mirrors the Go gkit/pkg/circuitbreaker package.
 *
 * Three states:
 *   CLOSED   — requests flow normally; failures are counted.
 *   OPEN     — requests fail immediately without calling the underlying fn.
 *   HALF_OPEN — after the open timeout, probe requests are allowed through.
 */

// ---------------------------------------------------------------------------
// State enum

export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

// ---------------------------------------------------------------------------
// CircuitOpenError

export class CircuitOpenError extends Error {
  constructor(retryAfterMs?: number) {
    super(
      retryAfterMs !== undefined
        ? `circuitbreaker: circuit is open (retry after ${retryAfterMs}ms)`
        : 'circuitbreaker: circuit is open',
    );
    this.name = 'CircuitOpenError';
  }
}

// ---------------------------------------------------------------------------
// Options

export interface CircuitBreakerOptions {
  /** Number of consecutive failures required to trip the breaker (default: 5). */
  failureThreshold?: number;
  /** Number of consecutive successes in HALF_OPEN to close the breaker (default: 1). */
  successThreshold?: number;
  /** How long (ms) the breaker stays OPEN before entering HALF_OPEN (default: 60 000). */
  openTimeoutMs?: number;
  /** Callback invoked on every state transition. */
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

// ---------------------------------------------------------------------------
// CircuitBreaker

export class CircuitBreaker {
  private _state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures = 0;
  private probes = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openTimeoutMs: number;
  private readonly onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.successThreshold = opts.successThreshold ?? 1;
    this.openTimeoutMs = opts.openTimeoutMs ?? 60_000;
    this.onStateChange = opts.onStateChange;
  }

  get state(): CircuitBreakerState {
    this.maybeTransitionFromOpen();
    return this._state;
  }

  /**
   * Executes fn if the breaker permits it. Throws CircuitOpenError when the
   * circuit is open. State transitions happen automatically.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionFromOpen();

    if (this._state === CircuitBreakerState.OPEN) {
      const retryAfter = this.openedAt + this.openTimeoutMs - Date.now();
      throw new CircuitOpenError(Math.max(0, retryAfter));
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /** Manually resets the breaker to CLOSED. */
  reset(): void {
    this.transition(CircuitBreakerState.CLOSED);
    this.failures = 0;
    this.probes = 0;
  }

  // ---- internal -----------------------------------------------------------

  private recordSuccess(): void {
    if (this._state === CircuitBreakerState.CLOSED) {
      this.failures = 0;
    } else if (this._state === CircuitBreakerState.HALF_OPEN) {
      this.probes++;
      if (this.probes >= this.successThreshold) {
        this.failures = 0;
        this.probes = 0;
        this.transition(CircuitBreakerState.CLOSED);
      }
    }
  }

  private recordFailure(): void {
    if (this._state === CircuitBreakerState.CLOSED) {
      this.failures++;
      if (this.failures >= this.failureThreshold) {
        this.openedAt = Date.now();
        this.transition(CircuitBreakerState.OPEN);
      }
    } else if (this._state === CircuitBreakerState.HALF_OPEN) {
      this.failures = 0;
      this.probes = 0;
      this.openedAt = Date.now();
      this.transition(CircuitBreakerState.OPEN);
    }
  }

  private maybeTransitionFromOpen(): void {
    if (
      this._state === CircuitBreakerState.OPEN &&
      Date.now() - this.openedAt >= this.openTimeoutMs
    ) {
      this.transition(CircuitBreakerState.HALF_OPEN);
    }
  }

  private transition(to: CircuitBreakerState): void {
    if (this._state === to) return;
    const from = this._state;
    this._state = to;
    if (this.onStateChange) {
      // Run in next tick to avoid blocking the caller.
      setTimeout(() => this.onStateChange!(from, to), 0);
    }
  }
}

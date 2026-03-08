/**
 * Graceful shutdown — coordinates ordered, timeout-aware shutdown of services.
 *
 * Mirrors the Go gkit/pkg/graceful package.
 *
 * Shutdown hooks run in LIFO order (last registered = first to shut down),
 * mirroring the typical dependency graph.
 */

// ---------------------------------------------------------------------------
// GracefulShutdown

interface Registration {
  name: string;
  fn: () => Promise<void>;
}

export class GracefulShutdown {
  private readonly hooks: Registration[] = [];
  private readonly timeoutMs: number;
  private signalHandlersRegistered = false;

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * Registers a named shutdown hook.
   * Hooks run in reverse registration order (LIFO).
   */
  register(name: string, fn: () => Promise<void>): this {
    this.hooks.push({ name, fn });
    return this;
  }

  /**
   * Runs all registered shutdown hooks in LIFO order with the configured
   * timeout. Errors from individual hooks are collected and thrown as an
   * aggregate error.
   */
  async shutdown(signal?: string): Promise<void> {
    console.log(`[graceful] shutting down${signal ? ` (${signal})` : ''}...`);

    const hooks = [...this.hooks].reverse();
    const errors: Error[] = [];

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
        ),
      ]);

    for (const { name, fn } of hooks) {
      try {
        await withTimeout(fn(), this.timeoutMs);
        console.log(`[graceful] ${name}: done`);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        e.message = `graceful: ${name}: ${e.message}`;
        errors.push(e);
        console.error(`[graceful] ${name}: error:`, e.message);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `graceful shutdown completed with ${errors.length} error(s)`);
    }
  }

  /**
   * Registers SIGTERM and SIGINT signal handlers.
   * When a signal is received, shutdown() is called and the process exits.
   *
   * @param exitCode  Process exit code after shutdown (default: 0).
   */
  listen(exitCode = 0): this {
    if (this.signalHandlersRegistered) return this;
    this.signalHandlersRegistered = true;

    const handler = (signal: string) => async () => {
      try {
        await this.shutdown(signal);
        process.exit(exitCode);
      } catch (err) {
        console.error('[graceful] shutdown error:', err);
        process.exit(1);
      }
    };

    process.once('SIGTERM', handler('SIGTERM'));
    process.once('SIGINT', handler('SIGINT'));

    return this;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory

export function createGracefulShutdown(opts?: { timeoutMs?: number }): GracefulShutdown {
  return new GracefulShutdown(opts);
}

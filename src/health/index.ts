/**
 * Health check system with NestJS controller integration.
 *
 * Mirrors the Go gkit/pkg/health package.
 * Suitable for Kubernetes liveness and readiness probes.
 */

import { Controller, Get, Injectable } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types

export type HealthStatus = 'healthy' | 'unhealthy';

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthChecker {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}

// ---------------------------------------------------------------------------
// HealthRegistry

@Injectable()
export class HealthRegistry {
  private readonly checkers: HealthChecker[] = [];

  /** Registers a health checker. */
  register(checker: HealthChecker): this {
    this.checkers.push(checker);
    return this;
  }

  /**
   * Runs all registered checkers concurrently.
   * Returns a map of checker name → result.
   */
  async checkAll(): Promise<Record<string, HealthCheckResult>> {
    const results = await Promise.allSettled(
      this.checkers.map(async (c) => {
        const result = await c.check();
        return { name: c.name, result };
      }),
    );

    const out: Record<string, HealthCheckResult> = {};
    for (const settled of results) {
      if (settled.status === 'fulfilled') {
        out[settled.value.name] = settled.value.result;
      } else {
        // The checker itself threw — treat as unhealthy.
        // We don't know the name at this point; use a fallback.
        const idx = results.indexOf(settled);
        const name = this.checkers[idx]?.name ?? `checker_${idx}`;
        out[name] = {
          status: 'unhealthy',
          message: String(settled.reason),
        };
      }
    }
    return out;
  }

  /** Returns true only if every checker reports healthy. */
  async isHealthy(): Promise<boolean> {
    const results = await this.checkAll();
    return Object.values(results).every((r) => r.status === 'healthy');
  }
}

// ---------------------------------------------------------------------------
// NestJS HealthController

/** Full health report response shape. */
interface HealthReport {
  status: HealthStatus;
  checks: Record<string, HealthCheckResult>;
  duration: string;
}

@Controller()
export class HealthController {
  constructor(private readonly registry: HealthRegistry) {}

  @Get('/health')
  async health(): Promise<HealthReport> {
    const start = Date.now();
    const checks = await this.registry.checkAll();
    const overallHealthy = Object.values(checks).every((r) => r.status === 'healthy');

    return {
      status: overallHealthy ? 'healthy' : 'unhealthy',
      checks,
      duration: `${Date.now() - start}ms`,
    };
  }

  @Get('/health/live')
  live(): { status: 'healthy' } {
    return { status: 'healthy' };
  }

  @Get('/health/ready')
  async ready(): Promise<HealthReport> {
    return this.health();
  }
}

// ---------------------------------------------------------------------------
// Built-in checkers

/** Simple ping checker — calls a provided async fn and wraps the result. */
export class PingChecker implements HealthChecker {
  constructor(
    public readonly name: string,
    private readonly pingFn: () => Promise<void>,
  ) {}

  async check(): Promise<HealthCheckResult> {
    try {
      await this.pingFn();
      return { status: 'healthy' };
    } catch (err) {
      return {
        status: 'unhealthy',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

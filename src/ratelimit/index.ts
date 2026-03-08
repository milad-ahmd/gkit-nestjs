import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export class RateLimiter {
  private tokens: number;
  private lastFill: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.lastFill = Date.now();
  }

  allow(): boolean { return this.allowN(1); }

  allowN(n: number): boolean {
    this.refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  getTokens(): number { this.refill(); return this.tokens; }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastFill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    this.lastFill = now;
  }
}

export class KeyedRateLimiter<K = string> {
  private readonly entries = new Map<K, { limiter: RateLimiter; lastSeen: number }>();

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly ttlMs = 10 * 60 * 1000,
  ) {}

  allow(key: K): boolean { return this.getLimiter(key).allow(); }
  allowN(key: K, n: number): boolean { return this.getLimiter(key).allowN(n); }
  delete(key: K): void { this.entries.delete(key); }

  evict(): number {
    const cutoff = Date.now() - this.ttlMs;
    let count = 0;
    for (const [k, e] of this.entries) {
      if (e.lastSeen < cutoff) { this.entries.delete(k); count++; }
    }
    return count;
  }

  get size(): number { return this.entries.size; }

  private getLimiter(key: K): RateLimiter {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { limiter: new RateLimiter(this.rate, this.burst), lastSeen: Date.now() };
      this.entries.set(key, entry);
    }
    entry.lastSeen = Date.now();
    return entry.limiter;
  }
}

export function createRateLimitGuard(limiter: RateLimiter): any {
  @Injectable()
  class RateLimitGuard implements CanActivate {
    canActivate(_ctx: ExecutionContext): boolean {
      return limiter.allow();
    }
  }
  return RateLimitGuard;
}

export function createKeyedRateLimitGuard(
  limiter: KeyedRateLimiter<string>,
  keyExtractor: (req: Request) => string = (req) => req.ip ?? 'unknown',
): any {
  @Injectable()
  class KeyedRateLimitGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Request>();
      return limiter.allow(keyExtractor(req));
    }
  }
  return KeyedRateLimitGuard;
}

/**
 * Distributed lock backed by Redis (SET NX PX pattern).
 *
 * Mirrors the Go gkit/pkg/lock package.
 *
 * Algorithm:
 *   1. SET key token PX ttlMs NX  — atomic acquire
 *   2. A background interval renews the TTL at ttl/3 intervals (keepalive).
 *   3. Release uses a Lua script that deletes the key only when the stored
 *      token matches — preventing a holder from releasing another holder's lock.
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Errors

export class LockNotAcquiredError extends Error {
  constructor(key?: string) {
    super(key ? `lock: not acquired: "${key}"` : 'lock: not acquired');
    this.name = 'LockNotAcquiredError';
  }
}

// ---------------------------------------------------------------------------
// Lua scripts

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end`;

// ---------------------------------------------------------------------------
// DistributedLock interface

export interface DistributedLock {
  /**
   * Attempts to acquire the lock.
   * Returns a token string on success, or null if already held.
   */
  acquire(key: string, ttlMs: number): Promise<string | null>;

  /**
   * Releases the lock. The token must match the one returned by acquire.
   * Returns true if the lock was released, false if the token didn't match.
   */
  release(key: string, token: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// RedisLock

export class RedisLock implements DistributedLock {
  constructor(private readonly client: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = uuidv4();
    const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<boolean> {
    const result = await this.client.eval(RELEASE_SCRIPT, 1, key, token);
    return result === 1;
  }

  /** Renews the TTL for an existing lock without releasing it. */
  async renew(key: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs));
    return result === 1;
  }
}

// ---------------------------------------------------------------------------
// withLock<T> helper

/**
 * Acquires the lock, runs fn, then releases the lock.
 * Starts a background keepalive that renews the TTL every ttlMs/3 ms.
 *
 * Throws LockNotAcquiredError if the lock cannot be acquired.
 */
export async function withLock<T>(
  lock: RedisLock,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const token = await lock.acquire(key, ttlMs);
  if (token === null) {
    throw new LockNotAcquiredError(key);
  }

  // Start keepalive interval.
  const renewInterval = Math.max(Math.floor(ttlMs / 3), 100);
  const keepalive = setInterval(async () => {
    await lock.renew(key, token, ttlMs);
  }, renewInterval);

  try {
    return await fn();
  } finally {
    clearInterval(keepalive);
    await lock.release(key, token);
  }
}

// ---------------------------------------------------------------------------
// Locker — higher-level acquire/release with retry

export interface LockerOptions {
  /** Number of retry attempts when lock is held. Default: no retry. */
  retryCount?: number;
  /** Interval between retry attempts in ms. Default: 100. */
  retryIntervalMs?: number;
}

export class Locker {
  private readonly lock: RedisLock;
  private readonly opts: Required<LockerOptions>;

  constructor(client: Redis, opts: LockerOptions = {}) {
    this.lock = new RedisLock(client);
    this.opts = {
      retryCount: opts.retryCount ?? 0,
      retryIntervalMs: opts.retryIntervalMs ?? 100,
    };
  }

  /**
   * Attempts to acquire the lock, retrying up to retryCount times.
   * Returns the token string.
   * Throws LockNotAcquiredError if all attempts fail.
   */
  async acquire(key: string, ttlMs: number): Promise<string> {
    const maxAttempts = this.opts.retryCount + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const token = await this.lock.acquire(key, ttlMs);
      if (token !== null) return token;

      if (attempt < maxAttempts - 1) {
        await sleep(this.opts.retryIntervalMs);
      }
    }

    throw new LockNotAcquiredError(key);
  }

  async release(key: string, token: string): Promise<boolean> {
    return this.lock.release(key, token);
  }

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const token = await this.acquire(key, ttlMs);

    const renewInterval = Math.max(Math.floor(ttlMs / 3), 100);
    const keepalive = setInterval(async () => {
      await this.lock.renew(key, token, ttlMs);
    }, renewInterval);

    try {
      return await fn();
    } finally {
      clearInterval(keepalive);
      await this.release(key, token);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

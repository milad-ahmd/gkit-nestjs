import Redis from 'ioredis';

export class RedisCache<V = unknown> {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = '',
  ) {}

  async get(key: string): Promise<V | null> {
    const raw = await this.redis.get(this.prefix + key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as V; }
    catch { return null; }
  }

  async set(key: string, value: V, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.set(this.prefix + key, raw, 'EX', ttlSeconds);
    } else {
      await this.redis.set(this.prefix + key, raw);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(this.prefix + key)) === 1;
  }

  async getOrSet(key: string, loader: () => Promise<V>, ttlSeconds?: number): Promise<V> {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async mget(keys: string[]): Promise<Map<string, V>> {
    if (keys.length === 0) return new Map();
    const prefixed = keys.map(k => this.prefix + k);
    const values = await this.redis.mget(...prefixed);
    const result = new Map<string, V>();
    for (let i = 0; i < keys.length; i++) {
      const raw = values[i];
      if (raw !== null) {
        try { result.set(keys[i]!, JSON.parse(raw) as V); } catch {}
      }
    }
    return result;
  }

  async flush(): Promise<void> {
    if (!this.prefix) { await this.redis.flushdb(); return; }
    const keys = await this.redis.keys(this.prefix + '*');
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async ping(): Promise<boolean> {
    try { return (await this.redis.ping()) === 'PONG'; }
    catch { return false; }
  }
}

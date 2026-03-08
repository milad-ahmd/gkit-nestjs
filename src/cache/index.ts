/**
 * In-memory LRU cache.
 *
 * Mirrors the Go gkit/pkg/cache package.
 * Uses a Map for O(1) key lookups and tracks insertion order for LRU eviction.
 */

// ---------------------------------------------------------------------------
// Cache interface

export interface Cache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  has(key: K): boolean;
  readonly size: number;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Stats

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

// ---------------------------------------------------------------------------
// LruCache<K, V>
//
// Implements an LRU (Least-Recently-Used) eviction policy using a Map.
// Map preserves insertion order; we move accessed entries to the "end"
// (most recently used) by deleting and re-inserting them.

export class LruCache<K, V> implements Cache<K, V> {
  private readonly maxSize: number;
  private readonly store: Map<K, { value: V; expiresAt?: number }>;
  private readonly ttlMs?: number;

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(maxSize: number, ttlMs?: number) {
    if (maxSize < 1) throw new Error('LruCache: maxSize must be >= 1');
    this.maxSize = maxSize;
    this.store = new Map();
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);

    if (entry === undefined) {
      this._misses++;
      return undefined;
    }

    // TTL check — lazy expiry.
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used).
    this.store.delete(key);
    this.store.set(key, entry);

    this._hits++;
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      // Update existing — move to end.
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Evict least-recently-used (first entry in Map).
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
        this._evictions++;
      }
    }

    const expiresAt = this.ttlMs ? Date.now() + this.ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (entry === undefined) return false;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.store.size,
    };
  }

  /**
   * Removes all expired entries (useful for periodic cleanup when TTL is set).
   */
  evictExpired(): void {
    if (this.ttlMs === undefined) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

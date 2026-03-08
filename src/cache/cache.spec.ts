import { LruCache, Cache, CacheStats } from './index';

describe('LruCache', () => {
  describe('constructor', () => {
    it('throws when maxSize < 1', () => {
      expect(() => new LruCache(0)).toThrow('maxSize must be >= 1');
    });

    it('accepts maxSize = 1', () => {
      expect(() => new LruCache(1)).not.toThrow();
    });
  });

  describe('set / get', () => {
    it('stores and retrieves a value', () => {
      const cache = new LruCache<string, number>(10);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('returns undefined for a missing key', () => {
      const cache = new LruCache<string, string>(5);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('updates an existing key without growing the cache', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('x', 1);
      cache.set('x', 99);
      expect(cache.get('x')).toBe(99);
      expect(cache.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when full', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' to make it recently used; 'b' becomes the LRU.
      cache.get('a');
      cache.set('d', 4); // should evict 'b'

      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('updates eviction counter', () => {
      const cache = new LruCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evict 'a'
      expect(cache.stats().evictions).toBe(1);
    });
  });

  describe('delete', () => {
    it('removes an existing key', () => {
      const cache = new LruCache<string, number>(5);
      cache.set('k', 42);
      cache.delete('k');
      expect(cache.get('k')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('is a no-op for a missing key', () => {
      const cache = new LruCache<string, number>(5);
      expect(() => cache.delete('nonexistent')).not.toThrow();
    });
  });

  describe('has', () => {
    it('returns true for an existing key', () => {
      const cache = new LruCache<string, boolean>(5);
      cache.set('y', true);
      expect(cache.has('y')).toBe(true);
    });

    it('returns false for a missing key', () => {
      const cache = new LruCache<string, boolean>(5);
      expect(cache.has('z')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new LruCache<string, number>(10);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('returns the current number of entries', () => {
      const cache = new LruCache<number, number>(5);
      expect(cache.size).toBe(0);
      cache.set(1, 10);
      expect(cache.size).toBe(1);
      cache.set(2, 20);
      expect(cache.size).toBe(2);
    });
  });

  describe('stats', () => {
    it('tracks hits, misses, and evictions', () => {
      const cache = new LruCache<string, number>(2);
      cache.set('a', 1);
      cache.get('a'); // hit
      cache.get('z'); // miss
      cache.set('b', 2);
      cache.set('c', 3); // evict 'a'

      const stats = cache.stats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.evictions).toBe(1);
      expect(stats.size).toBe(2);
    });
  });

  describe('TTL', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns value before TTL expires', () => {
      const cache = new LruCache<string, string>(5, 1000);
      cache.set('k', 'v');
      jest.advanceTimersByTime(500);
      expect(cache.get('k')).toBe('v');
    });

    it('returns undefined after TTL expires (lazy expiry)', () => {
      const cache = new LruCache<string, string>(5, 100);
      cache.set('k', 'v');
      jest.advanceTimersByTime(200);
      expect(cache.get('k')).toBeUndefined();
    });

    it('has() returns false for an expired entry', () => {
      const cache = new LruCache<string, number>(5, 50);
      cache.set('x', 1);
      jest.advanceTimersByTime(100);
      expect(cache.has('x')).toBe(false);
    });

    it('evictExpired removes expired entries', () => {
      const cache = new LruCache<string, number>(10, 50);
      cache.set('a', 1);
      cache.set('b', 2);
      jest.advanceTimersByTime(100);
      cache.evictExpired();
      expect(cache.size).toBe(0);
    });

    it('evictExpired does nothing without TTL configured', () => {
      const cache = new LruCache<string, number>(10);
      cache.set('a', 1);
      cache.evictExpired(); // should not throw
      expect(cache.size).toBe(1);
    });
  });
});

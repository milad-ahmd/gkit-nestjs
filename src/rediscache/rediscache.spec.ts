/**
 * RedisCache unit tests.
 *
 * ioredis is fully mocked — no real Redis connection is made.
 */

jest.mock('ioredis');

import Redis from 'ioredis';
import { RedisCache } from './index';

// Build a typed mock for the Redis instance.
function makeMockRedis(): jest.Mocked<Redis> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    mget: jest.fn(),
    keys: jest.fn(),
    flushdb: jest.fn(),
    ping: jest.fn(),
  } as unknown as jest.Mocked<Redis>;
}

describe('RedisCache', () => {
  let redis: jest.Mocked<Redis>;
  let cache: RedisCache<{ name: string }>;

  beforeEach(() => {
    redis = makeMockRedis();
    cache = new RedisCache(redis);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('returns parsed value for an existing key', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ name: 'Alice' }));
      const result = await cache.get('user:1');
      expect(result).toEqual({ name: 'Alice' });
      expect(redis.get).toHaveBeenCalledWith('user:1');
    });

    it('returns null when key does not exist', async () => {
      redis.get.mockResolvedValue(null);
      expect(await cache.get('missing')).toBeNull();
    });

    it('returns null when the stored value is not valid JSON', async () => {
      redis.get.mockResolvedValue('not-json{{');
      expect(await cache.get('bad')).toBeNull();
    });

    it('prepends prefix to the key', async () => {
      const prefixed = new RedisCache(redis, 'pfx:');
      redis.get.mockResolvedValue(null);
      await prefixed.get('mykey');
      expect(redis.get).toHaveBeenCalledWith('pfx:mykey');
    });
  });

  // -------------------------------------------------------------------------
  // set
  // -------------------------------------------------------------------------

  describe('set()', () => {
    it('sets a value without TTL', async () => {
      redis.set.mockResolvedValue('OK');
      await cache.set('user:1', { name: 'Bob' });
      expect(redis.set).toHaveBeenCalledWith('user:1', JSON.stringify({ name: 'Bob' }));
    });

    it('sets a value with TTL using EX', async () => {
      redis.set.mockResolvedValue('OK');
      await cache.set('user:1', { name: 'Bob' }, 60);
      expect(redis.set).toHaveBeenCalledWith('user:1', JSON.stringify({ name: 'Bob' }), 'EX', 60);
    });

    it('does not set EX when ttlSeconds is 0', async () => {
      redis.set.mockResolvedValue('OK');
      await cache.set('user:1', { name: 'Bob' }, 0);
      expect(redis.set).toHaveBeenCalledWith('user:1', JSON.stringify({ name: 'Bob' }));
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete()', () => {
    it('calls redis.del with the correct key', async () => {
      redis.del.mockResolvedValue(1);
      await cache.delete('user:1');
      expect(redis.del).toHaveBeenCalledWith('user:1');
    });
  });

  // -------------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------------

  describe('has()', () => {
    it('returns true when redis.exists returns 1', async () => {
      redis.exists.mockResolvedValue(1);
      expect(await cache.has('key')).toBe(true);
    });

    it('returns false when redis.exists returns 0', async () => {
      redis.exists.mockResolvedValue(0);
      expect(await cache.has('key')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getOrSet
  // -------------------------------------------------------------------------

  describe('getOrSet()', () => {
    it('returns cached value without calling loader', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ name: 'Cached' }));
      const loader = jest.fn();
      const result = await cache.getOrSet('key', loader);
      expect(result).toEqual({ name: 'Cached' });
      expect(loader).not.toHaveBeenCalled();
    });

    it('calls loader and caches result on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue('OK');
      const loader = jest.fn().mockResolvedValue({ name: 'Fresh' });
      const result = await cache.getOrSet('key', loader, 30);
      expect(result).toEqual({ name: 'Fresh' });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith('key', JSON.stringify({ name: 'Fresh' }), 'EX', 30);
    });
  });

  // -------------------------------------------------------------------------
  // mget
  // -------------------------------------------------------------------------

  describe('mget()', () => {
    it('returns a Map with parsed values for existing keys', async () => {
      redis.mget.mockResolvedValue([
        JSON.stringify({ name: 'Alice' }),
        null,
        JSON.stringify({ name: 'Charlie' }),
      ]);
      const result = await cache.mget(['a', 'b', 'c']);
      expect(result.get('a')).toEqual({ name: 'Alice' });
      expect(result.has('b')).toBe(false);
      expect(result.get('c')).toEqual({ name: 'Charlie' });
    });

    it('returns an empty Map for empty input', async () => {
      const result = await cache.mget([]);
      expect(result.size).toBe(0);
      expect(redis.mget).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // flush
  // -------------------------------------------------------------------------

  describe('flush()', () => {
    it('calls flushdb when no prefix is set', async () => {
      redis.flushdb.mockResolvedValue('OK');
      await cache.flush();
      expect(redis.flushdb).toHaveBeenCalled();
    });

    it('deletes only prefixed keys when prefix is set', async () => {
      const prefixed = new RedisCache(redis, 'app:');
      redis.keys.mockResolvedValue(['app:a', 'app:b']);
      redis.del.mockResolvedValue(2);
      await prefixed.flush();
      expect(redis.keys).toHaveBeenCalledWith('app:*');
      expect(redis.del).toHaveBeenCalledWith('app:a', 'app:b');
    });

    it('does not call del when no prefixed keys exist', async () => {
      const prefixed = new RedisCache(redis, 'app:');
      redis.keys.mockResolvedValue([]);
      await prefixed.flush();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ping
  // -------------------------------------------------------------------------

  describe('ping()', () => {
    it('returns true when redis replies PONG', async () => {
      redis.ping.mockResolvedValue('PONG');
      expect(await cache.ping()).toBe(true);
    });

    it('returns false when redis.ping throws', async () => {
      redis.ping.mockRejectedValue(new Error('connection refused'));
      expect(await cache.ping()).toBe(false);
    });
  });
});

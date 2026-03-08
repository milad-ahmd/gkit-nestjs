import { RateLimiter, KeyedRateLimiter } from './index';

describe('RateLimiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('allow / allowN', () => {
    it('allows up to burst requests immediately', () => {
      const limiter = new RateLimiter(10, 5); // 10 req/s, burst=5
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(true);
    });

    it('rejects when burst is exhausted', () => {
      const limiter = new RateLimiter(10, 3);
      limiter.allow();
      limiter.allow();
      limiter.allow();
      expect(limiter.allow()).toBe(false);
    });

    it('refills tokens over time', () => {
      const limiter = new RateLimiter(10, 5); // 10 req/s
      // Drain the burst.
      for (let i = 0; i < 5; i++) limiter.allow();
      expect(limiter.allow()).toBe(false);

      // Advance 1 second → 10 new tokens, capped at burst=5.
      jest.advanceTimersByTime(1000);
      expect(limiter.allow()).toBe(true);
    });

    it('allowN returns false when n > available tokens', () => {
      const limiter = new RateLimiter(1, 3);
      expect(limiter.allowN(4)).toBe(false);
    });

    it('allowN consumes the correct number of tokens', () => {
      const limiter = new RateLimiter(1, 5);
      expect(limiter.allowN(3)).toBe(true);
      expect(limiter.allowN(3)).toBe(false);
    });
  });

  describe('getTokens', () => {
    it('returns current token count after refill', () => {
      const limiter = new RateLimiter(10, 5);
      // Drain all.
      for (let i = 0; i < 5; i++) limiter.allow();
      jest.advanceTimersByTime(500); // 0.5s → +5 tokens, capped at 5
      expect(limiter.getTokens()).toBeCloseTo(5, 0);
    });
  });
});

describe('KeyedRateLimiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('creates a separate limiter per key', () => {
    const krl = new KeyedRateLimiter<string>(10, 2);
    expect(krl.allow('a')).toBe(true);
    expect(krl.allow('a')).toBe(true);
    expect(krl.allow('a')).toBe(false); // key 'a' burst exhausted

    // key 'b' has its own fresh burst.
    expect(krl.allow('b')).toBe(true);
  });

  it('tracks size correctly', () => {
    const krl = new KeyedRateLimiter<string>(10, 5);
    krl.allow('x');
    krl.allow('y');
    expect(krl.size).toBe(2);
  });

  it('delete removes a key', () => {
    const krl = new KeyedRateLimiter<string>(10, 5);
    krl.allow('z');
    expect(krl.size).toBe(1);
    krl.delete('z');
    expect(krl.size).toBe(0);
  });

  it('evict removes stale entries', () => {
    const ttlMs = 500;
    const krl = new KeyedRateLimiter<string>(10, 5, ttlMs);
    krl.allow('old');
    jest.advanceTimersByTime(ttlMs + 1);
    krl.allow('new'); // this one is fresh
    const evicted = krl.evict();
    expect(evicted).toBe(1);
    expect(krl.size).toBe(1);
  });

  it('allowN delegates correctly to per-key limiter', () => {
    const krl = new KeyedRateLimiter<string>(10, 3);
    expect(krl.allowN('a', 2)).toBe(true);
    expect(krl.allowN('a', 2)).toBe(false);
  });
});

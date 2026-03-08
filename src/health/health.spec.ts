import { HealthRegistry, PingChecker, HealthChecker, HealthCheckResult } from './index';

// ---------------------------------------------------------------------------
// PingChecker
// ---------------------------------------------------------------------------

describe('PingChecker', () => {
  it('returns healthy when pingFn resolves', async () => {
    const checker = new PingChecker('db', async () => {});
    const result = await checker.check();
    expect(result.status).toBe('healthy');
  });

  it('returns unhealthy with error message when pingFn rejects', async () => {
    const err = new Error('connection refused');
    const checker = new PingChecker('db', async () => { throw err; });
    const result = await checker.check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('connection refused');
  });

  it('returns unhealthy with string message for non-Error throws', async () => {
    const checker = new PingChecker('svc', async () => { throw 'string error'; });
    const result = await checker.check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('string error');
  });

  it('has correct name', () => {
    const checker = new PingChecker('my-service', async () => {});
    expect(checker.name).toBe('my-service');
  });
});

// ---------------------------------------------------------------------------
// HealthRegistry
// ---------------------------------------------------------------------------

describe('HealthRegistry', () => {
  let registry: HealthRegistry;

  beforeEach(() => {
    registry = new HealthRegistry();
  });

  describe('register', () => {
    it('returns this for method chaining', () => {
      const checker = new PingChecker('x', async () => {});
      const result = registry.register(checker);
      expect(result).toBe(registry);
    });
  });

  describe('checkAll()', () => {
    it('returns an empty object when no checkers registered', async () => {
      const result = await registry.checkAll();
      expect(result).toEqual({});
    });

    it('returns results keyed by checker name', async () => {
      registry.register(new PingChecker('db', async () => {}));
      registry.register(new PingChecker('cache', async () => {}));
      const result = await registry.checkAll();
      expect(result['db']?.status).toBe('healthy');
      expect(result['cache']?.status).toBe('healthy');
    });

    it('marks a failing checker as unhealthy', async () => {
      registry.register(new PingChecker('bad', async () => { throw new Error('down'); }));
      const result = await registry.checkAll();
      expect(result['bad']?.status).toBe('unhealthy');
    });

    it('handles mixed results (some healthy, some not)', async () => {
      registry.register(new PingChecker('ok', async () => {}));
      registry.register(new PingChecker('broken', async () => { throw new Error('fail'); }));
      const result = await registry.checkAll();
      expect(result['ok']?.status).toBe('healthy');
      expect(result['broken']?.status).toBe('unhealthy');
    });

    it('handles a checker that itself throws (rejected promise)', async () => {
      const throwingChecker: HealthChecker = {
        name: 'exploding',
        check: () => Promise.reject(new Error('checker crashed')),
      };
      registry.register(throwingChecker);
      const result = await registry.checkAll();
      expect(result['exploding']?.status).toBe('unhealthy');
    });

    it('runs checkers concurrently', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const makeChecker = (name: string): HealthChecker => ({
        name,
        check: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return { status: 'healthy' };
        },
      });

      registry.register(makeChecker('c1'));
      registry.register(makeChecker('c2'));
      registry.register(makeChecker('c3'));

      await registry.checkAll();
      expect(maxConcurrent).toBeGreaterThan(1);
    });
  });

  describe('isHealthy()', () => {
    it('returns true when all checkers are healthy', async () => {
      registry.register(new PingChecker('a', async () => {}));
      registry.register(new PingChecker('b', async () => {}));
      expect(await registry.isHealthy()).toBe(true);
    });

    it('returns false when any checker is unhealthy', async () => {
      registry.register(new PingChecker('a', async () => {}));
      registry.register(new PingChecker('b', async () => { throw new Error('fail'); }));
      expect(await registry.isHealthy()).toBe(false);
    });

    it('returns true with no checkers registered', async () => {
      expect(await registry.isHealthy()).toBe(true);
    });
  });

  describe('custom HealthChecker implementation', () => {
    it('supports a custom checker with details', async () => {
      const custom: HealthChecker = {
        name: 'custom',
        check: async () => ({
          status: 'healthy',
          message: 'all good',
          details: { version: '1.0' },
        }),
      };
      registry.register(custom);
      const result = await registry.checkAll();
      expect(result['custom']?.details?.['version']).toBe('1.0');
    });
  });
});

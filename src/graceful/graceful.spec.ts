import { GracefulShutdown, createGracefulShutdown } from './index';

describe('GracefulShutdown', () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('register / shutdown', () => {
    it('runs a registered hook on shutdown', async () => {
      const gs = new GracefulShutdown();
      const hook = jest.fn().mockResolvedValue(undefined);
      gs.register('db', hook);
      await gs.shutdown();
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('runs multiple hooks in LIFO order', async () => {
      const order: string[] = [];
      const gs = new GracefulShutdown();
      gs.register('first', async () => { order.push('first'); });
      gs.register('second', async () => { order.push('second'); });
      gs.register('third', async () => { order.push('third'); });
      await gs.shutdown();
      expect(order).toEqual(['third', 'second', 'first']);
    });

    it('returns this for method chaining', () => {
      const gs = new GracefulShutdown();
      const result = gs.register('noop', async () => {});
      expect(result).toBe(gs);
    });
  });

  describe('shutdown() error handling', () => {
    it('throws AggregateError when a hook fails', async () => {
      const gs = new GracefulShutdown();
      gs.register('bad', async () => { throw new Error('hook failed'); });
      await expect(gs.shutdown()).rejects.toBeInstanceOf(AggregateError);
    });

    it('continues running remaining hooks after a failure', async () => {
      const gs = new GracefulShutdown();
      const good = jest.fn().mockResolvedValue(undefined);
      gs.register('good', good);
      gs.register('bad', async () => { throw new Error('fail'); });

      // LIFO: bad runs first, then good.
      await gs.shutdown().catch(() => {});
      expect(good).toHaveBeenCalled();
    });

    it('includes error count in AggregateError message', async () => {
      const gs = new GracefulShutdown();
      gs.register('a', async () => { throw new Error('err-a'); });
      gs.register('b', async () => { throw new Error('err-b'); });

      try {
        await gs.shutdown();
        fail('should have thrown');
      } catch (err) {
        expect((err as AggregateError).message).toContain('2 error(s)');
      }
    });
  });

  describe('timeout', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('rejects if a hook takes longer than timeoutMs', async () => {
      const gs = new GracefulShutdown({ timeoutMs: 100 });
      gs.register('slow', () => new Promise(() => {})); // never resolves

      const promise = gs.shutdown();
      jest.advanceTimersByTime(200);
      await expect(promise).rejects.toBeInstanceOf(AggregateError);
    });
  });

  describe('shutdown() with signal', () => {
    it('logs the signal name', async () => {
      const gs = new GracefulShutdown();
      await gs.shutdown('SIGTERM');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SIGTERM'));
    });

    it('works without a signal argument', async () => {
      const gs = new GracefulShutdown();
      await expect(gs.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('listen()', () => {
    it('registers SIGTERM and SIGINT handlers without error', () => {
      const gs = new GracefulShutdown();
      const onceSpy = jest.spyOn(process, 'once').mockImplementation(() => process);
      gs.listen();
      expect(onceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      onceSpy.mockRestore();
    });

    it('registers handlers only once even if called multiple times', () => {
      const gs = new GracefulShutdown();
      const onceSpy = jest.spyOn(process, 'once').mockImplementation(() => process);
      gs.listen();
      gs.listen(); // second call should be a no-op
      // Should still be called exactly twice (SIGTERM + SIGINT).
      expect(onceSpy).toHaveBeenCalledTimes(2);
      onceSpy.mockRestore();
    });

    it('returns this for method chaining', () => {
      const gs = new GracefulShutdown();
      const onceSpy = jest.spyOn(process, 'once').mockImplementation(() => process);
      const result = gs.listen();
      expect(result).toBe(gs);
      onceSpy.mockRestore();
    });
  });
});

describe('createGracefulShutdown()', () => {
  it('returns a GracefulShutdown instance', () => {
    const gs = createGracefulShutdown({ timeoutMs: 5000 });
    expect(gs).toBeInstanceOf(GracefulShutdown);
  });

  it('works without options', () => {
    expect(() => createGracefulShutdown()).not.toThrow();
  });
});

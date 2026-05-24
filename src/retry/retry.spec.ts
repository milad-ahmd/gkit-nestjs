import {
  retry,
  Backoff,
  StopError,
  MaxAttemptsError,
  isMaxAttemptsError,
  stop,
  DefaultExponential,
  RetryOptions,
} from './index';

describe('Backoff', () => {
  describe('fixed', () => {
    it('returns the same delay for every attempt', () => {
      const fn = Backoff.fixed(200);
      expect(fn(0)).toBe(200);
      expect(fn(1)).toBe(200);
      expect(fn(5)).toBe(200);
    });

    it('returns 0 when delayMs is 0', () => {
      const fn = Backoff.fixed(0);
      expect(fn(0)).toBe(0);
    });
  });

  describe('exponential', () => {
    it('doubles the delay with multiplier 2', () => {
      const fn = Backoff.exponential(100, 2, 0);
      expect(fn(0)).toBe(100);
      expect(fn(1)).toBe(200);
      expect(fn(2)).toBe(400);
    });

    it('caps delay at maxMs', () => {
      const fn = Backoff.exponential(100, 2, 300);
      expect(fn(2)).toBe(300);
      expect(fn(10)).toBe(300);
    });

    it('does not cap when maxMs is 0', () => {
      const fn = Backoff.exponential(100, 2, 0);
      expect(fn(10)).toBe(100 * Math.pow(2, 10));
    });
  });

  describe('withJitter', () => {
    it('returns a value between 0 and base delay', () => {
      const base = Backoff.fixed(1000);
      const jittered = Backoff.withJitter(base);
      const delay = jittered(0);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    it('returns 0 when base delay is 0', () => {
      const base = Backoff.fixed(0);
      const jittered = Backoff.withJitter(base);
      expect(jittered(0)).toBe(0);
    });

    it('returns 0 when base delay is negative', () => {
      const jittered = Backoff.withJitter(() => -10);
      expect(jittered(0)).toBe(0);
    });
  });
});

describe('DefaultExponential', () => {
  it('starts at 100ms and is capped at 30_000ms', () => {
    expect(DefaultExponential(0)).toBe(100);
    expect(DefaultExponential(100)).toBe(30_000);
  });
});

describe('StopError', () => {
  it('wraps an Error cause', () => {
    const cause = new Error('original');
    const se = new StopError(cause);
    expect(se.name).toBe('StopError');
    expect(se.cause).toBe(cause);
    expect(se.message).toBe('original');
  });

  it('wraps a string cause', () => {
    const se = new StopError('oops');
    expect(se.cause).toBe('oops');
    expect(se.message).toBe('oops');
  });
});

describe('stop()', () => {
  it('returns a StopError', () => {
    const err = stop(new Error('test'));
    expect(err).toBeInstanceOf(StopError);
  });
});

describe('MaxAttemptsError', () => {
  it('captures attempts and last error', () => {
    const last = new Error('final');
    const err = new MaxAttemptsError(3, last);
    expect(err.name).toBe('MaxAttemptsError');
    expect(err.attempts).toBe(3);
    expect(err.last).toBe(last);
    expect(err.message).toContain('3 attempts');
    expect(err.message).toContain('final');
  });
});

describe('isMaxAttemptsError()', () => {
  it('returns true for MaxAttemptsError', () => {
    expect(isMaxAttemptsError(new MaxAttemptsError(1, null))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isMaxAttemptsError(new Error('x'))).toBe(false);
  });

  it('returns false for non-error', () => {
    expect(isMaxAttemptsError('string')).toBe(false);
  });
});

describe('retry()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');

    const promise = retry(fn, { maxAttempts: 5, backoff: Backoff.fixed(0) });
    // Advance timers for any sleeps (backoff = 0 so no real waiting needed).
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws MaxAttemptsError when all attempts fail', async () => {
    const cause = new Error('always fails');
    const fn = jest.fn().mockRejectedValue(cause);

    await expect(
      retry(fn, { maxAttempts: 3, backoff: Backoff.fixed(0) }),
    ).rejects.toBeInstanceOf(MaxAttemptsError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('aborts immediately when StopError is thrown', async () => {
    const original = new Error('stop me');
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new StopError(original));

    await expect(retry(fn, { maxAttempts: 5 })).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with correct attempt numbers', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('done');

    const onRetry = jest.fn();
    const promise = retry(fn, { maxAttempts: 5, backoff: Backoff.fixed(0), onRetry });
    await jest.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
  });

  it('throws when maxAttempts < 1', async () => {
    await expect(retry(jest.fn(), { maxAttempts: 0 })).rejects.toThrow('maxAttempts must be >= 1');
  });

  it('defaults to maxAttempts = 3', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('x'));
    await expect(retry(fn, { backoff: Backoff.fixed(0) })).rejects.toBeInstanceOf(MaxAttemptsError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses no delay by default', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('x'));
    // No backoff specified → Backoff.fixed(0) → no sleep
    const promise = retry(fn, { maxAttempts: 2 });
    // Should not need timer advancement for delay=0 path
    await expect(promise).rejects.toBeInstanceOf(MaxAttemptsError);
  });

  it('waits the backoff delay between attempts', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue('ok');

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const promise = retry(fn, { maxAttempts: 3, backoff: Backoff.fixed(500) });
    await jest.runAllTimersAsync();
    await promise;

    // setTimeout should have been called for the sleep(500)
    const sleepCall = setTimeoutSpy.mock.calls.find((c) => c[1] === 500);
    expect(sleepCall).toBeDefined();
  });
});

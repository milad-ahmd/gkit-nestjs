import { CircuitBreaker, CircuitBreakerState, CircuitOpenError } from './index';

function makeBreaker(opts: ConstructorParameters<typeof CircuitBreaker>[0] = {}) {
  return new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 1,
    openTimeoutMs: 1000,
    ...opts,
  });
}

async function failN(breaker: CircuitBreaker, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
  }
}

describe('CircuitOpenError', () => {
  it('contains retryAfterMs in message', () => {
    const err = new CircuitOpenError(500);
    expect(err.name).toBe('CircuitOpenError');
    expect(err.message).toContain('500ms');
  });

  it('works without retryAfterMs', () => {
    const err = new CircuitOpenError();
    expect(err.message).toContain('open');
  });
});

describe('CircuitBreaker', () => {
  describe('CLOSED state', () => {
    it('starts in CLOSED state', () => {
      const cb = makeBreaker();
      expect(cb.state).toBe(CircuitBreakerState.CLOSED);
    });

    it('executes fn and returns result in CLOSED state', async () => {
      const cb = makeBreaker();
      const result = await cb.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('resets failure count on success', async () => {
      const cb = makeBreaker({ failureThreshold: 3 });
      await cb.execute(() => Promise.reject(new Error('x'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('x'))).catch(() => {});
      // Success — should reset failures.
      await cb.execute(() => Promise.resolve('ok'));
      // Two more failures should not trip (3 failures needed after reset).
      await cb.execute(() => Promise.reject(new Error('x'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('x'))).catch(() => {});
      expect(cb.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    it('trips to OPEN after failureThreshold consecutive failures', async () => {
      const cb = makeBreaker({ failureThreshold: 3 });
      await failN(cb, 3);
      expect(cb.state).toBe(CircuitBreakerState.OPEN);
    });

    it('throws CircuitOpenError when OPEN', async () => {
      const cb = makeBreaker({ failureThreshold: 1 });
      await failN(cb, 1);
      await expect(cb.execute(() => Promise.resolve('x'))).rejects.toBeInstanceOf(CircuitOpenError);
    });

    it('does not call fn when circuit is OPEN', async () => {
      const cb = makeBreaker({ failureThreshold: 1 });
      await failN(cb, 1);
      const fn = jest.fn().mockResolvedValue('ok');
      await cb.execute(fn).catch(() => {});
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('HALF_OPEN state', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('transitions to HALF_OPEN after openTimeoutMs', async () => {
      const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 500 });
      await failN(cb, 1);
      expect(cb.state).toBe(CircuitBreakerState.OPEN);

      jest.advanceTimersByTime(600);
      expect(cb.state).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('closes circuit on success in HALF_OPEN', async () => {
      const cb = makeBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 100 });
      await failN(cb, 1);
      jest.advanceTimersByTime(200);

      // Probe succeeds → should close.
      await cb.execute(() => Promise.resolve('probe'));
      expect(cb.state).toBe(CircuitBreakerState.CLOSED);
    });

    it('re-opens circuit on failure in HALF_OPEN', async () => {
      const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 100 });
      await failN(cb, 1);
      jest.advanceTimersByTime(200);

      // Probe fails → re-open.
      await cb.execute(() => Promise.reject(new Error('probe fail'))).catch(() => {});
      expect(cb.state).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('reset()', () => {
    it('resets breaker to CLOSED and clears counters', async () => {
      const cb = makeBreaker({ failureThreshold: 1 });
      await failN(cb, 1);
      expect(cb.state).toBe(CircuitBreakerState.OPEN);
      cb.reset();
      expect(cb.state).toBe(CircuitBreakerState.CLOSED);
      // Should execute normally now.
      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    });
  });

  describe('onStateChange callback', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('calls onStateChange when transitioning CLOSED → OPEN', async () => {
      const onStateChange = jest.fn();
      const cb = makeBreaker({ failureThreshold: 2, onStateChange });
      await failN(cb, 2);
      await jest.runAllTimersAsync();
      expect(onStateChange).toHaveBeenCalledWith(CircuitBreakerState.CLOSED, CircuitBreakerState.OPEN);
    });

    it('calls onStateChange when transitioning OPEN → HALF_OPEN', async () => {
      const onStateChange = jest.fn();
      const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 50, onStateChange });
      await failN(cb, 1);
      jest.advanceTimersByTime(100);
      cb.state; // trigger the check
      await jest.runAllTimersAsync();
      expect(onStateChange).toHaveBeenCalledWith(CircuitBreakerState.OPEN, CircuitBreakerState.HALF_OPEN);
    });
  });

  describe('successThreshold', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('requires N successes in HALF_OPEN before closing', async () => {
      const cb = makeBreaker({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 100 });
      await failN(cb, 1);
      jest.advanceTimersByTime(200);

      // First probe success — should still be HALF_OPEN.
      await cb.execute(() => Promise.resolve('first'));
      expect(cb.state).toBe(CircuitBreakerState.HALF_OPEN);

      // Second probe success — should close now.
      await cb.execute(() => Promise.resolve('second'));
      expect(cb.state).toBe(CircuitBreakerState.CLOSED);
    });
  });
});

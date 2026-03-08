import { Future, Semaphore, Stream, fanOut, fanIn, debounce, throttle, Barrier } from './index';

// ---------------------------------------------------------------------------
// Future
// ---------------------------------------------------------------------------

describe('Future', () => {
  describe('of / await', () => {
    it('resolves with the function result', async () => {
      const f = Future.of(async () => 42);
      expect(await f.await()).toBe(42);
    });

    it('rejects when the function throws', async () => {
      const f = Future.of(async () => { throw new Error('boom'); });
      await expect(f.await()).rejects.toThrow('boom');
    });

    it('multiple await() calls return the same settled value', async () => {
      let calls = 0;
      const f = Future.of(async () => { calls++; return 'x'; });
      const [r1, r2] = await Promise.all([f.await(), f.await()]);
      expect(r1).toBe('x');
      expect(r2).toBe('x');
      expect(calls).toBe(1);
    });
  });

  describe('all', () => {
    it('resolves all futures in order', async () => {
      const futures = [Future.of(async () => 1), Future.of(async () => 2), Future.of(async () => 3)];
      const results = await Future.all(futures);
      expect(results).toEqual([1, 2, 3]);
    });

    it('rejects if any future rejects', async () => {
      const futures = [
        Future.of(async () => 1),
        Future.of(async () => { throw new Error('fail'); }),
      ];
      await expect(Future.all(futures)).rejects.toThrow('fail');
    });
  });

  describe('race', () => {
    it('resolves with the first settled future', async () => {
      const futures = [
        Future.of(() => new Promise<number>((r) => setTimeout(() => r(slow), 50))),
        Future.of(async () => 'fast' as unknown as number),
      ];
      const slow = 1;
      const result = await Future.race(futures);
      expect(result).toBe('fast');
    });
  });
});

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

describe('Semaphore', () => {
  it('throws when capacity < 1', () => {
    expect(() => new Semaphore(0)).toThrow('capacity must be >= 1');
  });

  it('reports correct capacity and initial available', () => {
    const s = new Semaphore(5);
    expect(s.capacity).toBe(5);
    expect(s.available).toBe(5);
  });

  it('acquire decrements available, release increments it', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    expect(s.available).toBe(1);
    s.release();
    expect(s.available).toBe(2);
  });

  it('tryAcquire returns true when available', () => {
    const s = new Semaphore(1);
    expect(s.tryAcquire()).toBe(true);
    expect(s.available).toBe(0);
  });

  it('tryAcquire returns false when no permit available', () => {
    const s = new Semaphore(1);
    s.tryAcquire();
    expect(s.tryAcquire()).toBe(false);
  });

  it('release throws when released more than acquired', async () => {
    const s = new Semaphore(2);
    // Don't acquire anything; release should throw.
    expect(() => s.release()).toThrow('released more times than acquired');
  });

  it('queues waiters when capacity is exhausted', async () => {
    const s = new Semaphore(1);
    await s.acquire(); // takes the only permit

    let released = false;
    const waiter = s.acquire().then(() => { released = true; });

    expect(released).toBe(false);
    s.release(); // hand permit to waiter
    await waiter;
    expect(released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

describe('Stream', () => {
  describe('fromArray', () => {
    it('collects all items', async () => {
      const result = await Stream.fromArray([1, 2, 3]).collect();
      expect(result).toEqual([1, 2, 3]);
    });

    it('collects an empty array', async () => {
      expect(await Stream.fromArray([]).collect()).toEqual([]);
    });
  });

  describe('generate', () => {
    it('emits values from producer', async () => {
      const stream = Stream.generate<number>(async (emit) => {
        emit(10);
        emit(20);
        emit(30);
      });
      expect(await stream.collect()).toEqual([10, 20, 30]);
    });
  });

  describe('map', () => {
    it('transforms each item', async () => {
      const result = await Stream.fromArray([1, 2, 3]).map((x) => x * 2).collect();
      expect(result).toEqual([2, 4, 6]);
    });

    it('supports async transforms', async () => {
      const result = await Stream.fromArray([1, 2]).map(async (x) => x + 10).collect();
      expect(result).toEqual([11, 12]);
    });
  });

  describe('filter', () => {
    it('keeps only matching items', async () => {
      const result = await Stream.fromArray([1, 2, 3, 4]).filter((x) => x % 2 === 0).collect();
      expect(result).toEqual([2, 4]);
    });
  });

  describe('take', () => {
    it('limits the number of items emitted', async () => {
      const result = await Stream.fromArray([1, 2, 3, 4, 5]).take(3).collect();
      expect(result).toEqual([1, 2, 3]);
    });

    it('emits all items when n >= length', async () => {
      const result = await Stream.fromArray([1, 2]).take(10).collect();
      expect(result).toEqual([1, 2]);
    });
  });

  describe('forEach', () => {
    it('calls fn for each item', async () => {
      const seen: number[] = [];
      await Stream.fromArray([1, 2, 3]).forEach((x) => { seen.push(x); });
      expect(seen).toEqual([1, 2, 3]);
    });
  });

  describe('Symbol.asyncIterator', () => {
    it('is iterable with for-await-of', async () => {
      const collected: number[] = [];
      for await (const n of Stream.fromArray([7, 8, 9])) {
        collected.push(n);
      }
      expect(collected).toEqual([7, 8, 9]);
    });
  });
});

// ---------------------------------------------------------------------------
// fanOut
// ---------------------------------------------------------------------------

describe('fanOut', () => {
  it('delivers all items to all consumers', async () => {
    const source = Stream.fromArray([1, 2, 3]);
    const [out1, out2] = fanOut(source, 2);

    const [r1, r2] = await Promise.all([
      (async () => { const items: number[] = []; for await (const x of out1!) items.push(x); return items; })(),
      (async () => { const items: number[] = []; for await (const x of out2!) items.push(x); return items; })(),
    ]);

    expect(r1).toEqual([1, 2, 3]);
    expect(r2).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// fanIn
// ---------------------------------------------------------------------------

describe('fanIn', () => {
  it('merges two streams into one', async () => {
    const s1 = Stream.fromArray([1, 2]);
    const s2 = Stream.fromArray([3, 4]);
    const merged: number[] = [];
    for await (const x of fanIn(s1, s2)) {
      merged.push(x);
    }
    expect(merged.sort()).toEqual([1, 2, 3, 4]);
  });

  it('returns empty when given no sources', async () => {
    const items: number[] = [];
    for await (const x of fanIn<number>()) {
      items.push(x);
    }
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls fn only once after rapid successive calls', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on each call', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);

    debounced();
    jest.advanceTimersByTime(50);
    debounced(); // reset
    jest.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------

describe('throttle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls fn at most once per interval', () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled(); // first call at t=0 → executes
    throttled(); // within interval → dropped
    throttled(); // within interval → dropped
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    throttled(); // interval elapsed → executes
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Barrier
// ---------------------------------------------------------------------------

describe('Barrier', () => {
  it('throws when n < 1', () => {
    expect(() => new Barrier(0)).toThrow('n must be >= 1');
  });

  it('releases all waiters once the last participant arrives', async () => {
    const barrier = new Barrier(3);
    const passed: number[] = [];

    const participants = [1, 2, 3].map((id) =>
      barrier.wait().then(() => passed.push(id)),
    );

    await Promise.all(participants);
    expect(passed).toHaveLength(3);
  });

  it('resolves immediately when n=1', async () => {
    const barrier = new Barrier(1);
    await expect(barrier.wait()).resolves.toBeUndefined();
  });
});

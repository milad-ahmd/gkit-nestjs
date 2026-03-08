/**
 * Async concurrency primitives — Future, Semaphore, Stream, FanOut, FanIn,
 * Debounce, Throttle, Barrier.
 *
 * Mirrors the Go gkit/pkg/async package.
 */

// ---------------------------------------------------------------------------
// Future<T>
//
// A Future represents the eventual result of an asynchronous computation.
// It is created with Future.of(fn) which immediately starts the computation.
// Calling await() returns a promise that resolves to the result.

export class Future<T> {
  private readonly promise: Promise<T>;

  private constructor(promise: Promise<T>) {
    this.promise = promise;
  }

  /**
   * Spawns fn immediately and returns a Future handle.
   * Multiple calls to await() all receive the same settled result.
   */
  static of<T>(fn: () => Promise<T>): Future<T> {
    // The promise is created once and cached — subsequent awaits reuse it.
    return new Future<T>(fn());
  }

  /** Awaits the future's result. Safe to call multiple times. */
  await(): Promise<T> {
    return this.promise;
  }

  /**
   * Runs all futures concurrently and returns their results in order.
   * If any future rejects, the returned promise rejects with that error.
   */
  static all<T>(futures: Future<T>[]): Promise<T[]> {
    return Promise.all(futures.map((f) => f.await()));
  }

  /**
   * Returns the result of whichever future settles first.
   * Mirrors Go's async.Race.
   */
  static race<T>(futures: Future<T>[]): Promise<T> {
    return Promise.race(futures.map((f) => f.await()));
  }
}

// ---------------------------------------------------------------------------
// Semaphore
//
// Counting semaphore using a counter + queue of waiting resolvers.
// acquire() blocks until a permit is available.

export class Semaphore {
  private _available: number;
  private readonly _capacity: number;
  private readonly _waiters: Array<() => void> = [];

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('Semaphore: capacity must be >= 1');
    this._capacity = capacity;
    this._available = capacity;
  }

  get available(): number {
    return this._available;
  }

  get capacity(): number {
    return this._capacity;
  }

  /** Acquires a permit, waiting until one becomes available. */
  acquire(): Promise<void> {
    if (this._available > 0) {
      this._available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._waiters.push(resolve);
    });
  }

  /** Attempts to acquire a permit without blocking. Returns true on success. */
  tryAcquire(): boolean {
    if (this._available > 0) {
      this._available--;
      return true;
    }
    return false;
  }

  /**
   * Returns a permit to the pool. Must be called exactly once per successful
   * acquire. Panics if called more times than acquire.
   */
  release(): void {
    const next = this._waiters.shift();
    if (next) {
      // Hand the permit directly to the next waiter — don't increment available.
      next();
    } else {
      if (this._available >= this._capacity) {
        throw new Error('Semaphore: released more times than acquired');
      }
      this._available++;
    }
  }
}

// ---------------------------------------------------------------------------
// Stream<T>
//
// Lazy, push-based async stream built on async generators.
// Operators (map, filter, take) each return a new Stream, forming a pipeline.

export class Stream<T> {
  private readonly source: () => AsyncIterable<T>;

  private constructor(source: () => AsyncIterable<T>) {
    this.source = source;
  }

  /** Creates a Stream from a producer function that calls emit() for each value. */
  static generate<T>(fn: (emit: (value: T) => void) => Promise<void>): Stream<T> {
    return new Stream<T>(() => streamFromProducer(fn));
  }

  /** Creates a Stream that emits all values from an array. */
  static fromArray<T>(arr: T[]): Stream<T> {
    return new Stream<T>(async function* () {
      for (const item of arr) {
        yield item;
      }
    });
  }

  /** Transforms each item with fn. */
  map<U>(fn: (value: T) => U | Promise<U>): Stream<U> {
    const source = this.source;
    return new Stream<U>(async function* () {
      for await (const item of source()) {
        yield await fn(item);
      }
    });
  }

  /** Passes only items for which predicate returns true. */
  filter(predicate: (value: T) => boolean | Promise<boolean>): Stream<T> {
    const source = this.source;
    return new Stream<T>(async function* () {
      for await (const item of source()) {
        if (await predicate(item)) {
          yield item;
        }
      }
    });
  }

  /** Emits at most n items. */
  take(n: number): Stream<T> {
    const source = this.source;
    return new Stream<T>(async function* () {
      let count = 0;
      for await (const item of source()) {
        if (count >= n) break;
        yield item;
        count++;
      }
    });
  }

  /** Drains the stream and returns all items as an array. */
  async collect(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.source()) {
      out.push(item);
    }
    return out;
  }

  /** Calls fn for each item in the stream. */
  async forEach(fn: (value: T) => void | Promise<void>): Promise<void> {
    for await (const item of this.source()) {
      await fn(item);
    }
  }

  /** Exposes the underlying AsyncIterable for use with for-await-of. */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.source()[Symbol.asyncIterator]();
  }
}

async function* streamFromProducer<T>(
  fn: (emit: (value: T) => void) => Promise<void>,
): AsyncGenerator<T> {
  const buffer: T[] = [];
  let done = false;
  let resolve: (() => void) | null = null;

  const emit = (value: T): void => {
    buffer.push(value);
    resolve?.();
    resolve = null;
  };

  const producerPromise = fn(emit).then(() => {
    done = true;
    resolve?.();
    resolve = null;
  });

  while (true) {
    while (buffer.length > 0) {
      yield buffer.shift() as T;
    }
    if (done) break;
    await new Promise<void>((r) => {
      resolve = r;
    });
  }

  await producerPromise;
}

// ---------------------------------------------------------------------------
// FanOut — broadcast one AsyncIterable to N independent output AsyncIterables

/**
 * Broadcasts all items from source to n independent async iterables.
 * Each output receives a copy of every item.
 * Note: all consumers must be iterated for the source to advance.
 */
export function fanOut<T>(source: AsyncIterable<T>, n: number): AsyncIterable<T>[] {
  const buffers: T[][] = Array.from({ length: n }, () => []);
  const resolvers: Array<(() => void) | null> = new Array(n).fill(null);
  let sourceDone = false;

  // Drain source into all buffers.
  (async () => {
    for await (const item of source) {
      for (let i = 0; i < n; i++) {
        buffers[i].push(item);
        resolvers[i]?.();
        resolvers[i] = null;
      }
    }
    sourceDone = true;
    for (let i = 0; i < n; i++) {
      resolvers[i]?.();
      resolvers[i] = null;
    }
  })();

  return Array.from({ length: n }, (_, idx) => ({
    [Symbol.asyncIterator]: async function* () {
      while (true) {
        while (buffers[idx].length > 0) {
          yield buffers[idx].shift() as T;
        }
        if (sourceDone && buffers[idx].length === 0) break;
        await new Promise<void>((r) => {
          resolvers[idx] = r;
        });
      }
    },
  }));
}

// ---------------------------------------------------------------------------
// FanIn (Merge) — combine N AsyncIterables into one

/**
 * Merges multiple async iterables into one output async iterable.
 * Terminates when all inputs are exhausted.
 */
export async function* fanIn<T>(...sources: AsyncIterable<T>[]): AsyncIterable<T> {
  const queue: T[] = [];
  let activeCount = sources.length;
  let resolve: (() => void) | null = null;

  if (activeCount === 0) return;

  const push = (item: T): void => {
    queue.push(item);
    resolve?.();
    resolve = null;
  };

  const done = (): void => {
    activeCount--;
    resolve?.();
    resolve = null;
  };

  for (const source of sources) {
    (async () => {
      for await (const item of source) {
        push(item);
      }
      done();
    })();
  }

  while (activeCount > 0 || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift() as T;
    }
    if (activeCount === 0) break;
    await new Promise<void>((r) => {
      resolve = r;
    });
  }
}

// ---------------------------------------------------------------------------
// Debounce
//
// Groups rapid calls into one, fired after the quiet period expires.

/**
 * Returns a function that delays calling fn until delayMs has elapsed since
 * the last call. Multiple rapid calls result in a single fn invocation.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
}

// ---------------------------------------------------------------------------
// Throttle
//
// Limits fn to at most one call per intervalMs.

/**
 * Returns a function that calls fn at most once per intervalMs.
 * Additional calls within the window are dropped.
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  intervalMs: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>): void => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      lastCall = now;
      fn(...args);
    }
  };
}

// ---------------------------------------------------------------------------
// Barrier
//
// A rendezvous point: n goroutines call wait() and all block until the last
// one arrives, at which point all are released simultaneously.

export class Barrier {
  private readonly n: number;
  private count: number = 0;
  private readonly resolvers: Array<() => void> = [];

  constructor(n: number) {
    if (n < 1) throw new Error('Barrier: n must be >= 1');
    this.n = n;
  }

  /**
   * Blocks until all n participants have called wait().
   * Returns a promise that resolves when the barrier is lifted.
   */
  wait(): Promise<void> {
    this.count++;
    if (this.count >= this.n) {
      // Last one in — release all waiters.
      for (const r of this.resolvers) r();
      this.resolvers.length = 0;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

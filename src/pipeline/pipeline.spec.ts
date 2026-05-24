import { process as pipelineProcess, chain, compose, Pipeline, StageFunc } from './index';

// ---------------------------------------------------------------------------
// process()
// ---------------------------------------------------------------------------

describe('process()', () => {
  it('maps items through fn', async () => {
    const result = await pipelineProcess([1, 2, 3], async (x) => x * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it('returns an empty array for empty input', async () => {
    const fn = jest.fn().mockResolvedValue(0);
    const result = await pipelineProcess([], fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('preserves order of results', async () => {
    // Simulate variable-latency tasks.
    const delays = [30, 10, 20];
    const result = await pipelineProcess(
      [0, 1, 2],
      (i) =>
        new Promise<number>((resolve) =>
          setTimeout(() => resolve(i * 10), delays[i]),
        ),
      3,
    );
    expect(result).toEqual([0, 10, 20]);
  });

  it('limits concurrency to workers count', async () => {
    let running = 0;
    let maxRunning = 0;
    const workers = 2;

    await pipelineProcess(
      [0, 1, 2, 3, 4],
      () =>
        new Promise<void>((resolve) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          setTimeout(() => { running--; resolve(); }, 10);
        }),
      workers,
    );

    expect(maxRunning).toBeLessThanOrEqual(workers);
  });

  it('propagates errors from fn', async () => {
    await expect(
      pipelineProcess([1], async () => { throw new Error('stage error'); }),
    ).rejects.toThrow('stage error');
  });
});

// ---------------------------------------------------------------------------
// chain()
// ---------------------------------------------------------------------------

describe('chain()', () => {
  it('pipes through multiple stages in order', async () => {
    const add1: StageFunc<number, number> = async (x) => x + 1;
    const mul2: StageFunc<number, number> = async (x) => x * 2;
    const sub3: StageFunc<number, number> = async (x) => x - 3;

    const chained = chain(add1, mul2, sub3);
    // (5 + 1) * 2 - 3 = 9
    expect(await chained(5)).toBe(9);
  });

  it('returns the identity when no stages are given', async () => {
    const chained = chain<number>();
    expect(await chained(42)).toBe(42);
  });

  it('propagates errors', async () => {
    const fail: StageFunc<number, number> = async () => { throw new Error('boom'); };
    await expect(chain(fail)(1)).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// compose()
// ---------------------------------------------------------------------------

describe('compose()', () => {
  it('composes two stages', async () => {
    const toString: StageFunc<number, string> = async (x) => String(x);
    const addBang: StageFunc<string, string> = async (s) => s + '!';

    const composed = compose(toString, addBang);
    expect(await composed(7)).toBe('7!');
  });

  it('propagates errors from the first stage', async () => {
    const fail: StageFunc<number, string> = async () => { throw new Error('first'); };
    const noop: StageFunc<string, string> = async (s) => s;
    await expect(compose(fail, noop)(1)).rejects.toThrow('first');
  });

  it('propagates errors from the second stage', async () => {
    const passthrough: StageFunc<number, number> = async (x) => x;
    const fail: StageFunc<number, number> = async () => { throw new Error('second'); };
    await expect(compose(passthrough, fail)(1)).rejects.toThrow('second');
  });
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

describe('Pipeline', () => {
  it('wraps a value', () => {
    const p = Pipeline.of(10);
    expect(p.get()).toBe(10);
  });

  it('chains stages via pipe()', async () => {
    const p1 = await Pipeline.of(5).pipe(async (x) => x * 2); // Pipeline(10)
    expect(p1.get()).toBe(10);

    const p2 = await p1.pipe(async (x) => x - 3); // Pipeline(7)
    expect(p2.get()).toBe(7);
  });

  it('propagates errors through pipe()', async () => {
    const p = Pipeline.of(1);
    await expect(
      p.pipe(async () => { throw new Error('pipe error'); }),
    ).rejects.toThrow('pipe error');
  });
});

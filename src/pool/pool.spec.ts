import { WorkerPool } from './index';

describe('WorkerPool', () => {
  it('submits and returns a task result', async () => {
    const pool = new WorkerPool(2);
    const result = await pool.submit(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('reports correct capacity', () => {
    const pool = new WorkerPool(5);
    expect(pool.capacity).toBe(5);
  });

  it('limits concurrency to the pool size', async () => {
    const concurrency = 2;
    const pool = new WorkerPool(concurrency);

    let running = 0;
    let maxRunning = 0;

    const task = () =>
      new Promise<void>((resolve) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        setTimeout(() => {
          running--;
          resolve();
        }, 20);
      });

    const tasks = Array.from({ length: 6 }, () => pool.submit(task));
    await Promise.all(tasks);

    expect(maxRunning).toBeLessThanOrEqual(concurrency);
  });

  it('drain() waits for all submitted tasks', async () => {
    const pool = new WorkerPool(3);
    const completed: number[] = [];

    for (let i = 0; i < 5; i++) {
      const idx = i;
      pool.submit(async () => {
        await new Promise((r) => setTimeout(r, 10));
        completed.push(idx);
      });
    }

    await pool.drain();
    expect(completed).toHaveLength(5);
  });

  it('propagates task errors to the caller', async () => {
    const pool = new WorkerPool(2);
    const err = new Error('task failed');
    await expect(pool.submit(() => Promise.reject(err))).rejects.toBe(err);
  });

  it('available decreases when tasks are running', async () => {
    const pool = new WorkerPool(3);
    // Initially all permits available.
    expect(pool.available).toBe(3);

    let releaser: (() => void) | null = null;
    const blocker = () =>
      new Promise<void>((resolve) => {
        releaser = resolve;
      });

    const taskPromise = pool.submit(blocker);
    // Give the event loop a tick to acquire the semaphore.
    await Promise.resolve();
    expect(pool.available).toBe(2);

    releaser!();
    await taskPromise;
    expect(pool.available).toBe(3);
  });

  it('runs tasks sequentially with concurrency 1', async () => {
    const pool = new WorkerPool(1);
    const order: number[] = [];

    await Promise.all([
      pool.submit(async () => { order.push(1); }),
      pool.submit(async () => { order.push(2); }),
      pool.submit(async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});

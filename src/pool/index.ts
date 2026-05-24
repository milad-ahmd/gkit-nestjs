import { Semaphore } from '../async';

export class WorkerPool {
  private readonly semaphore: Semaphore;
  private readonly pending: Promise<unknown>[] = [];

  constructor(private readonly concurrency: number) {
    this.semaphore = new Semaphore(concurrency);
  }

  async submit<T>(fn: () => Promise<T>): Promise<T> {
    const task = (async () => {
      await this.semaphore.acquire();
      try {
        return await fn();
      } finally {
        this.semaphore.release();
      }
    })();
    this.pending.push(task);
    return task;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.pending);
    this.pending.length = 0;
  }

  get capacity(): number { return this.concurrency; }
  get available(): number { return this.semaphore.available; }
}

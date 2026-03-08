export interface JobDefinition {
  name: string;
  handler: () => Promise<void>;
}

export type ErrorHandler = (job: JobDefinition, error: Error) => void;

export class Scheduler {
  private readonly jobs: Array<{ def: JobDefinition; intervalMs: number; delayMs: number; once: boolean }> = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private onError?: ErrorHandler;

  constructor(private readonly workers = 1, onError?: ErrorHandler) {
    this.onError = onError;
  }

  every(intervalMs: number, name: string, handler: () => Promise<void>): this {
    this.jobs.push({ def: { name, handler }, intervalMs, delayMs: 0, once: false });
    return this;
  }

  after(delayMs: number, name: string, handler: () => Promise<void>): this {
    this.jobs.push({ def: { name, handler }, intervalMs: 0, delayMs, once: true });
    return this;
  }

  start(): void {
    for (const entry of this.jobs) {
      if (entry.once) {
        const timer = setTimeout(() => this.dispatch(entry.def).catch(console.error), entry.delayMs);
        this.timers.push(timer);
      } else {
        // Run immediately, then repeat
        this.dispatch(entry.def).catch(console.error);
        const timer = setInterval(() => this.dispatch(entry.def).catch(console.error), entry.intervalMs);
        this.timers.push(timer);
      }
    }
  }

  stop(): void {
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers.length = 0;
  }

  private async dispatch(job: JobDefinition): Promise<void> {
    try {
      await job.handler();
    } catch (err) {
      if (this.onError) this.onError(job, err as Error);
      else console.error(`Job '${job.name}' failed:`, err);
    }
  }
}

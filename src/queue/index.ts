import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly pollIntervalMs = 2000,
  ) {}

  register<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  async enqueue<T>(type: string, payload: T, opts: { maxAttempts?: number; delayMs?: number } = {}): Promise<void> {
    const { maxAttempts = 3, delayMs = 0 } = opts;
    const runAt = new Date(Date.now() + delayMs);
    const raw = JSON.stringify(payload);
    await this.pool.query(
      'INSERT INTO jobs (type, payload, max_attempts, run_at) VALUES ($1, $2::jsonb, $3, $4)',
      [type, raw, maxAttempts, runAt],
    );
  }

  start(workers = 1): void {
    for (let i = 0; i < workers; i++) {
      this.timer = setInterval(() => this.processBatch().catch(console.error), this.pollIntervalMs);
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async processBatch(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, type, payload, attempts, max_attempts FROM jobs
         WHERE status='pending' AND run_at <= NOW() ORDER BY run_at LIMIT 10
         FOR UPDATE SKIP LOCKED`,
      );
      for (const row of rows) {
        const handler = this.handlers.get(row.type);
        if (!handler) {
          await client.query("UPDATE jobs SET status='failed', last_error=$1 WHERE id=$2", [`no handler for ${row.type}`, row.id]);
          continue;
        }
        const attempts = row.attempts + 1;
        try {
          await handler({ id: row.id, type: row.type, payload: JSON.parse(row.payload), attempts, maxAttempts: row.max_attempts, runAt: row.run_at, createdAt: row.created_at });
          await client.query("UPDATE jobs SET status='done', attempts=$1 WHERE id=$2", [attempts, row.id]);
        } catch (err: any) {
          if (attempts >= row.max_attempts) {
            await client.query("UPDATE jobs SET status='dead', attempts=$1, last_error=$2 WHERE id=$3", [attempts, err.message, row.id]);
          } else {
            const backoffMs = Math.min(Math.pow(2, attempts) * 10000, 3600000);
            const runAt = new Date(Date.now() + backoffMs);
            await client.query("UPDATE jobs SET status='pending', attempts=$1, last_error=$2, run_at=$3 WHERE id=$4", [attempts, err.message, runAt, row.id]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

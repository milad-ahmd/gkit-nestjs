import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

export interface OutboxMessage {
  id: string;
  topic: string;
  payload: unknown;
  createdAt: Date;
  publishedAt?: Date;
}

export interface OutboxPublisher {
  publish(topic: string, payload: Buffer): Promise<void>;
}

export class InMemoryOutboxPublisher implements OutboxPublisher {
  private messages: Array<{ topic: string; payload: Buffer }> = [];

  async publish(topic: string, payload: Buffer): Promise<void> {
    this.messages.push({ topic, payload });
  }

  getMessages() { return [...this.messages]; }
  clear() { this.messages = []; }
}

/** Store an outbox event within an existing transaction. */
export async function storeOutboxEvent(
  client: PoolClient,
  topic: string,
  payload: unknown,
): Promise<void> {
  const raw = JSON.stringify(payload);
  await client.query(
    'INSERT INTO outbox_events (topic, payload) VALUES ($1, $2::jsonb)',
    [topic, raw],
  );
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly publisher: OutboxPublisher,
    private readonly intervalMs = 5000,
    private readonly batchSize = 100,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.relay().catch(console.error), this.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async relay(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; topic: string; payload: string }>(
        `SELECT id, topic, payload FROM outbox_events
         WHERE published_at IS NULL ORDER BY created_at LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );
      if (rows.length === 0) { await client.query('ROLLBACK'); return; }

      for (const row of rows) {
        await this.publisher.publish(row.topic, Buffer.from(row.payload));
      }

      const ids = rows.map(r => r.id);
      await client.query(
        `UPDATE outbox_events SET published_at = NOW() WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

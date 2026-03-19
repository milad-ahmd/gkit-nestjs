import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import { JobQueue } from './index';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  attempts      INT         NOT NULL DEFAULT 0,
  max_attempts  INT         NOT NULL DEFAULT 3,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

describe('JobQueue Integration', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let queue: JobQueue;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_USER: 'gkit',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_DB: 'gkit',
      })
      .withWaitStrategy(Wait.forListeningPort())
      .start();

    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: 'gkit',
      password: 'secret',
      database: 'gkit',
    });

    await pool.query(SCHEMA);

    queue = new JobQueue(pool, { pollIntervalMs: 50 });
  });

  afterAll(async () => {
    queue.stop();
    await pool.end();
    await container.stop();
  });

  it('should enqueue and process a job', async () => {
    let processed = false;

    queue.register('test-job', async (payload) => {
      expect(payload.data).toEqual({ msg: 'hello' });
      processed = true;
    });

    await queue.enqueue('test-job', { msg: 'hello' });
    queue.start();

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (processed) { clearInterval(interval); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
    });

    expect(processed).toBe(true);
  });

  it('should retry a failing job', async () => {
    let attempts = 0;

    queue.register('retry-job', async () => {
      attempts++;
      if (attempts < 2) throw new Error('transient error');
    });

    await queue.enqueue('retry-job', {}, { maxAttempts: 3 });

    await new Promise(r => setTimeout(r, 3000));

    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});

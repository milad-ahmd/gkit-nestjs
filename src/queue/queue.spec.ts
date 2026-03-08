/**
 * JobQueue unit tests.
 *
 * The pg Pool is mocked — no real PostgreSQL connection is made.
 */

jest.mock('pg');

import { Pool, PoolClient } from 'pg';
import { JobQueue } from './index';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockClient(): jest.Mocked<PoolClient> {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  } as unknown as jest.Mocked<PoolClient>;
}

function makeMockPool(client: jest.Mocked<PoolClient>): jest.Mocked<Pool> {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue(client),
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pool>;
}

describe('JobQueue', () => {
  let mockClient: jest.Mocked<PoolClient>;
  let mockPool: jest.Mocked<Pool>;
  let queue: JobQueue;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockClient = makeMockClient();
    mockPool = makeMockPool(mockClient);
    (Pool as unknown as jest.Mock).mockImplementation(() => mockPool);
    queue = new JobQueue(mockPool, 500);
  });

  afterEach(() => {
    queue.stop();
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  describe('register()', () => {
    it('registers a handler for a job type without throwing', () => {
      expect(() => {
        queue.register('send-email', async () => {});
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  describe('enqueue()', () => {
    it('inserts a job row via pool.query', async () => {
      await queue.enqueue('send-email', { to: 'user@example.com' });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO jobs'),
        expect.arrayContaining(['send-email']),
      );
    });

    it('passes maxAttempts and runAt derived from delayMs', async () => {
      await queue.enqueue('task', { key: 'val' }, { maxAttempts: 5, delayMs: 10000 });
      const call = (mockPool.query as jest.Mock).mock.calls[0];
      expect(call[1][2]).toBe(5); // maxAttempts
      const runAt = call[1][3] as Date;
      expect(runAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('uses defaults for maxAttempts (3) and delayMs (0)', async () => {
      await queue.enqueue('task', {});
      const call = (mockPool.query as jest.Mock).mock.calls[0];
      expect(call[1][2]).toBe(3); // default maxAttempts
    });
  });

  // -------------------------------------------------------------------------
  // start / stop
  // -------------------------------------------------------------------------

  describe('start() / stop()', () => {
    it('starts polling and sets an interval', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      queue.start(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 500);
      setIntervalSpy.mockRestore();
    });

    it('stop() clears the interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      queue.start(1);
      queue.stop();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('stop() is idempotent — can be called multiple times without throwing', () => {
      queue.start(1);
      queue.stop();
      expect(() => queue.stop()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // processBatch (via poll tick simulation)
  // -------------------------------------------------------------------------

  describe('processBatch (via timer)', () => {
    it('calls a registered handler for a pending job', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.register('my-job', handler);

      // Simulate the poll tick returning one pending job.
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'job-1',
              type: 'my-job',
              payload: JSON.stringify({ data: 'test' }),
              attempts: 0,
              max_attempts: 3,
              run_at: new Date(),
              created_at: new Date(),
            },
          ],
          rowCount: 1,
        } as never)
        .mockResolvedValue({ rows: [], rowCount: 0 } as never); // UPDATE + COMMIT

      queue.start(1);
      jest.advanceTimersByTime(500);
      await jest.runAllTimersAsync();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1', type: 'my-job' }),
      );
    });

    it('marks job as failed when no handler is registered', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'job-2', type: 'orphan', payload: '{}', attempts: 0, max_attempts: 3 }],
          rowCount: 1,
        } as never)
        .mockResolvedValue({ rows: [], rowCount: 0 } as never);

      queue.start(1);
      jest.advanceTimersByTime(500);
      await jest.runAllTimersAsync();

      // Should have issued an UPDATE ... SET status='failed' call.
      const updateCall = (mockClient.query as jest.Mock).mock.calls.find(
        (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes("status='failed'"),
      );
      expect(updateCall).toBeDefined();
    });
  });
});

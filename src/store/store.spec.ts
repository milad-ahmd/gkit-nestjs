/**
 * Store unit tests.
 *
 * The pg Pool is mocked — no real PostgreSQL connection is made.
 */

jest.mock('pg');

import { Pool, PoolClient } from 'pg';
import { Store } from './index';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockClient(overrides: Partial<jest.Mocked<PoolClient>> = {}): jest.Mocked<PoolClient> {
  return {
    query: jest.fn(),
    release: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<PoolClient>;
}

function makeMockPool(
  client: jest.Mocked<PoolClient>,
  queryResult: { rows: unknown[]; rowCount: number } = { rows: [], rowCount: 0 },
): jest.Mocked<Pool> {
  return {
    query: jest.fn().mockResolvedValue(queryResult),
    connect: jest.fn().mockResolvedValue(client),
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pool>;
}

describe('Store', () => {
  let mockClient: jest.Mocked<PoolClient>;
  let mockPool: jest.Mocked<Pool>;
  let store: Store;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = makeMockClient();
    mockPool = makeMockPool(mockClient, { rows: [], rowCount: 0 });
    (Pool as unknown as jest.Mock).mockImplementation(() => mockPool);
    store = new Store();
  });

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------

  describe('query()', () => {
    it('returns rows from the query result', async () => {
      const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
      mockPool.query.mockResolvedValue({ rows, rowCount: 2 } as never);
      const result = await store.query('SELECT * FROM users');
      expect(result).toEqual(rows);
    });

    it('passes SQL and params to pool.query', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      await store.query('SELECT * FROM users WHERE id=$1', [42]);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id=$1', [42]);
    });

    it('returns an empty array when no rows', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      expect(await store.query('SELECT 1')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // queryOne
  // -------------------------------------------------------------------------

  describe('queryOne()', () => {
    it('returns the first row', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 } as never);
      const result = await store.queryOne('SELECT * FROM users WHERE id=$1', [1]);
      expect(result).toEqual({ id: 1 });
    });

    it('returns null when no rows are found', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      expect(await store.queryOne('SELECT * FROM users WHERE id=$1', [999])).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  describe('execute()', () => {
    it('returns rowCount from the result', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 3 } as never);
      const count = await store.execute('DELETE FROM sessions WHERE expired_at < NOW()');
      expect(count).toBe(3);
    });

    it('returns 0 when rowCount is null', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: null } as never);
      expect(await store.execute('DELETE FROM x')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // transaction
  // -------------------------------------------------------------------------

  describe('transaction()', () => {
    it('executes BEGIN, user fn, and COMMIT on success', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const fn = jest.fn().mockResolvedValue('result');
      const result = await store.transaction(fn);
      expect(result).toBe('result');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rolls back on error and re-throws', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const fn = jest.fn().mockRejectedValue(new Error('txn failed'));

      await expect(store.transaction(fn)).rejects.toThrow('txn failed');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('passes the client to the user fn', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      let receivedClient: PoolClient | null = null;
      await store.transaction(async (c) => { receivedClient = c; });
      expect(receivedClient).toBe(mockClient);
    });
  });

  // -------------------------------------------------------------------------
  // ping
  // -------------------------------------------------------------------------

  describe('ping()', () => {
    it('runs SELECT 1', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 } as never);
      await store.ping();
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    });
  });

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  describe('close()', () => {
    it('calls pool.end()', async () => {
      await store.close();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getPool
  // -------------------------------------------------------------------------

  describe('getPool()', () => {
    it('returns the underlying pool', () => {
      expect(store.getPool()).toBe(mockPool);
    });
  });
});

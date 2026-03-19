import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Store } from './index';

describe('Store Integration', () => {
  let container: StartedTestContainer;
  let store: Store;

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

    const host = container.getHost();
    const port = container.getMappedPort(5432);

    store = new Store({
      host,
      port,
      user: 'gkit',
      password: 'secret',
      database: 'gkit',
    });
  });

  afterAll(async () => {
    await store.close();
    await container.stop();
  });

  it('should ping successfully', async () => {
    await expect(store.ping()).resolves.not.toThrow();
  });

  it('should create table and insert/query rows', async () => {
    await store.execute(`CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, name TEXT NOT NULL)`);
    await store.execute(`INSERT INTO items (name) VALUES ($1)`, ['hello']);

    const rows = await store.query<{ name: string }>(`SELECT name FROM items WHERE name = $1`, ['hello']);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('hello');
  });

  it('should commit a transaction', async () => {
    await store.execute(`CREATE TABLE IF NOT EXISTS tx_test (val TEXT NOT NULL)`);

    await store.transaction(async (client) => {
      await client.query(`INSERT INTO tx_test (val) VALUES ($1)`, ['committed']);
    });

    const rows = await store.query<{ val: string }>(`SELECT val FROM tx_test`);
    expect(rows).toHaveLength(1);
    expect(rows[0].val).toBe('committed');
  });

  it('should rollback a transaction on error', async () => {
    await store.execute(`CREATE TABLE IF NOT EXISTS rollback_test (val TEXT NOT NULL)`);

    await expect(
      store.transaction(async (client) => {
        await client.query(`INSERT INTO rollback_test (val) VALUES ($1)`, ['should-not-exist']);
        throw new Error('intentional rollback');
      })
    ).rejects.toThrow('intentional rollback');

    const rows = await store.query(`SELECT * FROM rollback_test`);
    expect(rows).toHaveLength(0);
  });

  it('should return a single row with queryOne', async () => {
    await store.execute(`CREATE TABLE IF NOT EXISTS single_test (id SERIAL, val TEXT)`);
    await store.execute(`INSERT INTO single_test (val) VALUES ($1)`, ['only']);

    const row = await store.queryOne<{ val: string }>(`SELECT val FROM single_test LIMIT 1`);
    expect(row?.val).toBe('only');
  });
});

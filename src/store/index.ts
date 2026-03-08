import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface StoreConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  maxConnections?: number;
}

export class Store {
  private readonly pool: Pool;

  constructor(config: StoreConfig = {}) {
    this.pool = new Pool({
      host: config.host ?? 'localhost',
      port: config.port ?? 5432,
      database: config.database ?? 'postgres',
      user: config.user ?? 'postgres',
      password: config.password ?? '',
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: config.maxConnections ?? 10,
    });
  }

  async query<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const { rows } = await this.pool.query(sql, params);
    return rows as T[];
  }

  async queryOne<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params?: unknown[]): Promise<number> {
    const { rowCount } = await this.pool.query(sql, params);
    return rowCount ?? 0;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getPool(): Pool { return this.pool; }
}

export async function migrate(store: Store, migrationsDir: string): Promise<void> {
  await store.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await store.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version'))
      .map(r => r.version),
  );

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await store.transaction(async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    console.log(`Applied migration: ${version}`);
  }
}

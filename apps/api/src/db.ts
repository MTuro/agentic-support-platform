import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {Pool} from 'pg';

export function createPool(databaseUrl: string): Pool {
  return new Pool({connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000, statement_timeout: 125000});
}
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(684201)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.resolve(__dirname, '../../migrations');
    for (const file of (await readdir(dir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{checksum: string}>(
        'SELECT checksum FROM schema_migrations WHERE version=$1', [file]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error('Applied migration changed');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)', [file, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {client.release();}
}

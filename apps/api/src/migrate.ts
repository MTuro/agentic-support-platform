import {createPool, migrate} from './db';
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = createPool(process.env.DATABASE_URL);
  try {await migrate(pool); console.log('Migrations applied');} finally {await pool.end();}
}
void main().catch(() => {console.error('Migration failed'); process.exitCode = 1;});

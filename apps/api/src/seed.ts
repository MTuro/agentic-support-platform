import {createPool} from './db';
export async function seed(databaseUrl: string) {
  const pool = createPool(databaseUrl);
  try {
    // Deliberately distinct owners; repeat seeding never overwrites existing ownership.
    for (const row of [
      ['TKT-1001', 'demo-alice', 'in_progress', 'Synthetic workspace export investigation'],
      ['TKT-1002', 'demo-bob', 'resolved', 'Synthetic invoice download issue resolved']
    ]) await pool.query(`INSERT INTO tickets(id,owner_id,status,summary) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO NOTHING`, row);
  } finally {await pool.end();}
}
if (require.main === module) {
  void seed(process.env.DATABASE_URL ?? '').then(() => console.log('Synthetic tickets seeded'))
    .catch(() => {console.error('Seed failed'); process.exitCode = 1;});
}

// Development-only actual PostgreSQL, bound to loopback. No system user changes.
import EmbeddedPostgres from 'embedded-postgres';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../../.data');
await mkdir(root, {recursive: true});
const secretFile = path.join(root, 'postgres-password');
if (!existsSync(secretFile)) await writeFile(secretFile, randomBytes(32).toString('hex'), {mode: 0o600});
const password = (await readFile(secretFile, 'utf8')).trim();
const databaseDir = path.join(root, 'postgres');
const pg = new EmbeddedPostgres({databaseDir, user: 'orbitdesk', password,
  port: 55432, persistent: true, authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1', '-k', root], onLog: () => {}, onError: () => {}});
if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
const client = pg.getPgClient('postgres');
await client.connect();
const found = await client.query("SELECT 1 FROM pg_database WHERE datname='orbitdesk'");
await client.end();
if (!found.rowCount) await pg.createDatabase('orbitdesk');
await writeFile(path.join(root, 'database.env'),
  `export DATABASE_URL=postgresql://orbitdesk:${password}@127.0.0.1:55432/orbitdesk\n`, {mode: 0o600});
console.log('PostgreSQL ready at 127.0.0.1:55432; source .data/database.env from repository root');
let stopping = false;
async function stop() {if (stopping) return; stopping = true; await pg.stop(); process.exit();}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => {}, 60000);

import {configFromEnv} from './config';
import {createPool} from './db';
import {createApplication} from './application';
async function main() {
  const config = configFromEnv();
  const pool = createPool(config.databaseUrl);
  const app = createApplication(config, pool, Number(process.env.PORT ?? 8000));
  await app.start();
  console.log('OrbitDesk API listening on loopback');
  let stopping = false;
  async function stop() {if (stopping) return; stopping = true; await app.stop(); await pool.end();}
  process.on('SIGINT', () => {void stop();});
  process.on('SIGTERM', () => {void stop();});
}
void main().catch(() => {console.error('API startup failed; verify configuration and migrations'); process.exitCode = 1;});

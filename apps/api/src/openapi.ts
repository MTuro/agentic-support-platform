import SwaggerParser from '@apidevtools/swagger-parser';
import {writeFile} from 'node:fs/promises';
import {createApplication} from './application';
import {configFromEnv} from './config';
import {createPool} from './db';
async function main() {
  const config = configFromEnv();
  const pool = createPool(config.databaseUrl);
  const app = createApplication(config, pool);
  try {
    const spec = await app.restServer.getApiSpec();
    await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
    await writeFile('openapi.json', JSON.stringify(spec, null, 2) + '\n');
  } finally {await app.stop(); await pool.end();}
}
void main().catch(() => {console.error('OpenAPI export failed'); process.exitCode = 1;});

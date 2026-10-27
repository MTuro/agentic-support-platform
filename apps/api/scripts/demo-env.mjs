import {randomBytes} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../../.data');
await mkdir(root, {recursive: true});
const identities = [
  {id: 'demo-alice', role: 'customer'}, {id: 'demo-bob', role: 'customer'},
  {id: 'demo-operator', role: 'operator'}
].map(i => ({...i, token: randomBytes(32).toString('hex')}));
try {
  await writeFile(path.join(root, 'api.env'),
    `export DEMO_IDENTITIES='${JSON.stringify(identities)}'\n`, {mode: 0o600, flag: 'wx'});
  console.log('Created local credentials; source .data/api.env from repository root');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Keeping existing .data/api.env');
}

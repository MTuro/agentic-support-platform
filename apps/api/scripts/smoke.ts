// Real HTTP across LoopBack, PostgreSQL, Python, Chroma and Ollama. No doubles.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {configFromEnv} from '../src/config';
import {Conversation, Message} from '../src/contracts';
import {createPool} from '../src/db';
async function main() {
  const config = configFromEnv();
  const alice = config.identities.find(i => i.id === 'demo-alice')!;
  const bob = config.identities.find(i => i.id === 'demo-bob')!;
  const operator = config.identities.find(i => i.role === 'operator')!;
  assert.ok(alice && bob && operator, 'Generate the documented demo identities');
  const base = process.env.API_URL ?? 'http://127.0.0.1:8000';
  async function request(route: string, token: string, body?: unknown, key?: string) {
    return fetch(base + route, {method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(120000), headers: {'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json', ...(key ? {'Idempotency-Key': key} : {})},
      body: body === undefined ? undefined : JSON.stringify(body)});
  }
  const reportFile = path.resolve(__dirname, '../../../../.data/m2-smoke.json');
  if (process.argv.includes('--verify')) {
    const report = JSON.parse(await readFile(reportFile, 'utf8')) as {conversationId: string; messageIds: string[]};
    const result = await request(`/api/conversations/${report.conversationId}`, alice.token);
    assert.equal(result.status, 200);
    const restored = await result.json() as Conversation;
    assert.deepEqual(restored.messages.map(m => m.id), report.messageIds);
    console.log(JSON.stringify({restartPersistence: true, messages: restored.messages.length}));
    return;
  }
  const created = await request('/api/conversations', alice.token, {});
  assert.equal(created.status, 201);
  const conv = await created.json() as Conversation;
  const route = `/api/conversations/${conv.id}/messages`;
  const cases = [
    {content: 'How long are backups retained?', expected: 'rag'},
    {content: 'Status of TKT-1001?', expected: 'ticket'},
    {content: 'Status of TKT-1002?', expected: 'escalation'},
    {content: 'Please contact a human', expected: 'escalation'}
  ];
  for (const item of cases) {
    const started = performance.now(); const key = randomUUID();
    const result = await request(route, alice.token, {content: item.content}, key);
    assert.equal(result.status, 201);
    const message = await result.json() as Message;
    assert.equal(message.route, item.expected);
    if (item.expected === 'rag') {
      assert.match(message.content, /30 days/);
      const citation = message.citations[0]!;
      assert.equal(citation.document_id, 'backups.md');
      assert.equal(citation.quote, message.content);
      const source = await readFile(path.resolve(__dirname, '../../../../data/knowledge/backups.md'), 'utf8');
      assert.ok(source.includes(citation.quote));
    }
    if (item.expected === 'ticket') assert.equal(message.ticket?.id, 'TKT-1001');
    if (item.content.includes('1002')) {assert.equal(message.reason, 'ticket_not_found'); assert.equal(message.ticket, null);}
    const retry = await request(route, alice.token, {content: item.content}, key);
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), message);
    console.log(JSON.stringify({route: message.route, passed: true, latency_ms: Math.round(performance.now() - started)}));
  }
  assert.equal((await request(`/api/conversations/${conv.id}`, bob.token)).status, 404);
  const history = await request(`/api/conversations/${conv.id}`, alice.token);
  assert.equal(history.status, 200);
  const saved = await history.json() as Conversation;
  assert.equal(saved.messages.length, 8);
  const queue = await request('/api/operator/escalations', operator.token);
  assert.equal(queue.status, 200);
  const escalations = await queue.json() as {conversationId: string}[];
  assert.equal(escalations.filter(e => e.conversationId === conv.id).length, 2);
  assert.equal((await request('/api/operator/analytics', alice.token)).status, 403);
  assert.equal((await request('/api/operator/analytics', operator.token)).status, 200);
  const pool = createPool(config.databaseUrl);
  try {
    assert.equal((await pool.query('SELECT id FROM messages WHERE conversation_id=$1', [conv.id])).rowCount, 8);
    assert.equal((await pool.query('SELECT id FROM escalations WHERE conversation_id=$1', [conv.id])).rowCount, 2);
  } finally {await pool.end();}
  await writeFile(reportFile, JSON.stringify({conversationId: conv.id, messageIds: saved.messages.map(m => m.id)}));
  console.log(JSON.stringify({cases: cases.length, failures: 0, messages: 8, durableEscalations: 2}));
}
void main().catch(() => {console.error('M2 live smoke failed'); process.exitCode = 1;});

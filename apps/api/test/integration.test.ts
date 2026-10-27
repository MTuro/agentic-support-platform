import SwaggerParser from '@apidevtools/swagger-parser';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createServer, Server} from 'node:http';
import {randomUUID, randomBytes} from 'node:crypto';
import {AddressInfo} from 'node:net';
import {Pool} from 'pg';
import {RestApplication} from '@loopback/rest';
import {createApplication} from '../src/application';
import {Config} from '../src/config';
import {migrate} from '../src/db';
import {Answer, Conversation, Message, Ticket} from '../src/contracts';

let pool: Pool;
let admin: Pool;
let app: RestApplication;
let server: Server;
let base: string;
let config: Config;
let schema: string;
const alice = randomBytes(32).toString('hex');
const bob = randomBytes(32).toString('hex');
const operator = randomBytes(32).toString('hex');
const serviceToken = randomBytes(32).toString('hex');
let calls = 0;
const requests: {message: string; tickets: Ticket[]; requestId: string | undefined}[] = [];
const logs: string[] = [];
const originalLog = console.log;
const citation = {document_id: 'backups.md', version: 'a'.repeat(64), chunk_id: 'b'.repeat(64),
  title: 'Backups', source: 'kb://backups.md', quote: 'Synthetic grounded backup answer.'};
function answer(message: string): Answer {
  const escalated = message.includes('human');
  return {answer: escalated ? 'Contact support.' : citation.quote,
    route: escalated ? 'escalation' : 'rag', citations: escalated ? [] : [citation], escalated,
    reason: escalated ? 'human_requested' : null, ticket: null};
}
async function request(route: string, token = alice, body?: unknown, key?: string,
  extra: Record<string, string> = {}) {
  return fetch(base + route, {method: body === undefined ? 'GET' : 'POST',
    headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
      ...(key ? {'Idempotency-Key': key} : {}), ...extra},
    body: body === undefined ? undefined : JSON.stringify(body)});
}
async function create(): Promise<Conversation> {
  const result = await request('/api/conversations', alice, {});
  assert.equal(result.status, 201);
  return await result.json() as Conversation;
}
async function startApp() {
  app = createApplication(config, pool, 0);
  await app.start();
  base = app.restServer.url!;
}
before(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'Set TEST_DATABASE_URL to a real PostgreSQL database (tests isolate their schema)');
  admin = new Pool({connectionString: databaseUrl});
  schema = `test_${randomBytes(12).toString('hex')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 10});
  await migrate(pool);
  await migrate(pool);
  await pool.query(`INSERT INTO tickets(id,owner_id,status,summary) VALUES
    ('TKT-1001','demo-alice','open','Alice synthetic ticket'),
    ('TKT-1002','demo-bob','resolved','Bob synthetic ticket')`);
  server = createServer((req, res) => {
    void (async () => {
      calls++;
      assert.equal(req.headers.authorization, `Bearer ${serviceToken}`);
      let raw = '';
      for await (const part of req) raw += String(part);
      const body = JSON.parse(raw) as {message: string; tickets: Ticket[]};
      requests.push({...body, requestId: req.headers['x-request-id'] as string});
      if (body.message === 'slow') await new Promise(resolve => setTimeout(resolve, 250));
      if (body.message === 'outage' || (body.message === 'transient' &&
          requests.filter(r => r.message === 'transient').length === 1)) {
        res.writeHead(503).end('private upstream failure'); return;
      }
      if (body.message === 'bad-auth') {res.writeHead(401).end(); return;}
      if (body.message === 'malformed') {res.end('{'); return;}
      if (body.message === 'oversized') {res.end('x'.repeat(65537)); return;}
      if (body.message === 'wrong-contract') {res.end(JSON.stringify({answer: 'x'})); return;}
      if (body.message === 'leak-ticket') {
        res.end(JSON.stringify({...answer('x'), route: 'ticket', citations: [],
          ticket: {id: 'TKT-1002', status: 'resolved', summary: 'Bob synthetic ticket'}})); return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(answer(body.message)));
    })().catch(() => {res.writeHead(500).end();});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  config = {databaseUrl, agentUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    agentToken: serviceToken, agentTimeoutMs: 100,
    identities: [{id: 'demo-alice', role: 'customer', token: alice},
      {id: 'demo-bob', role: 'customer', token: bob}, {id: 'operator', role: 'operator', token: operator}]};
  console.log = (...args: unknown[]) => {logs.push(args.join(' '));};
  await startApp();
});
after(async () => {
  console.log = originalLog;
  await app?.stop();
  await pool?.end();
  if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.end();
  if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
});

test('create/send/read survives application restart and returns validated citations', async () => {
  const conv = await create();
  assert.deepEqual(conv.messages, []);
  const correlation = randomUUID();
  const sent = await request(`/api/conversations/${conv.id}/messages`, alice,
    {content: 'private synthetic backups'}, randomUUID(), {'X-Request-ID': correlation});
  assert.equal(sent.status, 201);
  assert.equal(sent.headers.get('x-request-id'), correlation);
  const message = await sent.json() as Message;
  assert.equal(message.role, 'assistant');
  assert.deepEqual(message.citations, [citation]);
  assert.equal(requests.at(-1)?.requestId, correlation);
  assert.deepEqual(requests.at(-1)?.tickets.map(t => t.id), ['TKT-1001']);
  await app.stop(); await startApp();
  const result = await request(`/api/conversations/${conv.id}`);
  assert.equal(result.status, 200);
  const stored = await result.json() as Conversation;
  assert.equal(stored.messages.length, 2);
  assert.equal(stored.messages[0]?.role, 'user');
  assert.deepEqual(stored.messages[1], message);
});

test('auth, ownership and operator roles are enforced before agent calls', async () => {
  const conv = await create(); const before = calls;
  assert.equal((await request('/api/conversations', '', {})).status, 401);
  assert.equal((await request('/api/conversations', operator, {})).status, 403);
  assert.equal((await request(`/api/conversations/${conv.id}`, bob)).status, 404);
  assert.equal((await request(`/api/conversations/${conv.id}/messages`, bob, {content: 'x'}, randomUUID())).status, 404);
  assert.equal((await request(`/api/conversations/${randomUUID()}`)).status, 404);
  assert.equal((await request('/api/operator/analytics', alice)).status, 403);
  assert.equal((await request('/api/operator/escalations', '')).status, 401);
  assert.equal((await request('/api/operator/analytics', '', undefined, undefined, {Authorization: operator})).status, 401);
  assert.equal(calls, before);
});

test('strict request validation rejects invalid IDs, keys, content and injected identity', async () => {
  const conv = await create(); const before = calls;
  for (const content of ['', '   ', 'x'.repeat(4001), 123, null]) {
    assert.equal((await request(`/api/conversations/${conv.id}/messages`, alice, {content}, randomUUID())).status, 422);
  }
  assert.equal((await request('/api/conversations', alice, {owner_id: 'demo-bob'})).status, 422);
  for (const key of [undefined, 'not-a-uuid']) {
    assert.equal((await request(`/api/conversations/${conv.id}/messages`, alice, {content: 'x'}, key)).status, 400);
  }
  assert.equal((await request('/api/conversations/not-uuid')).status, 400);
  assert.equal((await request(`/api/conversations/${conv.id}/messages`, alice,
    {content: 'x', tickets: []}, randomUUID())).status, 422);
  assert.equal(calls, before);
});

test('retries and concurrent duplicates return one persisted answer; changed content conflicts', async () => {
  const conv = await create(); const key = randomUUID(); const before = calls;
  const send = () => request(`/api/conversations/${conv.id}/messages`, alice, {content: 'backups'}, key);
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map(r => r.status), [201, 201]);
  const one = await results[0]!.json(); const two = await results[1]!.json();
  assert.deepEqual(one, two);
  assert.deepEqual(await (await send()).json(), one);
  assert.equal(calls, before + 1);
  assert.equal((await request(`/api/conversations/${conv.id}/messages`, alice, {content: 'different'}, key)).status, 409);
  const history = await (await request(`/api/conversations/${conv.id}`)).json() as Conversation;
  assert.equal(history.messages.length, 2);
});

test('agent outages, timeout, malformed/oversized/schema-invalid responses roll back and sanitize errors', async () => {
  for (const content of ['outage', 'slow', 'malformed', 'oversized', 'wrong-contract', 'leak-ticket', 'bad-auth']) {
    const conv = await create(); const key = randomUUID(); const before = calls;
    const result = await request(`/api/conversations/${conv.id}/messages`, alice, {content}, key);
    assert.equal(result.status, 503, content);
    if (['malformed', 'oversized', 'wrong-contract', 'leak-ticket', 'bad-auth'].includes(content)) {
      assert.equal(calls, before + 1, 'Protocol and auth errors must not retry');
    }
    if (content === 'outage') assert.equal(calls, before + 2);
    assert.doesNotMatch(await result.text(), /private|Bob|SQL|password/);
    const history = await (await request(`/api/conversations/${conv.id}`)).json() as Conversation;
    assert.equal(history.messages.length, 0);
    // A failed attempt does not reserve the key or leave an orphan user message.
    assert.equal((await request(`/api/conversations/${conv.id}/messages`, alice, {content: 'recovered'}, key)).status, 201);
  }
});

test('transient upstream failure is retried once', async () => {
  const conv = await create(); const before = calls;
  assert.equal((await request(`/api/conversations/${conv.id}/messages`, alice,
    {content: 'transient'}, randomUUID())).status, 201);
  assert.equal(calls, before + 2);
});

test('escalations are durable, deduplicated and visible to operators with accurate analytics', async () => {
  const conv = await create(); const key = randomUUID();
  const route = `/api/conversations/${conv.id}/messages`;
  const sent = await request(route, alice, {content: 'human please'}, key);
  assert.equal(sent.status, 201);
  const saved = await sent.json() as Message;
  assert.equal(saved.escalated, true);
  await request(route, alice, {content: 'human please'}, key);
  const result = await request('/api/operator/escalations', operator);
  assert.equal(result.status, 200);
  const queue = await result.json() as {messageId: string; status: string}[];
  assert.equal(queue.filter(e => e.messageId === saved.id).length, 1);
  assert.equal(queue.find(e => e.messageId === saved.id)?.status, 'open');
  const analytics = await (await request('/api/operator/analytics', operator)).json() as {
    conversations: number; messages: number; escalations: number; escalationRate: number};
  const db = await pool.query<{count: number}>('SELECT count(*)::int AS count FROM messages');
  assert.equal(analytics.messages, db.rows[0]!.count);
  assert.equal(analytics.escalations, queue.length);
  assert.equal(analytics.escalationRate, queue.length / (analytics.messages / 2));
});

test('escalation write failure rolls back the entire turn', async () => {
  const conv = await create();
  await pool.query(`CREATE FUNCTION reject_escalation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'private storage failure'; END; $$;
    CREATE TRIGGER reject_escalation BEFORE INSERT ON escalations FOR EACH ROW EXECUTE FUNCTION reject_escalation()`);
  try {
    const result = await request(`/api/conversations/${conv.id}/messages`, alice, {content: 'human'}, randomUUID());
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /private/);
    const history = await (await request(`/api/conversations/${conv.id}`)).json() as Conversation;
    assert.equal(history.messages.length, 0);
    const turns = await pool.query('SELECT id FROM turns WHERE conversation_id=$1', [conv.id]);
    assert.equal(turns.rowCount, 0);
  } finally {await pool.query('DROP TRIGGER reject_escalation ON escalations; DROP FUNCTION reject_escalation()');}
});

test('migration checksums reject edited history', async () => {
  const row = (await pool.query<{checksum: string}>('SELECT checksum FROM schema_migrations')).rows[0]!;
  await pool.query("UPDATE schema_migrations SET checksum='changed'");
  try {await assert.rejects(migrate(pool), /Applied migration changed/);}
  finally {await pool.query('UPDATE schema_migrations SET checksum=$1', [row.checksum]);}
  await migrate(pool);
});

test('OpenAPI covers auth, validation and response contracts; health and safe logs work', async () => {
  const response = await fetch(base + '/openapi.json');
  assert.equal(response.status, 200);
  const spec = await response.json() as {paths: Record<string, Record<string, {
    security: unknown[]; responses: Record<string, unknown>; parameters: {name: string; required: boolean}[]}>>;
    components: {securitySchemes: {bearerAuth: {scheme: string}}}};
  await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
  const op = spec.paths['/api/conversations/{id}/messages']!.post!;
  assert.ok(op.security.length);
  assert.ok(op.responses['201']); assert.ok(op.responses['503']);
  assert.ok(op.parameters.find(p => p.name === 'Idempotency-Key')?.required);
  assert.equal((await fetch(base + '/health/ready')).status, 200);
  const health = await fetch(base + '/health/live', {headers: {'X-Request-ID': 'invalid'}});
  assert.equal(health.status, 200);
  assert.match(health.headers.get('X-Request-ID')!, /^[a-f0-9-]{36}$/);
  const serialized = logs.join('\n');
  for (const secret of [alice, bob, operator, serviceToken, 'private synthetic backups', 'private storage failure']) {
    assert.ok(!serialized.includes(secret));
  }
  assert.ok(logs.every(line => JSON.parse(line).event === 'http.completed'));
});


test('database outage returns sanitized 503 while process liveness stays available', async () => {
  const offline = new Pool({connectionString: config.databaseUrl});
  await offline.end();
  const unavailable = createApplication(config, offline, 0);
  await unavailable.start();
  try {
    const result = await fetch(unavailable.restServer.url! + '/health/ready');
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /pool|password|postgresql/);
    assert.equal((await fetch(unavailable.restServer.url! + '/health/live')).status, 200);
  } finally {await unavailable.stop();}
});

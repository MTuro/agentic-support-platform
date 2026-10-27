import {randomUUID} from 'node:crypto';
import {Pool, PoolClient} from 'pg';
import {HttpErrors} from '@loopback/rest';
import {AgentClient} from './agent-client';
import {Conversation, Message, Ticket} from './contracts';
interface ConversationRow {id: string; created_at: Date}
interface MessageRow {
  id: string; role: 'user' | 'assistant'; content: string; citations: Message['citations'];
  escalated: boolean; reason: string | null; route: string | null; ticket: Ticket | null; created_at: Date;
}
function message(row: MessageRow): Message {
  const {created_at, ...rest} = row;
  return {...rest, createdAt: created_at.toISOString()};
}
const fields = 'id,role,content,citations,escalated,reason,route,ticket,created_at';
export class Store {
  constructor(readonly pool: Pool, private readonly agent: AgentClient) {}
  async create(owner: string): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      'INSERT INTO conversations(id,owner_id) VALUES ($1,$2) RETURNING id,created_at', [randomUUID(), owner]);
    const row = result.rows[0]!;
    return {id: row.id, createdAt: row.created_at.toISOString(), messages: []};
  }
  private async owner(client: PoolClient, id: string, owner: string, lock = false) {
    const result = await client.query<ConversationRow>(
      `SELECT id,created_at FROM conversations WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, owner]);
    if (!result.rows[0]) throw new HttpErrors.NotFound('Conversation not found');
    return result.rows[0];
  }
  async read(id: string, owner: string): Promise<Conversation> {
    const client = await this.pool.connect();
    try {
      const row = await this.owner(client, id, owner);
      const history = await client.query<MessageRow>(`SELECT ${fields} FROM messages
        WHERE conversation_id=$1 ORDER BY created_at,id`, [id]);
      return {id, createdAt: row.created_at.toISOString(), messages: history.rows.map(message)};
    } finally {client.release();}
  }
  async send(id: string, owner: string, content: string, key: string, requestId: string): Promise<Message> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      // Serializes turns for this conversation and concurrent idempotent retries.
      await this.owner(client, id, owner, true);
      const previous = await client.query<{id: string; content: string}>(
        'SELECT id,content FROM turns WHERE conversation_id=$1 AND idempotency_key=$2', [id, key]);
      if (previous.rows[0]) {
        if (previous.rows[0].content !== content) throw new HttpErrors.Conflict('Key already used for different content');
        const saved = await client.query<MessageRow>(`SELECT ${fields} FROM messages WHERE turn_id=$1 AND role='assistant'`,
          [previous.rows[0].id]);
        await client.query('COMMIT');
        return message(saved.rows[0]!);
      }
      const tickets = await client.query<Ticket>('SELECT id,status,summary FROM tickets WHERE owner_id=$1', [owner]);
      const answer = await this.agent.respond(content, tickets.rows, requestId);
      const turn = randomUUID();
      await client.query('INSERT INTO turns(id,conversation_id,idempotency_key,content) VALUES ($1,$2,$3,$4)',
        [turn, id, key, content]);
      await client.query(`INSERT INTO messages(id,conversation_id,turn_id,role,content) VALUES ($1,$2,$3,'user',$4)`,
        [randomUUID(), id, turn, content]);
      const saved = await client.query<MessageRow>(`INSERT INTO messages
        (id,conversation_id,turn_id,role,content,citations,escalated,reason,route,ticket)
        VALUES ($1,$2,$3,'assistant',$4,$5,$6,$7,$8,$9) RETURNING ${fields}`,
        [randomUUID(), id, turn, answer.answer, JSON.stringify(answer.citations), answer.escalated,
          answer.reason, answer.route, answer.ticket ? JSON.stringify(answer.ticket) : null]);
      if (answer.escalated) await client.query(`INSERT INTO escalations(id,conversation_id,message_id,reason)
        VALUES ($1,$2,$3,$4)`, [randomUUID(), id, saved.rows[0]!.id, answer.reason]);
      await client.query('COMMIT');
      return message(saved.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '55P03') {
        throw new HttpErrors.Conflict('Conversation busy; retry with the same Idempotency-Key');
      }
      throw error;
    } finally {client.release();}
  }
  async analytics() {
    const result = await this.pool.query<{conversations: number; messages: number; escalations: number; turns: number}>(
      `SELECT (SELECT count(*)::int FROM conversations) AS conversations,
        (SELECT count(*)::int FROM messages) AS messages,
        (SELECT count(*)::int FROM escalations) AS escalations,
        (SELECT count(*)::int FROM turns) AS turns`);
    const row = result.rows[0]!;
    return {conversations: row.conversations, messages: row.messages, escalations: row.escalations,
      escalationRate: row.turns ? row.escalations / row.turns : 0};
  }
  async escalations() {
    const result = await this.pool.query(`SELECT id,conversation_id AS "conversationId",message_id AS "messageId",
      reason,status,created_at AS "createdAt" FROM escalations ORDER BY created_at,id LIMIT 100`);
    return result.rows;
  }
}

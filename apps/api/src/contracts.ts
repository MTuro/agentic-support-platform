import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {SchemaObject} from '@loopback/rest';
export interface Ticket {id: string; status: 'open' | 'in_progress' | 'resolved'; summary: string}
export interface Citation {
  document_id: string; version: string; chunk_id: string; title: string; source: string; quote: string;
}
export interface Answer {
  answer: string; route: 'rag' | 'ticket' | 'escalation'; citations: Citation[];
  escalated: boolean; reason: string | null; ticket: Ticket | null;
}
export interface Message {
  id: string; role: 'user' | 'assistant'; content: string; citations: Citation[];
  escalated: boolean; reason: string | null; route: string | null; ticket: Ticket | null; createdAt: string;
}
export interface Conversation {id: string; createdAt: string; messages: Message[]}
const text = (maxLength: number): SchemaObject => ({type: 'string', minLength: 1, maxLength});
export const ticketSchema: SchemaObject = {
  type: 'object', additionalProperties: false, required: ['id', 'status', 'summary'],
  properties: {id: {type: 'string', pattern: '^TKT-[0-9]{4}$'},
    status: {type: 'string', enum: ['open', 'in_progress', 'resolved']}, summary: text(200)}
};
export const citationSchema: SchemaObject = {
  type: 'object', additionalProperties: false,
  required: ['document_id', 'version', 'chunk_id', 'title', 'source', 'quote'],
  properties: {document_id: text(512), version: {type: 'string', pattern: '^[a-f0-9]{64}$'},
    chunk_id: {type: 'string', pattern: '^[a-f0-9]{64}$'}, title: text(512), source: text(1024), quote: text(1200)}
};
const reasons = ['no_evidence', 'dependency_unavailable', 'unsafe_request', 'human_requested',
  'ticket_not_found', 'invalid_ticket', 'unsupported_generation'];
export const answerSchema: SchemaObject = {
  type: 'object', additionalProperties: false,
  required: ['answer', 'route', 'citations', 'escalated', 'reason', 'ticket'],
  properties: {answer: text(8000), route: {type: 'string', enum: ['rag', 'ticket', 'escalation']},
    citations: {type: 'array', maxItems: 5, items: citationSchema}, escalated: {type: 'boolean'},
    reason: {type: 'string', nullable: true, enum: [...reasons, null]},
    ticket: {...ticketSchema, nullable: true}}
};
export const messageSchema: SchemaObject = {
  type: 'object', additionalProperties: false,
  required: ['id', 'role', 'content', 'citations', 'escalated', 'reason', 'route', 'ticket', 'createdAt'],
  properties: {id: {type: 'string', format: 'uuid'}, role: {type: 'string', enum: ['user', 'assistant']},
    content: text(8000), citations: answerSchema.properties!.citations!,
    escalated: {type: 'boolean'}, reason: answerSchema.properties!.reason!,
    route: {type: 'string', nullable: true, enum: ['rag', 'ticket', 'escalation', null]},
    ticket: answerSchema.properties!.ticket!, createdAt: {type: 'string', format: 'date-time'}}
};
export const conversationSchema: SchemaObject = {
  type: 'object', additionalProperties: false, required: ['id', 'createdAt', 'messages'],
  properties: {id: {type: 'string', format: 'uuid'}, createdAt: {type: 'string', format: 'date-time'},
    messages: {type: 'array', items: messageSchema}}
};
const ajv = new Ajv({strict: false});
addFormats(ajv);
export const validateAnswer = ajv.compile<Answer>(answerSchema);

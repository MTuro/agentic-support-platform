import {inject} from '@loopback/core';
import {timingSafeEqual, randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {
  DefaultSequence, get, post, param, requestBody, RestApplication, RestBindings,
  HttpErrors, Request, Response, RequestContext, OperationObject, SchemaObject
} from '@loopback/rest';
import {Config, Identity} from './config';
import {AgentClient} from './agent-client';
import {Store} from './store';
import {conversationSchema, messageSchema} from './contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errorSchema: SchemaObject = {type: 'object', required: ['error'], properties: {
  error: {type: 'object', required: ['statusCode', 'message'], properties: {
    statusCode: {type: 'integer'}, message: {type: 'string'}}}}};
function operation(schema: SchemaObject, status = 200): OperationObject {
  const responses: OperationObject['responses'] = {
    [status]: {description: 'Success', content: {'application/json': {schema}}}
  };
  for (const code of [400, 401, 403, 404, 409, 413, 422, 500, 503]) {
    responses[code] = {description: 'Request failed', content: {'application/json': {schema: errorSchema}}};
  }
  return {security: [{bearerAuth: []}], responses};
}
class SafeSequence extends DefaultSequence {
  async handle(context: RequestContext): Promise<void> {
    const {request, response} = context;
    const supplied = request.get('X-Request-ID') ?? '';
    const requestId = uuid.test(supplied) ? supplied.toLowerCase() : randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-ID', requestId);
    const started = performance.now();
    try {
      if (await this.invokeMiddleware(context)) return;
      const route = this.findRoute(request);
      const args = await this.parseParams(request, route);
      const result = await this.invoke(route, args);
      this.send(response, result);
    } catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error &&
        typeof error.statusCode === 'number' ? error.statusCode : 503;
      const safeStatus = status >= 400 && status < 600 ? status : 503;
      const messages: Record<number, string> = {400: 'Invalid request', 401: 'Unauthorized',
        403: 'Forbidden', 404: 'Not found', 409: 'Conflict; retry with the same key and content',
        413: 'Request too large', 422: 'Invalid request', 503: 'Service unavailable; retry with the same key'};
      if (safeStatus === 401) response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(safeStatus).json({error: {statusCode: safeStatus,
        message: messages[safeStatus] ?? 'Internal server error'}});
    } finally {
      console.log(JSON.stringify({event: 'http.completed', request_id: requestId,
        status: response.statusCode, duration_ms: Math.round(performance.now() - started)}));
    }
  }
}
class ConversationController {
  constructor(
    @inject('store') private readonly store: Store,
    @inject('config') private readonly config: Config,
    @inject(RestBindings.Http.REQUEST) private readonly request: Request,
    @inject(RestBindings.Http.RESPONSE) private readonly response: Response,
  ) {}
  private authorize(role: Identity['role']): Identity {
    const header = this.request.get('Authorization') ?? '';
    const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    const identity = this.config.identities.find(i => {
      const token = Buffer.from(i.token);
      return supplied.length === token.length && timingSafeEqual(supplied, token);
    });
    if (!identity) throw new HttpErrors.Unauthorized();
    if (identity.role !== role) throw new HttpErrors.Forbidden();
    return identity;
  }
  @post('/api/conversations', operation(conversationSchema, 201))
  async create(@requestBody({required: true, content: {'application/json': {schema: {
    type: 'object', additionalProperties: false, maxProperties: 0}}}}) _body: object) {
    void _body;
    const identity = this.authorize('customer');
    const result = await this.store.create(identity.id);
    this.response.status(201);
    return result;
  }
  @get('/api/conversations/{id}', operation(conversationSchema))
  async read(@param.path.string('id', {schema: {type: 'string', format: 'uuid'}}) id: string) {
    return this.store.read(id, this.authorize('customer').id);
  }
  @post('/api/conversations/{id}/messages', operation(messageSchema, 201))
  async send(
    @param.path.string('id', {schema: {type: 'string', format: 'uuid'}}) id: string,
    @param.header.string('Idempotency-Key', {required: true, schema: {type: 'string', format: 'uuid'}}) key: string,
    @requestBody({required: true, content: {'application/json': {schema: {
      type: 'object', required: ['content'], additionalProperties: false,
      properties: {content: {type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S'}}}}}})
    body: {content: string}
  ) {
    const identity = this.authorize('customer');
    const result = await this.store.send(id, identity.id, body.content, key.toLowerCase(), this.request.get('X-Request-ID')!);
    this.response.status(201);
    return result;
  }
  @get('/api/operator/analytics', operation({type: 'object', additionalProperties: false,
    required: ['conversations', 'messages', 'escalations', 'escalationRate'], properties: {
      conversations: {type: 'integer', minimum: 0}, messages: {type: 'integer', minimum: 0},
      escalations: {type: 'integer', minimum: 0}, escalationRate: {type: 'number', minimum: 0, maximum: 1}}}))
  async analytics() {this.authorize('operator'); return this.store.analytics();}
  @get('/api/operator/escalations', operation({type: 'array', maxItems: 100, items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'conversationId', 'messageId', 'reason', 'status', 'createdAt'], properties: {
      id: {type: 'string', format: 'uuid'}, conversationId: {type: 'string', format: 'uuid'},
      messageId: {type: 'string', format: 'uuid'}, reason: {type: 'string'},
      status: {type: 'string', enum: ['open', 'resolved']}, createdAt: {type: 'string', format: 'date-time'}}}}))
  async escalations() {this.authorize('operator'); return this.store.escalations();}
  @get('/health/live', {responses: {'200': {description: 'Process is alive'}}})
  live() {return {status: 'ok'};}
  @get('/health/ready', {responses: {'200': {description: 'Database ready'}, '503': {description: 'Database unavailable'}}})
  async ready() {await this.store.pool.query('SELECT id FROM conversations LIMIT 1'); return {status: 'ready'};}
}
export function createApplication(config: Config, pool: Pool, port = 8000): RestApplication {
  const app = new RestApplication({rest: {host: '127.0.0.1', port,
    requestBodyParser: {json: {limit: '32kb'}}, cors: {origin: false},
    openApiSpec: {endpointMapping: {'/openapi.json': {version: '3.0.0', format: 'json'}}}}});
  app.api({openapi: '3.0.0', info: {title: 'OrbitDesk API', version: '0.2.0'}, paths: {},
    components: {securitySchemes: {bearerAuth: {type: 'http', scheme: 'bearer'}}}});
  app.bind('store').to(new Store(pool, new AgentClient(config)));
  app.bind('config').to(config);
  app.sequence(SafeSequence);
  app.controller(ConversationController);
  return app;
}

import {HttpErrors} from '@loopback/rest';
import {Config} from './config';
import {Answer, Ticket, validateAnswer} from './contracts';

class InvalidAgentResponse extends Error {}

export class AgentClient {
  constructor(private readonly config: Config) {}
  async respond(message: string, tickets: Ticket[], requestId: string): Promise<Answer> {
    // The agent is stateless. One bounded retry on transport/5xx failures is safe.
    const signal = AbortSignal.timeout(this.config.agentTimeoutMs);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.config.agentUrl}/agent/respond`, {
          method: 'POST', signal, redirect: 'error',
          headers: {'Authorization': `Bearer ${this.config.agentToken}`, 'Content-Type': 'application/json',
            'X-Request-ID': requestId},
          body: JSON.stringify({message, tickets})
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status >= 500 && attempt === 0) continue;
          break;
        }
        // Bound bytes before parsing, even without Content-Length.
        const reader = response.body?.getReader();
        if (!reader) break;
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {await reader.cancel(); throw new InvalidAgentResponse('Oversized response');}
            chunks.push(value);
          }
        } finally {reader.releaseLock();}
        let answer: unknown;
        try {answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {break;}
        if (!validateAnswer(answer)) break;
        if (answer.route === 'rag' && (!answer.citations.length || answer.escalated || answer.reason ||
            answer.ticket || answer.citations.some(c => c.quote !== answer.answer))) break;
        if (answer.route === 'escalation' && (!answer.escalated || !answer.reason ||
            answer.citations.length || answer.ticket)) break;
        if (answer.route === 'ticket' && (!answer.ticket || answer.escalated || answer.reason ||
            answer.citations.length || !tickets.some(t => t.id === answer.ticket?.id &&
              t.status === answer.ticket.status && t.summary === answer.ticket.summary))) break;
        return answer;
      } catch (error) {
        if (error instanceof InvalidAgentResponse || signal.aborted || attempt === 1) break;
      }
    }
    throw new HttpErrors.ServiceUnavailable('Agent unavailable; retry with the same Idempotency-Key');
  }
}

export interface Identity {id: string; role: 'customer' | 'operator'; token: string}
export interface Config {
  databaseUrl: string;
  agentUrl: string;
  agentToken: string;
  agentTimeoutMs: number;
  identities: Identity[];
}
export function configFromEnv(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  const agentToken = process.env.AGENT_SERVICE_TOKEN;
  if (!databaseUrl || !agentToken || agentToken.length < 32) {
    throw new Error('DATABASE_URL and AGENT_SERVICE_TOKEN (32+ characters) required');
  }
  const identities: unknown = JSON.parse(process.env.DEMO_IDENTITIES ?? '[]');
  if (!Array.isArray(identities) || !identities.length || identities.some((i: unknown) => {
    if (!i || typeof i !== 'object') return true;
    const row = i as Record<string, unknown>;
    return typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) ||
      !['customer', 'operator'].includes(String(row.role)) ||
      typeof row.token !== 'string' || !/^[\x21-\x7e]{32,}$/.test(row.token) || row.token === agentToken;
  })) throw new Error('DEMO_IDENTITIES must contain valid customer/operator identities');
  const typed = identities as Identity[];
  if (new Set(typed.map(i => i.token)).size !== typed.length ||
      new Set(typed.map(i => i.id)).size !== typed.length) throw new Error('Duplicate identities');
  const agentUrl = process.env.AGENT_URL ?? 'http://127.0.0.1:8001';
  const url = new URL(agentUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', 'agent'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('AGENT_URL must be a local HTTP origin');
  }
  const agentTimeoutMs = Number(process.env.AGENT_TIMEOUT_MS ?? 90000);
  if (!Number.isInteger(agentTimeoutMs) || agentTimeoutMs < 100 || agentTimeoutMs > 120000) {
    throw new Error('AGENT_TIMEOUT_MS must be 100..120000');
  }
  return {databaseUrl, agentUrl, agentToken, agentTimeoutMs, identities: typed};
}

import type { AppEnv } from '../app';
import type { ConnectionId } from '../types';

const KEY_VARS: Record<Exclude<ConnectionId, 'mock'>, string> = {
  gemini: 'OIA_KEY_GEMINI',
  github: 'OIA_KEY_GITHUB',
  perplexity: 'OIA_KEY_PERPLEXITY',
  deepseek: 'OIA_KEY_DEEPSEEK',
  openai: 'OIA_KEY_OPENAI',
  anthropic: 'OIA_KEY_ANTHROPIC',
};

const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Traduce variables de entorno (o secretos de la plataforma) a la configuración del servidor. */
export function envConfig(e: Record<string, string | undefined>, dev = false): Omit<AppEnv, 'kv'> {
  if (!e.OIA_MASTER_KEY) throw new Error('Falta OIA_MASTER_KEY');
  const envKeys: AppEnv['envKeys'] = {};
  for (const [conn, v] of Object.entries(KEY_VARS)) if (e[v]) envKeys[conn as ConnectionId] = e[v];
  return {
    auth: {
      projectId: e.FIREBASE_PROJECT_ID ?? '',
      ownerUids: list(e.OWNER_UIDS),
      ownerEmails: list(e.OWNER_EMAILS).map((x) => x.toLowerCase()),
      devToken: dev ? e.OIA_DEV_TOKEN : undefined,
    },
    masterKey: e.OIA_MASTER_KEY,
    allowedOrigins: list(e.ALLOWED_ORIGINS),
    envKeys,
    envAllowPaid: list(e.OIA_ALLOW_PAID) as ConnectionId[],
    enableMock: e.OIA_ENABLE_MOCK === '1',
    queriesPerMinute: e.OIA_QUERIES_PER_MINUTE ? Number(e.OIA_QUERIES_PER_MINUTE) : undefined,
  };
}

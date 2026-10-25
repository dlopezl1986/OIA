import type { Platform, Settings } from './platform';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Connection {
  id: string;
  label: string;
  cost: 'free' | 'credit' | 'paid';
  keyUrl: string;
  keyHelp: string;
  note: string | null;
  freeAlternative: string | null;
  configured: boolean;
  source: 'store' | 'env' | null;
  last4: string | null;
  allowPaid: boolean;
  status: 'ok' | 'unverified' | 'invalid' | null;
  detail: string | null;
  checkedAt: string | null;
  cooldownUntil: string | null;
}

export interface Participant {
  id: string;
  label: string;
  connection: string;
  defaultModel: string;
  webSearch: boolean;
}

export interface Answer {
  participant: string;
  label: string;
  model: string;
  round: number;
  status: string;
  error?: string;
  text?: string;
  citations?: string[];
  ms: number;
  cost: string;
}

export interface QueryResult {
  final: string;
  classification: { type: string; complexity: number; needsWeb: boolean; signals: string[] };
  strategy: 'single' | 'consensus' | 'none';
  arbiter: { participant: string; status: string } | null;
  agreement: 'high' | 'medium' | 'low' | null;
  confidence: 'high' | 'medium' | 'low' | null;
  discrepancies: { topic: string; detail: string }[];
  rounds: number;
  answers: Answer[];
  warnings: string[];
  usage: Record<string, { inputTokens: number | null; outputTokens: number | null; calls: number }>;
  calls: number;
  cached: boolean;
  ms: number;
}

export function createApi(p: Platform) {
  async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        ...init,
        headers: { authorization: `Bearer ${await p.token()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      });
    } catch {
      throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba tu conexión.');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
    return data as T;
  }
  return {
    connections: () => req<{ connections: Connection[]; participants: Participant[] }>('/api/connections'),
    saveKey: (id: string, key: string, allowPaid: boolean) => req<Connection>(`/api/connections/${id}`, { method: 'PUT', body: JSON.stringify({ key, allowPaid }) }),
    testKey: (id: string) => req<{ status: string; detail: string }>(`/api/connections/${id}/test`, { method: 'POST' }),
    removeKey: (id: string) => req(`/api/connections/${id}`, { method: 'DELETE' }),
    query: (query: string, mode: string, settings: Settings, fresh = false) =>
      req<QueryResult>('/api/query', { method: 'POST', body: JSON.stringify({ query, mode, settings, fresh }) }),
  };
}

export type Api = ReturnType<typeof createApi>;

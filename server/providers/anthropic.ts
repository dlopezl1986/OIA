import { ProviderError, type CallResult, type ProviderAdapter } from '../types';
import { requestJson } from './http';

const BASE = 'https://api.anthropic.com/v1';

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function anthropic(): ProviderAdapter {
  const headers = (key: string) => ({
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  });
  return {
    async call(key, req): Promise<CallResult> {
      const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const data = (await requestJson(`${BASE}/messages`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          ...(system ? { system } : {}),
          messages: req.messages.filter((m) => m.role === 'user').map((m) => ({ role: 'user', content: m.content })),
        }),
        signal: req.signal,
        secret: key,
      })) as MessagesResponse;
      const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
      if (!text) throw new ProviderError('incomplete', 'Respuesta vacía');
      return {
        text,
        citations: [],
        truncated: data.stop_reason === 'max_tokens',
        usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null },
      };
    },
    async validate(key, signal) {
      const data = (await requestJson(`${BASE}/models`, { headers: headers(key), signal, secret: key })) as { data?: unknown[] };
      return { ok: true, detail: `Clave válida (${data.data?.length ?? 0} modelos accesibles).`, costly: false };
    },
  };
}

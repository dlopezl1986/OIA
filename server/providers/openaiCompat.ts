import { ProviderError, type CallRequest, type CallResult, type ProviderAdapter } from '../types';
import { requestJson, stripThinking } from './http';

interface Options {
  baseUrl: string;
  chatPath?: string;
  /** Ruta para listar modelos (gratuita). Sin ella solo se valida el formato. */
  modelsUrl?: string;
  tokenParam?: 'max_tokens' | 'max_completion_tokens';
  headers?: Record<string, string>;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  citations?: string[];
  search_results?: { url?: string }[];
}

/** Adaptador para APIs compatibles con OpenAI Chat Completions (OpenAI, DeepSeek, Perplexity, GitHub Models). */
export function openaiCompatible(opts: Options): ProviderAdapter {
  const headers = (key: string) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...opts.headers,
  });
  return {
    async call(key: string, req: CallRequest): Promise<CallResult> {
      const body = {
        model: req.model,
        messages: req.messages,
        [opts.tokenParam ?? 'max_tokens']: req.maxTokens,
      };
      const data = (await requestJson(opts.baseUrl + (opts.chatPath ?? '/chat/completions'), {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify(body),
        signal: req.signal,
        secret: key,
      })) as ChatResponse;
      const choice = data.choices?.[0];
      const text = stripThinking(choice?.message?.content ?? '');
      if (!text) throw new ProviderError('incomplete', 'Respuesta vacía');
      const citations = data.citations ?? (data.search_results ?? []).map((r) => r.url ?? '').filter(Boolean);
      return {
        text,
        citations,
        truncated: choice?.finish_reason === 'length',
        usage: { inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null },
      };
    },
    async validate(key: string, signal?: AbortSignal) {
      if (!opts.modelsUrl) return { ok: true, detail: 'Formato aceptado; se comprobará en la primera consulta.', costly: false };
      const data = (await requestJson(opts.modelsUrl, { headers: headers(key), signal, secret: key })) as
        | { data?: unknown[] }
        | unknown[];
      const n = Array.isArray(data) ? data.length : (data.data?.length ?? 0);
      return { ok: true, detail: `Clave válida (${n} modelos accesibles).`, costly: false };
    },
  };
}

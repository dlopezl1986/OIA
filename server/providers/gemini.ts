import { ProviderError, type CallResult, type ProviderAdapter } from '../types';
import { requestJson } from './http';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function gemini(): ProviderAdapter {
  const headers = (key: string) => ({ 'x-goog-api-key': key, 'Content-Type': 'application/json' });
  return {
    async call(key, req): Promise<CallResult> {
      const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const user = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
      const data = (await requestJson(`${BASE}/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: user }] }],
          // Los modelos con razonamiento interno consumen tokens de salida: se deja margen.
          generationConfig: {
            maxOutputTokens: req.maxTokens * 2 + 1024,
            // Gemini 3.x razona por defecto en nivel medio (lento y gasta cuota); en bajo responde en segundos.
            ...(/^gemini-3/.test(req.model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: req.signal,
        secret: key,
      })) as GenerateResponse;
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
      if (!text) throw new ProviderError('incomplete', `Respuesta vacía (${cand?.finishReason ?? 'sin candidatos'})`);
      const u = data.usageMetadata;
      return {
        text,
        citations: [],
        truncated: cand?.finishReason === 'MAX_TOKENS',
        usage: {
          inputTokens: u?.promptTokenCount ?? null,
          outputTokens: u ? (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) : null,
        },
      };
    },
    async validate(key, signal) {
      const data = (await requestJson(`${BASE}/models?pageSize=100`, { headers: headers(key), signal, secret: key })) as {
        models?: unknown[];
      };
      return { ok: true, detail: `Clave válida (${data.models?.length ?? 0} modelos accesibles).`, costly: false };
    },
  };
}

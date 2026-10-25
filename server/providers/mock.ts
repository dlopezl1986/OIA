import { ProviderError, type CallRequest, type CallResult, type ErrorKind, type ProviderAdapter } from '../types';

/**
 * Proveedor SIMULADO para pruebas y modo demostración. Nunca hace llamadas de red.
 * Marcadores en la consulta: [contradict] [converge] [never-converge] [arbiter-fail]
 * [fail:<modelo>:<tipo>] [slow:<modelo>] [truncate:<modelo>]
 */
export function mock(): ProviderAdapter {
  return {
    async call(_key: string, req: CallRequest): Promise<CallResult> {
      const prompt = req.messages.map((m) => m.content).join('\n');
      const model = req.model;
      const fail = new RegExp(`\\[fail:${model}:(\\w+)\\]`).exec(prompt);
      if (fail) throw new ProviderError(fail[1] as ErrorKind, `Fallo simulado (${fail[1]})`);
      if (prompt.includes(`[slow:${model}]`)) await waitForAbort(req.signal);
      const usage = { inputTokens: Math.ceil(prompt.length / 4), outputTokens: 20 };

      if (req.json) {
        if (prompt.includes('[arbiter-fail]')) return { text: 'no es JSON', citations: [], truncated: false, usage };
        return { text: JSON.stringify(arbitrate(prompt)), citations: [], truncated: false, usage };
      }
      const isReview = prompt.includes('PUNTOS EN DISPUTA');
      let text = 'Respuesta simulada: 42.';
      if (model === 'mock-b' && prompt.includes('[contradict]') && !(isReview && prompt.includes('[converge]'))) {
        text = 'Respuesta simulada: 41.';
      }
      if (prompt.includes('[xss]')) text = '**negrita** 42 <img src=x onerror="alert(1)"> <script>alert(2)</script>';
      if (isReview) text = `Tras revisar: ${text.replace('Respuesta simulada: ', '')}`;
      const truncated = prompt.includes(`[truncate:${model}]`);
      return { text, citations: [], truncated, usage };
    },
    async validate() {
      return { ok: true, detail: 'Proveedor simulado.', costly: false };
    },
  };
}

function arbitrate(prompt: string) {
  const tag = prompt.includes('<review id=') ? 'review' : 'answer';
  const texts = [...prompt.matchAll(new RegExp(`<${tag} id="\\w+">([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]!.trim());
  const agree = texts.length > 0 && texts.every((t) => t === texts[0]) && !prompt.includes('[never-converge]');
  return {
    final: (texts[0] ?? 'Sin datos').replace('Tras revisar: ', 'Respuesta simulada: '),
    agreement: agree ? 'high' : 'low',
    confidence: agree ? 'high' : 'low',
    discrepancies: agree ? [] : [{ topic: 'valor', detail: 'Las respuestas dan valores distintos.' }],
    rejected: [],
    needs_review: !agree,
    review_questions: agree ? [] : ['¿Cuál es el valor correcto y por qué?'],
  };
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const err = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted) return err();
    signal?.addEventListener('abort', err, { once: true });
  });
}

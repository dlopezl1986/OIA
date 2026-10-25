import { ProviderError, type ErrorKind } from '../types';

const QUOTA_HINT = /insufficient[_ ]quota|billing|balance|credit|per ?day|PerDay|exceeded your current quota|limit: 0/i;

/** Traduce una respuesta HTTP fallida a un error normalizado sin filtrar la clave. */
export function mapHttpError(status: number, body: string, secret: string): ProviderError {
  const clean = redact(body, secret).slice(0, 240);
  let kind: ErrorKind;
  if (status === 401 || status === 403) kind = 'auth';
  else if (status === 402) kind = 'quota';
  else if (status === 429) kind = QUOTA_HINT.test(body) ? 'quota' : 'rate';
  else if (status === 400 && /API_KEY_INVALID|invalid api key|invalid x-api-key/i.test(body)) kind = 'auth';
  else if (status >= 500) kind = 'server';
  else kind = 'bad_request';
  return new ProviderError(kind, `HTTP ${status}: ${clean}`, status);
}

export function redact(text: string, secret: string): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join('***');
}

export async function requestJson(
  url: string,
  init: RequestInit & { secret: string },
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw new ProviderError('timeout', 'Tiempo de espera agotado');
    throw new ProviderError('network', 'Error de red al contactar con el proveedor');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw mapHttpError(res.status, text, init.secret);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('server', 'Respuesta no válida del proveedor');
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

/** Elimina bloques de razonamiento <think> que algunos modelos devuelven en el texto. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

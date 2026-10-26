import type { ConnectionDef, ConnectionId, ParticipantDef, ProviderAdapter, TaskType } from '../types';
import { anthropic } from './anthropic';
import { gemini } from './gemini';
import { mock } from './mock';
import { openaiCompatible } from './openaiCompat';

// Datos revisados el 2026-10-26 (ver docs/viabilidad.md). GitHub Models se retiró el 2026-07-30.
export const CONNECTIONS: Record<ConnectionId, ConnectionDef> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini (AI Studio)',
    cost: 'free',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHelp: 'Entra con tu cuenta de Google en AI Studio, pulsa «Create API key» y pégala aquí. No requiere tarjeta.',
    keyPattern: /^AIza[\w-]{20,}$/,
    note: 'Cuota gratuita limitada por día. En el nivel gratuito Google puede usar los datos para mejorar sus productos.',
  },
  groq: {
    id: 'groq',
    label: 'Groq (GPT-OSS de OpenAI)',
    cost: 'free',
    keyUrl: 'https://console.groq.com/keys',
    keyHelp: 'Entra en la consola de Groq (cuenta gratuita, sin tarjeta), pulsa «Create API Key» y pégala aquí.',
    keyPattern: /^gsk_\w{20,}$/,
    note: 'Cuota gratuita aprox. 1.000 consultas/día. Sirve gpt-oss, el modelo abierto de OpenAI (no es ChatGPT).',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (modelos gratuitos)',
    cost: 'free',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyHelp: 'Crea una cuenta gratuita en OpenRouter, genera una clave y pégala aquí. OIA solo usa modelos terminados en «:free».',
    keyPattern: /^sk-or-[\w-]{20,}$/,
    note: 'Aprox. 50 consultas/día en modelos gratuitos. Ahora mismo no incluye DeepSeek ni OpenAI gratis. La lista de modelos gratuitos cambia; si uno desaparece, cámbialo en Ajustes › Modelos.',
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity (Sonar API)',
    cost: 'credit',
    keyUrl: 'https://www.perplexity.ai/account/api',
    keyHelp: 'Con Perplexity Pro recibes 5 $ de crédito de API al mes. Genera una clave en el portal de API. No actives la recarga automática si quieres coste 0 €.',
    keyPattern: /^pplx-\w{20,}$/,
    freeAlternative: 'Sin alternativa gratuita con búsqueda web; las demás IA responden sin datos actualizados.',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek (API oficial)',
    cost: 'paid',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHelp: 'Requiere saldo prepago en la plataforma de DeepSeek.',
    keyPattern: /^sk-\w{20,}$/,
    freeAlternative: 'Usa DeepSeek a través de GitHub Models (gratis).',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (API de desarrollador)',
    cost: 'paid',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHelp: 'ChatGPT Plus no incluye API. La API se factura aparte en platform.openai.com.',
    keyPattern: /^sk-[\w-]{20,}$/,
    freeAlternative: 'Usa modelos de OpenAI a través de GitHub Models (gratis).',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude (API)',
    cost: 'paid',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHelp: 'Claude Pro/Max no incluye API. La API se factura aparte en la consola de Anthropic.',
    keyPattern: /^sk-ant-[\w-]{20,}$/,
    freeAlternative: 'No hay acceso gratuito oficial a Claude por API.',
  },
  mock: {
    id: 'mock',
    label: 'Simulado (pruebas)',
    cost: 'free',
    keyUrl: '',
    keyHelp: 'Solo disponible en modo de pruebas.',
  },
};

const s = (simple: number, general: number, code: number, research: number, reasoning: number): Record<TaskType, number> => ({
  simple,
  general,
  code,
  research,
  reasoning,
});

export const PARTICIPANTS: ParticipantDef[] = [
  { id: 'gemini', label: 'Gemini', family: 'google', connection: 'gemini', defaultModel: 'gemini-3.8-flash', webSearch: false, strengths: s(3, 2, 2, 1, 2) },
  { id: 'groq-gpt', label: 'GPT-OSS (Groq)', family: 'openai', connection: 'groq', defaultModel: 'openai/gpt-oss-120b', webSearch: false, strengths: s(3, 2, 3, 1, 3) },
  // A 2026-10-26 OpenRouter no ofrece DeepSeek ni OpenAI gratis; se usa el mayor modelo gratuito disponible como tercera familia.
  { id: 'or-free', label: 'Nemotron (OpenRouter)', family: 'nvidia', connection: 'openrouter', defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free', webSearch: false, strengths: s(2, 2, 2, 1, 3) },
  { id: 'sonar', label: 'Perplexity Sonar', family: 'perplexity', connection: 'perplexity', defaultModel: 'sonar', webSearch: true, strengths: s(1, 2, 1, 3, 1) },
  { id: 'deepseek', label: 'DeepSeek', family: 'deepseek', connection: 'deepseek', defaultModel: 'deepseek-flash', webSearch: false, strengths: s(2, 2, 3, 1, 3) },
  { id: 'gpt', label: 'GPT (OpenAI)', family: 'openai', connection: 'openai', defaultModel: 'gpt-5-mini', webSearch: false, strengths: s(2, 3, 3, 1, 3) },
  { id: 'claude', label: 'Claude', family: 'anthropic', connection: 'anthropic', defaultModel: 'claude-sonnet-5-5', webSearch: false, strengths: s(2, 3, 3, 1, 3) },
  { id: 'mock-a', label: 'Simulado A', family: 'mock-a', connection: 'mock', defaultModel: 'mock-a', webSearch: false, strengths: s(3, 2, 2, 2, 2) },
  { id: 'mock-b', label: 'Simulado B', family: 'mock-b', connection: 'mock', defaultModel: 'mock-b', webSearch: false, strengths: s(2, 2, 2, 2, 2) },
  { id: 'mock-c', label: 'Simulado C', family: 'mock-c', connection: 'mock', defaultModel: 'mock-c', webSearch: true, strengths: s(1, 1, 1, 3, 1) },
];

export function createAdapters(): Record<ConnectionId, ProviderAdapter> {
  return {
    gemini: gemini(),
    anthropic: anthropic(),
    openai: openaiCompatible({
      baseUrl: 'https://api.openai.com/v1',
      modelsUrl: 'https://api.openai.com/v1/models',
      tokenParam: 'max_completion_tokens',
    }),
    deepseek: openaiCompatible({ baseUrl: 'https://api.deepseek.com', modelsUrl: 'https://api.deepseek.com/models' }),
    perplexity: openaiCompatible({ baseUrl: 'https://api.perplexity.ai' }),
    groq: openaiCompatible({
      baseUrl: 'https://api.groq.com/openai/v1',
      modelsUrl: 'https://api.groq.com/openai/v1/models',
      // gpt-oss razona antes de responder: con esfuerzo bajo gasta menos cuota y deja tokens para la respuesta.
      extraBody: (model) => (model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
    }),
    openrouter: openaiCompatible({
      baseUrl: 'https://openrouter.ai/api/v1',
      // /models es público; /key exige la clave y no consume cuota.
      authCheckUrl: 'https://openrouter.ai/api/v1/key',
      headers: { 'HTTP-Referer': 'https://oia-dlopez.web.app', 'X-Title': 'OIA' },
      // Garantía de coste 0: solo se aceptan modelos gratuitos.
      allowModel: (model) => model.endsWith(':free'),
    }),
    mock: mock(),
  };
}

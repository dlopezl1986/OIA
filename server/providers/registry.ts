import type { ConnectionDef, ConnectionId, ParticipantDef, ProviderAdapter, TaskType } from '../types';
import { anthropic } from './anthropic';
import { gemini } from './gemini';
import { mock } from './mock';
import { openaiCompatible } from './openaiCompat';

// Datos verificados en documentación oficial el 2026-10-25 (ver docs/viabilidad.md).
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
  github: {
    id: 'github',
    label: 'GitHub Models (OpenAI y DeepSeek)',
    cost: 'free',
    keyUrl: 'https://github.com/settings/personal-access-tokens/new',
    keyHelp: 'Crea un token «fine-grained» sin acceso a repositorios y con el permiso «Models: Read-only». Gratuito con límites diarios.',
    keyPattern: /^(github_pat_|ghp_)\w{20,}$/,
    note: 'Alternativa gratuita oficial para modelos de OpenAI y DeepSeek (aprox. 150 peticiones/día en modelos básicos, 8 en DeepSeek-R1).',
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
  { id: 'gh-gpt', label: 'GPT (GitHub)', family: 'openai', connection: 'github', defaultModel: 'openai/gpt-4.1-mini', webSearch: false, strengths: s(3, 2, 2, 1, 2) },
  { id: 'gh-deepseek', label: 'DeepSeek (GitHub)', family: 'deepseek', connection: 'github', defaultModel: 'deepseek/deepseek-v3-0324', webSearch: false, strengths: s(2, 2, 3, 1, 2) },
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
    github: openaiCompatible({
      baseUrl: 'https://models.github.ai/inference',
      modelsUrl: 'https://models.github.ai/catalog/models',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    }),
    mock: mock(),
  };
}

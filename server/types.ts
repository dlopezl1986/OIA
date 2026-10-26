// Tipos compartidos del núcleo. Sin dependencias de plataforma.

export type ConnectionId = 'gemini' | 'groq' | 'openrouter' | 'perplexity' | 'deepseek' | 'openai' | 'anthropic' | 'mock';

/** free: cuota gratuita oficial · credit: crédito incluido en un plan · paid: facturación por uso */
export type CostClass = 'free' | 'credit' | 'paid';

export type TaskType = 'simple' | 'general' | 'code' | 'research' | 'reasoning';

export interface Classification {
  type: TaskType;
  complexity: 1 | 2 | 3;
  needsWeb: boolean;
  signals: string[];
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CallRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface CallResult {
  text: string;
  citations: string[];
  usage: Usage;
  truncated: boolean;
}

export type ErrorKind = 'auth' | 'quota' | 'rate' | 'timeout' | 'network' | 'server' | 'bad_request' | 'blocked' | 'incomplete';

export class ProviderError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.kind === 'rate' || this.kind === 'server' || this.kind === 'network' || this.kind === 'timeout';
  }
}

/** Adaptador: normaliza la llamada a un proveedor concreto. */
export interface ProviderAdapter {
  call(key: string, req: CallRequest): Promise<CallResult>;
  /** Comprobación de la clave sin coste cuando el proveedor lo permite. */
  validate(key: string, signal?: AbortSignal): Promise<{ ok: boolean; detail: string; costly: boolean }>;
}

export interface ConnectionDef {
  id: ConnectionId;
  label: string;
  cost: CostClass;
  keyUrl: string;
  keyHelp: string;
  keyPattern?: RegExp;
  freeAlternative?: string;
  note?: string;
}

export interface ParticipantDef {
  id: string;
  label: string;
  family: string;
  connection: ConnectionId;
  defaultModel: string;
  webSearch: boolean;
  /** Puntuación 0-3 por tipo de tarea */
  strengths: Record<TaskType, number>;
}

export interface Settings {
  maxRounds: number; // rondas de revisión adicionales (0-3)
  maxParticipants: number; // 1-4
  maxCalls: number; // llamadas totales por consulta (incluye árbitro y revisión)
  timeoutMs: number;
  disabled: string[]; // participantes desactivados
  models: Record<string, string>; // modelo por participante
  arbiter?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  maxRounds: 1,
  maxParticipants: 3,
  maxCalls: 8,
  timeoutMs: 45_000,
  disabled: [],
  models: {},
};

export type Mode = 'auto' | 'fast' | 'deep';

export interface AnswerRecord {
  participant: string;
  label: string;
  model: string;
  round: number;
  status: 'ok' | ErrorKind;
  error?: string;
  text?: string;
  citations?: string[];
  usage?: Usage;
  ms: number;
  cost: CostClass;
}

export interface Discrepancy {
  topic: string;
  detail: string;
}

export interface QueryResult {
  final: string;
  classification: Classification;
  strategy: 'single' | 'consensus' | 'none';
  arbiter: { participant: string; status: 'ok' | 'fallback' | 'skipped' } | null;
  agreement: 'high' | 'medium' | 'low' | null;
  confidence: 'high' | 'medium' | 'low' | null;
  discrepancies: Discrepancy[];
  rounds: number;
  answers: AnswerRecord[];
  warnings: string[];
  usage: Record<string, Usage & { calls: number }>;
  calls: number;
  cached: boolean;
  ms: number;
}

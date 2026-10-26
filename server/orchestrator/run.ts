import {
  ProviderError,
  type AnswerRecord,
  type CallResult,
  type ChatMessage,
  type ConnectionId,
  type Discrepancy,
  type Mode,
  type ProviderAdapter,
  type QueryResult,
  type Settings,
  type Usage,
} from '../types';
import { isAbort } from '../providers/http';
import { classify } from './classify';
import { arbiterMessages, OUTPUT_TOKENS, participantMessages, REVIEW_TOKENS, reviewMessages, type ArbiterInput } from './prompts';
import { pickArbiter, rank, score, selectParticipants, targetCount, type Available } from './select';

export interface OrchestratorDeps {
  adapters: Record<ConnectionId, ProviderAdapter>;
  keys: Partial<Record<ConnectionId, string>>;
  /** Participantes utilizables (conexión configurada, autorizada y activa). */
  available: Available[];
  /** Notifica cuotas agotadas o errores de autenticación para aplicar enfriamiento. */
  onConnectionFailure?: (conn: ConnectionId, kind: 'auth' | 'quota') => void;
  retryDelayMs?: number;
}

interface Verdict {
  final: string;
  agreement: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low';
  discrepancies: Discrepancy[];
  needs_review: boolean;
  review_questions: string[];
}

const LEVEL = new Set(['high', 'medium', 'low']);
const MAX_REPLACEMENTS = 2;

export function parseVerdict(text: string): Verdict | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof v.final !== 'string' || !v.final.trim()) return null;
    const lvl = (x: unknown) => (typeof x === 'string' && LEVEL.has(x) ? (x as Verdict['agreement']) : 'medium');
    const discrepancies = Array.isArray(v.discrepancies)
      ? v.discrepancies
          .filter((d): d is Discrepancy => !!d && typeof d === 'object' && typeof (d as Discrepancy).topic === 'string')
          .slice(0, 8)
          .map((d) => ({ topic: String(d.topic).slice(0, 200), detail: String(d.detail ?? '').slice(0, 600) }))
      : [];
    const questions = Array.isArray(v.review_questions) ? v.review_questions.filter((q) => typeof q === 'string').slice(0, 5) : [];
    return {
      final: v.final.trim(),
      agreement: lvl(v.agreement),
      confidence: lvl(v.confidence),
      discrepancies,
      needs_review: v.needs_review === true,
      review_questions: questions as string[],
    };
  } catch {
    return null;
  }
}

export async function orchestrate(query: string, mode: Mode, settings: Settings, deps: OrchestratorDeps): Promise<QueryResult> {
  const t0 = Date.now();
  const cls = classify(query);
  const warnings: string[] = [];
  const answers: AnswerRecord[] = [];
  const usage: QueryResult['usage'] = {};
  const blockedConn = new Set<ConnectionId>();
  let calls = 0;

  const result = (partial: Partial<QueryResult>): QueryResult => ({
    final: '',
    classification: cls,
    strategy: 'none',
    arbiter: null,
    agreement: null,
    confidence: null,
    discrepancies: [],
    rounds: 0,
    answers,
    warnings,
    usage,
    calls,
    cached: false,
    ms: Date.now() - t0,
    ...partial,
  });

  const addUsage = (conn: string, u: Usage) => {
    const e = (usage[conn] ??= { inputTokens: 0, outputTokens: 0, calls: 0 });
    e.calls++;
    e.inputTokens = u.inputTokens == null || e.inputTokens == null ? null : e.inputTokens + u.inputTokens;
    e.outputTokens = u.outputTokens == null || e.outputTokens == null ? null : e.outputTokens + u.outputTokens;
  };

  /** Llamada con presupuesto, timeout y un único reintento para errores transitorios. */
  const invoke = async (a: Available, messages: ChatMessage[], maxTokens: number, json = false): Promise<CallResult> => {
    const conn = a.def.connection;
    if (blockedConn.has(conn)) throw new ProviderError('blocked', 'Conexión no disponible en esta consulta');
    const key = deps.keys[conn];
    if (!key) throw new ProviderError('auth', 'Sin credencial');
    for (let attempt = 0; ; attempt++) {
      if (calls >= settings.maxCalls) throw new ProviderError('blocked', 'Límite de llamadas por consulta alcanzado');
      calls++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), settings.timeoutMs);
      try {
        const r = await deps.adapters[conn].call(key, { model: a.model, messages, maxTokens, json, signal: ctrl.signal });
        addUsage(conn, r.usage);
        return r;
      } catch (e) {
        const err = e instanceof ProviderError ? e : isAbort(e) ? new ProviderError('timeout', 'Tiempo de espera agotado') : new ProviderError('server', `Error inesperado del proveedor (${e instanceof Error ? `${e.name}: ${e.message}` : 'desconocido'})`);
        // Visible en los registros del servidor (wrangler tail); los mensajes HTTP ya vienen sin la clave.
        console.log(`[${a.def.id}] ${err.kind}: ${err.message.split(key).join('***').slice(0, 300)}`);
        if (err.kind === 'auth' || err.kind === 'quota') {
          blockedConn.add(conn);
          deps.onConnectionFailure?.(conn, err.kind);
        }
        if (!err.retryable || err.kind === 'timeout' || attempt >= 1 || calls >= settings.maxCalls) throw err;
        await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 800));
      } finally {
        clearTimeout(timer);
      }
    }
  };

  const ask = async (a: Available, round: number, messages: ChatMessage[], maxTokens: number): Promise<AnswerRecord> => {
    const t = Date.now();
    const base = { participant: a.def.id, label: a.def.label, model: a.model, round, cost: a.cost };
    try {
      const r = await invoke(a, messages, maxTokens);
      if (r.truncated) warnings.push(`La respuesta de ${a.def.label} se cortó por el límite de longitud.`);
      return { ...base, status: 'ok', text: r.text, citations: r.citations, usage: r.usage, ms: Date.now() - t };
    } catch (e) {
      const err = e as ProviderError;
      return { ...base, status: err.kind, error: err.message, ms: Date.now() - t };
    }
  };

  // 1. Selección
  if (deps.available.length === 0) {
    warnings.push('No hay proveedores disponibles (sin configurar, sin autorizar o en pausa). Revisa la sección Conexiones.');
    return result({});
  }
  const n = targetCount(cls, settings, mode);
  const chosen = selectParticipants(deps.available, cls, n);
  if (cls.needsWeb && !chosen.some((c) => c.def.webSearch)) {
    warnings.push('La consulta parece requerir información actual, pero no hay ningún proveedor con búsqueda web disponible: la respuesta puede estar desactualizada.');
  }

  // 2. Respuestas independientes, con sustitución limitada de los que fallen
  const maxTokens = OUTPUT_TOKENS[cls.type];
  const msgs = participantMessages(query, cls);
  const tried = new Set(chosen.map((c) => c.def.id));
  let wave = await Promise.all(chosen.map((a) => ask(a, 0, msgs, maxTokens)));
  answers.push(...wave);
  for (let r = 0; r < MAX_REPLACEMENTS; r++) {
    const failed = wave.filter((w) => w.status !== 'ok').length;
    const spare = rank(deps.available, cls).filter((a) => !tried.has(a.def.id) && !blockedConn.has(a.def.connection));
    const reserve = n > 1 ? 1 : 0; // reservar una llamada para el árbitro
    const k = Math.min(failed, spare.length, settings.maxCalls - calls - reserve);
    if (k <= 0) break;
    const repl = spare.slice(0, k);
    repl.forEach((a) => tried.add(a.def.id));
    wave = await Promise.all(repl.map((a) => ask(a, 0, msgs, maxTokens)));
    answers.push(...wave);
  }

  const ok = answers.filter((a) => a.status === 'ok');
  // No se elige como árbitro a un participante cuya conexión acaba de fallar en esta consulta.
  const failedIds = new Set(answers.filter((a) => a.status !== 'ok').map((a) => a.participant));
  for (const a of answers.filter((x) => x.status !== 'ok')) warnings.push(`${a.label}: ${describe(a.status)}`);
  if (ok.length === 0) {
    warnings.push('Ningún proveedor pudo responder.');
    return result({});
  }
  if (ok.length === 1) {
    if (n > 1) warnings.push('Solo un proveedor respondió: no hubo contraste entre modelos.');
    return result({ final: ok[0]!.text!, strategy: 'single' });
  }

  // 3. Árbitro y revisión cruzada
  const letters = new Map(ok.map((a, i) => [a.participant, String.fromCharCode(65 + i)]));
  const toInput = (a: AnswerRecord): ArbiterInput => ({ id: letters.get(a.participant)!, text: a.text!, citations: a.citations ?? [], truncated: false });
  const avById = new Map(deps.available.map((a) => [a.def.id, a]));
  const arbiterTokens = Math.max(maxTokens, 1200) + 300;
  const excluded = new Set<string>(failedIds);

  const judge = async (reviews: AnswerRecord[]): Promise<{ v: Verdict; by: Available } | null> => {
    for (let i = 0; i < 2; i++) {
      const arb = pickArbiter(deps.available.filter((a) => !blockedConn.has(a.def.connection)), settings, excluded);
      if (!arb || calls >= settings.maxCalls) return null;
      try {
        const r = await invoke(arb, arbiterMessages(query, cls, ok.map(toInput), reviews.map(toInput)), arbiterTokens, true);
        const v = parseVerdict(r.text);
        if (v) return { v, by: arb };
        warnings.push(`El árbitro ${arb.def.label} devolvió un formato no válido.`);
      } catch (e) {
        warnings.push(`El árbitro ${arb.def.label} falló: ${describe((e as ProviderError).kind)}`);
      }
      excluded.add(arb.def.id);
    }
    return null;
  };

  let verdict = await judge([]);
  let rounds = 0;
  while (verdict && verdict.v.needs_review && verdict.v.agreement !== 'high' && rounds < settings.maxRounds && settings.maxCalls - calls >= ok.length + 1) {
    rounds++;
    const v = verdict.v;
    const wave = await Promise.all(ok.map((a) => ask(avById.get(a.participant)!, rounds, reviewMessages(query, a.text!, v.discrepancies, v.review_questions), REVIEW_TOKENS)));
    answers.push(...wave);
    const reviews = wave.filter((w) => w.status === 'ok');
    if (reviews.length === 0) {
      warnings.push('La ronda de revisión no obtuvo respuestas; se mantiene la evaluación anterior.');
      break;
    }
    const next = await judge(reviews);
    if (!next) break;
    verdict = next;
  }
  if (verdict && verdict.v.needs_review && verdict.v.agreement !== 'high') {
    warnings.push(rounds >= settings.maxRounds ? 'Persisten discrepancias tras el máximo de rondas configurado.' : 'Persisten discrepancias; no quedaban llamadas disponibles para otra revisión.');
  }

  if (!verdict) {
    // Respaldo sin árbitro: la respuesta del participante mejor valorado para este tipo de tarea.
    const best = [...ok].sort((x, y) => score(avById.get(y.participant)!, cls) - score(avById.get(x.participant)!, cls))[0]!;
    warnings.push(`Árbitro no disponible: se muestra la respuesta de ${best.label} sin consolidar.`);
    return result({ final: best.text!, strategy: 'consensus', arbiter: { participant: best.participant, status: 'fallback' }, rounds });
  }
  return result({
    final: verdict.v.final,
    strategy: 'consensus',
    arbiter: { participant: verdict.by.def.id, status: 'ok' },
    agreement: verdict.v.agreement,
    confidence: verdict.v.confidence,
    discrepancies: verdict.v.discrepancies,
    rounds,
  });
}

export function describe(kind: string): string {
  switch (kind) {
    case 'auth':
      return 'credencial no válida o sin permisos.';
    case 'quota':
      return 'cuota o saldo agotado.';
    case 'rate':
      return 'demasiadas peticiones; inténtalo más tarde.';
    case 'timeout':
      return 'no respondió a tiempo.';
    case 'network':
      return 'error de red.';
    case 'server':
      return 'error del servicio del proveedor.';
    case 'incomplete':
      return 'respuesta vacía o incompleta.';
    case 'blocked':
      return 'omitido por los límites de la consulta.';
    default:
      return 'solicitud rechazada por el proveedor.';
  }
}

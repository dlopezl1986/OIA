import { CONNECTIONS, PARTICIPANTS, createAdapters } from './providers/registry';
import { orchestrate } from './orchestrator/run';
import type { Available } from './orchestrator/select';
import { authenticate, HttpError, type AuthConfig, type Principal } from './security/auth';
import { importMasterKey, sha256 } from './security/crypto';
import { RateLimiter } from './security/ratelimit';
import { CredentialStore, type KeyValue } from './store/credentials';
import { DEFAULT_SETTINGS, ProviderError, type ConnectionId, type Mode, type ProviderAdapter, type QueryResult, type Settings } from './types';

/** Configuración del servidor, independiente de la plataforma (Workers, Node…). */
export interface AppEnv {
  auth: AuthConfig;
  masterKey: string;
  kv: KeyValue;
  allowedOrigins: string[];
  /** Claves definidas como secretos del servidor (alternativa al asistente). */
  envKeys?: Partial<Record<ConnectionId, string>>;
  envAllowPaid?: ConnectionId[];
  enableMock?: boolean;
  adapters?: Record<ConnectionId, ProviderAdapter>;
  retryDelayMs?: number;
  queriesPerMinute?: number;
}

const MAX_QUERY = 8000;
const MAX_BODY = 32_000;
const CACHE_TTL = 10 * 60_000;
// Pausa tras errores de cuota o credencial; «Comprobar de nuevo» o guardar otra clave la anulan.
const COOLDOWN = { quota: 30 * 60_000, auth: 15 * 60_000 };
const MODES: Mode[] = ['auto', 'fast', 'deep'];
const MODEL_RE = /^[\w.\-/:@]{1,100}$/;

export function createApp(env: AppEnv) {
  const adapters = env.adapters ?? createAdapters();
  const queryLimiter = new RateLimiter(env.queriesPerMinute ?? 8, 2);
  const adminLimiter = new RateLimiter(20, 3);
  const cooldowns = new Map<ConnectionId, number>();
  const cache = new Map<string, { at: number; value: Promise<QueryResult> }>();
  let storePromise: Promise<CredentialStore> | undefined;
  const store = () => (storePromise ??= importMasterKey(env.masterKey).then((k) => new CredentialStore(env.kv, k)));

  const connIds = (Object.keys(CONNECTIONS) as ConnectionId[]).filter((c) => c !== 'mock' || env.enableMock);
  const participants = PARTICIPANTS.filter((p) => p.connection !== 'mock' || env.enableMock);

  async function resolveKey(uid: string, conn: ConnectionId) {
    if (conn === 'mock') return { key: 'mock', allowPaid: true, source: 'env' as const };
    const s = await store();
    const meta = await s.meta(uid, conn);
    if (meta) {
      const key = await s.secret(uid, conn);
      if (key) return { key, allowPaid: meta.allowPaid, source: 'store' as const };
    }
    const envKey = env.envKeys?.[conn];
    if (envKey) return { key: envKey, allowPaid: env.envAllowPaid?.includes(conn) ?? false, source: 'env' as const };
    return null;
  }

  async function connectionsView(uid: string) {
    const s = await store();
    const now = Date.now();
    const list = await Promise.all(
      connIds.map(async (id) => {
        const def = CONNECTIONS[id];
        const meta = id === 'mock' ? null : await s.meta(uid, id);
        const fromEnv = id === 'mock' || (!meta && !!env.envKeys?.[id]);
        const cd = cooldowns.get(id);
        return {
          id,
          label: def.label,
          cost: def.cost,
          keyUrl: def.keyUrl,
          keyHelp: def.keyHelp,
          note: def.note ?? null,
          freeAlternative: def.freeAlternative ?? null,
          configured: !!meta || fromEnv,
          source: meta ? 'store' : fromEnv ? 'env' : null,
          last4: meta?.last4 ?? null,
          allowPaid: def.cost === 'free' ? true : (meta?.allowPaid ?? (fromEnv && (env.envAllowPaid?.includes(id) ?? false))),
          status: meta?.status ?? (fromEnv ? 'unverified' : null),
          detail: meta?.detail ?? null,
          checkedAt: meta?.checkedAt ?? null,
          cooldownUntil: cd && cd > now ? new Date(cd).toISOString() : null,
        };
      }),
    );
    return {
      connections: list,
      participants: participants.map((p) => ({ id: p.id, label: p.label, connection: p.connection, defaultModel: p.defaultModel, webSearch: p.webSearch })),
    };
  }

  async function available(uid: string, settings: Settings) {
    const keys: Partial<Record<ConnectionId, string>> = {};
    const out: Available[] = [];
    const warnings: string[] = [];
    const now = Date.now();
    for (const conn of connIds) {
      const r = await resolveKey(uid, conn);
      if (!r) continue;
      const cost = CONNECTIONS[conn].cost;
      if (cost !== 'free' && !r.allowPaid) continue; // bloqueo preventivo: sin autorización expresa no se llama
      if ((cooldowns.get(conn) ?? 0) > now) {
        warnings.push(`${CONNECTIONS[conn].label} en pausa temporal por cuota agotada o credencial no válida.`);
        continue;
      }
      keys[conn] = r.key;
      for (const p of participants.filter((x) => x.connection === conn && !settings.disabled.includes(x.id))) {
        out.push({ def: p, model: settings.models[p.id] ?? p.defaultModel, cost });
      }
    }
    return { keys, available: out, warnings };
  }

  async function validateKey(conn: ConnectionId, key: string) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await adapters[conn].validate(key, ctrl.signal);
      return { status: 'ok' as const, detail: r.detail };
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('network', 'No se pudo contactar con el proveedor');
      if (err.kind === 'auth') return { status: 'invalid' as const, detail: 'El proveedor rechazó la clave (no válida o sin permisos).' };
      return { status: 'unverified' as const, detail: `No se pudo verificar ahora (${err.kind}). Se volverá a comprobar al usarla.` };
    } finally {
      clearTimeout(t);
    }
  }

  async function handleQuery(p: Principal, body: Record<string, unknown>) {
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) throw new HttpError(400, 'La consulta está vacía');
    if (query.length > MAX_QUERY) throw new HttpError(400, `La consulta supera ${MAX_QUERY} caracteres`);
    const mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : 'auto';
    const settings = sanitizeSettings(body.settings);
    const fresh = body.fresh === true;

    const { keys, available: av, warnings } = await available(p.uid, settings);
    const cacheKey = await sha256(JSON.stringify([p.uid, query, mode, settings, av.map((a) => a.def.id + a.model)]));
    const hit = cache.get(cacheKey);
    if (!fresh && hit && Date.now() - hit.at < CACHE_TTL) {
      const r = await hit.value;
      return { ...r, cached: true };
    }
    const run = orchestrate(query, mode, settings, {
      adapters,
      keys,
      available: av,
      retryDelayMs: env.retryDelayMs,
      onConnectionFailure: (conn, kind) => conn !== 'mock' && cooldowns.set(conn, Date.now() + COOLDOWN[kind]),
    }).then((r) => ({ ...r, warnings: [...warnings, ...r.warnings] }));
    // Las consultas idénticas simultáneas comparten la misma ejecución; solo se cachean respuestas sin datos de actualidad.
    cache.set(cacheKey, { at: Date.now(), value: run });
    try {
      const r = await run;
      if (r.classification.needsWeb || !r.final) cache.delete(cacheKey);
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
      return r;
    } catch (e) {
      cache.delete(cacheKey);
      throw e;
    }
  }

  async function route(req: Request, url: URL): Promise<unknown> {
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/api/health' && req.method === 'GET') return { ok: true };

    const p = await authenticate(req, env.auth);
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};

    if (path === '/api/query' && req.method === 'POST') return queryLimiter.run(p.uid, () => handleQuery(p, body));
    if (path === '/api/connections' && req.method === 'GET') return connectionsView(p.uid);

    const m = /^\/api\/connections\/([a-z]+)(\/test)?$/.exec(path);
    if (m) {
      const conn = m[1] as ConnectionId;
      if (!connIds.includes(conn) || conn === 'mock') throw new HttpError(404, 'Conexión desconocida');
      return adminLimiter.run(p.uid, async () => {
        const s = await store();
        if (m[2] && req.method === 'POST') {
          const r = await resolveKey(p.uid, conn);
          if (!r) throw new HttpError(404, 'No hay credencial guardada');
          const v = await validateKey(conn, r.key);
          if (v.status === 'ok') cooldowns.delete(conn);
          if (r.source === 'store') await s.updateMeta(p.uid, conn, { ...v, checkedAt: new Date().toISOString() });
          return v;
        }
        if (req.method === 'PUT') {
          const allowPaid = body.allowPaid === true;
          const key = typeof body.key === 'string' ? body.key.trim() : '';
          if (!key) {
            const meta = await s.updateMeta(p.uid, conn, { allowPaid });
            if (!meta) throw new HttpError(400, 'Introduce una clave');
            return meta;
          }
          if (key.length > 400 || /\s/.test(key)) throw new HttpError(400, 'Formato de clave no válido');
          const v = await validateKey(conn, key);
          if (v.status === 'invalid') throw new HttpError(400, v.detail);
          const pattern = CONNECTIONS[conn].keyPattern;
          const detail = pattern && !pattern.test(key) ? `${v.detail} Aviso: el formato no coincide con el habitual.` : v.detail;
          cooldowns.delete(conn);
          return s.save(p.uid, conn, key, { allowPaid, status: v.status, detail, checkedAt: new Date().toISOString() });
        }
        if (req.method === 'DELETE') {
          await s.remove(p.uid, conn);
          return { ok: true };
        }
        throw new HttpError(405, 'Método no permitido');
      });
    }
    throw new HttpError(404, 'Ruta no encontrada');
  }

  return async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors: Record<string, string> =
      origin && env.allowedOrigins.includes(origin)
        ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Max-Age': '600' }
        : {};
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ error: 'Origen no permitido' }, 403, {});
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return json(await route(req, url), 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      // Nunca se devuelven detalles internos ni secretos.
      console.error('Error interno', e instanceof Error ? e.name : 'desconocido');
      return json({ error: 'Error interno del servidor' }, 500, cors);
    }
  };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON no válido');
  }
}

function clamp(v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
}

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ids = new Set(PARTICIPANTS.map((p) => p.id));
  const models: Record<string, string> = {};
  if (r.models && typeof r.models === 'object') {
    for (const [k, v] of Object.entries(r.models as Record<string, unknown>)) if (ids.has(k) && typeof v === 'string' && MODEL_RE.test(v)) models[k] = v;
  }
  return {
    maxRounds: clamp(r.maxRounds, 0, 3, DEFAULT_SETTINGS.maxRounds),
    maxParticipants: clamp(r.maxParticipants, 1, 4, DEFAULT_SETTINGS.maxParticipants),
    maxCalls: clamp(r.maxCalls, 1, 16, DEFAULT_SETTINGS.maxCalls),
    timeoutMs: clamp(r.timeoutMs, 5_000, 120_000, DEFAULT_SETTINGS.timeoutMs),
    disabled: Array.isArray(r.disabled) ? r.disabled.filter((x): x is string => typeof x === 'string' && ids.has(x)) : [],
    models,
    arbiter: typeof r.arbiter === 'string' && ids.has(r.arbiter) ? r.arbiter : undefined,
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

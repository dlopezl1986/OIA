import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, sanitizeSettings } from '../../server/app';
import { createAdapters } from '../../server/providers/registry';
import { mapHttpError } from '../../server/providers/http';
import { b64, decrypt, encrypt, importMasterKey } from '../../server/security/crypto';
import { MemoryKV } from '../../server/store/credentials';
import { ProviderError, type ProviderAdapter } from '../../server/types';

const PROJECT = 'oia-test';
const master = b64(crypto.getRandomValues(new Uint8Array(32)));
let jwks: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

const token = (claims: Record<string, unknown> = {}, opts: { aud?: string; exp?: string } = {}) =>
  new SignJWT({ email: 'ruka@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(opts.aud ?? PROJECT)
    .setSubject('owner-uid')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(privateKey);

// Adaptador de prueba que simula la validación de claves de Gemini (sin red).
const fakeGemini: ProviderAdapter = {
  call: async () => ({ text: 'hola desde gemini simulado', citations: [], truncated: false, usage: { inputTokens: 3, outputTokens: 4 } }),
  validate: async (key) => {
    if (key.endsWith('bad')) throw new ProviderError('auth', 'HTTP 401');
    if (key.endsWith('down')) throw new ProviderError('network', 'red');
    return { ok: true, detail: 'Clave válida.', costly: false };
  },
};

function makeApp(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  const kv = new MemoryKV();
  const app = createApp({
    auth: { projectId: PROJECT, ownerUids: [], ownerEmails: ['ruka@example.com'], jwks },
    masterKey: master,
    kv,
    allowedOrigins: ['https://oia.example'],
    adapters: { ...createAdapters(), gemini: fakeGemini },
    retryDelayMs: 1,
    ...over,
  });
  return { app, kv };
}

async function call(app: ReturnType<typeof createApp>, path: string, init: RequestInit & { tok?: string | null } = {}) {
  const headers = new Headers(init.headers);
  const tok = init.tok === undefined ? await token() : init.tok;
  if (tok) headers.set('authorization', `Bearer ${tok}`);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await app(new Request(`https://api.example${path}`, { ...init, headers }));
  return { status: res.status, body: (await res.json()) as Record<string, any>, headers: res.headers };
}

describe('seguridad de la API', () => {
  it('health es público y no revela nada', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/health', { tok: null })).body).toEqual({ ok: true });
  });

  it('rechaza peticiones sin token', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/connections', { tok: null })).status).toBe(401);
  });

  it('rechaza tokens falsificados, caducados o de otro proyecto', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/connections', { tok: 'abc.def.ghi' })).status).toBe(401);
    expect((await call(app, '/api/connections', { tok: await token({}, { aud: 'otro' }) })).status).toBe(401);
    expect((await call(app, '/api/connections', { tok: await token({}, { exp: '-1m' }) })).status).toBe(401);
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ email: 'ruka@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setSubject('owner-uid')
      .setExpirationTime('1h')
      .sign(other.privateKey);
    expect((await call(app, '/api/connections', { tok: forged })).status).toBe(401);
  });

  it('rechaza usuarios válidos que no son el propietario', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/connections', { tok: await token({ email: 'otro@example.com' }) })).status).toBe(403);
    expect((await call(app, '/api/connections', { tok: await token({ email_verified: false }) })).status).toBe(403);
  });

  it('bloquea orígenes no permitidos y responde CORS al permitido', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/health', { headers: { origin: 'https://malo.example' } })).status).toBe(403);
    const ok = await call(app, '/api/health', { headers: { origin: 'https://oia.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://oia.example');
  });

  it('valida el cuerpo de la consulta', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/query', { method: 'POST', body: '{"query":""}' })).status).toBe(400);
    expect((await call(app, '/api/query', { method: 'POST', body: 'no json' })).status).toBe(400);
    expect((await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'x'.repeat(8001) }) })).status).toBe(400);
    expect((await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'x'.repeat(40000) }) })).status).toBe(413);
  });

  it('limita la frecuencia de consultas', async () => {
    const { app } = makeApp({ enableMock: true });
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: `Define ${i}` }) })).status);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });

  it('limita las consultas simultáneas y rinde bajo concurrencia', async () => {
    const slow: ProviderAdapter = {
      ...fakeGemini,
      call: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { text: 'ok', citations: [], truncated: false, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const { app } = makeApp({ adapters: { ...createAdapters(), gemini: slow }, queriesPerMinute: 100 });
    await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-buena-123' }) });
    const t0 = Date.now();
    const rs = await Promise.all([1, 2, 3].map((i) => call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: `Define ${i}` }) })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 429]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('acepta el token de desarrollo solo si está configurado', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/connections', { tok: 'dev-secret' })).status).toBe(401);
    const { app: devApp } = makeApp({ auth: { projectId: PROJECT, ownerUids: [], ownerEmails: [], jwks, devToken: 'dev-secret' } });
    expect((await call(devApp, '/api/connections', { tok: 'dev-secret' })).status).toBe(200);
  });
});

describe('credenciales', () => {
  it('cifra y descifra con AAD; falla con otro contexto', async () => {
    const k = await importMasterKey(master);
    const c = await encrypt(k, 'secreto', 'u:gemini');
    expect(await decrypt(k, c, 'u:gemini')).toBe('secreto');
    await expect(decrypt(k, c, 'u:openai')).rejects.toThrow();
  });

  it('guarda la clave cifrada y nunca la devuelve', async () => {
    const { app, kv } = makeApp();
    const key = 'AIzaSyD-clave-de-prueba-123456789';
    const r = await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key }) });
    expect(r.status).toBe(200);
    expect(r.body.last4).toBe('6789');
    expect(JSON.stringify(r.body)).not.toContain(key);
    const stored = [...kv.map.values()].join('');
    expect(stored).not.toContain(key);
    const list = await call(app, '/api/connections');
    const g = list.body.connections.find((c: any) => c.id === 'gemini');
    expect(g).toMatchObject({ configured: true, status: 'ok', last4: '6789', source: 'store' });
    expect(JSON.stringify(list.body)).not.toContain(key);
  });

  it('rechaza claves inválidas sin guardarlas', async () => {
    const { app, kv } = makeApp();
    const r = await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-bad' }) });
    expect(r.status).toBe(400);
    expect(kv.map.size).toBe(0);
  });

  it('guarda como no verificada si el proveedor no responde', async () => {
    const { app } = makeApp();
    const r = await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-down' }) });
    expect(r.body.status).toBe('unverified');
  });

  it('permite volver a comprobar y eliminar', async () => {
    const { app } = makeApp();
    await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-buena-123' }) });
    expect((await call(app, '/api/connections/gemini/test', { method: 'POST' })).body.status).toBe('ok');
    expect((await call(app, '/api/connections/gemini', { method: 'DELETE' })).status).toBe(200);
    expect((await call(app, '/api/connections/gemini/test', { method: 'POST' })).status).toBe(404);
  });

  it('rechaza conexiones desconocidas', async () => {
    const { app } = makeApp();
    expect((await call(app, '/api/connections/mock', { method: 'PUT', body: '{"key":"x"}' })).status).toBe(404);
    expect((await call(app, '/api/connections/foo', { method: 'PUT', body: '{"key":"x"}' })).status).toBe(404);
  });

  it('redacta la clave en los errores del proveedor', () => {
    const e = mapHttpError(401, 'invalid key sk-secreto-123456 provided', 'sk-secreto-123456');
    expect(e.message).not.toContain('sk-secreto-123456');
    expect(e.kind).toBe('auth');
    expect(mapHttpError(429, '{"error":{"code":"insufficient_quota"}}', '').kind).toBe('quota');
    expect(mapHttpError(429, 'slow down', '').kind).toBe('rate');
    expect(mapHttpError(402, 'Insufficient Balance', '').kind).toBe('quota');
  });
});

describe('control de costes y consultas', () => {
  it('sin proveedores informa y no llama a nada', async () => {
    const { app } = makeApp();
    const r = await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Hola' }) });
    expect(r.status).toBe(200);
    expect(r.body.strategy).toBe('none');
    expect(r.body.calls).toBe(0);
  });

  it('no usa proveedores de pago sin autorización expresa', async () => {
    let called = 0;
    const paid: ProviderAdapter = {
      call: async () => {
        called++;
        return { text: 'x', citations: [], truncated: false, usage: { inputTokens: 1, outputTokens: 1 } };
      },
      validate: async () => ({ ok: true, detail: 'ok', costly: false }),
    };
    const { app } = makeApp({ adapters: { ...createAdapters(), openai: paid } });
    await call(app, '/api/connections/openai', { method: 'PUT', body: JSON.stringify({ key: 'sk-proj-abcdefghijklmnopqrstuvwxyz' }) });
    const r1 = await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Hola' }) });
    expect(r1.body.calls).toBe(0);
    expect(called).toBe(0);
    await call(app, '/api/connections/openai', { method: 'PUT', body: JSON.stringify({ allowPaid: true }) });
    const r2 = await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Hola' }) });
    expect(r2.body.calls).toBe(1);
    expect(called).toBe(1);
  });

  it('las claves de entorno de pago tampoco se usan sin OIA_ALLOW_PAID', async () => {
    const { app } = makeApp({ envKeys: { openai: 'sk-env-1234567890abcdefghij' } });
    const r = await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Hola' }) });
    expect(r.body.calls).toBe(0);
  });

  it('reutiliza la respuesta de una consulta idéntica sin nuevas llamadas', async () => {
    const { app } = makeApp();
    await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-buena-123' }) });
    const body = JSON.stringify({ query: 'Define entropía' });
    const [a, b] = await Promise.all([call(app, '/api/query', { method: 'POST', body }), call(app, '/api/query', { method: 'POST', body })]);
    expect(a.body.final).toBe('hola desde gemini simulado');
    expect([a.body.cached, b.body.cached].sort()).toEqual([false, true]);
    const c = await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Define entropía', fresh: true }) });
    expect(c.body.cached).toBe(false);
  });

  it('no cachea consultas de actualidad', async () => {
    const { app } = makeApp();
    await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-buena-123' }) });
    const body = JSON.stringify({ query: 'noticias de hoy' });
    await call(app, '/api/query', { method: 'POST', body });
    expect((await call(app, '/api/query', { method: 'POST', body })).body.cached).toBe(false);
  });

  it('pone en pausa una conexión con cuota agotada', async () => {
    const exhausted: ProviderAdapter = { ...fakeGemini, call: async () => { throw new ProviderError('quota', 'HTTP 429'); } };
    const { app } = makeApp({ adapters: { ...createAdapters(), gemini: exhausted } });
    await call(app, '/api/connections/gemini', { method: 'PUT', body: JSON.stringify({ key: 'AIzaSyD-clave-buena-123' }) });
    await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Define a' }) });
    const r = await call(app, '/api/query', { method: 'POST', body: JSON.stringify({ query: 'Define b' }) });
    expect(r.body.calls).toBe(0);
    expect(r.body.warnings.join(' ')).toMatch(/pausa/);
    const list = await call(app, '/api/connections');
    expect(list.body.connections.find((c: any) => c.id === 'gemini').cooldownUntil).toBeTruthy();
  });

  it('sanea los ajustes recibidos', () => {
    const s = sanitizeSettings({ maxRounds: 99, maxParticipants: -1, maxCalls: 'x', disabled: ['gemini', 'evil'], models: { gemini: 'gemini-3.8-flash', gpt: 'bad model;rm' } });
    expect(s).toMatchObject({ maxRounds: 3, maxParticipants: 1, maxCalls: 8, disabled: ['gemini'], models: { gemini: 'gemini-3.8-flash' } });
  });
});

describe('validación de GitHub Models', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('valida con una llamada mínima y envía User-Agent', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'o' }, finish_reason: 'length' }] }), { status: 200 });
    });
    const r = await createAdapters().github.validate('github_pat_x');
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://models.github.ai/inference/chat/completions');
    expect(JSON.parse(calls[0]!.init.body as string).max_tokens).toBe(1);
    expect(new Headers(calls[0]!.init.headers).get('user-agent')).toMatch(/^OIA/);
  });

  it('un token rechazado se marca como clave no válida', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"Bad credentials"}', { status: 401 }));
    await expect(createAdapters().github.validate('github_pat_x')).rejects.toMatchObject({ kind: 'auth' });
  });
});

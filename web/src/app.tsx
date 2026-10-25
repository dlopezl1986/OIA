import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, createApi, type Api, type Connection, type Participant, type QueryResult } from './api';
import { renderMarkdown } from './markdown';
import { DEFAULT_SETTINGS, type HistoryItem, type Platform, type Settings, type User } from './platform';

type View = 'ask' | 'history' | 'connections' | 'settings';

const COST_LABEL = { free: 'Gratis', credit: 'Crédito incluido', paid: 'De pago' } as const;
const LEVEL = { high: 'alto', medium: 'medio', low: 'bajo' } as const;
const TYPE: Record<string, string> = { simple: 'sencilla', general: 'general', code: 'programación', research: 'investigación', reasoning: 'razonamiento' };
const STATUS_TEXT: Record<string, string> = {
  ok: 'respondió',
  auth: 'credencial no válida',
  quota: 'cuota agotada',
  rate: 'límite de peticiones',
  timeout: 'sin respuesta a tiempo',
  network: 'error de red',
  server: 'error del proveedor',
  incomplete: 'respuesta vacía',
  blocked: 'omitido por límites',
  bad_request: 'solicitud rechazada',
};

export function App({ platform }: { platform: Platform }) {
  const api = useMemo(() => createApi(platform), [platform]);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>('ask');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [conns, setConns] = useState<{ connections: Connection[]; participants: Participant[] } | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<HistoryItem | null>(null);

  useEffect(() => platform.onUser(setUser), [platform]);

  const refreshConns = async () => {
    try {
      setConns(await api.connections());
      setConnError(null);
    } catch (e) {
      setConnError(errorText(e));
    }
  };

  useEffect(() => {
    if (!user) return;
    void refreshConns();
    platform.loadSettings().then(setSettings).catch(() => undefined);
    platform.history.list(100).then(setHistory).catch(() => undefined);
  }, [user]);

  if (user === undefined) return <div class="center muted" role="status">Cargando…</div>;
  if (user === null) return <Login platform={platform} />;

  const configured = conns?.connections.some((c) => c.configured && c.status !== 'invalid' && (c.cost === 'free' || c.allowPaid));
  const go = (v: View) => {
    setView(v);
    setSelected(null);
  };

  return (
    <div class="shell">
      <header class="top">
        <div class="brand" aria-label="OIA">
          <span class="logo" aria-hidden="true">◎</span> OIA
        </div>
        <nav aria-label="Secciones">
          {(
            [
              ['ask', 'Consultar'],
              ['history', 'Historial'],
              ['connections', 'Conexiones'],
              ['settings', 'Ajustes'],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button key={v} class={view === v ? 'tab active' : 'tab'} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>
              {label}
            </button>
          ))}
        </nav>
        <button class="link" onClick={() => platform.signOut()} title={user.email ?? ''}>
          Salir
        </button>
      </header>
      <main>
        {connError && <div class="banner error">{connError}</div>}
        {view === 'ask' && (
          <Ask
            api={api}
            settings={settings}
            ready={!!configured}
            loaded={!!conns}
            onConfigure={() => go('connections')}
            onSaved={(h) => setHistory((prev) => [h, ...prev])}
            platform={platform}
          />
        )}
        {view === 'history' &&
          (selected ? (
            <HistoryDetail item={selected} onBack={() => setSelected(null)} />
          ) : (
            <History
              items={history}
              onOpen={setSelected}
              onRemove={async (id) => {
                await platform.history.remove(id);
                setHistory((prev) => prev.filter((h) => h.id !== id));
              }}
            />
          ))}
        {view === 'connections' && <Connections api={api} data={conns} onChange={refreshConns} />}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            participants={conns?.participants ?? []}
            onSave={async (s) => {
              setSettings(s);
              await platform.saveSettings(s);
            }}
          />
        )}
      </main>
    </div>
  );
}

function Login({ platform }: { platform: Platform }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div class="center">
      <div class="card login">
        <div class="logo big" aria-hidden="true">
          ◎
        </div>
        <h1>OIA</h1>
        <p class="muted">Orquestador personal de inteligencia artificial. Acceso privado.</p>
        <button class="primary" onClick={() => platform.signIn().catch((e) => setError(errorText(e)))}>
          {platform.mode === 'local' ? 'Entrar (modo desarrollo)' : 'Iniciar sesión con Google'}
        </button>
        {error && <p class="error-text">{error}</p>}
      </div>
    </div>
  );
}

function Ask(props: { api: Api; settings: Settings; ready: boolean; loaded: boolean; onConfigure: () => void; onSaved: (h: HistoryItem) => void; platform: Platform }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ q: string; r: QueryResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const run = async (fresh = false, text = query) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setSaveError(null);
    setElapsed(0);
    const t0 = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    try {
      const r = await props.api.query(q, mode, props.settings, fresh);
      setResult({ q, r });
      if (r.final && !r.cached) {
        try {
          props.onSaved(await props.platform.history.add(toHistory(q, mode, r)));
        } catch {
          setSaveError('La respuesta no se pudo guardar en el historial.');
        }
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      clearInterval(timer.current);
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ask-title">
      <h2 id="ask-title" class="sr-only">
        Nueva consulta
      </h2>
      {props.loaded && !props.ready && (
        <div class="banner">
          No hay ningún proveedor conectado.{' '}
          <button class="link" onClick={props.onConfigure}>
            Configura una conexión gratuita
          </button>{' '}
          para empezar.
        </div>
      )}
      <form
        class="card ask"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label for="q" class="sr-only">
          Consulta
        </label>
        <textarea
          id="q"
          value={query}
          maxLength={8000}
          rows={4}
          placeholder="Escribe tu consulta…"
          onInput={(e) => setQuery((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div class="row">
          <div class="segmented" role="radiogroup" aria-label="Modo">
            {[
              ['auto', 'Automático', 'Elige uno o varios modelos según la complejidad'],
              ['fast', 'Rápido', 'Un solo modelo'],
              ['deep', 'Profundo', 'Varios modelos con árbitro'],
            ].map(([v, l, t]) => (
              <button type="button" key={v} role="radio" aria-checked={mode === v} title={t} class={mode === v ? 'on' : ''} onClick={() => setMode(v!)}>
                {l}
              </button>
            ))}
          </div>
          <span class="muted small">{query.length > 7000 ? `${query.length}/8000` : 'Ctrl+Enter para enviar'}</span>
          <button class="primary" type="submit" disabled={busy || !query.trim()}>
            {busy ? 'Procesando…' : 'Consultar'}
          </button>
        </div>
      </form>

      {busy && (
        <div class="card progress" role="status" aria-live="polite">
          <span class="spinner" aria-hidden="true" />
          <span>
            {elapsed < 3 ? 'Analizando la consulta…' : elapsed < 20 ? 'Consultando modelos…' : 'Contrastando respuestas…'} ({elapsed} s)
          </span>
        </div>
      )}
      {error && (
        <div class="banner error" role="alert">
          {error}
        </div>
      )}
      {saveError && <div class="banner">{saveError}</div>}
      {result && !busy && <ResultView q={result.q} r={result.r} onRetry={() => run(true, result.q)} />}
    </section>
  );
}

function ResultView({ q, r, onRetry }: { q: string; r: QueryResult; onRetry: () => void }) {
  const firstRound = r.answers.filter((a) => a.round === 0);
  const tokens = Object.entries(r.usage);
  return (
    <article class="card result" aria-label="Respuesta">
      <p class="muted small question">{q}</p>
      {r.final ? <div class="answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.final) }} /> : <p class="error-text">No se obtuvo respuesta.</p>}
      <div class="chips">
        {r.cached && <span class="chip">Respuesta reutilizada</span>}
        {r.strategy === 'consensus' && r.agreement && <span class={`chip lvl-${r.agreement}`}>Acuerdo {LEVEL[r.agreement]}</span>}
        {r.confidence && <span class={`chip lvl-${r.confidence}`}>Confianza {LEVEL[r.confidence]}</span>}
        {firstRound.map((a) => (
          <span key={a.participant} class={a.status === 'ok' ? 'chip ok' : 'chip bad'} title={`${a.model}: ${STATUS_TEXT[a.status] ?? a.status}`}>
            {a.status === 'ok' ? '✓' : '✕'} {a.label}
          </span>
        ))}
      </div>
      {r.strategy === 'consensus' && <p class="muted small">El acuerdo entre modelos no garantiza que la respuesta sea correcta.</p>}
      {r.warnings.length > 0 && (
        <ul class="warnings">
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>Detalles</summary>
        {r.discrepancies.length > 0 && (
          <>
            <h3>Discrepancias</h3>
            <ul>
              {r.discrepancies.map((d, i) => (
                <li key={i}>
                  <strong>{d.topic}:</strong> {d.detail}
                </li>
              ))}
            </ul>
          </>
        )}
        <p class="small">
          Consulta {TYPE[r.classification.type] ?? r.classification.type} · complejidad {r.classification.complexity}/3 · llamadas: {r.calls} · rondas de revisión: {r.rounds} ·{' '}
          {(r.ms / 1000).toFixed(1)} s
          {r.arbiter && ` · árbitro: ${r.answers.find((a) => a.participant === r.arbiter!.participant)?.label ?? r.arbiter.participant}${r.arbiter.status === 'fallback' ? ' (sin consolidar)' : ''}`}
        </p>
        {tokens.length > 0 && (
          <p class="small">
            Tokens:{' '}
            {tokens
              .map(([k, u]) => `${k} ${u.inputTokens ?? '¿?'} entrada / ${u.outputTokens ?? '¿?'} salida (${u.calls} llamadas)`)
              .join(' · ')}
          </p>
        )}
        {r.answers
          .filter((a) => a.status === 'ok' && r.answers.length > 1)
          .map((a, i) => (
            <details key={i} class="sub">
              <summary>
                {a.label} ({a.model}){a.round > 0 ? ` · revisión ${a.round}` : ''}
              </summary>
              <div class="answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.text ?? '') }} />
            </details>
          ))}
        <button class="link" onClick={onRetry}>
          Repetir la consulta sin reutilizar respuestas
        </button>
      </details>
    </article>
  );
}

function History({ items, onOpen, onRemove }: { items: HistoryItem[]; onOpen: (h: HistoryItem) => void; onRemove: (id: string) => Promise<void> }) {
  const [filter, setFilter] = useState('');
  const shown = items.filter((h) => !filter || (h.query + ' ' + h.final).toLowerCase().includes(filter.toLowerCase()));
  return (
    <section aria-labelledby="h-title">
      <div class="row">
        <h2 id="h-title">Historial</h2>
        <input type="search" placeholder="Buscar…" aria-label="Buscar en el historial" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      </div>
      {shown.length === 0 && <p class="muted">{items.length ? 'Sin resultados.' : 'Aún no hay consultas guardadas.'}</p>}
      <ul class="history">
        {shown.map((h) => (
          <li key={h.id} class="card item">
            <button class="item-main" onClick={() => onOpen(h)}>
              <span class="item-q">{h.query}</span>
              <span class="muted small">
                {new Date(h.createdAt).toLocaleString()} · {h.strategy === 'consensus' ? `consenso (${h.participants.filter((p) => p.round === 0 && p.status === 'ok').length} IA)` : 'una IA'}
              </span>
            </button>
            <button
              class="link danger"
              aria-label="Eliminar consulta"
              onClick={() => {
                if (confirm('¿Eliminar esta consulta del historial?')) void onRemove(h.id);
              }}
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistoryDetail({ item, onBack }: { item: HistoryItem; onBack: () => void }) {
  return (
    <section>
      <button class="link" onClick={onBack}>
        ← Volver al historial
      </button>
      <article class="card result">
        <p class="muted small">{new Date(item.createdAt).toLocaleString()}</p>
        <h2 class="question-title">{item.query}</h2>
        <div class="answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.final) }} />
        <div class="chips">
          {item.agreement && <span class={`chip lvl-${item.agreement}`}>Acuerdo {LEVEL[item.agreement as 'high']}</span>}
          {item.participants
            .filter((p) => p.round === 0)
            .map((p, i) => (
              <span key={i} class={p.status === 'ok' ? 'chip ok' : 'chip bad'} title={p.model}>
                {p.status === 'ok' ? '✓' : '✕'} {p.label}
              </span>
            ))}
        </div>
        {item.warnings.length > 0 && (
          <ul class="warnings">
            {item.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {item.discrepancies.length > 0 && (
          <details>
            <summary>Discrepancias</summary>
            <ul>
              {item.discrepancies.map((d, i) => (
                <li key={i}>
                  <strong>{d.topic}:</strong> {d.detail}
                </li>
              ))}
            </ul>
          </details>
        )}
      </article>
    </section>
  );
}

function Connections({ api, data, onChange }: { api: Api; data: { connections: Connection[] } | null; onChange: () => Promise<void> }) {
  if (!data) return <p class="muted">Cargando conexiones…</p>;
  const free = data.connections.filter((c) => c.cost !== 'paid');
  const paid = data.connections.filter((c) => c.cost === 'paid');
  return (
    <section aria-labelledby="c-title">
      <h2 id="c-title">Conexiones</h2>
      <p class="muted">
        Las suscripciones (Claude Pro, ChatGPT Plus, Gemini) no incluyen acceso por API. Para coste 0 € empieza por <strong>Gemini</strong> y <strong>GitHub Models</strong>. Solo
        necesitas configurar los proveedores que vayas a usar. Las claves se cifran en el servidor y nunca se vuelven a mostrar.
      </p>
      {free.map((c) => (
        <ConnectionCard key={c.id} c={c} api={api} onChange={onChange} />
      ))}
      <details class="paid" open={paid.some((c) => c.configured)}>
        <summary>Proveedores de pago (opcional)</summary>
        <p class="muted small">Solo se llamarán si los autorizas expresamente. Pueden generar cargos en tu cuenta del proveedor.</p>
        {paid.map((c) => (
          <ConnectionCard key={c.id} c={c} api={api} onChange={onChange} />
        ))}
      </details>
    </section>
  );
}

function ConnectionCard({ c, api, onChange }: { c: Connection; api: Api; onChange: () => Promise<void> }) {
  const [key, setKey] = useState('');
  const [allow, setAllow] = useState(c.allowPaid);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (fn: () => Promise<{ ok: boolean; text: string }>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
      await onChange();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const status = c.cooldownUntil
    ? { cls: 'warn', text: `En pausa hasta ${new Date(c.cooldownUntil).toLocaleTimeString()}` }
    : !c.configured
      ? { cls: '', text: 'Sin configurar' }
      : c.status === 'ok'
        ? { cls: 'good', text: 'Conectada' }
        : c.status === 'invalid'
          ? { cls: 'bad', text: 'Clave no válida' }
          : { cls: 'warn', text: 'Sin verificar' };
  const id = `key-${c.id}`;
  return (
    <div class="card conn">
      <div class="row">
        <h3>{c.label}</h3>
        <span class={`badge cost-${c.cost}`}>{COST_LABEL[c.cost]}</span>
        <span class={`badge st ${status.cls}`}>{status.text}</span>
      </div>
      {c.configured && (
        <p class="small muted">
          {c.source === 'env' ? 'Definida como secreto del servidor.' : `Clave guardada ••••${c.last4}.`} {c.detail}
        </p>
      )}
      <p class="small">
        {c.keyHelp}{' '}
        {c.keyUrl && (
          <a href={c.keyUrl} target="_blank" rel="noopener noreferrer">
            Obtener clave ↗
          </a>
        )}
      </p>
      {c.note && <p class="small muted">{c.note}</p>}
      {c.freeAlternative && c.cost !== 'free' && <p class="small muted">Alternativa: {c.freeAlternative}</p>}
      {c.source !== 'env' && (
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await api.saveKey(c.id, key, allow);
              setKey('');
              return { ok: r.status === 'ok', text: r.detail || 'Guardada.' };
            });
          }}
        >
          <label for={id} class="sr-only">
            Clave de {c.label}
          </label>
          <input
            id={id}
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder={c.configured ? 'Sustituir clave…' : 'Pega aquí la clave'}
            value={key}
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
          {c.cost !== 'free' && (
            <label class="check small">
              <input type="checkbox" checked={allow} onChange={(e) => setAllow((e.target as HTMLInputElement).checked)} />
              {c.cost === 'credit' ? 'Autorizo consumir el crédito incluido' : 'Autorizo llamadas con coste'}
            </label>
          )}
          <button class="primary" disabled={busy || (!key && (!c.configured || allow === c.allowPaid))}>
            {key ? 'Guardar y validar' : 'Guardar'}
          </button>
        </form>
      )}
      {c.configured && (
        <div class="row">
          <button class="link" disabled={busy} onClick={() =>
              act(async () => {
                const r = await api.testKey(c.id);
                return { ok: r.status === 'ok', text: r.detail };
              })
            }>
            Comprobar de nuevo
          </button>
          {c.source === 'store' && (
            <button
              class="link danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`¿Eliminar la clave de ${c.label}?`)) void act(async () => (await api.removeKey(c.id), { ok: true, text: 'Clave eliminada.' }));
              }}
            >
              Eliminar clave
            </button>
          )}
        </div>
      )}
      {msg && (
        <p class={msg.ok ? 'small good-text' : 'small warn-text'} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}

function SettingsView({ settings, participants, onSave }: { settings: Settings; participants: Participant[]; onSave: (s: Settings) => Promise<void> }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  // El valor más reciente vive también en una ref: un envío inmediatamente después de escribir
  // no debe usar el estado de la renderización anterior.
  const latest = useRef(settings);
  const update = (fn: (prev: Settings) => Settings) => {
    latest.current = fn(latest.current);
    setS(latest.current);
  };
  // Solo se sincroniza cuando llegan ajustes nuevos; en el montaje no, para no pisar lo que ya se haya escrito.
  const shown = useRef(settings);
  useEffect(() => {
    if (shown.current === settings) return;
    shown.current = settings;
    update(() => settings);
  }, [settings]);
  const num = (k: 'maxRounds' | 'maxParticipants' | 'maxCalls', label: string, min: number, max: number, help: string) => (
    <label class="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} value={s[k]} onInput={(e) => update((p) => ({ ...p, [k]: Number((e.target as HTMLInputElement).value) }))} />
      <span class="small muted">{help}</span>
    </label>
  );
  return (
    <section aria-labelledby="s-title">
      <h2 id="s-title">Ajustes</h2>
      <form
        class="card"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave(latest.current);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }}
      >
        <h3>Consumo por consulta</h3>
        {num('maxRounds', 'Rondas de revisión máximas', 0, 3, 'Solo se ejecutan si hay contradicciones relevantes.')}
        {num('maxParticipants', 'Modelos independientes máximos', 1, 4, 'En modo automático se usan menos si la consulta es sencilla.')}
        {num('maxCalls', 'Llamadas máximas por consulta', 1, 16, 'Incluye árbitro, revisiones y reintentos.')}
        <label class="field">
          <span>Tiempo máximo por llamada (s)</span>
          <input type="number" min={5} max={120} value={s.timeoutMs / 1000} onInput={(e) => update((p) => ({ ...p, timeoutMs: Number((e.target as HTMLInputElement).value) * 1000 }))} />
        </label>
        <label class="field">
          <span>IA árbitro</span>
          <select value={s.arbiter ?? ''} onChange={(e) => update((p) => ({ ...p, arbiter: (e.target as HTMLSelectElement).value || undefined }))}>
            <option value="">Automático (mejor disponible)</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <h3>Modelos</h3>
        <p class="small muted">Desactiva los que no quieras usar o cambia el modelo si el proveedor lo renombra.</p>
        {participants.map((p) => (
          <div class="row model" key={p.id}>
            <label class="check">
              <input
                type="checkbox"
                checked={!s.disabled.includes(p.id)}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  update((prev) => ({ ...prev, disabled: on ? prev.disabled.filter((d) => d !== p.id) : [...prev.disabled, p.id] }));
                }}
              />
              {p.label}
            </label>
            <input
              aria-label={`Modelo de ${p.label}`}
              value={s.models[p.id] ?? ''}
              placeholder={p.defaultModel}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value.trim();
                update((prev) => {
                  const models = { ...prev.models };
                  if (v) models[p.id] = v;
                  else delete models[p.id];
                  return { ...prev, models };
                });
              }}
            />
          </div>
        ))}
        <div class="row">
          <button class="primary">Guardar ajustes</button>
          <button type="button" class="link" onClick={() => update(() => DEFAULT_SETTINGS)}>
            Valores por defecto
          </button>
          {saved && <span class="good-text small">Guardado</span>}
        </div>
      </form>
      <p class="small muted">
        Privacidad: las consultas solo se envían a los proveedores seleccionados para cada consulta. El historial se guarda en tu base de datos privada y solo tu cuenta puede leerlo.
      </p>
    </section>
  );
}

function toHistory(query: string, mode: string, r: QueryResult): Omit<HistoryItem, 'id' | 'createdAt'> {
  return {
    query,
    mode,
    final: r.final,
    strategy: r.strategy,
    agreement: r.agreement,
    confidence: r.confidence,
    discrepancies: r.discrepancies,
    warnings: r.warnings,
    participants: r.answers.map((a) => ({ label: a.label, model: a.model, status: a.status, round: a.round })),
    usage: r.usage,
    calls: r.calls,
    ms: r.ms,
    type: r.classification.type,
    complexity: r.classification.complexity,
  };
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
    if (e.status === 403) return `Acceso denegado: ${e.message}`;
    if (e.status === 429) return e.message;
    return e.message;
  }
  const code = (e as { code?: string })?.code;
  if (code === 'auth/popup-closed-by-user') return 'Se cerró la ventana de inicio de sesión.';
  if (code === 'permission-denied') return 'Sin permiso para acceder a los datos.';
  return e instanceof Error ? e.message : 'Error inesperado';
}

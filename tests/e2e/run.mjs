// Prueba de extremo a extremo: compila, arranca el servidor con el proveedor SIMULADO y recorre la interfaz en Chromium.
// No usa Firebase ni proveedores reales (modo desarrollo local).
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(join(execSync('npm root -g').toString().trim(), 'playwright')));
}

const TOKEN = 'e2e-' + randomBytes(8).toString('hex');
const out = 'test-results';
mkdirSync(out, { recursive: true });
execSync(`npx vite build --outDir ../dist-e2e`, { stdio: 'inherit', env: { ...process.env, VITE_DEV_TOKEN: TOKEN, VITE_FIREBASE_PROJECT_ID: '', VITE_FIREBASE_API_KEY: '' } });
execSync('npx vite build -c vite.server.config.ts', { stdio: 'inherit' });

function server(port, extra) {
  const p = spawn('node', ['dist-server/node.js'], {
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      OIA_MASTER_KEY: randomBytes(32).toString('base64'),
      OIA_DEV_TOKEN: TOKEN,
      OIA_STATIC_DIR: 'dist-e2e',
      OIA_DATA_FILE: join(mkdtempSync(join(tmpdir(), 'oia-')), 'cred.json'),
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => d.toString().includes('OIA en') && resolve(p));
    p.on('exit', (code) => reject(new Error(`El servidor terminó (código ${code})`)));
    setTimeout(() => reject(new Error('El servidor no arrancó a tiempo')), 15000);
  });
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['SUPERADO', name]);
  } catch (e) {
    results.push(['FALLIDO', `${name}: ${e.message.split('\n')[0]}`]);
    await globalThis.__page?.screenshot({ path: `${out}/fallo-${results.length}.png`, fullPage: true }).catch(() => undefined);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const s1 = await server(8799, { OIA_ENABLE_MOCK: '1', OIA_QUERIES_PER_MINUTE: '60' });
const s2 = await server(8798, {});
const browser = await chromium.launch();
const base = 'http://127.0.0.1:8799';

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  globalThis.__page = page;
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await step('API sin token devuelve 401', async () => {
    const r = await fetch(`${base}/api/connections`);
    assert(r.status === 401, `estado ${r.status}`);
  });
  await step('API con token falso devuelve 401', async () => {
    const r = await fetch(`${base}/api/connections`, { headers: { authorization: 'Bearer falso' } });
    assert(r.status === 401, `estado ${r.status}`);
  });
  await step('Origen no permitido devuelve 403', async () => {
    const r = await fetch(`${base}/api/health`, { headers: { origin: 'https://malicioso.example' } });
    assert(r.status === 403, `estado ${r.status}`);
  });

  await step('Pantalla de acceso e inicio de sesión', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: /Entrar/ }).click();
    await page.getByRole('button', { name: 'Consultar', exact: true }).first().waitFor();
  });

  await step('Consulta sencilla con un proveedor', async () => {
    await page.locator('#q').fill('Define entropía');
    await page.getByRole('button', { name: 'Consultar', exact: true }).last().click();
    await page.locator('.answer').first().waitFor({ timeout: 10000 });
    assert((await page.locator('.answer').first().innerText()).includes('42'), 'respuesta inesperada');
    assert((await page.locator('.result .chip.ok').count()) === 1, 'debería usar un solo modelo');
  });

  await step('Consulta compleja: contradicción, revisión y consenso', async () => {
    await page.locator('#q').fill('Analiza en profundidad el valor [contradict] [converge]');
    await page.getByRole('radio', { name: 'Profundo' }).click();
    await page.getByRole('button', { name: 'Consultar', exact: true }).last().click();
    await page.getByText('Acuerdo alto').waitFor({ timeout: 10000 });
    assert((await page.locator('.result .chip.ok').count()) === 3, 'deberían responder 3 modelos');
    await page.getByText('Detalles').click();
    assert(await page.getByText(/rondas de revisión: 1/).isVisible(), 'falta la ronda de revisión');
    await page.screenshot({ path: `${out}/consulta-escritorio.png`, fullPage: true });
  });

  await step('Proveedor caído no bloquea la respuesta', async () => {
    await page.locator('#q').fill('Analiza en profundidad [fail:mock-a:auth]');
    await page.getByRole('button', { name: 'Consultar', exact: true }).last().click();
    await page.locator('.result .chip.bad').first().waitFor({ timeout: 10000 });
    assert(await page.locator('.warnings').getByText(/credencial/).isVisible(), 'falta el aviso');
    assert((await page.locator('.answer').first().innerText()).includes('42'), 'sin respuesta final');
  });

  await step('HTML malicioso en una respuesta se sanea', async () => {
    let dialog = false;
    const onDialog = (d) => { dialog = true; d.dismiss(); };
    page.on('dialog', onDialog);
    await page.locator('#q').fill('Define x [xss]');
    await page.getByRole('radio', { name: 'Rápido' }).click();
    await page.getByRole('button', { name: 'Consultar', exact: true }).last().click();
    await page.locator('.answer strong').first().waitFor({ timeout: 10000 });
    assert((await page.locator('.answer script, .answer img, .answer [onerror]').count()) === 0, 'HTML peligroso presente');
    page.off('dialog', onDialog);
    assert(!dialog, 'se ejecutó código');
  });

  await step('El historial persiste tras recargar y muestra el detalle', async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Historial' }).click();
    const items = page.locator('.history .item');
    await items.first().waitFor();
    assert((await items.count()) === 4, `elementos: ${await items.count()}`);
    await page.getByRole('searchbox').fill('contradict');
    assert((await items.count()) === 1, 'el filtro no funciona');
    await items.first().locator('.item-main').click();
    await page.getByText('← Volver al historial').waitFor();
    assert((await page.locator('.answer').innerText()).includes('42'), 'detalle incorrecto');
  });

  await step('Eliminar del historial', async () => {
    await page.getByText('← Volver al historial').click();
    await page.getByRole('searchbox').fill('');
    page.once('dialog', (d) => d.accept());
    await page.locator('.history .item').first().getByRole('button', { name: 'Eliminar consulta' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.history .item').length === 3);
  });

  await step('Asistente de conexiones: estados, enlaces y campo protegido', async () => {
    await page.getByRole('button', { name: 'Conexiones' }).click();
    await page.getByRole('heading', { name: 'Google Gemini (AI Studio)' }).waitFor();
    assert((await page.locator('input[type=password]').count()) >= 3, 'faltan campos de clave');
    assert(await page.getByRole('link', { name: /Obtener clave/ }).first().getAttribute('rel').then((r) => r.includes('noopener')), 'enlace inseguro');
    assert(!(await page.getByText('Proveedores de pago (opcional)').locator('..').getAttribute('open')), 'los de pago deberían estar plegados');
    await page.getByLabel('Clave de Google Gemini (AI Studio)').fill('AIza-clave-que-no-se-puede-validar-aqui');
    await page.getByRole('button', { name: 'Guardar y validar' }).first().click();
    await page.locator('.conn [role=status]').first().waitFor({ timeout: 20000 });
    const text = await page.locator('.conn').first().innerText();
    assert(!text.includes('AIza-clave-que-no-se-puede-validar-aqui'), 'la clave se muestra');
    await page.screenshot({ path: `${out}/conexiones.png`, fullPage: true });
  });

  await step('Ajustes se guardan', async () => {
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByLabel('Rondas de revisión máximas').fill('3');
    await page.getByRole('button', { name: 'Guardar ajustes' }).click();
    await page.getByText('Guardado').waitFor();
    const afterSave = await page.evaluate(() => ({ stored: localStorage.getItem('oia.dev.settings'), value: document.querySelector('input[type=number]')?.value }));
    assert(afterSave.stored?.includes('"maxRounds":3'), `no se guardó ${JSON.stringify(afterSave)}`);
    await page.reload();
    await page.getByRole('button', { name: 'Ajustes' }).click();
    // Los ajustes se cargan de forma asíncrona tras iniciar sesión: se espera al valor guardado.
    const persisted = await page
      .waitForFunction(() => document.querySelector('input[type=number]')?.value === '3', null, { timeout: 5000 })
      .then(() => true, () => false);
    const diag = await page.evaluate(() => ({ stored: localStorage.getItem('oia.dev.settings'), value: document.querySelector('input[type=number]')?.value }));
    assert(persisted, `no persiste ${JSON.stringify(diag)}`);
  });

  await step('PWA: manifiesto válido e iconos', async () => {
    const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
    assert(m.display === 'standalone' && m.start_url === '/', 'manifiesto incompleto');
    for (const i of m.icons) assert((await fetch(base + i.src)).ok, `icono ${i.src}`);
    assert(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), 'faltan tamaños');
  });

  await step('PWA: service worker activo y apertura sin conexión', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload();
    await page.getByText('OIA').first().waitFor();
    await ctx.setOffline(false);
  });

  await step('Móvil: sin desplazamiento horizontal', async () => {
    const m = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
    const p = await m.newPage();
    await p.goto(base);
    await p.getByRole('button', { name: /Entrar/ }).click();
    await p.locator('#q').fill('Analiza en profundidad [contradict]');
    await p.getByRole('radio', { name: 'Profundo' }).click();
    await p.getByRole('button', { name: 'Consultar', exact: true }).last().click();
    await p.locator('.answer').first().waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await p.screenshot({ path: `${out}/consulta-movil.png`, fullPage: true });
    for (const v of ['Historial', 'Conexiones', 'Ajustes']) {
      await p.getByRole('button', { name: v }).click();
      const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(o <= 0, `${v}: desborda ${o}px`);
    }
    assert(overflow <= 0, `desborda ${overflow}px`);
    await m.close();
  });

  await step('Sin proveedores: aviso y enlace al asistente', async () => {
    const p = await (await browser.newContext()).newPage();
    await p.goto('http://127.0.0.1:8798');
    await p.getByRole('button', { name: /Entrar/ }).click();
    await p.getByText('No hay ningún proveedor conectado').waitFor();
    await p.getByRole('button', { name: 'Configura una conexión gratuita' }).click();
    await p.getByRole('heading', { name: 'Conexiones' }).waitFor();
  });

  await step('Sin errores de JavaScript en la página', async () => {
    assert(consoleErrors.length === 0, consoleErrors.join(' | '));
  });
} finally {
  await browser.close();
  s1.kill();
  s2.kill();
}

for (const [st, n] of results) console.log(`${st === 'SUPERADO' ? '✓' : '✗'} ${st}: ${n}`);
const failed = results.filter((r) => r[0] !== 'SUPERADO').length;
console.log(`\n${results.length - failed}/${results.length} pruebas de interfaz superadas`);
process.exit(failed ? 1 : 0);

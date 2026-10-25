// Despliegue guiado de OIA.
//   npm run deploy            → interfaz e historial en Firebase (plan gratuito Spark) y servidor en Cloudflare Workers (gratis, sin tarjeta)
//   npm run deploy:functions  → todo en Firebase con Cloud Functions (requiere plan Blaze con tarjeta)
// Nunca activa facturación. Pregunta antes de tocar una web o unas reglas de Firestore existentes.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const cloudflare = !process.argv.includes('--functions');
const interactive = !process.argv.includes('--yes');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const yes = async (q, def = false) => {
  if (!interactive) return def;
  return /^s/i.test((await rl.question(`${q} (s/N): `)).trim());
};
const run = (cmd, args, opts = {}) => {
  const r = spawnSync('npx', [cmd, ...args], { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`Falló: ${cmd} ${args.join(' ')}`);
};
const out = (cmd, args, input) => execFileSync('npx', [cmd, ...args], { encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });

if (!existsSync('.env') || !existsSync('firestore.rules')) fail('Ejecuta antes «npm run setup».');
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const project = env.FIREBASE_PROJECT_ID;
for (const k of ['OIA_MASTER_KEY', 'FIREBASE_PROJECT_ID', 'OWNER_EMAILS', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']) if (!env[k]) fail(`Falta ${k} en .env`);

console.log('\n1/5 Comprobaciones (tipos, lint y pruebas)…');
for (const s of ['typecheck', 'lint', 'test']) if (spawnSync('npm', ['run', s], { stdio: 'inherit' }).status !== 0) fail(`«npm run ${s}» falló; no se despliega.`);

console.log('\n2/5 Sesión de Firebase (se abrirá el navegador si hace falta)…');
try { out('firebase', ['projects:list']); } catch { run('firebase', ['login']); }

console.log('\n3/5 Firebase Hosting…');
const usesHosting = await yes(`¿El proyecto «${project}» ya publica OTRA web en Firebase Hosting?`);
const site = usesHosting ? `${project}-oia` : project;
if (usesHosting) {
  try { out('firebase', ['hosting:sites:create', site, '--project', project]); console.log(`✓ Sitio nuevo ${site}`); } catch { console.log(`Sitio ${site} ya existente o no creado; se intentará usar.`); }
}
run('firebase', ['target:apply', 'hosting', 'oia', site, '--project', project]);
const origins = [`https://${site}.web.app`, `https://${site}.firebaseapp.com`];
const sharedRules = await yes('¿Firestore de este proyecto lo usa ya otra aplicación con sus propias reglas?');
if (sharedRules) console.log('No se tocarán las reglas. Fusiona firestore.rules con las existentes (docs/despliegue.md).');

let config = 'firebase.json';
let apiBase = '';
const only = ['hosting:oia'];
if (!sharedRules) only.push('firestore:rules');

if (cloudflare) {
  console.log('\n4/5 Servidor en Cloudflare Workers…');
  try { out('wrangler', ['whoami']); } catch { run('wrangler', ['login']); }
  let toml = readFileSync('wrangler.toml', 'utf8');
  if (toml.includes('REPLACE_WITH_KV_ID')) {
    const kv = out('wrangler', ['kv', 'namespace', 'create', 'OIA_KV']);
    const id = /id\s*=\s*"([0-9a-f]{32})"/.exec(kv)?.[1] ?? /"id":\s*"([0-9a-f]{32})"/.exec(kv)?.[1];
    if (!id) fail('No se pudo crear el espacio KV:\n' + kv);
    toml = toml.replace('REPLACE_WITH_KV_ID', id);
    writeFileSync('wrangler.toml', toml);
  }
  out('wrangler', ['secret', 'put', 'OIA_MASTER_KEY'], env.OIA_MASTER_KEY);
  const vars = { FIREBASE_PROJECT_ID: project, OWNER_EMAILS: env.OWNER_EMAILS, ALLOWED_ORIGINS: origins.join(',') };
  const dep = out('wrangler', ['deploy', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])]);
  apiBase = /https:\/\/[\w.-]+\.workers\.dev/.exec(dep)?.[0] ?? '';
  if (!apiBase) fail('No se encontró la URL del Worker en la salida:\n' + dep);
  console.log('✓ API publicada en', apiBase);
  // Sin función en Firebase: configuración de Hosting sin la reescritura /api.
  const fb = JSON.parse(readFileSync('firebase.json', 'utf8'));
  fb.hosting.rewrites = fb.hosting.rewrites.filter((r) => !r.function);
  delete fb.functions;
  config = 'firebase.cloudflare.json';
  writeFileSync(config, JSON.stringify(fb, null, 2));
} else {
  console.log('\n4/5 Servidor en Cloud Functions (plan Blaze)…');
  if (!(await yes('Cloud Functions requiere que TÚ hayas activado el plan Blaze. ¿Está activo?', true))) {
    fail('Activa Blaze en la consola de Firebase (Uso y facturación) o usa «npm run deploy» (Cloudflare, gratis).');
  }
  // Variables no secretas de la función y clave maestra en Secret Manager (1 secreto: dentro de la cuota gratuita).
  writeFileSync(`functions/.env.${project}`, `OWNER_EMAILS=${env.OWNER_EMAILS}\nALLOWED_ORIGINS=${origins.join(',')}\n`);
  const tmp = join(tmpdir(), `oia-${process.pid}`);
  writeFileSync(tmp, env.OIA_MASTER_KEY, { mode: 0o600 });
  try {
    run('firebase', ['functions:secrets:set', 'OIA_MASTER_KEY', '--data-file', tmp, '--project', project, '--force']);
  } finally {
    rmSync(tmp, { force: true });
  }
  if (spawnSync('npx', ['vite', 'build', '-c', 'vite.functions.config.ts'], { stdio: 'inherit' }).status !== 0) fail('La compilación del servidor falló');
  only.push('functions:oia');
}

console.log('\n5/5 Interfaz y publicación…');
if (spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', env: { ...process.env, VITE_API_BASE: apiBase } }).status !== 0) fail('La compilación falló');
run('firebase', ['deploy', '--only', only.join(','), '--project', project, '--config', config]);
if (!cloudflare) {
  // Borra imágenes antiguas de la función para no acumular almacenamiento con coste.
  spawnSync('npx', ['firebase', 'functions:artifacts:setpolicy', '--location', 'europe-west1', '--days', '1', '--force', '--project', project], { stdio: 'inherit' });
}

console.log('\nVerificación…');
const api = apiBase || origins[0];
const [h, a] = await Promise.all([fetch(origins[0]).then((r) => r.status).catch(() => 0), fetch(`${api}/api/health`).then((r) => r.status).catch(() => 0)]);
console.log(`${h === 200 ? '✓' : '✗'} Web ${origins[0]} (${h})`);
console.log(`${a === 200 ? '✓' : '✗'} API ${api}/api/health (${a})`);
console.log(`\nPaso manual único: activa el proveedor «Google» en https://console.firebase.google.com/project/${project}/authentication/providers`);
if (usesHosting) console.log(`y añade ${site}.web.app en Authentication › Settings › Authorized domains.`);
rl.close();

function fail(msg) {
  console.error('\n✗', msg);
  process.exit(1);
}

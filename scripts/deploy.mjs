// Despliegue guiado: servidor en Cloudflare Workers (gratis) + interfaz y reglas en Firebase (plan Spark).
// No activa facturación ni servicios de pago. Pide confirmación antes de tocar recursos existentes.
// Uso: npm run deploy
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const yes = async (q) => /^s/i.test((await rl.question(`${q} (s/N): `)).trim());
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

console.log('\n2/5 Sesiones (se abrirá el navegador si hace falta)…');
try { out('firebase', ['projects:list']); } catch { run('firebase', ['login']); }
try { out('wrangler', ['whoami']); } catch { run('wrangler', ['login']); }

console.log('\n3/5 Firebase Hosting…');
const usesHosting = await yes(`¿El proyecto «${project}» ya publica otra web en Firebase Hosting?`);
const site = usesHosting ? `${project}-oia` : project;
if (usesHosting) {
  try { out('firebase', ['hosting:sites:create', site, '--project', project]); console.log(`✓ Sitio nuevo ${site}`); } catch { console.log(`Sitio ${site} ya existente o no creado; se intentará usar.`); }
}
run('firebase', ['target:apply', 'hosting', 'oia', site, '--project', project]);
const origins = [`https://${site}.web.app`, `https://${site}.firebaseapp.com`];

console.log('\n4/5 Servidor en Cloudflare Workers…');
let toml = readFileSync('wrangler.toml', 'utf8');
if (toml.includes('REPLACE_WITH_KV_ID')) {
  const kv = out('wrangler', ['kv', 'namespace', 'create', 'OIA_KV']);
  const id = /id\s*=\s*"([0-9a-f]{32})"/.exec(kv)?.[1] ?? /"id":\s*"([0-9a-f]{32})"/.exec(kv)?.[1];
  if (!id) fail('No se pudo crear el espacio KV:\n' + kv);
  toml = toml.replace('REPLACE_WITH_KV_ID', id);
  writeFileSync('wrangler.toml', toml);
  console.log('✓ KV creado:', id);
}
out('wrangler', ['secret', 'put', 'OIA_MASTER_KEY'], env.OIA_MASTER_KEY);
console.log('✓ Clave maestra guardada como secreto del Worker');
const vars = { FIREBASE_PROJECT_ID: project, OWNER_EMAILS: env.OWNER_EMAILS, ALLOWED_ORIGINS: origins.join(',') };
const dep = out('wrangler', ['deploy', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])]);
const apiBase = /https:\/\/[\w.-]+\.workers\.dev/.exec(dep)?.[0];
if (!apiBase) fail('No se encontró la URL del Worker en la salida:\n' + dep);
console.log('✓ API publicada en', apiBase);

console.log('\n5/5 Interfaz y reglas…');
if (spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', env: { ...process.env, VITE_API_BASE: apiBase } }).status !== 0) fail('La compilación falló');
const sharedRules = await yes('¿Firestore de este proyecto lo usa ya otra aplicación con sus propias reglas?');
const only = sharedRules ? 'hosting:oia' : 'hosting:oia,firestore:rules';
if (sharedRules) console.log('No se tocan las reglas. Fusiona firestore.rules con las existentes siguiendo docs/despliegue.md.');
run('firebase', ['deploy', '--only', only, '--project', project]);

console.log('\nVerificación…');
const [h, a] = await Promise.all([fetch(origins[0]).then((r) => r.status).catch(() => 0), fetch(`${apiBase}/api/health`).then((r) => r.status).catch(() => 0)]);
console.log(`${h === 200 ? '✓' : '✗'} Web ${origins[0]} (${h})`);
console.log(`${a === 200 ? '✓' : '✗'} API ${apiBase}/api/health (${a})`);
console.log(`\nPaso manual único: activa el proveedor «Google» en https://console.firebase.google.com/project/${project}/authentication/providers`);
if (usesHosting) console.log(`y añade ${site}.web.app en Authentication › Settings › Authorized domains.`);
rl.close();

function fail(msg) {
  console.error('\n✗', msg);
  process.exit(1);
}

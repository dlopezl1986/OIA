// Configuración inicial: genera .env, la clave maestra y las reglas de Firestore.
// Uso: npm run setup   (interactivo; no pide ni guarda claves de proveedores)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const env = parseEnv(existsSync('.env') ? readFileSync('.env', 'utf8') : '');
const ask = async (q, def = '') => (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim() || def;

console.log('\nConfiguración de OIA. Pulsa Intro para aceptar el valor entre corchetes.\n');

const project = await ask('ID del proyecto Firebase', env.FIREBASE_PROJECT_ID);
const emails = (await ask('Correo(s) de Google con acceso (separados por comas)', env.OWNER_EMAILS)).toLowerCase();
if (!project || !emails) fail('El ID del proyecto y al menos un correo son obligatorios.');

// La configuración web de Firebase es pública; se intenta obtener con la CLI si hay sesión iniciada.
let web = {};
try {
  const out = execFileSync('npx', ['firebase', 'apps:sdkconfig', 'web', '--project', project], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  web = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  console.log('✓ Configuración web obtenida de Firebase.');
} catch {
  console.log('No se pudo leer la configuración web automáticamente (requiere «npx firebase login» y una app web registrada).');
  console.log(`Puedes copiarla de https://console.firebase.google.com/project/${project}/settings/general`);
}
const apiKey = web.apiKey ?? (await ask('apiKey de la app web', env.VITE_FIREBASE_API_KEY));
const appId = web.appId ?? (await ask('appId de la app web', env.VITE_FIREBASE_APP_ID));
const authDomain = web.authDomain ?? `${project}.firebaseapp.com`;

Object.assign(env, {
  OIA_MASTER_KEY: env.OIA_MASTER_KEY || randomBytes(32).toString('base64'),
  FIREBASE_PROJECT_ID: project,
  OWNER_EMAILS: emails,
  ALLOWED_ORIGINS: env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:8787',
  VITE_FIREBASE_API_KEY: apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: authDomain,
  VITE_FIREBASE_PROJECT_ID: project,
  VITE_FIREBASE_APP_ID: appId,
});
writeFileSync('.env', Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
console.log('✓ .env guardado (no se sube al repositorio). La clave maestra se ha generado localmente.');

const list = emails.split(',').map((e) => `'${e.trim().replace(/'/g, '')}'`).join(', ');
writeFileSync('firestore.rules', readFileSync('firestore.rules.template', 'utf8').replace('__OWNER_EMAILS__', list));
console.log('✓ firestore.rules generado para:', emails);
console.log('\nSiguiente paso: «npm run deploy» (publica) o «npm run build && npm run serve» (solo en este ordenador).\n');
rl.close();

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2]) out[m[1]] = m[2];
  }
  return out;
}
function fail(msg) {
  console.error('✗', msg);
  process.exit(1);
}

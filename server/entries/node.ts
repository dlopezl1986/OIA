// Servidor Node para desarrollo local o para ejecutar la app en tu propio ordenador.
// Uso: node --env-file=.env --experimental-strip-types server/entries/node.ts (vía «npm run serve»).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createApp } from '../app';
import type { KeyValue } from '../store/credentials';
import { envConfig } from './config';

class FileKV implements KeyValue {
  private data: Record<string, string> | null = null;
  constructor(private file: string) {}
  private async load() {
    if (!this.data) this.data = JSON.parse(await readFile(this.file, 'utf8').catch(() => '{}'));
    return this.data!;
  }
  private async flush() {
    await mkdir(resolve(this.file, '..'), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data), { mode: 0o600 });
    await chmod(this.file, 0o600);
  }
  async get(k: string) {
    return (await this.load())[k] ?? null;
  }
  async put(k: string, v: string) {
    (await this.load())[k] = v;
    await this.flush();
  }
  async delete(k: string) {
    delete (await this.load())[k];
    await this.flush();
  }
}

const e = process.env;
const dev = e.NODE_ENV !== 'production';
const port = Number(e.PORT ?? 8787);
const host = e.HOST ?? '127.0.0.1';
const staticDir = resolve(e.OIA_STATIC_DIR ?? 'dist');
const app = createApp({ ...envConfig(e, dev), kv: new FileKV(e.OIA_DATA_FILE ?? '.data/credentials.json') });
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await app(new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  // Archivos estáticos de la interfaz compilada (SPA)
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(staticDir, rel);
  if (!file.startsWith(staticDir)) return void res.writeHead(400).end();
  let body = await readFile(file).catch(() => null);
  if (!body) body = await readFile((file = join(staticDir, 'index.html'))).catch(() => null);
  if (!body) return void res.writeHead(404).end('Compila la interfaz con «npm run build».');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
  res.end(body);
}).listen(port, host, () => console.log(`OIA en http://${host}:${port} ${dev ? '(desarrollo)' : ''}`));

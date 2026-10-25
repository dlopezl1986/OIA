// Punto de entrada para Cloudflare Workers (plan gratuito).
import { createApp } from '../app';
import type { KeyValue } from '../store/credentials';
import { envConfig } from './config';

interface WorkerEnv extends Record<string, unknown> {
  OIA_KV: KeyValue;
}

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(req: Request, env: WorkerEnv): Promise<Response> {
    app ??= createApp({ ...envConfig(env as Record<string, string | undefined>), kv: env.OIA_KV });
    return app(req);
  },
};


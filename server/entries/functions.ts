// Punto de entrada para Firebase Cloud Functions (2.ª gen., requiere el plan Blaze).
// Límites estrictos de instancias y memoria para mantener el uso personal dentro de la cuota gratuita.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from '../app';
import type { KeyValue } from '../store/credentials';
import { envConfig } from './config';

const masterKey = defineSecret('OIA_MASTER_KEY');

/** Claves cifradas en Firestore (colección sin acceso desde el cliente: las reglas la deniegan). */
class FirestoreKV implements KeyValue {
  private col = getFirestore().collection('oia_secrets');
  async get(k: string) {
    const d = await this.col.doc(k).get();
    return d.exists ? ((d.get('v') as string) ?? null) : null;
  }
  async put(k: string, v: string) {
    await this.col.doc(k).set({ v });
  }
  async delete(k: string) {
    await this.col.doc(k).delete();
  }
}

let app: ReturnType<typeof createApp> | undefined;

export const api = onRequest(
  { region: 'europe-west1', secrets: [masterKey], maxInstances: 2, memory: '256MiB', timeoutSeconds: 120, invoker: 'public' },
  async (req, res) => {
    if (!app) {
      initializeApp();
      const e = { ...process.env, OIA_MASTER_KEY: masterKey.value(), FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT };
      app = createApp({ ...envConfig(e), kv: new FirestoreKV() });
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const r = await app(
      new Request(`https://${req.get('host') ?? 'localhost'}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(req.rawBody),
      }),
    );
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await r.arrayBuffer()));
  },
);

import type { ConnectionId } from '../types';
import { decrypt, encrypt } from '../security/crypto';

/** Almacén clave-valor mínimo (Cloudflare KV, fichero local o memoria). */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryKV implements KeyValue {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    this.map.delete(k);
  }
}

export interface CredentialMeta {
  last4: string;
  allowPaid: boolean;
  savedAt: string;
  checkedAt: string | null;
  status: 'ok' | 'unverified' | 'invalid';
  detail: string;
}

interface StoredCredential extends CredentialMeta {
  v: 1;
  iv: string;
  ct: string;
}

/** Credenciales cifradas por usuario y conexión. La clave en claro nunca se devuelve al cliente. */
export class CredentialStore {
  constructor(
    private kv: KeyValue,
    private master: CryptoKey,
  ) {}

  private k(uid: string, conn: ConnectionId) {
    return `cred:${uid}:${conn}`;
  }

  async save(uid: string, conn: ConnectionId, secret: string, meta: Omit<CredentialMeta, 'last4' | 'savedAt'>): Promise<CredentialMeta> {
    const { iv, ct } = await encrypt(this.master, secret, `${uid}:${conn}`);
    const rec: StoredCredential = { v: 1, iv, ct, last4: secret.slice(-4), savedAt: new Date().toISOString(), ...meta };
    await this.kv.put(this.k(uid, conn), JSON.stringify(rec));
    return strip(rec);
  }

  async updateMeta(uid: string, conn: ConnectionId, patch: Partial<Omit<CredentialMeta, 'last4' | 'savedAt'>>): Promise<CredentialMeta | null> {
    const rec = await this.raw(uid, conn);
    if (!rec) return null;
    const next = { ...rec, ...patch };
    await this.kv.put(this.k(uid, conn), JSON.stringify(next));
    return strip(next);
  }

  async meta(uid: string, conn: ConnectionId): Promise<CredentialMeta | null> {
    const rec = await this.raw(uid, conn);
    return rec ? strip(rec) : null;
  }

  async secret(uid: string, conn: ConnectionId): Promise<string | null> {
    const rec = await this.raw(uid, conn);
    if (!rec) return null;
    try {
      return await decrypt(this.master, rec, `${uid}:${conn}`);
    } catch {
      return null; // clave maestra cambiada o dato alterado
    }
  }

  async remove(uid: string, conn: ConnectionId): Promise<void> {
    await this.kv.delete(this.k(uid, conn));
  }

  private async raw(uid: string, conn: ConnectionId): Promise<StoredCredential | null> {
    const s = await this.kv.get(this.k(uid, conn));
    if (!s) return null;
    try {
      return JSON.parse(s) as StoredCredential;
    } catch {
      return null;
    }
  }
}

function strip(rec: StoredCredential): CredentialMeta {
  const { last4, allowPaid, savedAt, checkedAt, status, detail } = rec;
  return { last4, allowPaid, savedAt, checkedAt, status, detail };
}

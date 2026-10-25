// Cifrado AES-256-GCM de secretos con una clave maestra que solo existe en el servidor.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importMasterKey(base64Key: string): Promise<CryptoKey> {
  const raw = unb64(base64Key);
  if (raw.length !== 32) throw new Error('OIA_MASTER_KEY debe ser de 32 bytes en base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey, plaintext: string, aad: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decrypt(key: CryptoKey, data: { iv: string; ct: string }, aad: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv), additionalData: enc.encode(aad) }, key, unb64(data.ct));
  return dec.decode(pt);
}

export async function sha256(text: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64(new Uint8Array(h));
}

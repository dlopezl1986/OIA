import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthConfig {
  projectId: string;
  ownerUids: string[];
  ownerEmails: string[];
  /** Solo para desarrollo local: token fijo aceptado como usuario «dev». */
  devToken?: string;
  jwks?: JWTVerifyGetKey;
}

export interface Principal {
  uid: string;
  email: string | null;
}

const FIREBASE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let defaultJwks: JWTVerifyGetKey | undefined;

/** Verifica el ID token de Firebase Authentication y exige que el usuario sea el propietario. */
export async function authenticate(req: Request, cfg: AuthConfig): Promise<Principal> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Falta el token de sesión');
  if (cfg.devToken && token === cfg.devToken) return { uid: 'dev', email: 'dev@localhost' };
  if (!cfg.projectId) throw new HttpError(401, 'Sesión no válida (servidor sin FIREBASE_PROJECT_ID)');

  let payload;
  try {
    ({ payload } = await jwtVerify(token, cfg.jwks ?? (defaultJwks ??= createRemoteJWKSet(new URL(FIREBASE_JWKS))), {
      issuer: `https://securetoken.google.com/${cfg.projectId}`,
      audience: cfg.projectId,
      algorithms: ['RS256'],
    }));
  } catch {
    throw new HttpError(401, 'Sesión no válida o caducada');
  }
  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' && payload.email_verified === true ? payload.email.toLowerCase() : null;
  if (!uid) throw new HttpError(401, 'Sesión no válida');
  const allowed = cfg.ownerUids.includes(uid) || (email !== null && cfg.ownerEmails.includes(email));
  if (!allowed) throw new HttpError(403, 'Usuario no autorizado');
  return { uid, email };
}

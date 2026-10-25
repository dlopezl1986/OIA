// Sesión y persistencia. Con Firebase configurado usa Auth + Firestore; si no, modo local de desarrollo.
import type { FirebaseApp } from 'firebase/app';

export interface User {
  uid: string;
  email: string | null;
  name: string | null;
}

export interface Settings {
  maxRounds: number;
  maxParticipants: number;
  maxCalls: number;
  timeoutMs: number;
  disabled: string[];
  models: Record<string, string>;
  arbiter?: string;
}

export const DEFAULT_SETTINGS: Settings = { maxRounds: 1, maxParticipants: 3, maxCalls: 8, timeoutMs: 45_000, disabled: [], models: {} };

export interface HistoryItem {
  id: string;
  createdAt: number;
  query: string;
  mode: string;
  final: string;
  strategy: string;
  agreement: string | null;
  confidence: string | null;
  discrepancies: { topic: string; detail: string }[];
  warnings: string[];
  participants: { label: string; model: string; status: string; round: number }[];
  usage: Record<string, { inputTokens: number | null; outputTokens: number | null; calls: number }>;
  calls: number;
  ms: number;
  type: string;
  complexity: number;
}

export interface Platform {
  mode: 'firebase' | 'local';
  onUser(cb: (u: User | null) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  token(): Promise<string>;
  history: {
    list(max: number): Promise<HistoryItem[]>;
    add(item: Omit<HistoryItem, 'id' | 'createdAt'>): Promise<HistoryItem>;
    remove(id: string): Promise<void>;
  };
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
}

const env = import.meta.env;

export async function createPlatform(): Promise<Platform> {
  if (env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_API_KEY) return firebasePlatform();
  if (env.VITE_DEV_TOKEN) return localPlatform(env.VITE_DEV_TOKEN);
  throw new Error('Configuración incompleta: define VITE_FIREBASE_* (producción) o VITE_DEV_TOKEN (desarrollo). Consulta docs/despliegue.md.');
}

async function firebasePlatform(): Promise<Platform> {
  const [{ initializeApp }, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore/lite')]);
  const app: FirebaseApp = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const a = auth.getAuth(app);
  await auth.setPersistence(a, auth.browserLocalPersistence);
  const db = fs.getFirestore(app);
  const uid = () => {
    const u = a.currentUser;
    if (!u) throw new Error('Sesión no iniciada');
    return u.uid;
  };
  const col = () => fs.collection(db, 'oia_users', uid(), 'queries');
  const settingsDoc = () => fs.doc(db, 'oia_users', uid(), 'meta', 'settings');
  return {
    mode: 'firebase',
    onUser: (cb) => auth.onAuthStateChanged(a, (u) => cb(u ? { uid: u.uid, email: u.email, name: u.displayName } : null)),
    async signIn() {
      const provider = new auth.GoogleAuthProvider();
      try {
        await auth.signInWithPopup(a, provider);
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await auth.signInWithRedirect(a, provider);
        else throw e;
      }
    },
    signOut: () => auth.signOut(a),
    token: async () => {
      const u = a.currentUser;
      if (!u) throw new Error('Sesión no iniciada');
      return u.getIdToken();
    },
    history: {
      async list(max) {
        const snap = await fs.getDocs(fs.query(col(), fs.orderBy('createdAt', 'desc'), fs.limit(max)));
        return snap.docs.map((d) => {
          const data = d.data();
          return { ...(data as HistoryItem), id: d.id, createdAt: (data.createdAt as { toMillis?: () => number })?.toMillis?.() ?? Date.now() };
        });
      },
      async add(item) {
        const ref = await fs.addDoc(col(), { ...item, createdAt: fs.serverTimestamp() });
        return { ...item, id: ref.id, createdAt: Date.now() };
      },
      remove: (id) => fs.deleteDoc(fs.doc(col(), id)),
    },
    async loadSettings() {
      const s = await fs.getDoc(settingsDoc());
      return { ...DEFAULT_SETTINGS, ...(s.exists() ? (s.data() as Partial<Settings>) : {}) };
    },
    saveSettings: (s) => fs.setDoc(settingsDoc(), JSON.parse(JSON.stringify(s))),
  };
}

/** Modo de desarrollo local: sin Firebase, historial en este navegador. Nunca se usa en producción. */
function localPlatform(devToken: string): Platform {
  const KEY = 'oia.dev.history';
  const read = (): HistoryItem[] => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      return [];
    }
  };
  const write = (items: HistoryItem[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
    } catch {
      /* almacenamiento no disponible */
    }
  };
  let user: User | null = sessionFlag() ? { uid: 'dev', email: 'dev@localhost', name: 'Desarrollo' } : null;
  const listeners = new Set<(u: User | null) => void>();
  const emit = () => listeners.forEach((l) => l(user));
  return {
    mode: 'local',
    onUser(cb) {
      listeners.add(cb);
      cb(user);
      return () => listeners.delete(cb);
    },
    async signIn() {
      user = { uid: 'dev', email: 'dev@localhost', name: 'Desarrollo' };
      sessionFlag(true);
      emit();
    },
    async signOut() {
      user = null;
      sessionFlag(false);
      emit();
    },
    token: async () => devToken,
    history: {
      list: async (max) => read().slice(0, max),
      async add(item) {
        const rec = { ...item, id: crypto.randomUUID(), createdAt: Date.now() };
        write([rec, ...read()]);
        return rec;
      },
      remove: async (id) => write(read().filter((h) => h.id !== id)),
    },
    loadSettings: async () => {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('oia.dev.settings') ?? '{}') };
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    saveSettings: async (s) => {
      try {
        localStorage.setItem('oia.dev.settings', JSON.stringify(s));
      } catch {
        /* sin almacenamiento */
      }
    },
  };
}

function sessionFlag(set?: boolean): boolean {
  try {
    if (set !== undefined) sessionStorage.setItem('oia.dev.session', set ? '1' : '');
    return sessionStorage.getItem('oia.dev.session') === '1';
  } catch {
    return false;
  }
}

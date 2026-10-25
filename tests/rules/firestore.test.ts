// Pruebas reales de las reglas de Firestore contra el emulador oficial de Firebase.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const OWNER = 'ruka@example.com';
let env: RulesTestEnvironment;

beforeAll(async () => {
  const rules = readFileSync('firestore.rules.template', 'utf8').replace('__OWNER_EMAILS__', `'${OWNER}'`);
  env = await initializeTestEnvironment({ projectId: 'demo-oia', firestore: { rules, host: '127.0.0.1', port: 8080 } });
});
afterAll(() => env?.cleanup());
beforeEach(() => env.clearFirestore());

const owner = () => env.authenticatedContext('u1', { email: OWNER, email_verified: true }).firestore();
const item = (over: Record<string, unknown> = {}) => ({ query: 'hola', mode: 'auto', final: 'respuesta', strategy: 'single', createdAt: serverTimestamp(), ...over });

describe('reglas de Firestore', () => {
  it('el propietario crea, lee y borra su historial', async () => {
    const db = owner();
    const ref = await assertSucceeds(addDoc(collection(db, 'oia_users/u1/queries'), item()));
    await assertSucceeds(getDocs(collection(db, 'oia_users/u1/queries')));
    await assertSucceeds(deleteDoc(ref));
  });

  it('el historial no se puede modificar después de guardarse', async () => {
    const ref = await addDoc(collection(owner(), 'oia_users/u1/queries'), item());
    await assertFails(updateDoc(ref, { final: 'alterada' }));
  });

  it('rechaza documentos con campos no permitidos o datos inválidos', async () => {
    const col = collection(owner(), 'oia_users/u1/queries');
    await assertFails(addDoc(col, item({ extra: 1 })));
    await assertFails(addDoc(col, item({ query: '' })));
    await assertFails(addDoc(col, item({ mode: 'otro' })));
    await assertFails(addDoc(col, item({ createdAt: new Date(0) })));
  });

  it('sin sesión no hay acceso', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'oia_users/u1/queries')));
    await assertFails(addDoc(collection(db, 'oia_users/u1/queries'), item()));
  });

  it('otra cuenta no puede leer el historial ajeno ni el suyo propio', async () => {
    const other = env.authenticatedContext('u2', { email: 'otro@example.com', email_verified: true }).firestore();
    await assertFails(getDocs(collection(other, 'oia_users/u1/queries')));
    await assertFails(addDoc(collection(other, 'oia_users/u2/queries'), item()));
  });

  it('el propietario no puede escribir en la ruta de otro uid', async () => {
    await assertFails(addDoc(collection(owner(), 'oia_users/u2/queries'), item()));
  });

  it('exige correo verificado', async () => {
    const db = env.authenticatedContext('u1', { email: OWNER, email_verified: false }).firestore();
    await assertFails(getDocs(collection(db, 'oia_users/u1/queries')));
  });

  it('ajustes: solo el propietario', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'oia_users/u1/meta/settings'), { maxRounds: 1 }));
    await assertSucceeds(getDoc(doc(owner(), 'oia_users/u1/meta/settings')));
    const other = env.authenticatedContext('u2', { email: 'otro@example.com', email_verified: true }).firestore();
    await assertFails(getDoc(doc(other, 'oia_users/u1/meta/settings')));
  });

  it('cualquier otra ruta está denegada', async () => {
    await assertFails(setDoc(doc(owner(), 'publico/x'), { a: 1 }));
    await assertFails(getDoc(doc(owner(), 'oia_users/u1')));
  });
});

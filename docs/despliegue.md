# Despliegue, recuperación y mantenimiento

## Requisitos

- Node.js 22 o superior y Git.
- Proyecto de Firebase en plan **Spark** (gratuito) con una app web registrada y Firestore creado (Firestore › Crear base de datos, modo producción).
- Cuenta gratuita de Cloudflare (sin tarjeta) para el servidor.

## Publicar (una vez)

```bash
npm ci
npm run setup    # pide ID del proyecto y tu correo; genera .env, clave maestra y reglas
npm run deploy   # inicia sesión en Firebase y Cloudflare (navegador), publica API, web y reglas
```

`deploy` pregunta antes de tocar recursos existentes:

- Si ya publicas otra web en Firebase Hosting, crea un sitio aparte (`<proyecto>-oia`) en lugar de sobrescribirla.
- Si Firestore ya lo usa otra app, no despliega reglas: fusiona a mano el bloque `match /oia_users/...` de `firestore.rules` dentro de tus reglas actuales (los datos de OIA viven solo en `oia_users`).

Paso manual único: Firebase Console › Authentication › Sign-in method › activar **Google**. Si se creó un sitio aparte, añádelo en Authentication › Settings › Authorized domains.

Después, abre la web, inicia sesión y ve a **Conexiones** para pegar tus claves (Gemini y GitHub Models son gratis).

## Alternativas de servidor

- **Solo en tu ordenador**: `npm run setup`, añade `http://127.0.0.1:8787` a `ALLOWED_ORIGINS`, luego `npm run build && npm run serve` y abre `http://127.0.0.1:8787`. Las claves se guardan cifradas en `.data/credentials.json`.
- **Firebase Cloud Functions**: requiere plan Blaze (tarjeta). El servidor es portable (`createApp` usa Request/Response estándar); haría falta un punto de entrada para Functions y un almacén de claves en Firestore. No se ha hecho para no activar facturación.

## Desarrollo

```bash
cp .env.example .env    # pon OIA_MASTER_KEY, OIA_DEV_TOKEN=algo, VITE_DEV_TOKEN=algo, OIA_ENABLE_MOCK=1
npm run dev:server      # API en 127.0.0.1:8787
npm run dev             # interfaz en localhost:5173 (modo local sin Firebase)
npm run check           # tipos, lint, pruebas unitarias y compilación
npm run test:rules      # reglas de Firestore en el emulador (requiere Java 21)
npm run test:e2e        # interfaz completa en Chromium con proveedor simulado
```

Los marcadores `[contradict]`, `[converge]`, `[fail:mock-a:quota]`, `[slow:mock-b]`, `[arbiter-fail]` en una consulta controlan el proveedor simulado.

## Recuperación ante errores

| Síntoma | Causa probable | Solución |
|---|---|---|
| «Usuario no autorizado» | Correo distinto al de `OWNER_EMAILS` | Repite `npm run setup` con el correo correcto y `npm run deploy` |
| «Sesión no válida» | Token caducado o `FIREBASE_PROJECT_ID` incorrecto | Sal y vuelve a entrar; revisa la variable del Worker |
| Conexión «En pausa» | Cuota agotada o clave rechazada | Espera o pulsa «Comprobar de nuevo» / guarda otra clave |
| «Clave no válida» al guardar | El proveedor la rechazó | Genera otra en el enlace «Obtener clave» |
| Modelo no encontrado | El proveedor lo renombró | Ajustes › Modelos: escribe el nombre nuevo |
| Todas las claves dejan de funcionar | Cambió `OIA_MASTER_KEY` | Restaura la clave anterior o vuelve a guardar las claves |
| El historial no carga | Reglas de Firestore no desplegadas | `npx firebase deploy --only firestore:rules` |
| «Origen no permitido» | `ALLOWED_ORIGINS` sin tu dominio | Vuelve a ejecutar `npm run deploy` |

## Mantenimiento

- Cada 2-3 meses: revisa `docs/viabilidad.md` (cuotas y modelos cambian) y actualiza nombres de modelo en `server/providers/registry.ts` o desde Ajustes.
- `npm outdated` y `npm audit --omit=dev` (la CI falla con vulnerabilidades críticas).
- Guarda `OIA_MASTER_KEY` en un gestor de contraseñas: sin ella las claves guardadas no se pueden descifrar.
- Para rotar una clave de proveedor, pégala de nuevo en Conexiones; para revocar el acceso, bórrala allí y en el portal del proveedor.

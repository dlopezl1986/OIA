# Despliegue, recuperación y mantenimiento

## Requisitos

- Node.js 22 o superior y Git.
- Proyecto de Firebase con una app web registrada y Firestore creado (Firestore › Crear base de datos, modo producción).
- Opción por defecto (0 €, sin tarjeta): Firebase en plan gratuito **Spark** (web, inicio de sesión e historial) + cuenta gratuita de **Cloudflare** para el servidor que guarda las claves y llama a las IA.
- Opción alternativa (`npm run deploy:functions`): todo en Firebase con Cloud Functions; exige que actives el plan Blaze con tarjeta.

## Publicar (una vez)

```bash
npm ci
npm run setup    # pide ID del proyecto y tu correo; genera .env, clave maestra y reglas
npm run deploy   # inicia sesión en Firebase y Cloudflare (navegador), publica servidor, web y reglas
```

Límites del plan gratuito de Cloudflare Workers, holgados para uso personal: 100.000 peticiones/día, 10 ms de CPU por petición (la espera a las IA no cuenta), 50 llamadas salientes por petición (OIA usa como máximo 16) y 1.000 escrituras/día en KV (solo se escribe al guardar claves). Los límites de frecuencia, la caché y las pausas por cuota se guardan en memoria de cada instancia, así que son aproximados.

Con `npm run deploy:functions` (Blaze), la función `api` corre en `europe-west1` con máximo 2 instancias y 256 MiB; la web llama a `/api` en su mismo dominio. La clave maestra va a Secret Manager (1 secreto, dentro de la cuota gratuita) y las claves cifradas de los proveedores a la colección `oia_secrets`, que las reglas cierran al navegador. El script configura el borrado automático de imágenes antiguas de la función para no acumular almacenamiento.

`deploy` pregunta antes de tocar recursos existentes:

- Si ya publicas otra web en Firebase Hosting, crea un sitio aparte (`<proyecto>-oia`) en lugar de sobrescribirla.
- Si Firestore ya lo usa otra app, no despliega reglas: fusiona a mano el bloque `match /oia_users/...` de `firestore.rules` dentro de tus reglas actuales (los datos de OIA viven en `oia_users`; comprueba también que ninguna regla existente permita leer `oia_secrets`).

Paso manual único: Firebase Console › Authentication › Sign-in method › activar **Google**. Si se creó un sitio aparte, añádelo en Authentication › Settings › Authorized domains.

Después, abre la web, inicia sesión y ve a **Conexiones** para pegar tus claves (Gemini, Groq y OpenRouter son gratis).

## Alternativas de servidor

- **Solo en tu ordenador**: `npm run setup`, añade `http://127.0.0.1:8787` a `ALLOWED_ORIGINS`, luego `npm run build && npm run serve` y abre `http://127.0.0.1:8787`. Las claves se guardan cifradas en `.data/credentials.json`.
- **Firebase Cloud Functions** (`npm run deploy:functions`): todo en un único dominio, pero requiere Blaze.

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
| «Billing account not configured» al desplegar | Blaze no está activo | Usa `npm run deploy` (Cloudflare) o activa Blaze |
| El historial no carga | Reglas de Firestore no desplegadas | `npx firebase deploy --only firestore:rules` |
| «Origen no permitido» | `ALLOWED_ORIGINS` sin tu dominio | Vuelve a ejecutar `npm run deploy` |

## Mantenimiento

- Cada 2-3 meses: revisa `docs/viabilidad.md` (cuotas y modelos cambian) y actualiza nombres de modelo en `server/providers/registry.ts` o desde Ajustes.
- `npm outdated` y `npm audit --omit=dev` (la CI falla con vulnerabilidades críticas).
- Guarda `OIA_MASTER_KEY` en un gestor de contraseñas: sin ella las claves guardadas no se pueden descifrar.
- Para rotar una clave de proveedor, pégala de nuevo en Conexiones; para revocar el acceso, bórrala allí y en el portal del proveedor.

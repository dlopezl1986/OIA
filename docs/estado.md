# Estado del proyecto

Registro breve para retomar el trabajo sin releer todo.

## 2026-10-25 · v0.1.0

Hecho: núcleo de orquestación y consenso, 6 conexiones (7 participantes), servidor portable (Workers/Node), cifrado de claves, interfaz PWA con historial, asistente de conexiones y ajustes, reglas de Firestore, scripts de setup y despliegue, CI.

Pruebas: 52 unitarias, 9 de reglas (emulador), 17 de interfaz (Chromium) superadas. Worker probado en local con `wrangler dev`.

Decisiones:
- Servidor por defecto en Cloudflare Workers (Ruka prefiere el plan gratuito de Firebase, sin Blaze). Cloud Functions queda como alternativa con `npm run deploy:functions`.
- GitHub Models como vía gratuita oficial para modelos de OpenAI y DeepSeek.
- Historial escrito por el cliente en Firestore (`oia_users/{uid}`) con reglas de propietario; el servidor no guarda contenido.
- Clasificación heurística local (0 tokens) en lugar de una IA clasificadora.

Pendiente (externo):
- Repositorio en GitHub, proyecto Firebase y claves de proveedores de Ruka.
- Pruebas reales contra proveedores (la red del entorno de desarrollo bloquea sus API).
- Despliegue real (`npm run deploy`, requiere iniciar sesión en Firebase y Cloudflare).

## 2026-10-25 · v0.2.0

Añadido punto de entrada para Cloud Functions (reescritura `/api` en Hosting, claves en `oia_secrets`, secreto en Secret Manager) y despliegue por defecto a Firebase. Probado en el emulador de Functions: health 200, token falso 401, origen ajeno 403. La reescritura Hosting → función no se pudo probar en el emulador por el proxy del entorno.

## 2026-10-25 · v0.2.1

Ruka decide quedarse en Firebase Spark. `npm run deploy` vuelve a publicar el servidor en Cloudflare Workers; `npm run deploy:functions` conserva la opción Blaze. CI en verde; corregido un fallo de Ajustes que perdía el último valor escrito.

## 2026-10-26 · v0.3.0

Publicado: web https://oia-dlopez.web.app (Firebase oia-dlopez, Spark) y API https://oia-api.dlopez-oia.workers.dev (Cloudflare, gratis). Verificado: health 200, sin sesión 401, CORS correcto.

Primera prueba real: GitHub Models responde «OK» a todo porque se retiró el 2026-07-30. Se sustituye por Groq (`openai/gpt-oss-120b`) y OpenRouter (solo modelos `:free`, bloqueo en el adaptador). DeepSeek se queda sin vía gratuita. Se añade User-Agent a todas las peticiones y el servidor registra el motivo de cada fallo (`wrangler tail`).

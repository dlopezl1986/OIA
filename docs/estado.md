# Estado del proyecto

Registro breve para retomar el trabajo sin releer todo.

## 2026-10-25 · v0.1.0

Hecho: núcleo de orquestación y consenso, 6 conexiones (7 participantes), servidor portable (Workers/Node), cifrado de claves, interfaz PWA con historial, asistente de conexiones y ajustes, reglas de Firestore, scripts de setup y despliegue, CI.

Pruebas: 52 unitarias, 9 de reglas (emulador), 17 de interfaz (Chromium) superadas. Worker probado en local con `wrangler dev`.

Decisiones:
- Servidor en Cloudflare Workers gratis porque Cloud Functions exige Blaze (tarjeta).
- GitHub Models como vía gratuita oficial para modelos de OpenAI y DeepSeek.
- Historial escrito por el cliente en Firestore (`oia_users/{uid}`) con reglas de propietario; el servidor no guarda contenido.
- Clasificación heurística local (0 tokens) en lugar de una IA clasificadora.

Pendiente (externo):
- Repositorio en GitHub, proyecto Firebase y claves de proveedores de Ruka.
- Pruebas reales contra proveedores (la red del entorno de desarrollo bloquea sus API).
- Despliegue real (`npm run deploy`, requiere iniciar sesión en Firebase y Cloudflare).

# Arquitectura técnica

```
Navegador (PWA, Preact)                          Servidor (Cloud Functions, Worker o Node)      Proveedores
┌────────────────────────┐   ID token Firebase  ┌──────────────────────────────────┐  HTTPS  ┌──────────────┐
│ Consulta · Historial   │ ───────────────────▶ │ app.ts: auth, CORS, límites      │ ──────▶ │ Gemini       │
│ Conexiones · Ajustes   │ ◀─────────────────── │ orchestrator/: clasifica, elige, │         │ Groq, OpenRtr│
└──────────┬─────────────┘   resultado JSON     │   consulta, árbitro, revisión    │         │ Perplexity…  │
           │ reglas: solo el propietario        │ providers/: un adaptador por API │         └──────────────┘
           ▼                                    │ store/: claves cifradas          │
     Firestore (historial, ajustes)             └──────────────────────────────────┘
```

## Módulos

| Ruta | Responsabilidad |
|---|---|
| `server/types.ts` | Interfaces comunes: adaptador, resultado, ajustes, errores normalizados |
| `server/providers/` | Adaptadores: `openaiCompat` (OpenAI, DeepSeek, Perplexity, Groq, OpenRouter), `anthropic`, `gemini`, `mock` (simulado). `registry.ts` define conexiones y participantes |
| `server/orchestrator/classify.ts` | Clasificación local por heurística (tipo, complejidad, necesidad de web). Sin coste de tokens |
| `server/orchestrator/select.ts` | Selección por aptitud, coste (gratuitos primero) y diversidad de familia |
| `server/orchestrator/run.ts` | Flujo completo: respuestas independientes, sustitución de caídos, árbitro, revisión, respaldo |
| `server/orchestrator/prompts.ts` | Prompts compactos, límites de salida por tipo, delimitación anti-inyección |
| `server/security/` | Verificación de tokens de Firebase (`jose`), cifrado AES-256-GCM, limitador |
| `server/store/credentials.ts` | Claves cifradas por usuario y conexión sobre un almacén clave-valor |
| `server/app.ts` | API HTTP independiente de la plataforma (Request/Response estándar) |
| `server/entries/` | `functions.ts` (Firebase Cloud Functions, claves en Firestore `oia_secrets`), `worker.ts` (Cloudflare, claves en KV), `node.ts` (local, archivo cifrado), `config.ts` (variables de entorno) |
| `web/src/` | Interfaz: `app.tsx`, `platform.ts` (Firebase o modo local), `api.ts`, `markdown.ts` (saneado) |

Añadir un proveedor: crear su adaptador (o reutilizar `openaiCompatible`), declarar la conexión y sus participantes en `registry.ts`. El núcleo no cambia.

## Flujo de una consulta

1. Clasificación local (`simple`, `general`, `code`, `research`, `reasoning`; complejidad 1-3).
2. Número de modelos: Rápido = 1; Automático = según complejidad; Profundo = máximo configurado. Siempre se reserva una llamada para el árbitro.
3. Llamadas en paralelo con tiempo límite, un reintento solo para errores transitorios y sustitución de los caídos por otros disponibles.
4. Con una sola respuesta válida se entrega directamente (sin árbitro).
5. Con dos o más, el árbitro (otra IA, preferiblemente gratuita y que no haya fallado) recibe las respuestas anonimizadas (A, B, C), recortadas a 5.000 caracteres y marcadas como datos no confiables. Devuelve JSON con respuesta final, acuerdo, confianza y discrepancias.
6. Si hay contradicciones relevantes y quedan rondas y llamadas, cada modelo recibe solo los puntos en disputa (no las respuestas completas de los demás). El árbitro reevalúa. Se para al alcanzar acuerdo alto, al agotar rondas o presupuesto.
7. Si el árbitro falla dos veces, se muestra la respuesta del mejor participante con un aviso.

## Seguridad

- Las claves de proveedores solo existen en el servidor: cifradas con AES-256-GCM (clave maestra en Secret Manager o en secreto del Worker) y ligadas a usuario y conexión. Nunca se devuelven ni se registran; los errores de proveedores se redactan.
- Acceso: ID token de Firebase verificado (firma, emisor, audiencia, caducidad) + lista de correos verificados o UIDs permitidos. Firestore aplica la misma restricción en sus reglas.
- CORS limitado a los orígenes de la app; límite de 8 consultas/min y 2 simultáneas por usuario; cuerpo máximo 32 KB; consulta máxima 8.000 caracteres; ajustes saneados en el servidor.
- Proveedores de pago o con crédito: bloqueados salvo autorización expresa guardada en el servidor.
- Respuestas de modelos tratadas como no confiables: Markdown saneado con DOMPurify, sin imágenes ni scripts; delimitadores neutralizados antes del árbitro; OIA nunca ejecuta código ni acciones propuestas por un modelo.
- Cabeceras de seguridad en Hosting (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy).

## Coste y tokens en producción

- Gratuitos primero; un solo modelo para consultas sencillas; árbitro solo con 2+ respuestas; revisión solo con contradicciones.
- Sin historial de conversación enviado a los proveedores; cada consulta es independiente.
- Límites de salida por tipo de tarea (500-1.800 tokens; revisión 400).
- Consultas idénticas en curso comparten ejecución; resultados reutilizables 10 minutos salvo consultas de actualidad (opción «Repetir sin reutilizar»).
- Pausa automática de 30 min para conexiones con cuota agotada (15 min si la credencial falla).
- Tokens de entrada y salida registrados por proveedor cuando la API los facilita; si no, se muestran como «¿?».

## Integraciones futuras (diseño, no implementado)

La API ya es REST y autenticada; para exponerla a otros programas basta con añadir **claves de integración propias**:

1. `POST /api/integrations` (solo el propietario) crea una clave `oia_…`; se guarda solo su hash SHA-256 en KV con nombre, permisos (`query`) y límite por minuto/día.
2. `authenticate()` acepta `Authorization: Bearer oia_…` además del token de Firebase, aplica el límite de esa integración y registra cada solicitud (fecha, integración, llamadas, sin contenido).
3. Webhooks de finalización: campo opcional `callbackUrl` en la consulta; el servidor firma el cuerpo con HMAC y lo envía al terminar (dominios permitidos en una lista).
4. Power Automate y Make se conectan con su acción HTTP genérica a `POST /api/query` con esa clave. MCP: un servidor MCP mínimo con una herramienta `consultar_oia` que llama a la misma API.
5. Cualquier acción externa propuesta por la IA seguiría requiriendo tu aprobación explícita; las integraciones solo reciben texto.

Nunca se expone un endpoint sin autenticación ni límites, y las claves de los proveedores no salen del servidor.

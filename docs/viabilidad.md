# Matriz de viabilidad por proveedor

Revisada el 2026-10-25 y corregida el 2026-10-26: GitHub Models se retiró el 30 de julio de 2026 ([aviso](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)), aunque su documentación seguía publicada. Los precios y cuotas cambian: vuelve a comprobarlos cada pocos meses.

Ninguna suscripción de consumidor (Claude Pro/Max, ChatGPT Plus/Pro, Gemini en la app) da acceso por API. Usarla desde otra aplicación exigiría automatizar la interfaz web o extraer sesiones, lo que viola sus condiciones, así que OIA no lo hace.

| Proveedor | Acceso oficial usado | Coste para ti | Restricciones | Estado en OIA | Pruebas |
|---|---|---|---|---|---|
| Google Gemini | API de Gemini con clave de AI Studio | 0 € (cuota gratuita) | Cuota diaria por proyecto (Google no publica cifras fijas). En el nivel gratuito Google puede usar los datos para mejorar sus productos. La búsqueda web (grounding) no es gratuita en los modelos Flash | Adaptador listo (`gemini-3.8-flash`) | Simuladas ✔, real pendiente de tu clave |
| OpenAI (gpt-oss, modelo abierto) | API de Groq | 0 € (cuota gratuita, sin tarjeta) | ~30 peticiones/min, ~1.000/día. No es ChatGPT: los modelos GPT de pago no tienen vía gratuita | Adaptador listo (`openai/gpt-oss-120b`) | Simuladas ✔, real pendiente |
| Modelos gratuitos variados | API de OpenRouter, solo modelos `:free` | 0 € (sin tarjeta) | ~20/min, ~50/día. A 2026-10-26 no hay DeepSeek ni OpenAI gratis; se usa `nvidia/nemotron-3-ultra-550b-a55b:free` | Adaptador listo; OIA bloquea cualquier modelo sin `:free` | Simuladas ✔, real pendiente |
| GitHub Models | — | — | **Retirado el 2026-07-30** | Eliminado | — |
| Perplexity | API Sonar | 0 € mientras no superes los 5 $/mes de crédito incluido en Pro | Hay que desactivar la recarga automática para no pagar. Es el único proveedor con búsqueda web incluida | Adaptador listo (`sonar`). Necesita tu autorización expresa en la app | Simuladas ✔, real pendiente |
| DeepSeek (API directa) | API oficial | De pago (prepago, sin cuota gratuita) | Requiere saldo | Adaptador listo. Bloqueado salvo que lo autorices | Simuladas ✔ |
| OpenAI (API directa) | API de desarrollador | De pago | ChatGPT Plus no la incluye | Adaptador listo. Bloqueado salvo que lo autorices | Simuladas ✔ |
| Anthropic Claude | API de Anthropic | De pago | Claude Pro/Max no la incluye. No hay acceso gratuito oficial | Adaptador listo. Bloqueado salvo que lo autorices | Simuladas ✔ |

## Configuración inicial a 0 €

1. Gemini (AI Studio): modelo general rápido y árbitro por defecto.
2. Groq (gpt-oss) y OpenRouter (modelos gratuitos) como segunda y tercera opinión.

DeepSeek ya no tiene vía gratuita: solo su API de pago o un modelo `:free` en OpenRouter si vuelve a aparecer (Ajustes › Modelos).
3. Perplexity (opcional): solo cuando la consulta necesita información actual, con el crédito de Pro.

Claude, OpenAI directo y DeepSeek directo quedan desactivados mientras no marques «Autorizo llamadas con coste».

## Firebase

- Hosting, Authentication (Google) y Firestore: incluidos en el plan gratuito Spark.
- Servidor (elección final de Ruka: plan gratuito): Cloudflare Workers, 100.000 peticiones/día gratis y sin tarjeta.
- Alternativa: Cloud Functions, que exige el plan Blaze con tarjeta (cuota gratuita mensual, pero facturación activa). Preparada con `npm run deploy:functions` por si algún día se prefiere.

## Fuentes

- [Precios y cuota gratuita de Gemini](https://ai.google.dev/pricing)
- [Retirada de GitHub Models](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)
- [Límites de Groq](https://console.groq.com/docs/rate-limits)
- [Modelos gratuitos de OpenRouter](https://openrouter.ai/api/v1/models)
- [Crédito de API de Perplexity Pro](https://hub-prod.perplexity.ai/hub/faq/pplx-api)
- [Precios de DeepSeek](https://api-docs.deepseek.com) (precios consultados en [morphllm.com/deepseek-api](https://www.morphllm.com/deepseek-api))

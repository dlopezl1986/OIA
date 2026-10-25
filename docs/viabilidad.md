# Matriz de viabilidad por proveedor

Revisada el 2026-10-25 con documentación oficial. Los precios y cuotas cambian: vuelve a comprobarlos cada pocos meses.

Ninguna suscripción de consumidor (Claude Pro/Max, ChatGPT Plus/Pro, Gemini en la app) da acceso por API. Usarla desde otra aplicación exigiría automatizar la interfaz web o extraer sesiones, lo que viola sus condiciones, así que OIA no lo hace.

| Proveedor | Acceso oficial usado | Coste para ti | Restricciones | Estado en OIA | Pruebas |
|---|---|---|---|---|---|
| Google Gemini | API de Gemini con clave de AI Studio | 0 € (cuota gratuita) | Cuota diaria por proyecto (Google no publica cifras fijas). En el nivel gratuito Google puede usar los datos para mejorar sus productos. La búsqueda web (grounding) no es gratuita en los modelos Flash | Adaptador listo (`gemini-3.8-flash`) | Simuladas ✔, real pendiente de tu clave |
| OpenAI (familia GPT) | GitHub Models con token personal (`models:read`) | 0 € (cuota gratuita) | ~15 peticiones/min, ~150/día en modelos básicos, 8k tokens de entrada y 4k de salida por petición. Algunos modelos (GPT-5, o3…) no están en el nivel gratuito | Adaptador listo (`openai/gpt-4.1-mini`) | Simuladas ✔, real pendiente |
| DeepSeek | GitHub Models (mismo token) | 0 € (cuota gratuita) | DeepSeek-R1: 8 peticiones/día. V3: límites del nivel básico | Adaptador listo (`deepseek/deepseek-v3-0324`) | Simuladas ✔, real pendiente |
| Perplexity | API Sonar | 0 € mientras no superes los 5 $/mes de crédito incluido en Pro | Hay que desactivar la recarga automática para no pagar. Es el único proveedor con búsqueda web incluida | Adaptador listo (`sonar`). Necesita tu autorización expresa en la app | Simuladas ✔, real pendiente |
| DeepSeek (API directa) | API oficial | De pago (prepago, sin cuota gratuita) | Requiere saldo | Adaptador listo. Bloqueado salvo que lo autorices | Simuladas ✔ |
| OpenAI (API directa) | API de desarrollador | De pago | ChatGPT Plus no la incluye | Adaptador listo. Bloqueado salvo que lo autorices | Simuladas ✔ |
| Anthropic Claude | API de Anthropic | De pago | Claude Pro/Max no la incluye. No hay acceso gratuito oficial | Adaptador listo. Bloqueado salvo que lo autorices | Simuladas ✔ |

## Configuración inicial a 0 €

1. Gemini (AI Studio): modelo general rápido y árbitro por defecto.
2. GitHub Models: GPT y DeepSeek como segunda y tercera opinión.
3. Perplexity (opcional): solo cuando la consulta necesita información actual, con el crédito de Pro.

Claude, OpenAI directo y DeepSeek directo quedan desactivados mientras no marques «Autorizo llamadas con coste».

## Firebase (plan Spark, gratuito)

- Hosting, Authentication (Google) y Firestore: incluidos en Spark, con cuotas de sobra para uso personal.
- Cloud Functions y App Hosting: requieren el plan Blaze (tarjeta). Por eso el servidor corre en Cloudflare Workers (100.000 peticiones/día gratis, sin tarjeta) o en tu ordenador.

## Fuentes

- [Precios y cuota gratuita de Gemini](https://ai.google.dev/pricing)
- [Límites de GitHub Models](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)
- [Crédito de API de Perplexity Pro](https://hub-prod.perplexity.ai/hub/faq/pplx-api)
- [Precios de DeepSeek](https://api-docs.deepseek.com) (precios consultados en [morphllm.com/deepseek-api](https://www.morphllm.com/deepseek-api))

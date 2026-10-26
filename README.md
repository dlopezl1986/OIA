# OIA · Orquestador personal multi-IA

Aplicación web privada e instalable (PWA) que envía tus consultas a una o varias IA, contrasta sus respuestas con una IA árbitro y te entrega una respuesta consolidada, con historial.

- **Coste 0 € por defecto**: usa Gemini (AI Studio), Groq (gpt-oss de OpenAI) y modelos gratuitos de OpenRouter; Perplexity con el crédito de Pro. Claude, OpenAI y DeepSeek directos solo si los autorizas.
- **Adaptativo**: una IA para preguntas sencillas, varias con árbitro para las complejas, revisión cruzada (hasta 3 rondas) solo si hay contradicciones.
- **Privado**: solo tu cuenta de Google entra; las claves se cifran en el servidor y nunca vuelven al navegador.

## Uso

1. **Consultar**: escribe y pulsa Consultar (o Ctrl+Enter). Modo *Automático* decide cuántas IA usar; *Rápido* usa una; *Profundo* usa varias con árbitro.
2. **Resultado**: respuesta final, nivel de acuerdo y confianza, IA que respondieron y avisos. «Detalles» muestra discrepancias, respuestas individuales y tokens.
3. **Historial**: búsqueda, consulta anterior completa y borrado.
4. **Conexiones**: pega una clave, la app la valida y la guarda cifrada. Cada proveedor indica si es gratis, con crédito o de pago y cómo conseguir la clave.
5. **Ajustes**: rondas máximas, número de IA, llamadas por consulta, árbitro y modelos.

Instalar: en Chrome/Edge, icono de instalar en la barra de direcciones; en Android, «Añadir a pantalla de inicio»; en iPhone, Compartir › «Añadir a pantalla de inicio».

## Documentación

- [Despliegue, recuperación y mantenimiento](docs/despliegue.md)
- [Arquitectura, seguridad e integraciones futuras](docs/arquitectura.md)
- [Viabilidad y costes por proveedor](docs/viabilidad.md)
- [Estado del proyecto](docs/estado.md)

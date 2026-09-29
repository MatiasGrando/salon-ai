# Piloto WhatsApp del bot conversacional

Reutiliza admisión, inbox, worker, outbox y sender actuales. El proveedor sólo se invoca después de validar la policy conversacional de Barber Demo `WX-38N6UG`: configuración activa, marcador `conversational-booking-v1`, tenant y generación vigentes. Otros negocios siguen por su motor actual. No ejecuta reservas: produce propuestas.

## Configuración (apagada por defecto)

- `CONVERSATIONAL_WHATSAPP_AI_ENABLED=true`: opt-in específico del canal. La flag QA no lo activa.
- `CONVERSATIONAL_WHATSAPP_AI_MODEL`: default `gpt-6-luna`; no hereda `OPENAI_MODEL` ni modifica Booking V2.
- `CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS`: default 4500 ms por llamada, rango 1000–5000 ms. Dos llamadas secuenciales pueden sumar hasta dos deadlines más consultas/persistencia; no es una promesa de latencia total.
- `OPENAI_API_KEY`: clave existente; nunca imprimirla. Sin clave o ante error/timeout/salida inválida se responde con respaldo determinista.

Este cambio local no activa la configuración del perfil ni modifica Railway. Antes de activarlo, autorizar explícitamente el envío de mensajes y catálogo de Barber Demo a `api.openai.com` usando la clave correspondiente y autorizar el despliegue. El usuario configura las variables Railway.

## Medición

`[conversational-bot-latency]` vincula job, providerEvent y transition (null cuando no se aplicó salida). Incluye contexto, cómputo, interpretación, validación, motor, redacción, modo/fallback y tokens cuando el proveedor los devuelve. No incluye mensajes, teléfono ni errores raw. Se emite después del commit; es best-effort y no sustituye evidencia durable de entrega.

Usar junto a `[bot-options-latency]`, métricas de outbox existentes y timestamps de `BotProviderEvent` / `BotTransitionLog` / `BotOutbox`. HTTP aceptado por Meta no significa entregado: `deliveredAt` corresponde a observación del callback, no al instante exacto de pantalla del teléfono. Un reintento puede producir más de una traza; agrupar por job/event y distinguir transición nula para no contar cómputo descartado como respuesta enviada.

## Pendientes antes de prueba completa

- Consolidación durable de mensajes que ingresan mientras se calcula, con guardia de vigencia antes de comenzar el envío a Meta (C05.2). Actualmente aún se procesa un evento por turno.
- Recolector read-only y reporte por rango de tiempos (C05.3).
- Autorización remota, despliegue, activación del perfil y prueba desde número privado; después medir muestra representativa y probar carga. Las pruebas fake no establecen latencia ni capacidad productiva.

Pruebas offline: `tsx scripts/conversational-bot-runtime-test.ts`, `tsx scripts/conversational-bot-whatsapp-ai-test.ts`, intérprete y suites existentes de latencia/outbox.

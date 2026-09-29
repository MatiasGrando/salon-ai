# Piloto local de Barber Demo (preparación, sin cutover)

El proceso de este piloto es `src/barber-local.ts`, **no** `src/server.ts`.
Arranca dos workers, el sender Meta y la admisión autoritativa únicamente para
`cmpvr0oqo0000o0vcnhgyv054` (WX-38N6UG). No inicia el CRM, bootstrap de
administrador, marketing scheduler ni listeners generales.

## Requisitos locales antes de arrancar

- `BOT_WORKER_SCOPE_MODE=include` y
  `BOT_WORKER_SCOPE_BUSINESS_ID=cmpvr0oqo0000o0vcnhgyv054`.
  Un par parcial, otro modo u otro negocio bloquean el inicio.
- `BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=true`,
  `BOT_OPTIONS_WORKERS_ENABLED=true`, `BOT_OPTIONS_SENDER_ENABLED=true` y
  `BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE=true`. Conservar las
  capability flags de producción para no cambiar el comportamiento del bot.
- `DATABASE_URL`, `OPENAI_API_KEY`, `WHATSAPP_VERIFY_TOKEN` y
  `CONVERSATIONAL_WHATSAPP_AI_ENABLED=true`, usando las credenciales
  existentes autorizadas. No imprimirlas ni copiarlas a este documento.
- `WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES` debe incluir
  `WX-38N6UG`. El sender toma sus credenciales Meta del perfil conectado.
- Opcional: `BARBER_INTERNAL_PORT` (3311) y `BARBER_GATEWAY_PORT` (3312);
  deben ser distintos y sólo escuchan en `127.0.0.1`.

El arranque local, después de desplegar y comprobar que Railway **excluye**
Barber y se drenó el proceso previo, es
`./node_modules/.bin/tsx.cmd src/barber-local.ts` desde PowerShell. **No
ejecutar este comando como prueba contra la base compartida antes del
cutover.**

Si luego se habilita un túnel temporal, su destino debe ser **sólo**
`http://127.0.0.1:3312`, nunca el puerto interno 3311 ni el CRM.
El gateway permite únicamente GET y POST sobre la ruta exacta
`/webhooks/whatsapp`; pasa la firma y el body sin transformaciones.
La ruta interna verifica token de Meta, firma por appSecret del perfil y
admite mensajes y callbacks de estado. Un tenant desconocido o legacy no
cae en el handler anterior: se rechaza para reintento seguro.

Para detener el proceso usar Ctrl+C. Primero se cierra el gateway; luego
se drenan los loops y se cierran las conexiones. Antes de restaurar
Railway, inspeccionar leases `SENDING` y `UNKNOWN`: nunca reenviar a
ciegas un resultado ambiguo.

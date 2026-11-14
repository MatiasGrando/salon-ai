# Mapa de Instagram y reservas

Actualizado el 14/11/2026. Este mapa se actualiza junto con cada cambio de entrada, enrutamiento, confirmación o envío del bot de Instagram.

## Cómo saber qué flujo atendió un mensaje

El [webhook de Instagram](../../src/routes/instagram-webhook.ts) recibe `POST /webhooks/instagram` y autentica la solicitud. [InstagramWebhookService](../../src/services/instagram-webhook-service.ts) identifica el comercio y llama a la admisión conversacional antes de ejecutar el flujo anterior.

| Flujo | Cómo reconocerlo | Qué hace con un pedido de reserva |
| --- | --- | --- |
| Anterior | `PrismaInstagramBotAdmission` devuelve `route: 'legacy'` cuando el proceso deshabilita explícitamente el flujo nuevo o el comercio queda fuera de una lista explícita. | `requiresWhatsappContinuation` deriva una intención de reserva. `composeInstagramReply` dice «Para reservar el turno, continuemos por WhatsApp» y `buildWhatsappUrl` arma un enlace `wa.me` con el número público, contexto de la consulta y código de referencia. |
| Nuevo bot | El webhook registra `engine: 'conversational-booking-v1'` y el resultado de admisión. | Admite el mensaje al motor compartido. La conversación, la propuesta y la confirmación pueden ocurrir por Instagram. |

Si el comercio está seleccionado para el bot nuevo pero le falta procesador, despliegue activo o política, la [admisión](../../src/services/instagram-bot-admission.ts) lanza un error. Los resultados `paused`, `outside_window` y `duplicate` también salen por el flujo nuevo. Estas condiciones no ejecutan la regla anterior de WhatsApp.

## Activación y datos a verificar

1. [Configuración del proceso](../../src/config/instagram-bot.ts). Con la lista de comercios vacía, el Nuevo bot es el predeterminado para Instagram. `INSTAGRAM_CONVERSATIONAL_BOT_ENABLED=false` lo desactiva explícitamente y una lista `INSTAGRAM_CONVERSATIONAL_BOT_BUSINESS_IDS` no vacía conserva el modo acotado y la asignación manual. El comercio debe quedar dentro del alcance efectivo del trabajador. El modo predeterminado requiere `CONVERSATIONAL_INSTAGRAM_AI_ENABLED=true` y `OPENAI_API_KEY` en el servidor.
2. [Primera asignación](../../src/services/instagram-bot-routing.ts). Un mensaje válido autenticado activa el bot para una cuenta habilitada y apta. La operación comprueba el token, el secreto, la zona horaria y los estados protegidos. Reutiliza una versión publicada válida o prepara la versión inicial exclusivamente de Instagram. No necesita WhatsApp. Tanto un comercio conectado antes del cambio como uno recién conectado pasan por este mismo recorrido.
3. [Enrutamiento en el CRM](../../src/routes/business-bot-routing.ts). Consultar el canal **Instagram** para verificar versión activa, generación y estado de pausa. Las asignaciones ya activas se conservan. Previo a habilitar el modo predeterminado, esperar a que terminen los procesos de la revisión anterior que todavía puedan enviar la respuesta antigua.
4. Correlacionar el resultado del webhook con el mensaje probado. La frase fija junto a `wa.me` apunta al flujo anterior. El enlace solo también puede ser parte de una respuesta informativa. Para cerrar el diagnóstico de una prueba concreta, verificar el resultado de admisión y qué versión y configuración tenía el proceso que recibió ese webhook.

## Recorrido del bot nuevo

| Etapa | Ubicación y responsabilidad |
| --- | --- |
| Admisión | [instagram-bot-admission.ts](../../src/services/instagram-bot-admission.ts) vincula el evento con cuenta, comercio y lead. Controla autenticación, duplicados, capacidad de procesar, sesión y ventana de 24 h. Persiste `BotProviderEvent` y `BotActionInbox` y encola `PROCESS_INBOX` cuando corresponde. |
| Trabajador | [server.ts](../../src/server.ts) registra la admisión y arranca el trabajador y el envío de Instagram con su alcance. [process-session-job.ts](../../src/bot-options/application/process-session-job.ts) llama a `processConversationInbox`. |
| Conversación y confirmación | [process-inbox-job.ts](../../src/conversational-bot/process-inbox-job.ts) usa la identidad de Instagram, interpreta el turno y, ante una confirmación válida de la propuesta, llama a `executePrismaConversationBooking`. |
| Reserva y respuesta | [prisma-conversational-booking.ts](../../src/conversational-bot/prisma-conversational-booking.ts) ejecuta la reserva y devuelve el resultado de la operación. [instagram-runtime-channel.ts](../../src/conversational-bot/instagram-runtime-channel.ts) verifica el destino de envío, vinculado a la sesión y a la cuenta de Instagram. |

## Registro de cambios

- **14/11/2026, diagnóstico de reprogramación.** El contrato `instagram-shared-bot-runtime-test.ts` confirma con «si confirmo» sin pasar un intérprete al trabajador. El texto entra como mensaje libre. El motor requiere interpretación semántica de la aceptación o una selección de la propuesta vigente (por ejemplo, «Confirmar cambio»). La prueba anterior falla en ambas ramas de código comparadas. Pendiente verificar confirmación semántica con IA simulada y selección explícita en el contrato, y una prueba real para confirmar el comportamiento desplegado.

- **14/11/2026**. Se trazaron los dos recorridos en el código. El enlace de WhatsApp reportado coincide con la regla anterior de derivación. Falta identificar qué proceso y configuración atendieron la prueba. La verificación se limitó al código local.
- **14/11/2026**. Se agregó la activación predeterminada de primera admisión para Instagram, con reutilización de configuración publicada y un perfil propio para comercios sin WhatsApp. Se verificaron localmente la activación sin WhatsApp, la deduplicación y las pausas mediante la suite del canal.
- Al modificar este módulo, registrar acá el punto que cambió, su configuración y cómo se comprobó. La suite del canal se ejecuta con `npm run test:instagram-shared-bot`.

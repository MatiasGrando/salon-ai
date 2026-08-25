# Diseño técnico — bot determinístico de WhatsApp por opciones

## 1. Objetivos, no objetivos y principios

### Objetivos

- Implementar la etapa 1 definida en `alcance-etapa-1.md`, `reglas-funcionales.md` y `maquina-de-estados.md` con acciones cerradas, estado persistido y efectos auditables.
- Aceptar webhooks en p95 ≤ 200 ms, estabilizar pulsaciones sin mantener abierta la petición y recuperar trabajo después de una caída.
- Garantizar aislamiento por negocio, una sola transición por sesión, idempotencia de operaciones y exclusión de agenda al retener o mover un turno.
- Permitir activación y rollback exclusivos, transaccionales y verificables.

### No objetivos de etapa 1

- No hay router semántico, clasificación por IA ni inferencia desde texto visible. El texto sólo se admite para nombre y el archivo sólo para comprobante en los estados previstos.
- No se reutiliza silenciosamente `ConversationService`. El nuevo runtime no llama a `ConversationService.handleMessage`; el motor anterior queda detrás de su deployment legado.
- No se implementan coordinación ni retención multiprofesional, búsqueda por hora, orden fecha → horario → profesional ni migración automática de bots personalizados. El código multiprofesional parcial existente (`coordinationGroupId`, itinerarios y Booking V2) queda fuera de etapa 1.
- No se introduce Kafka, Redis, SQS ni otro servicio operativo. PostgreSQL alcanza para el volumen inicial y permite transacciones con estado, jobs y outbox. Una cola externa reduciría polling a costa de otra fuente de verdad, coordinación distribuida y mayor costo operativo; se reevaluará con métricas.

### Principios arquitectónicos

1. **Determinismo:** `estado + acción admitida + contexto versionado → resultado`; ninguna transición depende del título, posición o último texto enviado.
2. **PostgreSQL como verdad:** admisión, revisión, prompts, vencimientos, jobs, outbox y fencing son durables. Timers locales sólo aceleran despertares.
3. **Fronteras mínimas con significado:** entrada/admisión, runtime puro, casos de uso transaccionales, persistencia y adaptador Meta. No se replica cada concepto en capas artificiales.
4. **Efectos después del commit:** WhatsApp nunca participa de una transacción SQL; el outbox se crea en la misma transacción que el cambio funcional.
5. **Aislamiento explícito:** toda referencia se revalida contra `businessId`, deployment, sesión, prompt y revisión de estado.
6. **Tiempo de base de datos:** decisiones concurrentes y vencimientos usan `clock_timestamp()`/`CURRENT_TIMESTAMP`, no relojes de procesos independientes.

### Decisiones arquitectónicas principales

| Decisión | Alternativas consideradas | Razón |
|---|---|---|
| Jobs y outbox en PostgreSQL | Timers locales; Redis/SQS/Kafka | Los timers no sobreviven reinicios. Una cola externa agrega costo y una segunda coordinación; PostgreSQL permite commit atómico con el estado en etapa 1. |
| Pointer `BotChannelDeployment` como autoridad | Consultar `BusinessBotConfiguration.status`; flags independientes | Una fila única por negocio/canal hace inequívoco el motor activo y aporta generation para fencing. |
| Token opaco corto con choices persistidas | Serializar acción e IDs completos; identificar por label | Evita PII y presupuestos variables, y obliga a validar tenant, prompt y revisión en DB. |
| Estado nuevo en `BotSession` | Extender `Conversation.currentStep`/`bookingV2State`; reutilizar `ConversationService` | El modelo legado mezcla motores y no expresa regiones/revisión; aislarlo permite rollout y rollback sin inferir JSON viejo. |
| `BookingVisit` + `Appointment` de agenda | Reemplazar `Appointment`; usar sólo `Appointment PENDING` | Conserva CRM/agenda y crea un agregado para hold/seña/idempotencia. Etapa 1 limita la visita a un solo segmento. |
| Outbox transaccional, entrega at-least-once controlada | Enviar dentro de la transición; prometer exactly-once externo | El commit no puede ser atómico con Meta. El outbox evita perder envíos y trata timeouts inciertos sin duplicado ciego. |

## 2. Evaluación del estado actual

El webhook actual hace resolución, deduplicación, housekeeping, marketing, señas, procesamiento conversacional y envío antes de responder. `WhatsAppWebhookService.handleWebhook` acumula `automaticTasks` y espera `Promise.all` (líneas 173–723); por lo tanto, **el HTTP actual espera el procesamiento**. Además:

- `InboundMessageBatcher.pending`, sus timers y `processingTails` son mapas locales: **el batcher actual es in-memory** y pierde conciliaciones al reiniciar.
- `Message.status` usa strings como `received`, `queued_bot` y `processed_bot`, pero **no es una cola durable**: no tiene `availableAt`, lease, intentos, fencing ni política de recuperación.
- `BusinessBotConfiguration` tiene `status/channel`, y `setTamaraOptionsBotEnabled` archiva otras filas dentro de una transacción, pero **la exclusividad de bot activo no tiene constraint de base de datos**. Dos escritores ajenos al servicio pueden dejar más de uno activo.
- `BusinessWhatsAppConfig.businessId` es único, pero `phoneNumberId` sólo está indexado indirectamente en configuraciones de bot: **dos negocios conectados pueden declarar el mismo `phoneNumberId`** y volver ambiguo el tenant.
- `AppointmentService.lockProfessionalAgenda` usa `pg_advisory_xact_lock` y luego consulta solapamientos: **el overlap de `Appointment` está impuesto por advisory lock/aplicación**, no por exclusion constraint.
- El flujo legado crea primero `Appointment` y la seña desde otros pasos: **la creación actual de `BookingDeposit` no es atómica con la creación del turno**.
- `POST /webhooks/whatsapp` recibe el body parseado y **no valida `X-Hub-Signature-256`** contra el body crudo.
- El payload tipado/extractor sólo recorre `messages`; **los callbacks `statuses` de entrega se ignoran**.
- `isSupportedDepositProof` acepta extensiones y MIME adicionales sin descargar/verificar contenido, mientras `BookingDepositService.submitWebProof` sí limita web a 3 MiB y verifica firmas. WhatsApp debe converger a la política canónica JPEG/PNG/WebP/PDF, 3 MiB y magic bytes.
- `src/config/prisma.ts` configura `DATABASE_POOL_MAX=3` por defecto; webhook, workers y CRM hoy compiten por ese pool pequeño, por lo que el SLO de ACK requiere aislamiento/capacidad explícitos.

### Reusar, adaptar o reemplazar

| Archivo / símbolo exacto | Decisión | Motivo |
|---|---|---|
| `src/routes/whatsapp-webhook.ts` / `whatsappWebhookRoutes` | Adaptar | Capturar body crudo, validar firma y responder tras admisión durable. |
| `src/services/whatsapp-webhook-service.ts` / `WhatsAppWebhookService` | Dividir/reemplazar para el nuevo deployment | Es un orquestador monolítico y sin ACK rápido; conservar ramas legadas detrás del selector durante rollout. |
| `src/services/inbound-message-batcher.ts` / `InboundMessageBatcher` | No reutilizar como verdad | Sólo timer opcional; la estabilización nueva vive en tablas/jobs. |
| `src/services/conversation-processing-lease.ts` / `withConversationProcessingLease` | Reemplazar en el nuevo runtime | Usa hora del proceso y lease sin fencing de revisión; la sesión nueva usa lock/revisión/lease durable. |
| `src/services/conversation-interactive-prompt.ts` / `admitConversationInteractivePromptReply`, `resolveConversationInteractivePrompt` | Reusar conceptos, reemplazar persistencia | El token y el lock son un buen antecedente; depender de `Conversation.activeInteractivePromptToken` y escanear `Message.metadata` no modela choices, revisión ni ventana durable. |
| `src/integrations/whatsapp-cloud-api.ts` / builders y `WhatsAppCloudApi` | Adaptar | Reusar credenciales, payloads y parser de errores; agregar validación estricta de IDs, callbacks, resultado normalizado y envío desde outbox. |
| `src/services/business-bot-activation-service.ts` / `setTamaraOptionsBotEnabled` | Reemplazar por activador genérico | Falta preflight protegido, pointer único y auditoría completa de rollback. |
| `src/services/business-support-bot-runtime.ts` / `handleExclusiveBusinessSupportBotMessage` | No usar como runtime nuevo | Busca una fila activa sin constraint y actualiza JSON legado; el nuevo deployment se resuelve por pointer. |
| `src/services/business-bot-configuration-service.ts` | Adaptar | `BusinessBotConfiguration` puede representar una versión desplegable, pero no la activación efectiva. |
| `src/services/appointment-service.ts` / disponibilidad, `lockProfessionalAgenda` | Extraer/reusar reglas | Mantener grilla, duración, horarios y advisory lock; exponer casos de uso con `TransactionClient` para componer confirmación atómica. |
| `src/services/booking-deposit-service.ts` / magic bytes y transiciones | Extraer/adaptar | Reusar validación web; ampliar estados y ejecutar todo contra visita/retención en una sola transacción. |
| `src/services/customer-identity-service.ts` / normalización y advisory lock | Reusar con contrato nuevo de nombre | Ya aísla por negocio/teléfono; el bot no debe crear ni cambiar nombre antes de confirmarlo. |
| `prisma/schema.prisma` / `Conversation`, `Message`, `Appointment`, `BookingDeposit` | Compatibilidad, no cola/estado nuevo | Siguen sirviendo al CRM y motores legados; se agregan relaciones/snapshots sin sobrecargar sus campos históricos. |
| `scripts/whatsapp-interactive-reliability-contract-test.ts`, `appointment-concurrency-contract-test.ts`, `deposit-flow-contract-test.ts` | Conservar y ampliar | Son regresiones útiles, pero mocks no sustituyen concurrencia real en PostgreSQL. |

## 3. Estructura objetivo y responsabilidades

```text
src/bot-options/
  domain/
    actions.ts                 envelope y catálogo tipado
    state.ts                   regiones e invariantes
    transition.ts              función pura y tabla de transiciones
    effects.ts                 efectos declarativos
    views.ts                   ViewModel sin detalles de Meta
  application/
    admit-provider-events.ts   admisión rápida y tenant
    reconcile-actions.ts       ventana 500/1500 y conflictos
    process-session-job.ts     lock, fencing, transición y commit
    booking-operations.ts      confirmar/cancelar/reprogramar
    deposit-operations.ts      comprobante, vencimiento y revisión
    handoff-operations.ts      ownership humano
    activation-operations.ts   preflight/cutover/rollback
  infrastructure/
    prisma-*.ts                repositorios/casos SQL concretos
    postgres-worker.ts         claim SKIP LOCKED y leases
    whatsapp-renderer.ts       límites y partición de contenido
    whatsapp-outbox-sender.ts  entrega, retry y poison
    meta-webhook-adapter.ts    firma, parsing y callbacks
```

Las rutas sólo traducen HTTP. Los casos de uso application poseen límites transaccionales. `domain` no importa Prisma, Fastify, Meta, reloj global ni servicios legacy. No se crean repositorios triviales por tabla: una unidad de persistencia corresponde a una invariante real (admisión, transición, reserva, seña, activación).

## 4. Entrada: ACK rápido, admisión durable y worker

```text
Meta → Fastify(raw body) → HMAC + parse mínimo → resolver tenant
                                        ↓
                         TX ProviderEvent + ActionInbox + Wakeup
                                        ↓ commit
                                   HTTP 200
                                        ↓
                     worker PostgreSQL → reconciliar → transición
                                        ↓
                                 Outbox → Meta
```

1. El plugin de raw body conserva bytes con un límite de payload. Se exige `X-Hub-Signature-256=sha256=<hex>` y se compara `HMAC-SHA256(appSecret, rawBody)` con `timingSafeEqual`. Firma ausente/malformada/inválida: 401/403, sin persistir contenido. **Modelo de secretos resuelto (decisión D):** cada negocio crea su propia Meta App, por lo que el `appSecret` se guarda **por negocio** junto a su configuración de WhatsApp (`BusinessWhatsAppConfig`, nueva columna junto a `accessToken`). El flujo extrae `phone_number_id` del body **sin confiar en él**, busca el secreto de ese negocio y verifica con ese secreto; un atacante que finja otro tenant sigue necesitando el secreto real del mismo, y el body no se procesa ni persiste hasta que la firma coincide. Esta exigencia aplica al motor nuevo desde el primer día; el runtime legado mantiene su comportamiento actual sin firmas hasta su migración. La rotación es por negocio: se admite transitoriamente el secreto anterior y el nuevo durante una ventana corta marcada en configuración. El alta/onboarding agrega el campo `app secret` junto a los datos existentes; el verify token GET de la plataforma es compartido y el comercio lo pega en su app de Meta.
2. Se parsea sólo después de validar. Se admiten `messages[]` y `statuses[]`; cambios desconocidos se registran como tipo no soportado sin romper todo el batch.
   Los tipos de mensaje no admitidos por el flujo —audio, video, ubicación,
   contacto, sticker o reacción— también se persisten como entrada tipada
   `UNSUPPORTED_INPUT`: no se descargan ni interpretan, pero permiten aplicar la
   recuperación gradual y el contador de inválidos en vez de quedar sin respuesta.
3. El tenant se resuelve por `metadata.phone_number_id` contra `BusinessWhatsAppConfig` conectado y único. `display_phone_number` es sólo diagnóstico, nunca fallback de identidad. Admisión exige que la configuración esté `CONNECTED`, que el pointer activo pertenezca al mismo `businessId` y que deployment/generation coincidan. El `from`, cualquier entidad y credenciales nunca deciden tenant.
4. Una transacción inserta un `ProviderEvent` por evento estable, su `ActionInbox` o actualización de entrega, y un `BotWakeup`. `ON CONFLICT DO NOTHING` hace idempotente el retry de Meta. Tenant desconocido se persiste sin PII expandida como `UNMATCHED` para diagnóstico y no crea conversación.
5. Se responde 200 inmediatamente después del commit. No se ejecutan catálogo, agenda, IA, media download ni envío dentro del request. Si PostgreSQL no confirma, se devuelve 5xx para que Meta reintente; nunca se da ACK a un evento perdido.
6. Workers en el mismo monolito reclaman filas con `FOR UPDATE SKIP LOCKED`, lease con hora SQL y token de fencing. Cada tipo de claim consulta además su capability switch, ownership y generation; un scheduler periódico recupera leases vencidos. `LISTEN/NOTIFY` o timers sólo optimizan latencia.

### Modos de admisión y capacidad

- **Shadow observacional:** intenta insertar copias marcadas `SHADOW_NON_EXECUTABLE`, sin `ActionInbox`, wakeup ni outbox ejecutables. Si falla, el handler legado continúa (**fail-open**) y su ACK no se atribuye al SLO del motor nuevo. Se mide por separado `shadow_attempt/skip/error`; jamás se promueve ni activa una fila histórica shadow.
- **Autoritativo durable:** sólo se habilita después del backfill de pointers y constraints. Falla cerrado: sin commit durable devuelve 5xx y no ejecuta ni el nuevo motor ni un fallback legado. Su ACK sí mide p95 ≤200 ms.
- El pool Prisma actual tiene máximo **3** conexiones por defecto (`src/config/prisma.ts`). Antes del modo autoritativo se crea un cliente/pool exclusivo de ingreso (`DATABASE_INGRESS_POOL_MAX=2` inicial), separado del pool general; el presupuesto inicial por instancia queda explícito en 5 conexiones y debe respetar el límite total de PostgreSQL. Workers: concurrencia inicial 2; sender: 1; ambos usan sólo el pool general. Admisión aplica deadline total 175 ms, `lock_timeout` 50 ms y `statement_timeout` 120 ms; al vencer, circuit breaker + 5xx. Descargas, Meta, agenda y scans nunca usan/retienen el pool de ingreso. La carga objetivo confirma o ajusta estos números antes del piloto.

## 5. Envelope de acción, token y prompt

### Transporte

El ID enviado a Meta es opaco:

```text
b1.<promptToken>.<choiceToken>
```

- `promptToken`: 16 caracteres base64url de 96 bits aleatorios.
- `choiceToken`: 11 caracteres base64url de 64 bits aleatorios, único dentro del prompt.
- Longitud normal: 31 bytes ASCII. El renderer aplica un máximo interno de **64 bytes**, muy por debajo del presupuesto conservador común de **200 bytes para row ID** (y 256 para reply button ID). Así el mismo ID sirve para botón o lista y queda margen ante prefijos futuros.
- El token no contiene IDs de cliente, turno, servicio ni estado; no revela PII y evita depender del largo de CUIDs. No se firma individualmente porque es aleatorio, de un solo prompt y se valida por lookup tenant-scoped; la autenticidad del webhook la da HMAC. Un MAC truncado puede agregarse si el token se usa fuera de Meta.

### Envelope persistido

```ts
type AdmittedAction = {
  schemaVersion: 1
  engineKey: 'deterministic-options'
  engineVersion: string
  deploymentId: string
  businessId: string
  sessionId: string
  promptId: string
  choiceId: string
  actionType: ActionType
  entityRef?: { type: EntityType; id: string }
  payload?: JsonValue
  expectedStateRevision: bigint
  providerEventId: string
  providerMessageId: string
  receivedAt: Date
}
```

`BotPrompt` guarda token, sesión, `stateRevision`, vista, modo (`FUNCTIONAL|NAVIGATION|CONFLICT`), `OPEN|STABILIZING|RESOLVED|INVALIDATED|EXPIRED`, tiempos y mensaje outbox. `BotPromptChoice` guarda `choiceToken`, `actionType`, `entityType/entityId`, payload mínimo, label snapshot sólo para auditoría/render y orden. La admisión toma `BotPrompt FOR UPDATE`; para `OPEN` fija en esa misma transacción `absoluteAt=dbNow+1500ms`, y luego acepta **`OPEN` o `STABILIZING`** únicamente si negocio, deployment, generation, sesión y revisión coinciden y `dbNow <= absoluteAt`. No cambia el prompt a cerrado: sólo conciliación puede cerrarlo bajo ese mismo lock. El título devuelto por Meta nunca elige la acción. Emitir una nueva pantalla funcional invalida prompts incompatibles en la misma transacción.

Nombre y comprobante son excepciones explícitas al choice interactivo. El
adaptador sintetiza `name.submit`, `deposit.proof_received` o
`input.unsupported` únicamente después de bloquear la sesión y comprobar que el
estado vigente espera exactamente ese tipo de entrada. Un texto no puede
convertirse por coincidencia con el título de un botón y un archivo fuera de
`DEPOSIT_INSTRUCTIONS` nunca se interpreta como comprobante.

## 6. Estabilización durable de pulsaciones rápidas

Por cada acción válida, admisión y conciliación toman lock de `BotPrompt`; por sesión sólo hay una exclusión lógica.

1. Primera pulsación con prompt `OPEN`: insertar `BotActionInbox(ADMITTED)`, cambiarlo a `STABILIZING`, y usar hora SQL para `firstActionAt=lastActionAt=dbNow`, `settleAt=dbNow+500ms`, `absoluteAt=dbNow+1500ms`.
2. Otra pulsación con prompt `STABILIZING` y `dbNow<=absoluteAt`: insertar si su `providerEventId` es nuevo, conservar `firstActionAt/absoluteAt`, actualizar `lastActionAt=dbNow` y `settleAt=LEAST(absoluteAt, dbNow+500ms)`. Upsert de un único wakeup `(kind,promptId)` a ese instante. Por eso `STABILIZING` es admisible, no sinónimo de cerrado.
3. El worker sólo reclama cuando `clock_timestamp() >= settleAt`. Bajo `BotPrompt FOR UPDATE` vuelve a calcular y cierra admisión atómicamente (`STABILIZING→RESOLVED`) al tomar el conjunto definitivo. Si una admisión anterior movió el límite, reprograma y sale; ninguna ruta distinta de conciliación cierra el prompt.
4. Ordenar por `receivedAt`, luego `ProviderEvent.createdAt`, luego ID estable. El timestamp de Meta es informativo; el orden durable de admisión rompe empates y evita confiar en relojes remotos.
5. Una sola `choiceId`: la primera acción pasa a `SELECTED`; las restantes a `DUPLICATE`. Se ejecuta exactamente una transición lógica.
6. Más de una `choiceId`: todas pasan a `CONFLICT`; no se aplica ninguna. Se incrementa la revisión sólo para emitir una vista de desambiguación con choices explícitas derivadas de las recibidas. Confirmar esa vista genera una nueva acción normal; no revive el prompt anterior.
7. Si la acción llega tras `absoluteAt` o después del cierre, queda `STALE`, no modifica estado y agenda reconstrucción de la vista vigente como operación idempotente. Si pertenece a otra generation se clasifica `STALE_CUTOVER`, nunca vuelve a interpretarse como choice: crea una **nueva** operación de recovery idempotente en el deployment vigente que abre `MAIN_MENU` con aviso de actualización.
8. Tras caída: filas `ADMITTED`, prompts `STABILIZING`, wakeups vencidos y jobs con lease expirado son reclamables. `operationKey`, revisión esperada y transition log impiden repetir efectos. Un worker que perdió lease no puede committear porque su `fenceToken`/revisión ya no coincide.

No hay timer local necesario para corrección. Un timer puede hacer `NOTIFY`, pero el escaneo indexado de wakeups vencidos garantiza recuperación.

## 7. Contrato del runtime, efectos, vistas y revisiones

```ts
transition(state, action, context): {
  nextState: BotState
  effects: Effect[]
  view: ViewModel
  outcome: 'APPLIED' | 'RECOVERED' | 'HANDOFF'
}
```

- `BotState` conserva regiones separadas: `flow`, `booking`, `deposit`, `handoff`, contexto de carrito/selecciones, contador de inválidos y modos de vista. Los estados válidos son los del documento canónico; no se reducen a `Conversation.currentStep`.
- `context` es un snapshot ya tenant-scoped: cliente, catálogo, configuración, disponibilidad o entidad objetivo, junto con `dbNow`. El core no consulta servicios.
- Efectos tipados: `PersistCustomerName`, `CreateVisitHold`, `CreateDeposit`, `ExpireDeposit`, `ApproveDeposit`, `CancelVisit`, `RescheduleAppointment`, `CreateHandoff`, `EmitOperationalAlert` y `SendView`. El executor valida guardas y puede devolver un evento de recuperación al core; nunca adapta una acción vieja al estado nuevo.
- `ViewModel` declara cuerpo, mensajes informativos previos, choices y metadata. El renderer decide botón/lista/paginación sin cambiar estado funcional. Sólo la vista interactiva final abre prompt.
- `BotSession.revision` es monotónica. Cada transición compara `expectedRevision`, bloquea la sesión, escribe estado + `revision+1`, prompts, log, operaciones y outbox en una transacción. Paginación puramente visual también produce un prompt nuevo y revisión de presentación para vencer tokens anteriores, aunque conserve la región funcional.
- `stateSchemaVersion` permite migrar JSON. Al cargar una versión desconocida se pausa y deriva; jamás se interpreta parcialmente.

## 8. Persistencia propuesta y migración

Nombres conceptuales; se materializan con enums Prisma cuando sean estables y constraints SQL para invariantes que Prisma no exprese.

| Tabla/modelo | Campos principales, estados e índices |
|---|---|
| `BotChannelDeployment` | `id,businessId,channel,activeConfigurationId,generation,activatedAt,activatedBy,previousConfigurationId,claimsPausedAt`; `UNIQUE(businessId,channel)` es el pointer exclusivo. La pertenencia se impone con FK compuesta `(businessId,activeConfigurationId)→BusinessBotConfiguration(businessId,id)` respaldada por `UNIQUE(businessId,id)`; si Prisma no expresa la relación, migración SQL + trigger diferible equivalente. El runtime sólo considera activo este pointer. |
| `BotDeploymentAudit` | anterior/nuevo, `ACTIVATE|ROLLBACK`, actor, preflight snapshot, timestamp; índice negocio/fecha. |
| `BotSession` | `businessId,channel,conversationId,deploymentId,engineVersion,stateSchemaVersion,state JSONB,revision,businessTimezone,status ACTIVE|HUMAN_QUEUED|HUMAN_TAKEN|CLOSED,invalidCount,draftTouchedAt,draftExpiresAt,fenceToken`; unique deployment/conversation activa e índices por negocio/status. |
| `BotPrompt` | campos de la sección 5, `firstActionAt,lastActionAt,settleAt,absoluteAt,resolvedAt`; unique token y partial unique de prompt funcional abierto por sesión; índice `(status,settleAt)`. |
| `BotPromptChoice` | `promptId,choiceToken,actionType,entityType,entityId,payload,labelSnapshot,sortOrder`; unique prompt/token. |
| `ProviderEventShadow` | copia observacional separada: `provider,eventKey,payloadRedacted,observedAt,result`; unique provider/event. Nunca tiene FK a inbox/job/outbox y puede purgarse. Separarla evita que un retry autoritativo choque contra una fila shadow no ejecutable. |
| `ProviderEvent` | `provider,eventKey,eventType,businessId,phoneNumberId,providerMessageId,payloadCipherOrRedacted,providerOccurredAt,admittedAt,status ADMITTED|DUPLICATE|UNMATCHED|PROCESSED|REJECTED`; unique `(provider,eventKey)`, índices providerMessageId y negocio/fecha. Para inbound se usa message ID; para status, `providerMessageId + status + providerTimestamp`; eventos sin ID reciben hash canónico del subevento. Callbacks sin outbox correlacionable se conservan `UNMATCHED`, no se descartan. |
| `BotActionInbox` | `providerEventId,sessionId,promptId,choiceId,deploymentId,deploymentGeneration,expectedRevision,receivedAt,status ADMITTED|CLAIMED|SELECTED|DUPLICATE|CONFLICT|STALE|STALE_CUTOVER|REJECTED|PROCESSED|FAILED,claimToken,claimedUntil,operationKey,error`; unique providerEvent y `(promptId,providerMessageId)`, índice prompt/status/receivedAt. |
| `BotWakeup`/`BotJob` | `kind,aggregateId,businessId,deploymentGeneration,availableAt,status READY|CLAIMED|DONE|RETRY|POISON,attempts,maxAttempts,claimToken,claimedUntil,lastError`; unique kind/aggregate para wakeups; índice `(status,availableAt)`. Puede ser una tabla común. |
| `BotDispatchClaim` | registro compartido por rutas legacy y nuevas: `businessId,channel,sessionId?,engineKey,generation,fenceEpoch,kind PROCESS|SEND,status CLAIMED|SENDING|UNKNOWN|DONE,claimToken,claimedAt,claimedUntil,providerMessageId?`; índices scope/status. Es requisito de cutover: ningún runtime legacy procesa/envía sin este compatibility guard. |
| `BotOutbox` | `businessId,sessionId,transitionId,deliveryGroupId,sequence,kind,payload,idempotencyKey,status PENDING|CLAIMED|SENDING|UNKNOWN|ACCEPTED|DELIVERED|READ|RETRY|FAILED|POISON|SKIPPED,attempts,availableAt,claimToken,claimedUntil,providerMessageId,errorCode,sentAt,deliveredAt,readAt`; unique idempotency, providerMessageId parcial, índice status/availableAt y grupo/sequence. |
| `BotOutboxDependency` | `predecessorId,dependentId,requiredState ACCEPTED|DELIVERED`; PK compuesta y acíclica por creación dentro de un mismo `deliveryGroupId`. Sólo relaciones semánticas (fragmentos requeridos → interactivo) bloquean; vistas independientes no se encadenan globalmente. |
| `BotTransitionLog` | revisión anterior/nueva, estado/acción/resultados, prompt/action/event, deployment/engine, actor, duración, timestamps; unique sesión/revisión nueva. Payload sin PII libre. |
| `BotOperation` | `operationKey,type,businessId,sessionId,status STARTED|COMPLETED|FAILED,resultRef,requestHash`; unique operationKey; idempotencia de reservas, señas, cancelaciones y swaps. |
| `BookingVisit` | agregado lógico: negocio/cliente, `DRAFT|HELD|PENDING_PAYMENT_REVIEW|CONFIRMED|CANCELLED|EXPIRED`, importe/duración snapshots, `holdExpiresAt`, `version`, origen/session; en etapa 1 exige exactamente un `Appointment` activo y un profesional. Índices cliente/estado/fecha y expiraciones. |
| `Appointment` (cambio) | agregar `visitId` nullable y `version`; `UNIQUE(visitId)` para visitas del nuevo bot garantiza un único Appointment actual. La reprogramación actualiza esta misma fila; no hay `replacedAppointmentId/supersededAt` en etapa 1. |
| `AppointmentChangeHistory` | append-only: `appointmentId,visitId,operationKey,changeType RESCHEDULE,oldStartAt,newStartAt,oldDuration,newDuration,professionalId,actorType,actorId,changedAt,depositId?`; unique operationKey e índice appointment/changedAt. |
| `BookingDeposit` (cambio) | agregar `visitId` único, valores nuevos `REJECTED_RESUBMISSION_ALLOWED` y `REJECTED_FINAL`, `resubmissionExpiresAt,currentProofId,version`; mantener `appointmentId` y `REJECTED` histórico durante transición. El runtime nuevo no produce `REJECTED` ambiguo. |
| `BookingDepositProof` | evidencia append-only: `id,depositId,sequence,kind INITIAL|RESUBMISSION|LATE,providerEventId?,messageId?,mediaId?,bytes/reference,mimeType,size,sha256,filename,receivedAt,validationStatus VALID|INVALID|QUARANTINED,lateReason?,createdBy`; uniques por provider event/media+deposit y depósito/secuencia. `BookingDeposit.currentProofId` apunta a la evidencia vigente; rechazo/reenvío nunca sobrescribe pruebas anteriores. |
| `BotHandoff` | sesión, motivo/contexto tipado, estado `QUEUED|TAKEN|CANCELLED|RESOLVED`, ownerUserId, timestamps, resume policy; partial unique de handoff activo por sesión. |
| Configuración | en settings tenant-scoped: `timezone` IANA obligatoria, horizonte 30/máx.90, anticipación horas, límites cancelación/reprogramación, cortes 12:30/16:30, TTL borrador 24h, TTL/reenvío seña 2h. Agregar `Professional.botBookingPriority` default 100. Para cada servicio, `newBotDepositHoldMinutes Int?` + provenance (`SERVICE_OVERRIDE|BUSINESS_POLICY|DEFAULT_120`): usar 120 sólo si no hay política explícita del nuevo bot; **no** interpretar ni backfillear ciegamente el actual `Service.depositHoldMinutes @default(60)`. |

### Compatibilidad y migración

1. Migración aditiva de tablas/columnas nullable; no se reinterpreta `Conversation.bookingV2State`, `supportBotState`, `BookingDeposit.REJECTED` ni `depositHoldMinutes` legado.
2. Ejecutar **fuera de la migración automática de startup** un reporte de duplicados de `BusinessBotConfiguration ACTIVE` y de `BusinessWhatsAppConfig.phoneNumberId` conectado/no nulo. Remediar con dueño y auditoría, reejecutar validación en cero y recién entonces crear índices únicos parciales concurrentes: activo por `(businessId,channel)` y conectado por `phoneNumberId WHERE connectionStatus='CONNECTED' AND phoneNumberId IS NOT NULL`. Activación y reconexión fallan con reporte de conflicto, nunca reasignan silenciosamente.
3. Agregar y validar la FK compuesta de pertenencia deployment/configuration. Luego crear/backfillear pointers de **todos** los deployments legados por negocio/canal antes de que la admisión consulte el pointer autoritativamente; validar cobertura y generation inicial. Sólo después habilitar durable authoritative.
4. Mantener `Conversation` como hilo CRM y `Message` como historial visible, no como queue. `BotSession` referencia `Conversation`; outbox materializa un `Message OUTBOUND` al aceptar Meta y la admisión materializa `INBOUND` una vez.
5. `Appointment` sigue alimentando agenda, CRM y recordatorios. `BookingVisit` coordina la semántica nueva; etapa 1 tiene cardinalidad efectiva 1:1. Filas existentes pueden quedar sin `visitId`; backfill sólo cuando sea inequívoco.
6. `BookingDeposit.appointmentId` se conserva para lecturas legacy; nuevas escrituras completan también `visitId`. `BookingDepositProof` recibe sólo pruebas nuevas, sin sintetizar evidencia histórica inexistente.
7. No se migran borradores legacy ni se activan jobs/eventos shadow históricos. El preflight bloquea retenciones, señas, handoffs y trabajo in-flight; los demás se invalidan y una recovery nueva abre `MAIN_MENU`.
8. Las filas históricas `BookingDeposit.REJECTED` permanecen como estado legacy;
   no se reclasifican automáticamente como final o corregible. Sólo operaciones
   nuevas usan los estados inequívocos.

## 9. Límites transaccionales

### Transición normal

Una transacción bloquea `BotSession FOR UPDATE`, valida deployment/generation, owner humano, revisión y prompt; carga/valida choices tenant-scoped; ejecuta efectos puramente persistentes; incrementa revisión; cierra/crea prompts; inserta operación, transition log, outbox y jobs. El envío ocurre luego.

### Confirmación sin seña

Todo escritor de disponibilidad —bot nuevo, `AppointmentService`, CRM, web, bloqueos y procesos legacy— usa una jerarquía única: **(1) business agenda lock, (2) professional agenda locks por ID estable, (3) filas Visit/Appointment**. Bajo esos locks se revalidan dentro de la transacción horario del negocio/profesional, excepciones y `ScheduleBlock`, profesional activo y `acceptsBotBookings`, capacidades `ProfessionalService`, servicio/precio/duración/política de seña, anticipación y overlap. Para “cualquier profesional” se bloquean candidatos compatibles en orden y recién entonces se recalculan minutos/prioridad/ID. Crear `BookingVisit(CONFIRMED)` + `Appointment(CONFIRMED)` + items/snapshots + operación/log/outbox. Un conflicto no crea nada. Si no puede garantizarse que **todos** los writers adopten esta jerarquía, las confirmaciones automáticas permanecen deshabilitadas hasta instalar una exclusion constraint de rango que cubra estados bloqueantes; el advisory lock aislado no alcanza.

### Confirmación con seña

Mismo lock y revalidación; validar primero configuración completa de pago. En una sola transacción crear `BookingVisit(HELD)`, `Appointment(PENDING)`, items y `BookingDeposit(PENDING_PROOF)` con importe/fecha derivados de `dbNow`, job de expiración y outbox de instrucciones. **Turno y seña nacen atómicamente**. Si falta configuración, no se retiene y se deriva con alerta.

### Comprobante, vencimiento y revisión

- **Recepción:** descargar fuera de la transacción sólo después de validar tenant/estado; verificar tamaño, MIME, estructura y SHA-256. La transacción condiciona `PENDING_PROOF` o reenvío y plazo `> dbNow`, inserta un `BookingDepositProof` append-only, actualiza `currentProofId`, pone depósito `PROOF_RECEIVED`, visita `PENDING_PAYMENT_REVIEW`, anula wakeup de expiración y crea ACK/outbox. Provider event/media+deposit son idempotency keys; nunca se reemplazan bytes ni metadata de una prueba anterior.
- **Vencimiento:** job bloquea depósito/visita, exige estado y plazo vencido según DB; pone `EXPIRED`, cancela Appointment/visita y notifica. Si el comprobante ganó el lock, no vence.
- **Aprobación:** operación autorizada y única; `PROOF_RECEIVED→APPROVED`, `PENDING_PAYMENT_REVIEW→CONFIRMED`, `Appointment→CONFIRMED`, auditoría/outbox.
- **Rechazo corregible:** motivo obligatorio, nuevo plazo; conserva la prueba rechazada, pone depósito `REJECTED_RESUBMISSION_ALLOWED`, mantiene hold y agenda expiración. El siguiente archivo crea proof `RESUBMISSION` con nueva secuencia.
- **Rechazo final:** depósito `REJECTED_FINAL`, visita/Appointment cancelados y bloque liberado en el mismo commit.
- **Reenvío:** misma guarda atómica que recepción. Un comprobante tardío crea proof `LATE`, deriva y nunca cambia `currentProofId`, recrea Appointment ni recupera hold.

### Cancelación y reprogramación

- Cancelar `CONFIRMED` revalida anticipación/estado. Seña aprobada o proof en revisión deriva sin mutar. En espera inicial/reenvío, depósito, visita y Appointment se cierran juntos si no entró proof concurrente.
- Reprogramar usa la misma jerarquía business→professional→Appointment, bloquea la fila actual y revalida el bloque nuevo. Como etapa 1 conserva servicios y profesional, elige la representación de menor riesgo: **actualiza `startAt` en el mismo `Appointment`** e inserta en el mismo commit un `AppointmentChangeHistory(RESCHEDULE)` append-only con old/new y operation key. `BookingVisit`, `Appointment.id` y vínculos de `BookingDeposit` no cambian; existe un solo Appointment actual por Visit. En ese commit, recordatorios todavía no enviados actualizan `scheduledFor`/snapshot o se reemplazan idempotentemente; recordatorios ya enviados quedan históricos y se crea outbox de corrección. La integración calendario recibe después del commit un update idempotente del mismo event ID, con retry/poison; nunca delete+create. La seña y sus vencimientos se conservan sin extensión. Un fallo SQL conserva fecha, historial y recordatorios originales; un fallo externo deja el Appointment ya movido y el outbox durable pendiente, no ejecuta compensación destructiva.

## 10. Concurrencia, fencing e idempotencia

- Jerarquía única business agenda→professional(s) en orden→filas, mantenida hasta commit. Crear/cambiar `ScheduleBlock`, horas, capacidades o estado profesional adquiere business/professional lock correspondiente, o incrementa una versión de agenda/config que la confirmación compara dentro del lock. La corrección de etapa 1 depende de cobertura total de writers; ante cualquier excepción conocida se exige exclusion constraint antes de habilitar confirmación automática.
- Lock de fila de sesión + `revision`; jobs y workers portan `expectedRevision`, `deploymentGeneration` y `leaseToken`. Updates son condicionales; cero filas significa worker obsoleto.
- Hora SQL para ventanas, leases, TTL y límites. La zona IANA transforma reglas de calendario; instantes se persisten UTC.
- Ningún mapa, singleton o JSON de `Conversation` es fuente de verdad del motor nuevo.
- `ProviderEvent` deduplica ingreso; `BotOperation.operationKey` deduplica efectos; outbox deduplica intención de envío. Semántica interna: effectively-once mediante transacción e idempotencia.
- La llamada HTTP a Meta no ofrece atomicidad con PostgreSQL. Si hay timeout después de aceptar Meta, no se reintenta ciegamente: queda `SENDING/UNKNOWN`, se reconcilia por callback/provider ID si existe y luego pasa a retry manual/seguro. Esto minimiza duplicados; no se promete exactamente una entrega externa.

## 11. Entrega WhatsApp y outbox

El renderer valida antes de crear outbox:

- cuerpo interactivo ≤ 1024 caracteres Unicode;
- hasta 3 reply buttons, títulos ≤ 20;
- hasta 10 rows totales, row title ≤ 24, description ≤ 72;
- texto del botón de apertura ≤ 20 y título de sección ≤ 24;
- IDs ASCII ≤ 64 bytes por política interna.

No se truncan importes, unidades, “Desde” ni acciones ambiguamente. Si una descripción no cabe, se divide por párrafos/palabras y code points en uno o más mensajes informativos, seguidos por un interactivo breve. Cada `ViewModel` crea un `deliveryGroupId`; sólo declara dependencias semánticas explícitas (por ejemplo, todos los fragmentos requeridos `ACCEPTED` antes del interactivo). Una vista independiente de la misma sesión pertenece a otro grupo y no espera una cadena global. Si falla contenido requerido, no se envía una acción descontextualizada.

El sender reclama con token/lease y hace toda escritura condicional a ese token. Antes de iniciar I/O cambia `CLAIMED→SENDING`; el pre-send recheck de deployment/ownership reduce carreras pero **no garantiza silencio** por sí solo. Respuestas 429/5xx/network con certeza de no aceptación usan backoff exponencial con jitter y `Retry-After`; 4xx de payload/auth pasan a `POISON`. Un lease `SENDING` vencido pasa a `UNKNOWN`, nunca directamente a `RETRY`. **Parámetros resueltos (decisión 5):** timeout HTTP a Meta 10 s; máximo 5 reintentos con backoff 30 s → 1 m → 2 m → 4 m → 8 m (jitter, respeta `Retry-After`); agotados → `POISON` con alerta inmediata. Los items `UNKNOWN` quedan en cuarentena operativa visibles en el CRM con tres disposiciones auditadas: `ASSUME_SENT`, `SKIP` y `RESEND_ACCEPT_DUPLICATE_RISK`; alerta si un item permanece sin resolver más de 15 minutos. Responsable operativo inicial: propietario del proyecto.

Dentro de un delivery group, un dependiente sólo se reclama cuando sus predecesores alcanzan el estado requerido o una resolución auditada lo marca `SKIPPED`. `POISON`/`UNKNOWN` bloquean únicamente su subgrafo dependiente. Resolver poison permite `SKIP` (suprime dependientes incompatibles) o corregir payload/config y crear **un nuevo** outbox idempotente; no muta evidencia histórica.

`UNKNOWN` sin `providerMessageId` queda en cuarentena y no tiene auto-retry. Un operador autorizado debe registrar una resolución auditada: `ASSUME_SENT` (cierra sin reenviar), `SKIP` (cancela y resuelve dependencias según política) o `RESEND_ACCEPT_DUPLICATE_RISK` (crea nuevo outbox/idempotency key y deja explícito actor, motivo y riesgo). Un callback posterior puede correlacionar sólo si aporta un provider ID/clave inequívoca; los callbacks no correlacionables se persisten `UNMATCHED` para investigación.

Los callbacks `sent`, `delivered`, `read`, `failed` se admiten como `ProviderEvent`, buscan `BotOutbox.providerMessageId` dentro del tenant y aplican avance monotónico; eventos repetidos o fuera de orden no regresan estado. `deliveredAt` alimenta SLO. `Message` refleja el resultado para CRM, pero no gobierna reintentos.

## 12. Handoff, ownership, activación y rollback

`BotHandoff` es el ownership explícito. `QUEUED` permite sólo esperar/cancelar. `TAKE` no promete silencio con una mera escritura de owner: ejecuta el protocolo de quiescence descrito abajo. Los inbound se guardan para CRM sin respuesta. Resolver exige `HOME|RESUME`; resume revalida el estado pausado y los cambios manuales prevalecen.

### Protocolo de quiescence

Handoff TAKE opera por sesión; cutover/rollback por negocio/canal. Antes de habilitar routing nuevo, tanto el handler legacy como el nuevo registran cada procesamiento/envío en `BotDispatchClaim`; un legacy que no puede hacerlo bloquea activación. Ambos siguen la misma secuencia:

1. Bajo lock, poner fence `claimsPausedAt`/`ownership=PENDING_TAKE` e incrementar un `dispatchFenceEpoch` independiente. El pointer y su generation activa todavía no cambian. Desde ese commit ningún worker/sender puede reclamar nuevo `READY/PENDING`; updates de claims viejos siguen condicionados a token, generation y fence epoch.
2. Contabilizar `CLAIMED`, `SENDING` y `UNKNOWN` de inbox/jobs/outbox y `BotDispatchClaim` del scope, incluyendo motores legacy y nuevo. `READY/PENDING` se cancelan o quedan para recovery según operación.
3. Esperar un drain acotado de `CLAIMED`: el worker debe terminar antes del fence o fallar su commit por generation/ownership. Para `SENDING`, hay tres interleavings: (a) Meta no fue invocada: aborta seguro; (b) respuesta con provider ID llega: persiste `ACCEPTED` token-condicional y se drena; (c) request pudo llegar pero no hay respuesta: pasa `UNKNOWN`.
4. Si queda cualquier `UNKNOWN`, abortar TAKE/cutover/rollback y mantener el scope en pausa hasta resolución auditada. No se puede asegurar si Meta enviará ese mensaje. Tampoco se permite reanudar claims de otro owner/generation.
5. Sólo con cero `CLAIMED/SENDING/UNKNOWN` se confirma `HUMAN_TAKEN` o se cambia pointer/generation. Timeout de drain aborta sin transferencia. Auditoría registra conteos, duración y resultado.

Activación/rollback toman `pg_advisory_xact_lock` exclusivo para `bot-cutover:<businessId>:WHATSAPP`; la admisión toma `pg_advisory_xact_lock_shared` sobre la misma clave durante tenant/deployment admission y persiste `generation`. Bajo exclusión:

1. Preflight cuenta y lista borradores, acciones/jobs `READY/CLAIMED`, outbox `PENDING/CLAIMED/SENDING/UNKNOWN`, holds, señas pendientes/revisión/reenvío y handoffs queued/taken de motores legacy y nuevo.
2. Holds, flujos financieros y handoffs activos bloquean. Turnos confirmados sin proceso pendiente no.
3. Ejecutar quiescence hasta cero in-flight. Con cero bloqueos, una transacción actualiza pointer/generation, registra auditoría, invalida prompts y cierra sesiones no protegidas. La próxima entrada abre `MAIN_MENU`; no se manda proactivo fuera de ventana.
4. Una acción de generation anterior queda `STALE_CUTOVER` y **no se reprocesa** contra el nuevo estado. Se crea una operación recovery separada, idempotente y sin choice original, que abre `MAIN_MENU` con aviso bajo la generation nueva.
5. Rollback de routing ejecuta exactamente el mismo preflight/quiescence; no se confunde con kill switches. Los **capability switches** pueden detener claims de admisión autoritativa, workers, sender o confirmaciones para contener fallas, pero cambiar el motor activo siempre requiere el protocolo protegido. Los bots personalizados no cambian sin migración explícita.

## 13. Presupuesto de latencia y observabilidad

| Tramo | Objetivo / medición |
|---|---|
| `http_received → durable_admission_commit → ack` | p95 ≤ 200 ms. Incluye HMAC, parse mínimo, tenant y transacción. |
| `first_action → settle_closed` | 500 ms idle, máximo absoluto 1500 ms; se informa separado, no como procesamiento. |
| `settle_ready → transition_commit` | p95 ≤ 1 s, **incluye** espera de cola/claim/lock/contexto/commit y excluye settle previo y Meta. |
| `outbox_available → meta_accepted` | Incluye espera de cola, dependencias, claim y request; separar tiempo puro del proveedor. |
| `inbound_admitted → delivered_callback` | objetivo p95 ≤ 3 s; muestra incompleta si no llega callback, nunca sustituida por `accepted`. |

Cada evento propaga `traceId=ProviderEvent.id`, `businessId`, deployment/engine version, session ID hash, prompt/action type, revisión y operation key. Stages: `signature`, `pool_wait`, `parse`, `tenant`, `admission_lock`, `admission`, `ack`, `settle_wait`, `settle_ready`, `job_queue_wait`, `session_lock_wait`, `context_load`, `transition`, `agenda_lock_wait`, `tx_commit`, `outbox_available`, `dependency_wait`, `outbox_queue_wait`, `meta_request`, `sent_callback`, `delivered_callback`.

Métricas: tasa/latencia por stage; firma inválida; tenant desconocido; provider dedup; backlog/edad máxima; settle por selected/duplicate/conflict; stale/rejected; revision/fence conflict; transición por acción/outcome; agenda conflict; hold/deposit por estado; outbox retry/poison/unknown; delivery completa/incompleta; cutover bloqueado. Segmentación por negocio y versión con cardinalidad controlada, sin teléfono, nombre, cuerpo, labels ni IDs de entidad en labels. Logs estructurados redaccionan PII y secretos.

**Umbrales operativos resueltos (decisión 7):** pool Prisma sube a 10 conexiones con capacidad reservada para admisión (los workers no pueden agotarlo) y `statement_timeout` de 5 s en la transacción de admisión. Alertas: job más viejo esperando > 60 s (aviso) / > 5 min (crítico); p95 interno queue-inclusive > 1,5 s sostenido 10 min (aviso); entrega al cliente p95 > 3 s sostenido 10 min (aviso) / > 6 s (crítico); handoff en cola > 30 min (alerta CRM configurable por negocio); firmas inválidas > 5/min desde la misma fuente (alerta seguridad). Siempre inmediatas: cualquier `POISON`, cualquier `UNKNOWN` sin resolver > 15 min, cualquier cutover o rollback bloqueado.

## 14. Seguridad y privacidad

- HMAC del body crudo con el app secret **del negocio** (resuelto por `phone_number_id` extraído sin confiar) y comparación constante; exigido siempre en el motor nuevo, no en el legado hasta su migración; el verify token GET no autentica POST.
- Tenant por `phone_number_id`; toda query de entidad incluye `businessId` o atraviesa una relación tenant-scoped. Tokens de otro negocio/sesión son rechazo de seguridad, no “stale” normal.
- Credenciales de WhatsApp nunca se guardan en outbox/log. Se resuelven al enviar y deberían cifrarse en reposo mediante el mecanismo de secretos del despliegue.
- Comprobantes WhatsApp: metadata primero, máximo 3 MiB antes y después de descargar, sólo JPEG/PNG/WebP/PDF, MIME permitido **y** magic bytes, hash SHA-256, filename saneado y media vinculado al tenant/deposit esperado. No alcanza extensión ni MIME declarado.
- La política de privacidad es precondición de habilitación, no hardening: roles mínimos para ver/descargar, auditoría de accesos, cifrado, retención, purge de blobs/metadata, tratamiento de casos en revisión/legal hold, restauración y plazo real de desaparición de backups deben estar aprobados y probados antes del primer proof productivo. El purge elimina cada `BookingDepositProof` elegible sin romper el historial financiero mínimo.
- No se promete detectar todo polyglot con una sola firma. JPEG/PNG/WebP se decodifican y re-encodean siempre con una librería mantenida, descartando metadata; se registra hash del original recibido y del derivado almacenado, y el original no validado no se conserva. Si el decoder no soporta el formato, se rechaza; no se implementa un parser casero. PDF exige `%PDF-`, MIME consistente, límites, parseo estructural básico y rechazo/cuarentena de cifrado, adjuntos, JavaScript/acciones, formularios o contenido activo; se sirve como attachment sin ejecución/render server-side. Antivirus/sandbox externo mejora cobertura pero agrega costo, egress y exposición a tercero; resuelto en la sección 18: etapa 1 no lo contrata y la política A queda habilitada.
- Limitar body/evento, choices por prompt, tasa por remitente/tenant y tiempo de descarga. Rechazar URLs o media no esperada sin interpretar.
- Minimización: tokens opacos, snapshots sólo necesarios, payload raw cifrado o redaccionado con retención corta, comprobantes con control de acceso y política de borrado. No poner PII en métricas, operation keys o errores del proveedor.
- **Retención y backup resueltos (decisión 6):** comprobantes 12 meses (sección 18); payload crudo de `ProviderEvent` purgado a los 30 días conservando la fila para deduplicación; `BotTransitionLog` sin PII 12 meses; auditoría de seña/handoff/cutover dura lo que viva el negocio (cascada al eliminarlo). Backups diarios con retención 30 días; objetivos **RPO ≤ 24 h** y **RTO ≤ 4 h** con procedimiento escrito; un drill de restauración es obligatorio antes del piloto. Si la infraestructura ofrece PITR/WAL, se registra el RPO real alcanzable en el runbook.
- Auditoría de revisión de seña, handoff y cutover incluye actor y negocio. Acceso CRM usa autorización tenant existente.

## 15. Fallos y recuperación

| Falla | Resultado seguro | Recuperación |
|---|---|---|
| Firma inválida | No persistir ni responder automáticamente | 401/403; alerta por tasa. |
| Firma válida, tenant desconocido | No crear conversación ni acción | Persistir `UNMATCHED` redaccionado, responder 200 y alertar; evita retries inútiles de Meta. |
| DB caída antes del ACK | Evento no aceptado | 5xx; retry de Meta y unique provider key. |
| Retry/duplicado Meta | Sin doble inbox/efecto | `ON CONFLICT`, devolver 200. |
| Caída durante settle | Acciones quedan admitidas | Escaneo de wakeups/prompts vencidos. |
| Click durante `STABILIZING` antes de `absoluteAt` | Se incluye en el mismo conjunto | Admisión bajo prompt lock mueve `settleAt`; sólo reconciliación cierra. |
| Dos workers | Uno gana lease/lock/revisión | El otro falla fencing y reprograma/termina. |
| Prompt vencido o entidad cambió | Estado funcional no muta | Marcar stale/recovery y render vigente. |
| Dos choices rápidas | Ninguna se supone correcta | Prompt único de conflicto. |
| Horario ocupado | No crea hold/turno | Guardar outcome y render alternativas frescas. |
| Caída después de commit funcional | Estado correcto, mensaje pendiente | Outbox durable reintenta. |
| Lease `SENDING` vence / timeout incierto Meta | Evitar duplicado ciego | `UNKNOWN` en cuarentena, sin auto-retry; `ASSUME_SENT`, `SKIP` o `RESEND_ACCEPT_DUPLICATE_RISK` auditado. |
| 429/5xx Meta | Estado funcional no se revierte | Backoff/jitter; alerta por edad. |
| 4xx payload/auth | No loop infinito | `POISON`, bloquear dependientes y alertar. |
| Callback duplicado/fuera de orden | No regresión de delivery | Update monotónico e idempotente. |
| Callback sin outbox correlacionable | No inventar asociación tenant | Persistir `UNMATCHED`, alertar/investigar. |
| Proof concurrente con expiración/cancelación | Sólo un estado gana | Lock + update condicional con dbNow; tardío se conserva sin rehold. |
| Caída en reprogramación | Appointment conserva fecha vieja o queda movido una vez con historial | Update in-place + history/recordatorios SQL en una transacción; efectos externos por outbox. |
| TAKE/cutover contra claim o provider call | No prometer silencio prematuro | Pausar claims, drenar; abortar ante timeout o `UNKNOWN`; completar sólo en cero. |
| Acción de generation anterior | Choice vieja nunca entra al estado nuevo | `STALE_CUTOVER` + recovery nueva idempotente a `MAIN_MENU`. |
| `phoneNumberId` conectado duplicado | No resolver tenant ambiguo | Activación/reconexión falla; reporte/remediación e índice parcial. |
| Writer de agenda sin jerarquía común | Advisory lock no protege el slot | Mantener confirmación automática apagada hasta corregir writer o instalar exclusion constraint. |
| Cutover con estado protegido | Sin cambio parcial | Preflight aborta bajo lock y reporta casos. |
| Estado/schema desconocido | No interpretación parcial | Pausar, alertar y handoff. |

## 16. Estrategia de pruebas

1. **Unitarias puras:** tablas exhaustivas `estado × acción × contexto`, guardas, conservación/invalidación, back explícito, tres inválidos, conflictos, expiraciones, asignación por carga/prioridad/ID y nombres Unicode que aceptan letras/marcas, espacios, apóstrofes, guiones **y puntos**, y rechazan número/emoji/URL/control. Todo input no soportado sigue tipado y recuperable.
2. **Contratos de renderer:** snapshots/fixtures para botones/listas, 1024/3/10/20/24/72, IDs ≤64, paginación estable, split Unicode y dependencia del interactivo final. Nada se trunca ambiguamente.
3. **Integración con PostgreSQL real:** constraints/FK compuesta/índices parciales, `OPEN|STABILIZING`, `SKIP LOCKED`, dbNow, revisión/generation, provider dedup, delivery groups, agenda hierarchy, pruebas append-only, dos confirmaciones del mismo slot y reprogramación in-place + historial. Los mocks actuales no prueban locks reales.
4. **Crash/restart:** matar worker antes/después de claim, transición, commit y llamada Meta; verificar que `SENDING` vencido va a `UNKNOWN`, nunca retry directo, y probar las tres resoluciones auditadas.
5. **Adaptador Meta:** raw-body HMAC válida/inválida, payloads múltiples, interactive IDs, media, statuses repetidos/desordenados, 429/5xx/4xx/timeouts y tenant incorrecto.
6. **E2E de dominio:** recorridos canónicos sin/con seña, rechazo/reenvío, tardío, cancelación, reprogramación, handoff y stale.
7. **Cutover/handoff:** interleavings TAKE/cutover con `CLAIMED/SENDING/UNKNOWN`, drain/abort, `STALE_CUTOVER` sin choice replay, recuperación nueva y separación kill switch/routing.
8. **Carga/latencia:** saturar el pool actual de 3 y el plan de pool reservado/aislado, timeouts fail-closed, bursts por prompt; medir `settle_ready→commit`, `outbox_available→accepted`, ACK e inbound→delivered con queue waits.

Se agregan scripts focalizados siguiendo el harness `tsx`/`node:assert` existente y fixtures PostgreSQL aisladas. **No se ejecutó build ni pruebas para producir este documento**, porque el trabajo es exclusivamente de diseño.

## 17. Plan de implementación y milestones rollback-safe

1. **Fundación aditiva:** tablas/columnas nullable para deployment, sesión, inbox/job, delivery groups/outbox, visit, proof append-only e historial de reprogramación; capability switches apagados. Sin routing.
2. **Higiene de identidad/deployment:** reportar duplicados activos y `phoneNumberId`, remediar/auditar, validar cero, crear índices parciales concurrentes y FK compuesta. Esto es operación controlada, no migración ciega de startup.
3. **Pointers antes de autoridad:** crear y validar pointers legacy completos; ningún webhook nuevo depende del pointer hasta probar cobertura. Rollback mantiene runtime legacy.
4. **Ingreso seguro shadow:** firma/statuses y copia `SHADOW_NON_EXECUTABLE` fail-open, sin jobs ni SLO de ACK nuevo. Filas shadow nunca se activan. Medir capacidad/pool.
5. **Ingreso autoritativo + workers en negocio de prueba:** pool/reserva y timeouts validados; fail-closed durable, `OPEN|STABILIZING`, crash recovery, delivery groups y UNKNOWN manual. Capability switches permiten contener sin cambiar routing.
6. **Core navegacional:** menú, catálogo, identidad —incluidos puntos en nombres y unsupported inputs—, carrito de un profesional y disponibilidad; tablas puras completas.
7. **Agenda segura:** inventariar/migrar todos los writers a business→professional locks y revalidación interna; si no hay cobertura total, instalar exclusion constraint. Recién después habilitar confirmaciones automáticas.
8. **Reservas/gestión:** visit+Appointment 1:1, confirmación/cancelación atómica y reprogramación in-place con `AppointmentChangeHistory`, recordatorios e integración calendario.
9. **Privacidad y señas:** aprobar retención/acceso/purge/backups y política malware/PDF antes de almacenar; luego proof append-only, creación atómica, expiración, revisión/reenvío/tardío y CRM.
10. **Quiescence:** envolver primero procesamiento/envío legacy y nuevo con `BotDispatchClaim`; luego ensayar TAKE/cutover/rollback con drain de `CLAIMED/SENDING`, bloqueo por `UNKNOWN`, `STALE_CUTOVER` y recovery nueva. Sin cobertura de un writer legacy no se habilita routing. Routing nunca se cambia con un kill switch.
11. **Piloto exclusivo:** corte limpio, cero in-flight/protegidos/UNKNOWN, monitoreo de queue-inclusive SLO/poison/duplicados. Rollback usa idéntico preflight/quiescence; nunca dual-response.
12. **Endurecimiento:** optimizar índices/pool con `EXPLAIN` y métricas, ejecutar purges y restore tests. Legacy permanece para negocios no migrados.

Cada milestone es desplegable con migraciones compatibles hacia atrás. Ninguno elimina columnas o caminos legacy antes de demostrar rollback y vaciar estados protegidos.

## 18. Decisiones para resolver con el usuario

Antes de habilitar recepción productiva de comprobantes deben resolverse estas decisiones reales, porque afectan privacidad, costo y riesgo; no bloquean el resto del motor:

1. **Retención y backups — RESUELTA:** los bytes del comprobante se conservan mientras la reserva esté activa y se purgan **12 meses después de la fecha del turno** (para rechazados/tardíos, 12 meses desde su recepción). El purge elimina sólo bytes; permanecen hash SHA-256, estado, timestamps y auditoría como trazabilidad financiera. Acceso de descarga limitado a roles CRM autorizados con auditoría; sin legal hold en etapa 1. El volumen esperado (≤3 MiB por intento, append-only) es aceptable en PostgreSQL/backups; object storage con lifecycle queda diferido a etapa 2 si las métricas lo justifican. Los backups previos conservan copias hasta su rotación natural: plazo aceptado.
2. **Malware/PDF — RESUELTA:** se habilitan imágenes y PDF desde el piloto con la política ya definida: decode/re-encode de imágenes con hash del original y del derivado; PDF con `%PDF-`, parseo estructural básico, cuarentena de cifrado/adjuntos/JavaScript/formularios y entrega sólo como attachment sin render server-side. Se acepta el riesgo residual sin antivirus externo en etapa 1; un scanner/sandbox puede reevaluarse después si el volumen o incidentes lo justifican.

### Supuestos explícitos de diseño

- PostgreSQL seguirá siendo la única cola de etapa 1; workers corren con el monolito. La admisión tendrá capacidad reservada/aislada y concurrencia acotada antes del piloto.
- El backend será único TypeScript/Node: no se promete detección polyglot universal ni se agrega un servicio de parsing propio. Usa librerías mantenidas para decode/parse y rechaza o cuarentena lo no soportado.
- El plazo de retención de seña del motor nuevo es una configuración única por negocio con fallback explícito de 120 minutos (decisión 8); el campo por servicio heredado (`Service.depositHoldMinutes`, default 60) no se lee ni migra.
- El nuevo motor se activa primero en un negocio de prueba y luego en un único piloto mediante corte exclusivo, nunca con dos motores respondiendo.
- Etapa 1 crea exactamente un Appointment por BookingVisit y un profesional para todo el carrito, aunque el modelo deje una relación preparada para una evolución posterior.
- La timezone IANA debe quedar configurada antes de habilitar reservas automáticas; si falta o es inválida, el preflight bloquea la activación de esas capacidades.

# Plan de implementación — nuevo bot determinístico por opciones

## Propósito, alcance y orden

Este checklist traduce `alcance-etapa-1.md`, `reglas-funcionales.md`, `maquina-de-estados.md` y `diseno-tecnico.md` a incrementos desplegables y reversibles. **F0–F11 son etapa 1**. F12 es backlog posterior y no integra su Definition of Done. El orden se corrigió para definir contratos de dominio antes de resolver acciones o integrar transiciones.

No habrá una migración gigante: cada migración es aditiva y compatible hacia atrás. Los cambios destructivos, optimizaciones y backfills no esenciales quedan fuera de etapa 1.

### Marcas

- **[PG]** PostgreSQL real; **[META]** sandbox/proveedor controlado; **[CRM]** API/UI CRM.
- **[MIG]** migración/backfill; **[OBS]** métricas/trazas/alertas; **[RUNBOOK]** procedimiento operativo.

Convención de rutas en las tablas: basenames de dominio (`actions.ts`, `state.ts`, `prompts.ts`, `transition.ts`, `effects.ts`, `views.ts`) pertenecen a `src/bot-options/domain/`; casos de uso a `src/bot-options/application/`; adaptadores `prisma-*`, worker, renderer, media y sender a `src/bot-options/infrastructure/`; servicios/rutas legacy citados por basename pertenecen a `src/services/` o `src/routes/` según corresponda.

> La revisión que originó este plan fue únicamente documental. La ejecución y aceptación posteriores de F8–F10 se registran en sus checkpoints específicos.

---

## F0 — Baseline y preflight técnico

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F0.1 **[OBS]** | Medir el webhook legado antes de cambiar routing. | `src/routes/whatsapp-webhook.ts`; `src/services/whatsapp-webhook-service.ts`; `scripts/whatsapp-greeting-latency-diagnostic-test.ts` | — | Baseline separa recepción, DB, trabajo síncrono, ACK y errores por negocio, sin PII. | Captura controlada de p50/p95/p99 y tasa de error. |
| F0.2 | Inventariar todos los escritores de agenda y configuración reservable. | `prisma/schema.prisma`; `src/services/appointment-service.ts`; servicios/rutas de `ScheduleBlock`, horarios, `ProfessionalService`, `Service` y capacidades | — | Matriz identifica locks y mutaciones de turnos, bloqueos, horas, capacidades, servicios, duración y reservas por bot; ningún escritor que altere disponibilidad queda fuera. | Revisión estática de imports, rutas y consultas de escritura. |
| F0.3 **[PG] [RUNBOOK]** | Preparar fixtures aisladas para concurrencia real. | `scripts/bot-options-pg-test-support.ts` (nuevo); `.env.example`; `docs/nuevo-bot/runbook-pruebas.md` (nuevo) | F0.2 | Cada corrida usa tenant, teléfono, agenda y timezone propios y aborta contra producción. | Conexión, aislamiento y cleanup en PG real. |
| F0.4 **[META] [RUNBOOK]** | Preparar Meta sandbox/proveedor controlado. | `.env.example`; `docs/nuevo-bot/runbook-meta-sandbox.md` (nuevo) | — | Secretos fuera de repo/logs; destinatarios limitados; callbacks `statuses` disponibles. | Firma y envío manual sin activar runtime nuevo. |
| F0.5 **[OBS]** | Definir métricas de etapas y latencias end-to-end. | `src/bot-options/observability/metrics.ts` (nuevo); `docs/nuevo-bot/observabilidad.md` (nuevo) | F0.1 | Incluye ACK, settle, espera de job **desde admisión**, lock, transición, outbox, Meta y delivered; reporta tanto tiempo de ejecución como latencia **incluyendo cola**. | Contratos de timestamps, labels y muestras incompletas. |
| F0.6 **[RUNBOOK]** | Separar controles de shadow, procesamiento, capacidades y routing. | `src/config/bot-options.ts` (nuevo); `.env.example`; `docs/nuevo-bot/runbook-operacion.md` (nuevo) | F0.2 | Flags distintos para shadow, workers y sender; kill switches por capacidad (reservar, señas, gestión, handoff) no cambian deployment; rollback de routing sólo usa pointer/preflight. | Matriz de flags/defaults y combinaciones inválidas. |
| F0.7 **[PG] [OBS]** | Aislar capacidad de conexiones del ingress. | `src/db.ts` o provider de Prisma/`pg`; `src/config/bot-options.ts`; runbook | F0.1 | Admisión tiene presupuesto/pool o reserva de conexiones separado de workers/outbox; saturar workers no impide ACK; capacidad total respeta límite DB. | Carga con pool de workers saturado y admisión concurrente. |

### Definition of Done F0

- [ ] Baseline, inventario de escritores y fixtures existen antes de migrar.
- [ ] Ingress, capacidades y routing tienen controles separados y rollback explícito.
- [ ] El presupuesto de conexiones y las métricas queue-inclusive están definidos.

---

## F1 — Esquema aditivo, remediación y pointer inicial

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F1.1 **[MIG] [PG]** | Agregar deployment pointer y auditoría tenant-safe. | `prisma/schema.prisma`; `prisma/migrations/<ts>_add_bot_channel_deployments/migration.sql` | F0.2 | `UNIQUE(businessId,channel)`; generation; relación compuesta garantiza que `activeConfigurationId` pertenece al mismo `businessId`; auditoría registra anterior/nuevo/actor/preflight. | FK cross-tenant rechazada y carrera de pointers. |
| F1.2 **[MIG] [PG]** | Agregar sesiones, prompts y choices con lifecycle coherente. | `prisma/schema.prisma`; migración `..._add_bot_sessions_prompts` | F1.1 | Revisión/fence/timezone; prompt admite replies en `OPEN` **o `STABILIZING`** hasta cierre; únicos parciales impiden dos prompts funcionales vigentes. | Primer click y clicks rápidos posteriores admitidos bajo lock. |
| F1.3 **[MIG] [PG]** | Agregar ProviderEvent, inbox, jobs y leases. | `prisma/schema.prisma`; migración `..._add_bot_event_inbox_jobs` | F1.2 | Dedup de provider key; inbox único; jobs con tiempo SQL, lease, fencing, intentos y poison. | `ON CONFLICT`, `SKIP LOCKED` y lease vencido reales. |
| F1.4 **[MIG] [PG]** | Agregar outbox con grupos de dependencia y cuarentena. | `prisma/schema.prisma`; migración `..._add_bot_outbox_operations` | F1.3 | Outbox guarda `dependencyGroup/key`, secuencia dentro del grupo, `SENDING/UNKNOWN`, dispatch epoch/lease; una conversación no forma una cadena global. | Grupos independientes avanzan; dependientes esperan sólo a su grupo. |
| F1.5 **[MIG] [PG]** | Agregar `BookingVisit` y relación 1:1 efectiva de etapa 1. | `prisma/schema.prisma`; migración `..._add_booking_visit` | F1.1 | Visit soporta estados canónicos; `Appointment.visitId` nullable para legacy; un segmento activo por Visit de etapa 1. | Compatibilidad con agenda/CRM legacy. |
| F1.6 **[MIG] [PG]** | Ampliar seña y modelar proofs append-only. | `prisma/schema.prisma`; migración `..._extend_booking_deposit_and_proofs` | F1.5 | `BookingDepositProof` append-only conserva cada intento, rechazado, reenvío y tardío con hash/tamaño/MIME/timestamps; `BookingDeposit` apunta al proof vigente sin sobrescribir evidencia; `REJECTED` legacy permanece. | Dos reenvíos y tardío conservan historial completo. |
| F1.7 **[MIG] [PG]** | Agregar handoff y gate durable de dispatch. | `prisma/schema.prisma`; migración `..._add_bot_handoffs_dispatch_gate` | F1.2, F1.4 | Un handoff activo por sesión; ownership fence, gate abierto/cerrado e in-flight dispatches son persistentes. | Carreras request/take/cancel y gate/in-flight. |
| F1.8 **[MIG] [CRM]** | Persistir configuración y procedencia de TTL. | `prisma/schema.prisma`; rutas de negocio/profesional; migración `..._add_bot_options_settings` | F1.1 | Timezone IANA; horizonte 30/máx.90; anticipación entera; límites 1h; cortes; draft 24h; **default nuevo de seña/reenvío 120 min con fuente (`SERVICE|BUSINESS|DEFAULT`)**; no reescribe valores legacy de 60 min; prioridad profesional 100. | Defaults/provenance, timezone y legacy 60 intacto. |
| F1.9 **[MIG] [PG]** | Remediar duplicados antes de imponer unicidad activa. | script `scripts/remediate-active-bot-and-phone-duplicates.ts` (nuevo); runbook de migración | F1.1 | Dry-run lista `phoneNumberId` conectados duplicados y configuraciones activas duplicadas; no elige ganador automáticamente; conflictos se resuelven/auditan antes del índice. | Fixtures con cero, uno y varios conflictos; rerun idempotente. |
| F1.10 **[MIG] [PG]** | Crear índices únicos sin bloqueo prolongado. | migración SQL separada `..._enforce_connected_phone_and_active_bot_uniqueness` | F1.9 | Tras validar cero duplicados se ejecuta `CREATE UNIQUE INDEX CONCURRENTLY` para `phoneNumberId` conectado/no nulo y activo legado por negocio/canal; se comprueban `indisready/indisvalid`; un índice inválido se elimina/reintenta explícitamente y nunca se asume activo. | Inserciones concurrentes y recuperación de índice concurrente inválido. |
| F1.11 **[MIG] [PG]** | Crear y poblar pointers legacy antes de admisión autoritativa. | `scripts/backfill-bot-channel-deployments.ts` (nuevo); `docs/nuevo-bot/runbook-migraciones.md` | F1.1, F1.10 | Dry-run obligatorio; backfill idempotente e inequívoco; bots personalizados y estados conversacionales no se migran; conflicto aborta/reportando. | Dry-run/rerun y routing legacy por pointer en todos los canales objetivo. |
| F1.12 **[MIG] [PG]** | Agregar historial de reprogramación in-place. | `prisma/schema.prisma`; migración `..._add_appointment_change_history` | F1.5 | `AppointmentChangeHistory` append-only guarda before/after, actor, operation key y timestamp; no se agrega una vía alternativa de replacement. | Un operation key produce una sola entrada. |
| F1.13 **[MIG] [RUNBOOK]** | Documentar secuencia rollback-safe de migraciones. | `docs/nuevo-bot/runbook-migraciones.md` | F1.1–F1.12 | Tablas/columnas → remediación → índices concurrentes → backfill pointer → consumidores; rollback no borra datos nuevos. | Ensayo lógico sobre copia aislada y handler legacy. |

### Definition of Done F1

- [ ] `phoneNumberId`, active configuration y deployment son tenant-safe y no ambiguos.
- [ ] El pointer legacy está poblado y verificado **antes** de cualquier admisión autoritativa.
- [ ] Proofs e historial de reprogramación son append-only; no se reescribe legado.

---

## F2 — Ingreso seguro en shadow no ejecutable

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F2.1 | Capturar raw body con límite. | `src/server.ts`; `src/plugins/whatsapp-raw-body.ts` (nuevo); `src/routes/whatsapp-webhook.ts` | F0.6, F0.7 | Bytes exactos disponibles para HMAC; exceso se rechaza antes de persistir. | HTTP con bytes distintos y body excesivo. |
| F2.2 | Validar `X-Hub-Signature-256`. | `src/bot-options/infrastructure/meta-webhook-adapter.ts` (nuevo); ruta webhook; `prisma/schema.prisma` (`BusinessWhatsAppConfig.appSecret` nuevo); alta/onboarding de WhatsApp | F2.1 | `sha256=<hex>`, HMAC-SHA256 y `timingSafeEqual`; secreto **por negocio** resuelto por `phone_number_id` extraído sin confiar (decisión D); exigido siempre en el motor nuevo, legado sin cambios; rotación por negocio con ventana transitoria de doble secreto; inválida no persiste. | Válida, ausente, malformada, longitud/secreto incorrectos; secreto faltante en config bloquea admisión del motor nuevo; cross-tenant no verifica. |
| F2.3 | Parsear mensajes y `statuses`. | `meta-webhook-adapter.ts`; `src/integrations/whatsapp-cloud-api.ts` | F2.2 | Subeventos desconocidos no rompen batch; unsupported input queda tipado; status conserva claves de correlación disponibles. | Batches mixtos, repetidos y fuera de orden. |
| F2.4 **[PG]** | Resolver tenant por `phone_number_id` único conectado. | `src/bot-options/infrastructure/prisma-admission.ts` (nuevo) | F1.1, F1.10, F2.3 | Lookup único y conectado; relación active configuration pertenece al tenant; `from`/display phone no deciden tenant. | Cross-tenant, desconectado y desconocido. |
| F2.5 **[PG]** | Admitir shadow como `ProviderEvent` solamente. | `src/bot-options/application/admit-provider-events.ts` (nuevo); `prisma-admission.ts`; ruta webhook | F1.3, F2.4 | Shadow es **fail-open respecto del legado**, no crea inbox/wakeup/session, no ejecuta acciones ni envía Meta; su fallo no cambia ACK/resultado legado y **no se usa para afirmar SLO de ACK autoritativo**. | DB shadow caída/timeout mientras legado conserva conducta. |
| F2.6 **[OBS]** | Medir shadow sin confundirlo con admisión autoritativa. | `metrics.ts`; ruta webhook | F2.5 | Métricas `shadow_*` separadas; registran dedup/tenant/costo y omiten cualquier claim p95≤200 ms de modo autoritativo. | Labels y dashboards separan ambos modos. |
| F2.7 **[META]** | Validar shadow no ejecutable. | `scripts/bot-options-meta-admission-test.ts` (nuevo) | F2.5–F2.6 | Retry crea un ProviderEvent; sólo legado responde; no existen inbox, wakeup, prompt ni outbox nuevos. | Payload firmado y callbacks sandbox. |

### Definition of Done F2

- [ ] HMAC/tenant/dedup funcionan en shadow fail-open sin ejecutar el runtime nuevo.
- [ ] Shadow no altera ACK legado ni se presenta como evidencia del SLO autoritativo.

---

## F3 — Contratos puros de acciones, estado, prompts y rendering

> Los IDs F3.x/F4.x se reordenan deliberadamente frente a la versión anterior: esta corrección P0 evita integrar workers contra contratos todavía inexistentes.

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F3.1 | Definir acciones y envelope admitido. | `src/bot-options/domain/actions.ts` (nuevo) | F1.2 | Versiona engine/deployment/session/prompt/choice/revision; labels/posición nunca identifican decisión. | Parseo y rechazos cross-context. |
| F3.2 | Modelar regiones e invariantes de estado. | `src/bot-options/domain/state.ts` (nuevo) | F3.1 | Flujo, reserva, seña y handoff separados; schema desconocido pausa/deriva; draft 24h. | Estados válidos/inválidos y schema version. |
| F3.3 | Definir lifecycle de prompt y admisión. | `src/bot-options/domain/prompts.ts` (nuevo); `views.ts` | F3.1 | Choices del prompt se admiten en `OPEN|STABILIZING` hasta `settleAt/absoluteAt` o cierre; nueva pantalla invalida incompatibles. | Primera/segunda pulsación y cierres concurrentes. |
| F3.4 | Implementar transición pura y efectos. | `transition.ts`; `effects.ts`; `views.ts` (nuevos) | F3.2–F3.3 | Core sin Prisma/Fastify/Meta/reloj; guardas recuperan sin mutar; tabla canónica completa. | Estado×acción×contexto, conservación e invalidación. |
| F3.5 | Definir recuperación `STALE_CUTOVER`. | `actions.ts`; `transition.ts`; `views.ts` | F3.4 | Evento/action con generation anterior **no se reprocesa contra el deployment nuevo**; se marca `STALE_CUTOVER` y agenda reconstrucción/`MAIN_MENU` del deployment vigente sin revivir acción vieja. | Click legacy antes/durante/después del corte. |
| F3.6 | Implementar navegación/back e inválidos. | `transition.ts`; `views.ts` | F3.4 | Back explícito; 1.º reconstruye, 2.º destaca handoff, 3.º deriva; holds/señas bloquean navegación genérica. | Matrices canónicas. |
| F3.7 | Modelar tokens/prompts opacos. | `views.ts`; `src/bot-options/infrastructure/whatsapp-renderer.ts` (nuevo) | F3.3 | `b1.<prompt>.<choice>`, sin PII, ASCII≤64; sólo interactivo final abre prompt. | Formato, colisión controlada y lookup tenant-scoped. |
| F3.8 | Validar límites y split Unicode. | `whatsapp-renderer.ts`; `src/integrations/whatsapp-cloud-api.ts` | F3.7 | 1024/3/10/20/24/72 antes de Meta; split por párrafos/palabras/code points sin cortar Unicode, importes o unidades. | Límites exactos/+1 y alfabetos diversos. |

### Definition of Done F3

- [ ] Acciones, estado, prompt `OPEN|STABILIZING`, stale cutover y vistas son contratos probados antes del worker.
- [ ] Renderer y tokens cumplen límites sin depender del proveedor.

---

## F4 — Admisión autoritativa, worker, estabilización y dispatch seguro

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F4.1 **[PG]** | Habilitar admisión autoritativa fail-closed por pointer. | `admit-provider-events.ts`; `prisma-admission.ts`; ruta webhook | F1.3, F1.11, F3.1, F3.3 | Selector exclusivo resuelve pointer/generation; TX crea ProviderEvent+inbox+wakeup; DB no confirma→5xx; ACK sólo post-commit; p95≤200 ms medido aquí. | Retry, rollback y carga con pool aislado. |
| F4.2 **[PG]** | Implementar worker con leases/fencing. | `src/bot-options/infrastructure/postgres-worker.ts` (nuevo); `src/server.ts` | F4.1 | `SKIP LOCKED`, hora SQL, lease token y recuperación; timers sólo optimizan. | Dos workers y lease vencido. |
| F4.3 **[PG]** | Reconciliar 500/1500 admitiendo `OPEN|STABILIZING`. | `src/bot-options/application/reconcile-actions.ts` (nuevo); `prisma-prompts.ts` (nuevo) | F3.3, F4.2 | Cada click válido persiste bajo lock; idle 500/máx.1500; duplicados seleccionan una vez; choices distintas generan conflicto sin aplicar ninguna. | Bordes temporales y clicks durante `STABILIZING`. |
| F4.4 **[PG]** | Integrar transición con sesión/revisión. | `process-session-job.ts` (nuevo); `prisma-session-runtime.ts` (nuevo) | F3.4–F3.6, F4.3 | Lock valida generation/ownership/revision/lease; estado, prompts, log, operación, outbox y jobs commitean juntos; generation vieja produce `STALE_CUTOVER`, no reprocessing. | Dos workers, revision/fence y cutover stale. |
| F4.5 **[PG]** | Implementar grupos ordenados de entrega. | `whatsapp-outbox-sender.ts` (nuevo); `prisma-session-runtime.ts` | F1.4, F4.4 | Descripción→interactivo comparte grupo/secuencia; grupos sin dependencia de la misma sesión avanzan independientemente; poison bloquea sólo descendientes del grupo; sender real permanece deshabilitado hasta F4.8. | Varios grupos/senders y fragmento fallido con provider falso. |
| F4.6 **[PG]** | Resolver incertidumbre de envío. | `whatsapp-outbox-sender.ts`; `meta-webhook-adapter.ts` | F4.5 | Timeout con posible aceptación→`UNKNOWN`; si no hay provider ID se aísla en cuarentena y **no se reintenta automáticamente**; `SENDING` con lease/edad vencida pasa a `UNKNOWN`; callbacks avanzan monotónicamente; se prueba con provider falso antes de habilitar Meta. | Timeout antes/después de ID, restart en SENDING y callback tardío simulados. |
| F4.7 **[PG]** | Implementar quiescence de dispatch para ownership/cutover. | `whatsapp-outbox-sender.ts`; `prisma-handoff.ts`; `prisma-activation.ts` (nuevo) | F1.7, F4.6 | Sender adquiere permiso durable inmediatamente antes de Meta y lo libera al persistir resultado; handoff/cutover cierran gate y esperan in-flight=0; `UNKNOWN` sin resolver bloquea finalización; fence se revalida bajo el mismo protocolo, no con precheck vulnerable. | Take/cutover cuando sender está antes/durante/después del request. |
| F4.8 **[PG]** | Establecer mínimo de ownership y routing antes del primer envío nuevo. | `process-session-job.ts`; `whatsapp-outbox-sender.ts`; `prisma-handoff.ts`; `prisma-activation.ts` | F4.7 | Pointer/generation, selector exclusivo, ownership fence y dispatch gate son obligatorios para claim y envío; sin ellos el sender suprime y alerta. | Config ausente, generation cambiada y HUMAN_TAKEN. |
| F4.9 **[PG] [RUNBOOK]** | Probar crash recovery y cuarentena. | `scripts/bot-options-crash-recovery-pg-test.ts` (nuevo); runbook | F4.2–F4.8 | Recupera inbox/prompts/jobs/outbox sin doble efecto; UNKNOWN requiere callback o disposición operativa auditada. | Kill antes/después de claim, commit y Meta. |
| F4.10 **[OBS]** | Instrumentar latencia y capacidad autoritativas. | `metrics.ts`; módulos F4 | F4.1–F4.9 | Publica ACK≤200 ms, admitted→claim, admitted→transition commit (queue-inclusive), ejecución≤1s separada, outbox wait, Meta y delivered≤3s/incompleto; alerta SENDING stale/UNKNOWN/quiescence. | Carga con backlog y callbacks simulados/controlados. |

### Definition of Done F4

- [ ] Admisión autoritativa es fail-closed y usa pointer ya backfilleado.
- [ ] Crash, UNKNOWN, SENDING stale, grupos de dependencia y `STALE_CUTOVER` tienen recuperación segura.
- [ ] **No puede ocurrir ningún envío Meta del runtime nuevo** sin pointer/generation, routing exclusivo, ownership fence y dispatch quiescence.

---

## F5 — Navegación, catálogo y horarios informativos

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F5.1 **[META]** | Entregar menú vertical end-to-end en negocio de prueba. | dominio F3; runtime F4; `scripts/bot-options-main-menu-e2e-test.ts` (nuevo) | F4.8–F4.10 | Inbound firmado→prompt→outbox→Meta bajo routing exclusivo; kill switch de capacidad detiene menú nuevo sin ejecutar rollback de pointer; rollback de routing usa preflight. | E2E PG/proveedor y carrera con handoff/cutover. |
| F5.2 | Implementar navegación adaptativa/descarte. | `transition.ts`; `views.ts` | F5.1 | Volver/Menú/Handoff a ≤1 interacción; progreso exige `DISCARD_CONFIRM`; holds/señas usan menú específico. | Con/sin progreso y stale. |
| F5.3 | Consultar catálogo tenant-scoped y paginado. | `catalog-queries.ts` (nuevo); `prisma-catalog.ts` (nuevo) | F5.1 | Categorías/subcategorías/servicios reales; filas reservadas; página en prompt. | >10 opciones y cambios entre páginas. |
| F5.4 | Renderizar lista/detalle/precio real. | `catalog-queries.ts`; renderer | F5.3 | FIXED/Desde/sin precio público; ausentes se omiten; contenido largo precede al interactivo en mismo dependency group. | Snapshots y fallos del fragmento previo. |
| F5.5 | Convertir detalle a reserva o consulta. | `transition.ts`; `catalog-queries.ts` | F5.4 | Revalida servicio; reservable conserva ID; consulta previa deriva con contexto. | Servicio desactivado concurrentemente. |
| F5.6 | Mostrar horario semanal del negocio. | `hours-queries.ts` (nuevo); `src/services/weekly-hours.ts`; rutas de horas | F5.1 | Lunes–domingo y excepciones operativas 30 días; no crea draft ni revela agenda. | Semana parcial/cierres/excepciones. |
| F5.7 | Mostrar jornada de profesionales. | `hours-queries.ts`; rutas profesionales | F5.6 | Sólo activos; marca no reservable; jornada no equivale a disponibilidad. | Inactivo/no reservable/cross-tenant. |
| F5.8 **[META]** | Validar catálogo/horarios en sandbox. | `scripts/bot-options-catalog-hours-meta-test.ts` (nuevo) | F5.2–F5.7 | Entrega ordenada y sin reservas incidentales; callbacks alimentan métricas. | Recorrido controlado con límites reales. |

### Definition of Done F5

- [ ] Primeros envíos nuevos usan todos los fences/quiescence de F4.
- [ ] Menú, catálogo y horarios son incrementos reversibles por capacidad y por routing, sin confundir ambos mecanismos.

---

## F6 — Cliente, carrito y disponibilidad

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F6.1 | Buscar cliente por teléfono/negocio. | `customer-identity-service.ts`; `customer-operations.ts` (nuevo) | F5.1 | Reutiliza nombre tenant-scoped; candidato no persiste antes de confirmar. | Mismo teléfono en dos negocios. |
| F6.2 | Validar nombres Unicode. | `customer-operations.ts`; `transition.ts` | F6.1 | NFC, 2–80; acepta letras/marcas, espacios, apóstrofes, guiones **y puntos**, incluyendo ñ/acentos/otros alfabetos; rechaza números, emoji, URLs y controles; conserva casing. | Tabla Unicode y bordes 1/2/80/81. |
| F6.3 | Construir carrito uniprofesional. | `cart-operations.ts` (nuevo); `prisma-catalog.ts` | F5.3 | Cada cambio recalcula precio/duración/intersección e invalida dependencias; no existe carrito automático sin profesional común. | Agregar/quitar/inactivar. |
| F6.4 | Resolver recomendaciones/incompatibilidad. | `cart-operations.ts`; `transition.ts` | F6.3 | No autoagrega/repite; incompatible queda separado y permite handoff. | Compatible, rechazado e incompatible. |
| F6.5 | Calcular disponibilidad con timezone/config real. | `availability-queries.ts` (nuevo); servicios de availability existentes | F1.8, F6.3 | Servicios→profesional→fecha→hora; horizonte 30/máx.90, anticipación, 8 fechas, grilla 30 y duración real. | DST, anticipación y duración no múltiplo. |
| F6.6 | Implementar franjas/paginación. | `availability-queries.ts`; renderer | F6.5 | Cronológico o Mañana/Tarde/Noche/Ver todos; cortes configurables sin huecos/overlap. | Bordes 12:30/16:30 y páginas. |
| F6.7 **[PG]** | Calcular asignación balanceada provisional. | `availability-queries.ts`; `appointment-service.ts` | F6.5 | Menor carga en minutos, luego prioridad e ID; cuenta confirmados y holds; se recalcula al confirmar. | Empates y carga concurrente. |
| F6.8 **[OBS]** | Derivar horizonte sin disponibilidad. | `availability-queries.ts`; métricas | F6.5 | Handoff+señal sin afirmar error de configuración. | Agenda vacía/bloqueada/válida. |
| F6.9 **[META]** | Validar vertical hasta resumen. | `scripts/bot-options-booking-draft-meta-test.ts` (nuevo) | F6.1–F6.8 | Llega a resumen sin crear Appointment; stale no muta. | Sandbox+PG con pulsaciones rápidas. |

### Definition of Done F6

- [ ] Nombre, carrito, disponibilidad y asignación cumplen reglas tenant/timezone.
- [ ] El recorrido llega al resumen sin efectos de agenda.

---

## F7 — Exclusión de agenda y reserva atómica

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F7.1 **[PG]** | Establecer jerarquía única de locks para disponibilidad. | `appointment-service.ts`; servicios/rutas de ScheduleBlock, horas, ProfessionalService, Service y capacidades; `docs/nuevo-bot/runbook-locks-agenda.md` (nuevo) | F0.2, F6.5 | Orden documentado negocio/config→servicios/capacidades→agendas profesionales por ID→filas objetivo; todo escritor que cambie disponibilidad toma locks compatibles o incrementa versión/fence validado bajo lock; omitirlo falla contrato. | Carreras booking vs bloqueo/horas/capacidad/servicio y detector de deadlock. |
| F7.2 | Extraer operaciones componibles con `TransactionClient`. | `appointment-service.ts`; `booking-operations.ts`; `prisma-booking.ts` (nuevos) | F7.1 | Sin commit interno; última consulta de overlap ocurre bajo jerarquía completa. | Regresión legacy y composición. |
| F7.3 **[PG]** | Confirmar sin seña atómicamente. | `booking-operations.ts`; `prisma-booking.ts` | F7.2 | Revalida sesión/catálogo/capacidades/horas/bloqueo/precio; crea Visit+Appointment+snapshots+operación+outbox o nada. | Dos confirmaciones y mutación concurrente de disponibilidad. |
| F7.4 **[PG]** | Reasignar “cualquier profesional” bajo locks ordenados. | `booking-operations.ts`; `prisma-booking.ts` | F7.3 | Locks candidatos por ID; recalcula carga/prioridad/ID sin deadlock; informa final. | Carga cambiante y workers inversos. |
| F7.5 | Recuperar slot ocupado sin elegir alternativa. | `booking-operations.ts`; `transition.ts` | F7.3 | Cero residuos; conserva carrito/preferencia y ofrece opciones frescas. | Ocupación entre resumen/confirmación. |
| F7.6 **[PG] [META]** | Validar idempotencia/concurrencia y vertical sin seña. | scripts de booking/concurrency nuevos; ampliar contrato existente | F7.3–F7.5 | Un operation key/turno; crash post-commit recupera outbox; capability kill switch detiene nuevas reservas sin mover pointer ni borrar turnos. | PG real, múltiples procesos y sandbox. |

### Definition of Done F7

- [ ] Todos los escritores que afectan disponibilidad participan de la jerarquía/fencing.
- [ ] Visit y Appointment nacen atómicamente, sin doble booking bajo concurrencia real.

---

## F8 — Señas, seguridad y evidencia append-only

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F8.1 **[RUNBOOK] [CRM] [OBS]** | Cerrar prerrequisitos de retención antes de ingerir proofs. | `docs/nuevo-bot/runbook-seguridad-privacidad.md` (nuevo); rutas/servicios de autorización; jobs de purga; política de backup | F1.6 | Define y aplica acceso tenant/rol, retención, purga, backups/restore, auditoría y tratamiento de datos; ingestión permanece deshabilitada hasta verificar estos controles. | Acceso cross-tenant denegado, purga y restore controlado. |
| F8.2 | Calcular seña y TTL desde configuración del negocio. | `deposit-operations.ts` (nuevo); `booking-deposit-service.ts` | F1.8, F6.3 | NONE/FIXED/PERCENTAGE; una seña por carrito; TTL único del negocio (decisión 8), default 120 min registrado como `DEFAULT`; el campo por servicio legacy 60 no se lee ni reescribe. | Modos, provenance y datos legacy. |
| F8.3 **[PG]** | Crear Visit HELD+Appointment+Deposit+job atómicamente. | `booking-operations.ts`; `deposit-operations.ts`; `prisma-booking.ts` | F7.3, F8.2 | Config de pago se valida antes; todo nace en un commit con dbNow o deriva sin retener. | Fallo por insert y retry. |
| F8.4 | Descargar y validar proof de forma realista. | `meta-media.ts` (nuevo); `whatsapp-cloud-api.ts`; `booking-deposit-service.ts` | F8.1, F8.3 | Sólo estado/tenant esperado y ≤3 MiB antes/después; JPEG/PNG/WebP se decodifican/re-encodean con librería mantenida; PDF usa parser mantenido y política explícita, y cifrado/contenido activo/no soportado se rechaza o cuarentena; MIME+magic/estructura, hash y filename; no se promete detección universal de malware/polyglots ni parser casero. | Formato válido, magic/MIME discordante, truncado, contenido activo/cifrado, >3 MiB, media ajena y timeout. |
| F8.5 **[PG]** | Insertar `BookingDepositProof` append-only y ganar carrera. | `deposit-operations.ts`; `prisma-booking.ts` | F8.4 | Cada recepción crea evidencia inmutable; media ID/hash idempotentes; proof vigente pasa a revisión, anula expiración y no sobrescribe anteriores. | Proof vs expire/cancel, duplicado y reenvíos. |
| F8.6 **[PG]** | Ejecutar expiración programada. | `deposit-operations.ts`; worker | F8.3 | Update condicional con dbNow expira Deposit/Visit/Appointment y notifica una vez; proof ganador impide expiración. | Jobs duplicados y frontera temporal. |
| F8.7 **[CRM] [PG]** | Revisar, aprobar o rechazar con auditoría. | ruta `booking-deposit.ts` (nueva) o appointment; `crm-ui.ts`; servicios | F8.5 | Aprobar confirma agregados; rechazo exige motivo y modalidad; UI sin diálogos nativos; proof histórico permanece. | Auth, doble click y cross-tenant. |
| F8.8 **[PG]** | Soportar reenvío/final/tardío sin perder evidencia. | `deposit-operations.ts`; `handoff-operations.ts` | F8.6–F8.7 | Reenvío conserva hold y nuevo TTL/provenance; final libera; tardío agrega proof y deriva sin rehold; ningún blob anterior se reemplaza. | Reenvío vencido, final concurrente y tardío. |
| F8.9 **[META]** | Validar flujo completo de seña. | `scripts/bot-options-deposit-meta-test.ts` (nuevo); contrato deposit existente | F8.1–F8.8 | JPEG/PNG/WebP y la política decidida para PDF (aceptar, rechazar o cuarentena) producen estados inequívocos; revisión, reenvío y tardío funcionan con callbacks y controles de retención activos. | Sandbox/proveedor controlado con formatos válidos y no soportados. |

### Definition of Done F8

- [ ] No se ingiere proof antes de acceso, retención, purga y backup verificados.
- [ ] Evidencia es append-only; TTL/provenance y legacy 60 son inequívocos.
- [ ] Validación declara capacidades reales, sin criterio blanket de polyglots.

---

## F9 — Gestión y reprogramación in-place

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F9.1 | Listar turnos gestionables tenant-scoped. | `appointment-management.ts` (nuevo); `prisma-booking.ts` | F7.3, F8.3 | Próximos confirmados/holds activos; excluye pasados/cancelados/vencidos; ID estable. | Estados, páginas y cross-tenant. |
| F9.2 | Aplicar límites independientes. | `appointment-management.ts`; config F1.8 | F9.1 | Defaults 1h, timezone/dbNow; dentro del límite deriva sin mutar. | Bordes temporales. |
| F9.3 **[PG]** | Cancelar según estado financiero. | `booking-operations.ts`; `appointment-management.ts` | F9.2, F8.8 | Confirmación explícita; pendiente/reenvío cierra agregados juntos; aprobada/revisión deriva y conserva evidencia/bloque. | Cancel vs proof. |
| F9.4 **[PG]** | Reprogramar **in-place** con historial atómico. | `booking-operations.ts`; `prisma-booking.ts`; `AppointmentChangeHistory` | F1.12, F7.1, F9.2 | Bajo locks revalida original/nuevo, actualiza `startAt` del **mismo Appointment** y agrega history en el mismo commit; no crea replacement/superseded alternativo; fallo deja fila original intacta. | Dos swaps, slot ocupado, crash y operation key. |
| F9.5 **[PG]** | Conservar seña/vencimiento bajo guardas. | `deposit-operations.ts`; `appointment-management.ts` | F9.4 | Aprobada sólo si servicios/profesional/importe iguales; pendiente/reenvío no extiende TTL; revisión deriva. | Snapshots y dbNow. |
| F9.6 | Implementar navegación/recuperación. | `transition.ts`; `views.ts` | F9.1–F9.5 | Back conserva turno; conflicto mantiene original; stale reconstruye. | Tabla `APPOINTMENT_*`. |
| F9.7 **[META] [PG]** | Validar gestión concurrente. | scripts PG/Meta nuevos | F9.3–F9.6 | CRM/mensajes reflejan mismo Appointment e historial; ninguna falla pierde original. | PG real+sandbox. |

### Definition of Done F9

- [ ] Existe una sola estrategia de reprogramación: update in-place + history append-only en una transacción.
- [ ] Cancelación/reprogramación preservan original/evidencia ante carreras.

---

## F10 — Handoff y ownership humano

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F10.1 **[PG]** | Crear/cancelar handoff idempotente. | `handoff-operations.ts` (nuevo); `prisma-handoff.ts` | F4.7 | Una solicitud activa; en cola sólo esperar/cancelar; cancel revalida. | Request/request y cancel/take. |
| F10.2 **[CRM] [PG]** | Tomar/resolver con quiescence. | `crm.ts`; `crm-ui.ts`; `handoff-operations.ts` | F10.1 | Take cierra dispatch gate, espera in-flight=0 y bloquea si hay UNKNOWN no dispuesto; luego asigna owner/invalida prompts; UI integrada. | Sender cruzando Meta y UNKNOWN. |
| F10.3 **[PG]** | Silenciar bot tras toma. | `process-session-job.ts`; `postgres-worker.ts`; `prisma-admission.ts`; sender | F10.2 | Inbound se guarda para CRM; ningún claim/envío automático atraviesa ownership epoch. | Take vs worker/sender. |
| F10.4 | Revalidar HOME/RESUME. | `handoff-operations.ts`; migración snapshot | F10.2 | TAKE guarda baseline inmutable de Conversation/sesión/aggregates; RESUME compara y bloquea referencias tenant-scoped bajo la transacción. Cambios manuales prevalecen; entidad inválida o vencida no revive. | Mutación manual bloqueada contra resolve, replay, referencia cross-tenant e invalidación de visit/seña/turno. |
| F10.5 **[OBS]** | Medir cola/quiescence/ownership. | métricas; handoff | F10.1–F10.3 | Sin contexto sensible; alerta por UNKNOWN que bloquea toma y cola atascada. | Labels/transiciones. |
| F10.6 **[META]** | Validar silencio/retorno. | `scripts/bot-options-f10-6-handoff-controlled-contract-test.ts` | F10.3–F10.4 | Mensajes durante TAKE aparecen en CRM sin autorespuesta. | Proveedor controlado concurrente; transporte Meta live opcional. |

### Definition of Done F10

- [x] Handoff usa quiescence durable, no un precheck; UNKNOWN bloquea hasta resolución auditada.
- [x] HUMAN_TAKEN silencia incluso jobs/outbox previamente reclamados.

---

## F11 — Preflight, cutover y piloto exclusivo

| ID | Objetivo | Archivos / módulos probables | Dep. | Criterios de aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F11.1 **[PG]** | Ejecutar preflight bajo exclusión y dispatch quiescence. | `activation-operations.ts`; `prisma-activation.ts` | F4.7, F10.2 | Cierra gate; espera in-flight=0; lista drafts/jobs/holds/señas/handoffs y UNKNOWN; protegidos/UNKNOWN bloquean; confirmados sin proceso no. | Un caso por bloqueo y sender/admission concurrentes. |
| F11.2 **[PG]** | Activar pointer/generation transaccionalmente. | activación; `business-bot-activation-service.ts` | F11.1 | Cambia pointer/generation, audita, invalida prompts y descarta estados no protegidos; eventos viejos quedan `STALE_CUTOVER` y sólo reconstruyen runtime vigente. | Activaciones simultáneas y evento en vuelo. |
| F11.3 **[PG]** | Implementar rollback simétrico. | módulos F11.2 | F11.2 | Mismo preflight/gate; no confunde kill switch de capacidad con routing rollback; cero doble motor. | Rollback con sender/UNKNOWN/estado protegido. |
| F11.4 **[CRM]** | Exponer selector exclusivo, preflight y auditoría. | `business.ts`; config service; `crm-ui.ts` | F11.1–F11.3 | Selector, no checkboxes; bloqueos y warnings visibles; confirmación integrada. | API/UI/auth/concurrencia. |
| F11.5 **[RUNBOOK]** | Documentar corte/rollback. | `docs/nuevo-bot/runbook-piloto.md` (nuevo) | F11.1–F11.4 | Responsables, gates, UNKNOWN, capabilities, routing, métricas y rollback; noche no implica cero actividad. | Tabletop y ensayo en negocio de prueba. |
| F11.6 **[PG] [META] [OBS]** | Ensayar cutover bajo carga. | `scripts/bot-options-cutover-load-test.ts` (nuevo) | F11.3, F11.5 | Nunca responden ambos; ACK≤200 ms autoritativo; queue-inclusive e interno separados; delivered≤3s/incompleto; STALE_CUTOVER no reejecuta. | Bursts, backlog, sender in-flight y generation change. |
| F11.7 **[META] [RUNBOOK]** | Ejecutar gates verticales. | flags/capabilities; runbook | F11.6 | Negocio prueba: menú→catálogo/horarios→draft→sin seña→seña→gestión→handoff; cada gate admite disable de capacidad y rollback de routing por caminos distintos. | Smoke/regresión por incremento. |
| F11.8 **[META] [OBS]** | Habilitar un comercio piloto. | pointer; dashboards; runbook | F11.7 | Preflight cero, timezone/config/retención listas; legado/personalizados restantes sin cambios. | Smoke autorizado y monitoreo acordado. |

### Definition of Done F11

- [ ] Activación/rollback esperan quiescence y bloquean por UNKNOWN/estados protegidos.
- [ ] Eventos de generation anterior nunca ejecutan acciones viejas contra el motor nuevo.
- [ ] Piloto avanza por gates verticales con controles de capacidad y routing separados.

---

## Definition of Done global — etapa 1 (F0–F11)

- [ ] Recorridos sin/con seña, expiración, reenvío, tardío, gestión y handoff cumplen la máquina de estados.
- [ ] Raw-body HMAC, tenant por `phoneNumberId` único y admisión autoritativa post-commit alcanzan ACK p95≤200 ms; shadow no cuenta como evidencia.
- [ ] `OPEN|STABILIZING`, 500/1500, crash recovery, revision/fencing y `STALE_CUTOVER` evitan pérdida, doble efecto y reejecución vieja.
- [ ] Pointer/generation backfilleado, selector exclusivo, ownership fence y dispatch quiescence preceden todo envío nuevo.
- [ ] Outbox usa grupos de dependencia; SENDING stale→UNKNOWN; UNKNOWN sin ID queda en cuarentena sin retry automático y bloquea handoff/cutover.
- [ ] Métricas distinguen ejecución de latencia queue-inclusive y aíslan capacidad de conexiones del ingress.
- [ ] Renderer valida 1024/3/10/20/24/72 e Unicode; nombres admiten puntos además de reglas Unicode canónicas.
- [ ] Jerarquía de locks cubre turnos, bloqueos, horas, capacidades y mutaciones de servicio que afectan disponibilidad.
- [ ] Visit/Appointment/Deposit son atómicos; reprogramación es in-place con `AppointmentChangeHistory` append-only.
- [ ] Retención/purga/acceso/backup preceden proofs; cada `BookingDepositProof` es append-only y ≤3 MiB con validación realista.
- [ ] TTL nuevo conserva provenance/default 120 y no reescribe legacy 60.
- [ ] Pruebas planificadas cubren PG real, Meta controlado, concurrencia, carga y crashes; existen runbooks de migración, seguridad y piloto.

---

## F12 — Backlog posterior a etapa 1: optimización y limpieza opcionales

F12 **no bloquea el DoD de etapa 1**. Sólo se promueve una tarea a obligatoria si evidencia posterior descubre un defecto de corrección o seguridad; en ese caso debe volver a la fase propietaria, no ocultarse como “hardening”.

| ID | Tarea opcional | Archivos / módulos probables | Dep. | Criterio de entrada/aceptación | Pruebas previstas |
|---|---|---|---|---|---|
| F12.1 **[OBS] [PG]** | Optimizar índices/polling. | migraciones focalizadas; worker; queries Prisma | F11.8 | Sólo con `EXPLAIN`/métricas; migración compatible y mejora medida. | Planes/backlog antes-después. |
| F12.2 | Ajustar rate limits no críticos. | adapter/media/sender | F11.8 | Basado en tráfico/abuso observado; controles mínimos de seguridad ya están en F2/F8. | Carga/fuzz controlado. |
| F12.3 **[MIG]** | Backfill no esencial de Visit/proofs históricos. | scripts específicos | F11.8 | Sólo filas inequívocas; dry-run/rerun; ambiguas quedan legacy. | Copia aislada y rollback lógico. |
| F12.4 | Retirar shadow temporal. | ruta webhook; flags | F11.8 | Después de ventana acordada y sin perder rollback/routing de negocios legacy. | Routing mixto. |
| F12.5 **[MIG] [RUNBOOK]** | Planificar limpieza destructiva. | documento/migración futura | F12.3–F12.4 | Cambio independiente con cero consumidores, backup y rollback; no borra columnas/estados en etapa 1. | Auditoría/ensayo. |
| F12.6 | Evaluar exclusion constraint de agenda. | schema/migración futura | F11.8 | Sólo tras modelar ranges/estados y migrar todos los writers. | Concurrencia y compatibilidad. |
| F12.7 | Evaluar object storage de proofs. | storage adapter/migración futura | F11.8 | Sólo por volumen/costo/backup/retención; migración reversible. | Integridad, acceso y restore. |
| F12.8 | Evaluar cola externa. | arquitectura futura | F11.8 | Sólo si backlog/locks prueban límite de PG. | Benchmark comparativo. |

---

## Etapa 2 — explícitamente diferida

| ID | Tarea diferida | Motivo / condición de entrada |
|---|---|---|
| D2.1 | Coordinación/retención multiprofesional. | Requiere agregado y locks nuevos; etapa 1 es un profesional/Appointment. |
| D2.2 | Itinerarios y Booking V2 multiprofesional. | No reutilizar parcial sin invariantes/migración. |
| D2.3 | Búsqueda por hora y orden fecha→hora→profesional. | Cambia recorrido/asignación canónicos. |
| D2.4 | Automatizar servicios hoy derivados. | Depende de coordinación multiprofesional. |
| D2.5 | Migrar bots personalizados/borradores legacy. | Requiere plan explícito por motor. |

---

## Decisiones operativas pendientes antes del piloto

1. Negocio de prueba: **Barber DemoWX-38N6UG** (pruebas internas del propietario, sin tráfico real): su corte puede ejecutarse apenas el incremento esté listo, sin ventana protegida. Comercio piloto real: **el comercio que hoy usa el bot normal** (nombre exacto se fija en el runbook al momento del corte); ese corte sí exige ventana protegida propuesta de día de semana 03:00–04:00 ART más 72 h de observación reforzada. Responsables: propietario del proyecto.
2. Keyring/rotación de Meta apps y secretos — **RESUELTA (decisión D)**: cada negocio tiene su propia Meta App; se guarda `appSecret` por negocio, el motor nuevo exige firma siempre y el legado sigue sin firmas hasta su migración. Rotación por negocio con ventana transitoria de doble secreto; verify token GET compartido de la plataforma.
3. Timeout `SENDING` stale y disposición de `UNKNOWN` — **RESUELTA (decisión 5)**: timeout Meta 10 s; lease vencido → `UNKNOWN` en cuarentena; reintentos máx. 5 con backoff 30 s/1 m/2 m/4 m/8 m + jitter respetando `Retry-After`; agotado → `POISON` + alerta. CRM ofrece `ASSUME_SENT` / `SKIP` / `RESEND_ACCEPT_DUPLICATE_RISK` auditados; alerta si `UNKNOWN` > 15 min sin resolver. Responsable inicial: propietario.
4. Retención y backups — **RESUELTA (decisión 6)**: payload de `ProviderEvent` purgado a 30 días (fila persiste para dedup); `BotTransitionLog` sin PII 12 meses; auditoría dura lo que vive el negocio. Backups diarios retención 30 días, RPO ≤ 24 h, RTO ≤ 4 h con procedimiento escrito y drill de restore obligatorio antes del piloto. Comprobantes: 12 meses (decisión previa).
5. Umbrales — **RESUELTA (decisión 7)**: pool Prisma 10 conexiones con reserva para admisión + `statement_timeout` 5 s; backlog > 60 s aviso / > 5 min crítico; p95 interno queue-inclusive > 1,5 s (10 min) aviso; entrega p95 > 3 s (10 min) aviso / > 6 s crítico; handoff en cola > 30 min alerta CRM configurable; firmas inválidas > 5/min misma fuente. Inmediatas: POISON, UNKNOWN > 15 min, cutover/rollback bloqueado.
6. TTL de seña — **RESUELTA (decisión 8)**: plazo único configurable por negocio, default 2 h; el motor nuevo ignora el campo por servicio heredado. Reenvío: el comercio define el plazo por caso desde el CRM con 2 h por defecto (ya decidido).
7. Campos de pago obligatorios — **RESUELTA (decisión 9)**: transferencia exige alias o CBU/CVU + nombre del titular; banco e instrucciones opcionales. Preflight y advertencia CRM nombran los campos exactos faltantes por servicio afectado. Medios futuros definen su propio set antes de habilitarse.
8. Carga y SLO del piloto — **RESUELTA (decisión 10)**: DemoWX valida sólo funcionalidad; ningún SLO se mide sobre el número de pruebas. La aprobación se evalúa exclusivamente en el piloto real con tráfico: ≥ 200 acciones reales o 14 días (lo primero), exigiendo ACK p95 ≤ 200 ms, interno p95 ≤ 1 s, entrega p95 ≤ 3 s en muestras completas, cero reservas duplicadas, POISON sin causa identificada igual a cero, UNKNOWN resueltos < 24 h y rollback ensayado antes de habilitar. Fallo de cualquier criterio → rollback con preflight y análisis antes de reintentar.

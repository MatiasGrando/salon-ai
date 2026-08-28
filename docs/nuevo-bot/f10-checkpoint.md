# Checkpoint F10 — handoff durable

## Alcance F10.1

F10.1 agrega únicamente la cola durable y la cancelación idempotente. El runtime, ingress, sender, schedulers, CRM, toma/resolución humana y cualquier protocolo de quiescence operativo permanecen **OFF**. F10.2 continúa deliberadamente diferido.

## Contrato funcional

- `REQUEST_HUMAN_HANDOFF` crea exactamente un `BotHandoff(QUEUED)`, cambia la sesión `ACTIVE → HUMAN_QUEUED` y completa un `BotOperation` cuyo `resultRef` identifica esa fila, todo dentro de la transacción existente del job.
- `handoff.cancel` emite `CANCEL_HUMAN_HANDOFF_BY_CUSTOMER`; bajo lock tenant-scoped cambia únicamente el handoff activo `QUEUED → CANCELLED` y la sesión `HUMAN_QUEUED → ACTIVE`.
- Request y cancel tienen operation keys separadas. El replay valida negocio, sesión, tipo, hash y `resultRef`; un replay histórico nunca retargetea un handoff posterior.
- La FK compuesta `(businessId, sessionId)` y el índice parcial garantizan pertenencia y un solo handoff `QUEUED|TAKEN` activo por sesión. F10.1 no escribe `TAKEN|RESOLVED` ni ownership humano.
- No se agregó una FK transversal desde `BotOperation`: `resultRef` se valida bajo lock contra negocio y sesión. Esto evita reinterpretar operaciones históricas ajenas al handoff.

## Operación de migración

La migración F10.1 debe correrse en quiescencia: no puede existir ninguna ventana con writers pre-F10 que cambien `BotSession.status` mientras se ejecuta. Antes de crear el índice parcial activo, backfillea cada `BotSession` preexistente `HUMAN_QUEUED` con exactamente un `BotHandoff` `QUEUED`, de ID determinístico derivado de `(businessId, sessionId)`, razón explícita `LEGACY_HUMAN_QUEUED_BACKFILL` y contexto sin PII. La FK compuesta conserva el tenant y la sesión.

Los contratos PG requieren una scratch local explícita `postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_*`, nunca infieren un destino seguro. Para el contrato de upgrade, el orquestador prepara una scratch nueva con F8 + F9 pero sin F10, inserta nada adicional y ejecuta:

```sh
export F10_PG_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_upgrade_contract
# Sobre una scratch vacía: aplicar sólo estos SQL, en este orden.
psql "$F10_PG_CONTRACT_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/00000000000000_f8_schema_baseline/migration.sql
psql "$F10_PG_CONTRACT_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260827200000_add_f9_appointment_management/migration.sql
psql "$F10_PG_CONTRACT_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260827210000_add_f9_cancellation_transition/migration.sql
npm run test:bot-options-f10-handoff-upgrade-pg
```

El contrato ejecuta el SQL real de la migración F10 una vez; por eso esa scratch queda migrada y debe descartarse/recrearse externamente antes de repetirlo. El contrato normal F10.1 requiere otra scratch ya migrada a F10:

```sh
F10_PG_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_handoff_contract npm run test:bot-options-f10-handoff-pg
```

## Evidencia

- Upgrade real sobre scratch F8+F9: la migración F10 backfilleó dos sesiones legacy `HUMAN_QUEUED` con IDs determinísticos y el executor real canceló una de ellas dejando sesión `ACTIVE`.
- Bootstrap vacío F8+F9+F10: las cuatro migraciones aplicaron y `prisma migrate status` quedó limpio.
- El contrato PG F10.1 pasó schema/checks/FK/índice parcial, request y cancel idempotentes, conflictos de hash, tenant scope, rollback y replay histórico sin retarget.
- Las carreras reales `request/request` y `request/cancel` en ambos órdenes dejaron equivalencia exacta: handoff activo iff sesión `HUMAN_QUEUED`; la operación ganadora quedó `COMPLETED` y la perdedora no dejó `STARTED` fantasma.
- El E2E F5.5/F10 verificó que la transición `service.consult` persiste sesión, log, operación y `BotHandoff` coherentes; su harness ya no toca `salon_ai_test` y exige una scratch F10 explícita.
- `prisma validate`, gate de URL, transición pura, UTF-8 y `git diff --check` pasaron. La revisión crítica final no encontró blockers F10.1.

**F10.1 queda aceptado.** F10 completo todavía no cumple DoD: TAKE, ownership, quiescence durable, bloqueo por `UNKNOWN`, silencio post-toma, HOME/RESUME y sandbox Meta siguen en F10.2–F10.6. Ninguna superficie operativa fue activada.

## Alcance F10.2 (runtime OFF)

- La migración aditiva `20260827230000_add_f10_2_handoff_fencing` agrega gate/epoch por sesión, snapshot de claim y auditoría de ownership. No habilita runtime alguno.
- TAKE cierra el gate de una sola sesión y aumenta su epoch dentro de una transacción corta; el drain ocurre fuera de esa transacción. Un timeout sin incertidumbre reabre únicamente ese mismo epoch y deja la operación `ABORTED`. `UNKNOWN` mantiene el gate pausado y bloquea TAKE/RESOLVE hasta una disposición durable.
- Los claims snapshottean tanto el epoch de deployment como el de handoff. Worker y sender revalidan ambos fences antes de procesar o cruzar el punto pre-Meta.
- Una operación `BLOCKED_UNKNOWN` sólo puede recuperarse con la misma `operationKey`, sobre el mismo handoff/epoch, después de que el drain ya no reporte `UNKNOWN`; una key distinta no puede tomar ese ownership.
- TAKE/RESOLVE usan el orden de locks `BotSession → BotHandoff → BotOperation`, validan replay por tenant, sesión, hash y `resultRef`, y guardan estado, status, revisión, `BotTransitionLog`, conversación y supresión en la misma transacción final. El rollback de esa fase conserva únicamente el gate y la operación `STARTED` de la fase previa, para permitir el replay seguro.
- Sólo el owner autenticado puede resolver. La degradación explícita y auditada de `RESUME → HOME` fue la seguridad histórica de F10.2 y queda **supersedida por F10.4**: sobre el schema F10.4, un baseline `resumeSnapshot` inmutable y sin cambios habilita un `RESUME` durable/replayable. El contrato F10.4 conserva los negativos críticos: cambio manual o estado/referencia inválidos resuelven `HOME`. `BotHandoffAudit` sigue append-only por trigger de PostgreSQL.
- El contrato F10.2 actual ejecuta el writer vigente y por eso sólo puede correr sobre una scratch explícita, migrada hasta F10.4:

```sh
F10_PG_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_handoff_f10_2 npm run test:bot-options-f10-2-handoff-pg
```

## Evidencia F10.2

- Evidencia histórica: sobre la scratch local `salon_ai_f10_2_contract_20260828a` se aplicaron las cinco migraciones F8, F9, F10.1 y F10.2 con `prisma migrate deploy`; el writer vigente ya no puede correr contra ese schema pre-F10.4 porque requiere `resumeSnapshot`.
- El contrato PG F10.2 pasó tres veces, dos de ellas consecutivas sobre la misma scratch: verificó snapshot de ambos fences, gate por sesión, worker/`BotJob` `LEASED`, sender real controlado cruzando el pre-send, timeout/reapertura exacta, `UNKNOWN`/disposición/recovery, TAKE concurrente, crash/replay, scope tenant, ownership, la degradación `HOME` histórica, auditoría append-only y rollback final/replay. Bajo F10.4, su caso estable de resolución verifica el `RESUME` snapshot-backed durable/replayable; el contrato F10.4 verifica que cambios manuales o inválidos sigan en `HOME`.
- El contrato F10.1 pasó contra el schema F10.2; también pasaron transición pura, sintaxis CRM, UTF-8, `prisma validate`, gate de URL F10 y el E2E F5.5/F10.
- La revisión crítica final obtuvo **PASS** para F10.2 sin activar ninguna superficie operativa.

**F10.2 queda aceptado.** F10.3 y F10.5–F10.6 continúan pendientes: silencio de runtime post-toma, observabilidad y sandbox Meta; F10.4 supersede la degradación histórica con revalidación HOME/RESUME. Runtime, ingress, sender y schedulers permanecen **OFF**.

## Alcance F10.3 (runtime OFF)

- `HUMAN_TAKEN` bloquea en claim y recheck a jobs ligados por sesión, prompt o por el `ProviderEvent`/teléfono de un inbox inicial todavía sin sesión. Los jobs de recuperación no ligados a esa conversación no se bloquean.
- Un inbox inicial que ya estaba `READY` o `LEASED` antes del TAKE se serializa contra la sesión existente. Si TAKE gana, se persiste el inbound en `Message`, se marca el inbox `PROCESSED/HUMAN_TAKEN_SILENCED` y no se crea sesión ni outbox. Si el worker gana, consume el inbox contra la sesión existente sin crear una segunda sesión `ACTIVE` ni una respuesta automática.
- La admisión posterior a TAKE persiste el inbound en el ledger `Message` que consume el CRM, conserva el `BotProviderEvent`, deja una traza `BotActionInbox` procesada y no crea `BotJob`. Un comprobante o media queda silenciado; un proof-job previamente `LEASED` bloquea TAKE y, si observa ownership humano, termina sin I/O de Meta ni efectos funcionales.
- Sender y dispatch claims revalidan explícitamente `status <> HUMAN_TAKEN`, además del gate y epoch de F10.2.

```sh
F10_PG_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_handoff_f10_3 npm run test:bot-options-f10-3-handoff-pg
```

## Evidencia F10.3

- El contrato PG pasó tres veces sobre `salon_ai_f10_2_contract_20260828a`: inbound post-toma visible para CRM sin job, jobs session-bound bloqueados, outbox bloqueado, TAKE contra worker `LEASED`, sender `CLAIMED` y proof `LEASED`, inbox inicial `READY` y `LEASED` antes de TAKE, carrera worker/TAKE sin segunda sesión activa/outbox, proof post-toma sin I/O y recuperación no ligada aún claimable.
- Regresiones F10.1, F10.2, transición, sintaxis CRM, UTF-8, `prisma validate`, `git diff --check` y E2E F5.5/F10 pasaron.
- La revisión crítica final obtuvo **PASS** para F10.3. Runtime, ingress, sender y schedulers permanecen **OFF**.

**F10.3 queda aceptado.** F10.4–F10.6 continúan pendientes: revalidación completa HOME/RESUME, observabilidad y sandbox Meta.

## Alcance F10.4 (runtime OFF)

- TAKE guarda en `BotHandoff.resumeSnapshot` un baseline inmutable: revisión y digest del estado `HANDOFF_TAKEN`, estado/timestamp de Conversation y los IDs/versiones/estados de los aggregates `BookingVisit → Appointment → BookingDeposit` de la sesión. Filas legacy sin snapshot no pueden RESUME.
- RESOLVE conserva el orden `BotSession → BotHandoff → BotOperation`, bloquea Conversation y las referencias tenant-scoped, y compara el baseline dentro de la transacción que persiste la resolución. Cualquier diferencia, entidad no reservable/inactiva/fuera de tenant, aggregate faltante, estado inválido o vencimiento aplica `HOME`.
- `RESUME` sólo usa `handoff.resolve_resume` cuando esa revalidación pasa. No crea, actualiza ni reconstruye BookingVisit, BookingDeposit o Appointment; HOME tampoco deshace cambios manuales. El precheck de seña fuera de transacción del endpoint CRM se elimina en F10.4 porque la decisión durable pertenece al writer transaccional.
- En la transacción final de TAKE, luego del drain, todo `BotJob` pre-toma correlacionado por inbox, prompt o `ProviderEvent.fromPhone → Conversation` pasa de `READY`/`RETRY` a `DONE` con `HUMAN_TAKEN_SUPPRESSED`. No se usa `POISON`: no es una falla operativa sino una decisión terminal de ownership. Los proof-events directos quedan materializados en `Message` para CRM y marcados procesados, sin crear trabajo nuevo; recuperación sin esa correlación sigue claimable. El fence de sesión también bloquea nuevos claims entre drain y finalización.
- Contrato local explícito: `F10_PG_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_handoff_f10_4 npm run test:bot-options-f10-4-handoff-pg`.

## Evidencia F10.4

- Sobre la scratch local `salon_ai_f10_handoff_f10_4`, migrada hasta F10.4, pasaron los contratos PG F10.1–F10.4. F10.4 cubre snapshot inmutable, filas legacy sin baseline, replay, cambios manuales y carreras de Conversation, referencias cross-tenant/cliente, entidades inactivas/vencidas y aggregates de reserva/seña/turno inválidos que degradan a HOME.
- El contrato F10.3 verifica además que un inbox inicial leaseado participa del drain, y que jobs `READY`/`RETRY` pre-TAKE correlacionados terminan en `DONE/HUMAN_TAKEN_SUPPRESSED`, siguen visibles para CRM cuando corresponda y no reviven luego de la resolución ni mutan `BookingDeposit`.
- También pasaron transición, sintaxis de CRM, UTF-8, `prisma validate` y `git diff --check`.
- La revisión crítica final obtuvo **PASS** para F10.4. Runtime, ingress, sender y schedulers permanecen **OFF**.

**F10.4 queda aceptado.** F10.5–F10.6 siguen pendientes: observabilidad de quiescence/ownership y sandbox Meta.

## Alcance F10.5 (observabilidad privacy-safe, runtime OFF)

F10.5 agrega visibilidad de cola/quiescence/ownership del handoff **sin** modificar semántica de transacción, locks, gates, fencing, comportamiento de ownership ni estado durable. La señal se deriva 100% de un barrido **SELECT-only** sobre `BotHandoff` (columnas de estado/tiempo), `BotHandoffAudit` (acciones estructuradas) y operaciones estrictamente acotadas por `type IN ('HANDOFF_TAKE','HANDOFF_RESOLVE') AND status='BLOCKED_UNKNOWN'`. Los estados de operaciones ajenas —incluido F11— nunca contribuyen. No se agregaron dependencias y no se cambió el tipado de `observe(stage, durationMs, outcome)`.

### Señales y nombres

El colector `collectBotOptionsHandoffMetrics` (en `src/bot-options/observability/metrics.ts`) escribe los siguientes *gauges* en `BotOptionsMetrics.handoff` vía `setHandoffGauges`, todos enteros/ms y **sin PII** (sin IDs, teléfonos ni free-text):

| Gauge | Fuente SELECT-only | Qué mide |
|---|---|---|
| `handoffTakeStarted` | `count(BotHandoffAudit.action='TAKE_STARTED')` en ventana 24h | Inicios de TAKE (tasa de intento). |
| `handoffTakeCompleted` | `BotHandoffAudit.action='TAKE_COMPLETED'` 24h | TAKE con ownership alcanzado. |
| `handoffTakeTimeoutReopened` | `BotHandoffAudit.action='TAKE_TIMEOUT_REOPENED'` 24h | Drains que expiraron y reabrieron el gate exacto. |
| `handoffTakeBlockedUnknown` | `BotOperation(type='HANDOFF_TAKE', status='BLOCKED_UNKNOWN')` | UNKNOWN que **sigue bloqueando** un TAKE. |
| `handoffTakeBlockedUnknownRecent` | `BotHandoffAudit.action='TAKE_BLOCKED_UNKNOWN'` 24h | Transiciones recientes a bloqueo de TAKE. |
| `handoffResolveCompleted` | `BotHandoffAudit.action='RESOLVE_COMPLETED'` 24h | RESOLVE completados. |
| `handoffResolveBlockedUnknown` | `BotOperation(type='HANDOFF_RESOLVE', status='BLOCKED_UNKNOWN')` | UNKNOWN que **sigue bloqueando** un RESOLVE. |
| `handoffResolveBlockedUnknownRecent` | `BotHandoffAudit.action='RESOLVE_BLOCKED_UNKNOWN'` 24h | Transiciones recientes a bloqueo de RESOLVE. |
| `handoffQueuedStuck` | `BotHandoff.status='QUEUED' AND queuedAt < now()-30min` | Cola atascada (umbral plan: >30 min). |
| `handoffQueuedOldestMs` | `now()-min(queuedAt)` sobre QUEUED | Antigüedad de la cola más vieja. |
| `handoffStaleOwnership` | `BotHandoff.status='TAKEN' AND takenAt < now()-6h` | Ownership humano obsoleto (umbral heurístico 6h). |
| `handoffStaleOwnershipMs` | `now()-min(takenAt)` sobre TAKEN | Antigüedad del ownership más viejo. |

Alertas derivadas en `snapshot()` (distintas del signal global):

- `bot_handoff_take_blocked_unknown` — `handoffTakeBlockedUnknown > 0`
- `bot_handoff_resolve_blocked_unknown` — `handoffResolveBlockedUnknown > 0`
- `bot_handoff_queue_stuck` — `handoffQueuedStuck > 0`
- `bot_handoff_stale_ownership` — `handoffStaleOwnership > 0`

### Argumento de seguridad (no duplicación y no PII)

- **No duplica `bot_dispatch_unknown`**: ese signal global cuenta UNKNOWN crudos en cualquier `BotOutbox`/`BotDispatchClaim`. F10.5 cuenta operaciones de handoff *efectivamente bloqueadas* por un UNKNOWN (vía `BotHandoffAudit`), señal distinta y más accionable; por eso lleva nombre propio y no reutiliza el global.
- **Scope estricto de operación**: el bloqueo activo exige simultáneamente `type='HANDOFF_TAKE'|'HANDOFF_RESOLVE'` y `status='BLOCKED_UNKNOWN'`; un estado homónimo de F11 u otra operación no puede contaminar la señal.
- **Sin PII**: el barrido devuelve exclusivamente conteos y duraciones; el snapshot no incluye IDs, teléfonos ni textos. El contrato F10.5 afirma que cada gauge es numérico.
- **Fuente autoritativa**: `BotHandoffAudit` es el ledger append-only de transiciones; `BotOperation` representa si aquel bloqueo continúa activo; `BotHandoff` aporta edad de cola/ownership (no existe un audit de "enqueue", por lo que su columna `queuedAt`/`takenAt` es la fuente correcta). El barrido es SELECT-only y no muta durable state ni transacciones.
- **Costo acotado**: la migración aditiva F10.5 crea concurrentemente índices por audit-time/action, estado/tiempo del handoff y status/type de operación; el sweep de 60 s no depende de scans globales sin índice.
- **Additivo y fail-isolated**: `startBotOptionsMetricsLoop` invoca `collectBotOptionsHandoffMetrics` sin impedir la publicación operacional previa si el colector F10.5 falla, resetea gauges F10.5 para no publicar alertas stale y evita ticks superpuestos. No se alteran transacciones, locks, gates, fencing ni ownership. El tipado de `observe` quedó intacto.

### Contrato

`scripts/bot-options-f10-5-handoff-observability-pg-contract-test.ts` (npm `test:bot-options-f10-5-handoff-observability-pg`) usa el safety-gate de URL scratch F10 explícita (`resolveF10PgContractDatabase`). Verifica señales de cola atascada, ownership obsoleto, outcomes recientes del ledger, bloqueos activos type-scoped y aislamiento respecto de `bot_dispatch_unknown`.

### Evidencia F10.5

- La migración aditiva `20260827250000_add_f10_5_handoff_observability_indexes` se aplicó sobre la scratch explícita `salon_ai_f10_handoff_f10_4`; `prisma migrate status` quedó limpio y los cuatro índices coinciden con el schema y los predicados del colector.
- El contrato PG F10.5 pasó sobre esa scratch: verificó outcomes recientes, bloqueo activo type-scoped, cola atascada, ownership obsoleto, gauges sin PII, baseline repetible y aislamiento respecto de `bot_dispatch_unknown`.
- `prisma validate`, chequeo TypeScript enfocado de los archivos F10.5 y `git diff --check` pasaron. El typecheck completo conserva errores previos fuera de F10.5.
- La revisión crítica final obtuvo **PASS**: confirmó aislamiento de fallas del colector, ticks no superpuestos, separación entre transición reciente y bloqueo activo, índices concurrentes, fixture válido y ausencia de cambios en transacciones/locks/gates/fencing/ownership.

**F10.5 queda aceptado.** F10.6 sigue pendiente: validación sandbox Meta de silencio durante TAKE y retorno posterior. Runtime, ingress, sender y schedulers permanecen **OFF**.

## F10.6 — proveedor controlado aceptado

- `CONTROLLED_PROVIDER_PASS`: el contrato controlado local verificó la carrera
  TAKE/sender sin llamadas al provider cuando TAKE gana, silencio y materialización
  CRM del inbound bajo ownership humano, deduplicación, RESUME durable y bloqueo
  de `UNKNOWN`.
- El criterio normativo de `[META]` admite explícitamente `sandbox/proveedor
  controlado` (`plan-implementacion.md`, marcas). Por eso el contrato concurrente
  satisface F10.6 sin exigir transporte Meta live.
- La revisión crítica final obtuvo `ACCEPT_F10_6_CONTROLLED`: confirmó cero
  provider calls/autorespuestas cuando TAKE gana, ledger CRM único, supresión de
  jobs/outbox, deduplicación, RESUME sin revival y bloqueo durable por `UNKNOWN`.
- La regresión completa F10.1–F10.6 pasó secuencialmente sobre la scratch F10.5:
  safety gate de URL, contratos PG F10.1–F10.5, proveedor controlado F10.6,
  safety live, `prisma validate` y contrato UTF-8.
- `META_LIVE_PENDING` se conserva como evidencia externa opcional para piloto/F11.
  Su preflight continúa sin DB/red/envío y nunca equivale a `META_LIVE_PASS`.

**F10.6 queda aceptado y F10 completo queda aceptado.** Runtime, ingress, sender,
workers y capabilities permanecen **OFF**; su activación pertenece a F11.

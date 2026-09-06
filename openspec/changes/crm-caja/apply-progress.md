# Apply progress: crm-caja

## Lote F1 — Dominio y tiempo

### Tareas completadas

- [x] 1.1 Contrato puro de fórmulas monetarias, invariantes, signos, reversas y métricas.
- [x] 1.2 Dominio puro en `src/services/cash-domain.ts`, sin I/O.
- [x] 1.3 Zona IANA, jornadas transmedianoche, efectivo heredado y configuración aditiva `Business.timezone`.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `scripts/cash-domain-contract-test.ts` | Unit | N/A (nuevo) | Import falló porque `cash-domain` no existía | Contrato ejecutado correctamente | Casos válidos e inválidos, efectivo y electrónicos | Métricas extraídas a una función pura |
| 1.2 | `scripts/cash-domain-contract-test.ts` | Unit | N/A (nuevo) | Contrato 1.1 rojo | Implementación mínima verde | Reversa de pago y reversa de gasto probaron ramas diferentes | Buckets de métricas unificados por tipo efectivo |
| 1.3 | `scripts/cash-domain-contract-test.ts` | Unit + source contract | `test:crm-ui-syntax` verde; autorización PG no ejecutable sin `TEST_DATABASE_URL` | Faltaban exports de tiempo y luego `Business.timezone` | Contrato completo y `prisma validate` verdes | Dos zonas, jornada cerrada/abierta y primera/posterior apertura | Validación IANA centralizada y fail-closed |

### Pruebas

- `npx tsx scripts/cash-domain-contract-test.ts`: PASS.
- `npx prisma validate`: PASS.
- `npm run test:crm-ui-syntax`: PASS (2 scripts inline).
- `npm run test:text-encoding`: PASS.
- `npm run test:business-authorization`: no ejecutable por ausencia de `TEST_DATABASE_URL`; no se modificó el contrato PG.
- `npx tsc --noEmit`: FAIL por errores preexistentes fuera de F1; no reportó errores en los archivos de Caja ni configuración tocados.

### Decisiones y rollout

- `Business.timezone` queda nullable durante el rollout y Caja deberá fallar cerrada si falta.
- La migración sólo copia zonas ya configuradas explícitamente en `BusinessBotOptionsSettings`; no asigna una zona por defecto ni inventa historia.
- La configuración del CRM permite guardar una zona IANA validada por el servidor.
- La revisión posterior reforzó la invariante del ledger: un movimiento debe tener importe entero estrictamente positivo; los totales y saldos sí pueden ser cero.

### Próximo lote

F3 — jornadas y sesiones. No iniciado; este lote se detuvo deliberadamente al completar F2.

## Lote F2 — Persistencia segura

### Tareas completadas

- [x] 2.1 Contrato ejecutable de esquema con verificación estática siempre disponible y verificación PostgreSQL cuando existe `TEST_DATABASE_URL` segura.
- [x] 2.2 Modelos y enums Prisma, `Appointment.businessId` tenant-safe y migración SQL nueva con CHECKs, FKs compuestas, únicos parciales, inmutabilidad e idempotencia.
- [x] 2.3 Regresiones focalizadas y `npx prisma validate`; no se creó commit ni se ejecutó migración/deploy.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `scripts/cash-schema-pg-contract-test.ts` | Contrato PostgreSQL + source contract | F1 `cash-domain-contract-test.ts` verde | Falló porque no existía la migración financiera | Contrato estático ejecutado correctamente | Catálogo, tenant ajeno, importe cero, forma por tipo, dos únicos parciales y reversa duplicada | Guardia de base de prueba y ruta de SKIP explícita |
| 2.2 | `scripts/cash-schema-pg-contract-test.ts` | Persistencia | N/A (modelos/migración nuevos; `schema.prisma` validado antes en F1) | Contrato 2.1 rojo | Esquema/migración satisfacen el contrato estático | FKs tenant-safe, CHECKs por tipo, append-only, contrapartida exacta e idempotencia por únicos | Invariantes no representables por Prisma quedaron exclusivamente en SQL nuevo |
| 2.3 | mismo contrato + regresiones focalizadas | Regresión | `cash-domain`, `appointment-payload` y UTF-8 verdes | El primer `prisma validate` detectó relaciones inversas/únicos compuestos faltantes; un RED adicional detectó CHECKs de cierre permisivos ante NULL | `prisma validate` y todas las regresiones focalizadas verdes | Prisma, dominio, payload Agenda, controles de cierre y codificación cubren capas diferentes | Se agregaron relaciones inversas, claves compuestas y presencia explícita de controles sin tocar F3+ |

### Pruebas

- RED: `npx tsx scripts/cash-schema-pg-contract-test.ts` falló con `0 !== 1` al no existir la migración.
- RED de triangulación: el contrato rechazó los CHECKs de cierre que no exigían controles `IS NOT NULL`; se corrigieron antes del GREEN final.
- GREEN: `npm run test:cash-schema-pg`: PASS estático; `SKIP PG` explícito porque falta `TEST_DATABASE_URL`.
- `npx tsx scripts/cash-domain-contract-test.ts`: PASS.
- `npm run test:appointment-payload`: PASS.
- `npx prisma validate`: PASS.
- `npm run test:text-encoding`: PASS.

### Decisiones y rollout

- Cada relación financiera usa `businessId` en su FK; `Appointment.businessId` se backfillea desde `Professional.businessId` y queda obligatorio.
- `CashEntry` es append-only por trigger; las correcciones son reversas exactas, de dirección opuesta, con importe/medio/cuenta iguales y una sola reversa por original.
- Una jornada y una sesión abiertas por negocio se garantizan con índices parciales únicos.
- Prisma modela las relaciones y enums; CHECKs, índices parciales y triggers permanecen en `20260906120000_add_cash_financial_ledger/migration.sql`.
- La validación PostgreSQL dinámica queda pendiente de ejecutar contra una base de prueba ya migrada; el contrato rechaza URLs cuyo nombre de base no identifica un entorno de test.

### Correcciones de la revisión F2

- Los dos writers Prisma de `appointment-service.ts` y el writer SQL de `booking-operations.ts` ahora persisten `Appointment.businessId` desde el profesional/input tenant ya revalidado.
- `CashEntry` referencia una sesión mediante `(businessId, registerDayId, cashSessionId)` hacia `CashSession(businessId, registerDayId, id)`; no puede mezclar una sesión con otra jornada del mismo negocio.
- `PAYMENT` separa formas excluyentes: Agenda/Caja requieren jornada+sesión y no aceptan seña; WEB/BOT requieren `bookingDepositId` y `TRANSFER`, con jornada+sesión ambas presentes o ambas ausentes.
- `LEGACY_PAYMENT` exige origen `MIGRATION`, medio `UNSPECIFIED` y ausencia de jornada, sesión y seña.

#### Evidencia RED→GREEN de revisión

| Finding | RED | GREEN | Regresión |
|---|---|---|---|
| Writers de Appointment | El contrato falló en `el writer SQL de Booking debe persistir input.businessId validado` | Los tres writers incluyen el tenant revalidado | `appointment-payload`, `manual-appointment-override` y `bot-options-service-estimate-financial-test` verdes |
| Sesión↔jornada | Assertions nuevas exigieron relación/FK triple y caso PG de jornada cruzada | Prisma y SQL usan la clave compuesta completa | `prisma validate` verde; PG dinámico pendiente por falta de URL |
| Origen/idempotencia de señas | Assertions nuevas rechazaron pago manual cerrado, seña sin ID y legacy con origen Agenda | `CashEntry_shape_check` usa ramas mutuamente excluyentes | Contrato estático verde; casos PG quedaron ejecutables |

Regresiones finales de la revisión: `test:cash-schema-pg`, `cash-domain-contract-test.ts`, `test:appointment-payload`, `test:manual-appointment-override`, `bot-options-service-estimate-financial-test.ts`, `prisma validate` y `test:text-encoding`: PASS. PostgreSQL real: SKIP explícito por ausencia de `TEST_DATABASE_URL`.

## Lote F3 — Jornadas y sesiones

### Tareas completadas

- [x] 3.1 Contrato RED para primera apertura, responsable tenant-safe/activo, Nueva sesión, cierre, controles, arrastre, transmedianoche y carreras.
- [x] 3.2 `CashService` y repositorio Prisma transaccional con reloj DB y advisory lock por negocio.
- [x] 3.3 Regresiones unitarias determinísticas de ciclo de vida/competencia y casos PostgreSQL ejecutables; no se inició F4.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `scripts/cash-session-pg-contract-test.ts` | Unit + source + PostgreSQL opcional | `cash-schema-pg` y `cash-domain` verdes | ENOENT porque `cash-service.ts` no existía | Contrato unitario/estático ejecutado correctamente | Responsable ajeno/inactivo, primera apertura sin efectivo, cambio y cierre con diferencias, reapertura y carreras | Contrato separa verificación siempre ejecutable de PG opcional seguro |
| 3.2 | mismo contrato | Servicio + repositorio transaccional | N/A (archivos nuevos) | Contrato 3.1 rojo | Apertura, Nueva sesión y cierre pasan con repositorio in-memory; wiring SQL satisface contrato estático | Cambio transmedianoche conserva jornada; apertura posterior hereda esperado; token viejo falla `STALE_SESSION` | Cálculo reutiliza `summarizeCashRegister`; persistencia SQL queda encapsulada en repositorio |
| 3.3 | mismo contrato + regresiones Caja | Regresión | Ciclo unitario verde | La primera verificación TypeScript focalizada detectó un uso value/type incorrecto en el contrato | Contrato y chequeo TypeScript focalizado quedaron limpios | Dos aperturas concurrentes dejan una ganadora; dos cambios sobre la misma sesión dejan uno y el otro queda stale | Tipado del resultado concurrente se estrechó sin casts de producción |

### Comportamiento implementado

- Cada operación adquiere `pg_advisory_xact_lock(hashtextextended(...))` por `businessId` y lee `clock_timestamp()` dentro de la misma transacción.
- La zona IANA es obligatoria y el responsable debe ser un usuario activo del mismo negocio.
- La primera jornada requiere efectivo inicial; las siguientes heredan `expectedClosingCash`, nunca el contado.
- Nueva sesión cierra la vigente y abre la siguiente al mismo `dbNow`, mantiene la jornada y rechaza tokens viejos con `STALE_SESSION`.
- Cierre finaliza sesión y jornada al mismo instante. Ambos guardan esperado, contado y diferencia.
- Los controles consultan el ledger para calcular efectivo esperado, pero no insertan ningún `CashEntry`; una diferencia no es un ajuste automático.
- La jornada se resuelve por `closedAt IS NULL`, sin filtros de fecha calendario, por lo que cruza medianoche.

### Pruebas

- RED: `npm run test:cash-sessions-pg` falló con ENOENT antes de crear servicio/repositorio.
- `npm run test:cash-sessions-pg`: PASS unitario y estático; PG dinámico SKIP por ausencia de `TEST_DATABASE_URL`.
- `npm run test:cash-schema-pg`: PASS estático; PG SKIP.
- `npx tsx scripts/cash-domain-contract-test.ts`: PASS.
- `npx prisma validate`: PASS.
- `npm run test:text-encoding`: PASS.
- `npx tsc --noEmit --pretty false`: FAIL por errores preexistentes; el filtro focalizado no reporta errores en `cash-service.ts`, `prisma-cash-repository.ts` ni `cash-session-pg-contract-test.ts`.
- `git diff --check` focalizado: PASS.

### Próximo lote

F4 — cuenta y migración legacy. No iniciado.

## Lote F4 — Cuenta y migración legacy

### Tareas completadas

- [x] 4.1 Contrato RED ejecutable para reserva simple, coordinada, `BookingVisit`, snapshot de precio y pago manual legacy `UNSPECIFIED`.
- [x] 4.2 Backfill reportable, reanudable e idempotente y resolución tenant-safe de cuentas en servicio/repositorio.
- [x] 4.3 Regresiones de enlace único, grupo inconsistente, escritura no parcial y aislamiento; no se inició F5.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `scripts/appointment-account-backfill-pg-contract-test.ts` | Unit + source + PostgreSQL opcional | F2/F3 verdes | Falló porque `CashService` no exponía `backfillAppointmentAccounts` | Contrato unitario/estático ejecutado correctamente | Simple, coordinada web, `BookingVisit`, precio fijo, estimativo, legacy y tenant | Guardia de base segura y `SKIP PG` explícito |
| 4.2 | mismo contrato | Servicio + repositorio Prisma | Contrato 4.1 rojo | API/persistencia ausentes | IDs determinísticos, lock por negocio, cursores, `ON CONFLICT` y reporte de conflictos | Un RED adicional detectó que `Service` podía cruzar tenant por FK simple | Joins de servicio usan `businessId`; la resolución siempre parte de `AppointmentAccountLink` tenant-scoped |
| 4.3 | mismo contrato + regresiones focalizadas | Integridad/regresión | Backfill unitario verde | La prueba de enlace preexistente mostró una cuenta y un link parciales (`accounts: 4`, `links: 5`) | Preflight de todos los links rechaza el grupo antes de escribir (`accounts: 3`, `links: 4`) | Grupo WEB mixto, servicio ajeno, link único, repetición sin duplicados y consulta cross-tenant | El contrato F3 se acotó a prohibir `ADJUSTMENT` automático, sin bloquear la inserción legacy legítima de F4 |

### Comportamiento implementado

- El backfill pagina turnos todavía no enlazados por `(businessId, appointmentId)`, bloquea el negocio y devuelve contadores, conflictos y `nextCursor`.
- Las cuentas y pagos legacy usan IDs SHA-256 determinísticos por tenant y fuente; `ON CONFLICT DO NOTHING` permite reanudar y repetir el lote.
- Una reserva simple genera una cuenta propia; un grupo coordinado WEB comparte cuenta; un `BookingVisit` usa su total congelado. Grupos ambiguos o inconsistentes se reportan y no se adivinan.
- El precio se resuelve por evidencia existente: total de visita, `quotedPrice`, snapshots de ítems o precio primario. Ausencia parcial produce `ESTIMATED`; no se inventa un monto.
- Un pago manual legacy sólo se proyecta con importe positivo real, como `LEGACY_PAYMENT/MIGRATION/UNSPECIFIED`, fuera de jornada/sesión y con `effectiveAt = NULL` para no inventar fecha.
- Antes de crear cuenta o enlaces, el servicio verifica todo el grupo; un miembro enlazado a otra cuenta reporta `APPOINTMENT_LINK_CONFLICT` sin dejar escrituras parciales.
- Los joins a servicio primario/ítems se acotan al negocio y evidencia extranjera falla cerrada; resolver una cuenta también exige el mismo `businessId`.

### Pruebas

- RED inicial: `npm run test:appointment-account-backfill-pg` falló por ausencia de `backfillAppointmentAccounts`.
- RED tenant: el contrato exigió el join `primary_service.businessId = appointment.businessId` y el caso puro `TENANT_MISMATCH` antes del fix.
- RED escritura parcial: un miembro coordinado ya enlazado dejó inicialmente `accounts: 4`, `links: 5`; el preflight grupal corrigió la operación a cero escrituras del grupo conflictivo.
- `npm run test:appointment-account-backfill-pg`: PASS unitario/estático; PG dinámico `SKIP` por ausencia de `TEST_DATABASE_URL`.
- `npm run test:cash-sessions-pg`: PASS unitario/estático; PG `SKIP`.
- `npm run test:cash-schema-pg`: PASS estático; PG `SKIP`.
- `npx tsx scripts/cash-domain-contract-test.ts`: PASS.
- `npm run test:manual-appointment-deposit`: PASS.
- `npm run test:deposits`: 22 PASS.
- `npx prisma validate`: PASS.
- `npm run test:text-encoding`: PASS.
- `npx tsc --noEmit --pretty false`: el filtro focalizado no reportó errores en los tres archivos F4; el proyecto mantiene errores globales preexistentes.

### Riesgos pendientes

- La ruta dinámica PostgreSQL quedó escrita pero no se ejecutó porque no existe `TEST_DATABASE_URL`; debe correrse contra una base de prueba ya migrada antes del rollout.
- No se ejecutó el backfill contra ningún ambiente ni se creó comando de producción; F8 deberá definir flag, auditoría y operación controlada.

### Próximo lote

F5 — cobros y señas. No iniciado.

## Lote F5 — Cobros y señas

### Tareas completadas

- [x] 5.1 Contrato focalizado para pago simple/mixto, sesión vigente, total estimativo, descuento nominal entero y carrera de sobrepago.
- [x] 5.2 Lectura de cuenta/saldo y escritura atómica de cobros manuales en el ledger común, con lock y hora DB.
- [x] 5.3 Proyección transaccional de aprobaciones WEB/F8 exactamente una vez, asociada a sesión activa cuando existe y permitida fuera de sesión.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 5.1 | `scripts/cash-payment-pg-contract-test.ts` | Unit + source + PostgreSQL opcional | F2–F4, `appointment-payload` y Booking V2 verdes | El contrato original exigió las operaciones todavía ausentes; la auditoría agregó un RED para el replay de seña que fallaba por no detectar proyección existente | Contrato unitario/estático verde | Pago simple y mixto, sesión stale, total fijo/estimativo, descuento entero, descuento bajo pagado y carrera PG con dos cobros por el saldo completo | Casos PG quedaron agrupados en fixture aislada, con guardia segura y limpieza tenant-scoped |
| 5.2 | mismo contrato | Servicio + repositorio Prisma | Contratos Caja F2–F4 verdes | Cuenta/saldo, updates y writers no existían al iniciar el lote | El servicio valida el lote antes del insert, exige sesión vigente, bloquea negocio/cuenta y calcula saldo antes de escribir | Orígenes Agenda/Caja, tres medios, pago parcial/completo/mixto y dos solicitudes concurrentes | Cálculos monetarios reutilizan `calculateAccountTotals`; acceso SQL queda encapsulado en el repositorio |
| 5.3 | mismo contrato + contratos WEB/F8 focalizados | Integración transaccional + PostgreSQL opcional | `manual-appointment-deposit`, `bot-options-f8-review-pure` y Booking V2 verdes | La revisión detectó que un replay podía recalcular saldo incluyendo su propia seña y fallar como sobrepago antes del `ON CONFLICT` | La proyección consulta la fila idempotente después de bloquear depósito/cuenta y retorna `created:false` antes del control de saldo | WEB legacy en sus dos aprobadores, F8 bot/web, repetición y proyección con/sin sesión; PG verifica dos depósitos y dos filas TRANSFER | El proyector transaccional es compartido por los tres aprobadores y conserva el origen explícito |

### Comportamiento implementado

- `getAppointmentFinance` resuelve o crea la cuenta tenant-safe y calcula acordado, descuento, total final, pagado y saldo sobre el ledger append-only.
- El total sólo se actualiza en cuentas `ESTIMATED`; el descuento usa un entero nominal y ambos cambios se rechazan si dejarían el total final por debajo de lo ya pagado.
- El cobro manual exige jornada y sesión abiertas, rechaza token stale, valida todas las líneas antes de insertar y persiste el lote dentro de una única transacción con hora obtenida mediante `clock_timestamp()`.
- El lock de negocio serializa el flujo y `FOR UPDATE OF account` protege la cuenta; dos intentos sobre el mismo saldo no pueden crear saldo a favor.
- Las señas aprobadas se registran como `PAYMENT/TRANSFER`, con origen `WEB_DEPOSIT` o `BOT_DEPOSIT`; toman la sesión abierta si existe y quedan con jornada/sesión nulas si Caja está cerrada.
- La idempotencia se verifica después de bloquear depósito y cuenta, pero antes de recalcular saldo: un replay devuelve la proyección existente y no se confunde con sobrepago.
- Las dos aprobaciones WEB legacy y la aprobación F8 proyectan dentro de la misma transacción que confirma la reserva; un fallo financiero revierte toda la aprobación.

### Pruebas

- RED de auditoría: `npm run test:cash-payments-pg` falló con `el reintento de una seña debe reconocer la proyección existente`.
- GREEN: `npm run test:cash-payments-pg`: PASS unitario/estático; PG dinámico `SKIP` explícito porque falta `TEST_DATABASE_URL`.
- `npm run test:cash-schema-pg`: PASS estático; PG `SKIP`.
- `npm run test:cash-sessions-pg`: PASS unitario/estático; PG `SKIP`.
- `npm run test:appointment-account-backfill-pg`: PASS unitario/estático; PG `SKIP`.
- `npm run test:appointment-payload`: PASS.
- `npm run test:manual-appointment-deposit`: PASS.
- `npm run test:bot-options-f8-review-pure`: PASS.
- `npm run test:booking-v2`: 247 PASS.
- `npm run test:text-encoding`: PASS.
- `npm run test:bot-options-f8-review-pg`: no ejecutable porque falta su base F8 segura; no se utilizó una base no autorizada.
- `npm run test:deposit-security`: FAIL preexistente por documentación F8.1 desactualizada, fuera de `crm-caja`; no se modificó.
- `npx tsc --noEmit`: no produjo un resultado consumible dentro del límite de ejecución; los contratos `tsx` focalizados compilaron y pasaron.

### Riesgos pendientes

- La ruta PostgreSQL completa de pagos/concurrencia/señas quedó escrita pero no se ejecutó por ausencia de `TEST_DATABASE_URL`; debe correrse contra una base de prueba ya migrada antes del rollout.
- El contrato PG histórico de revisión F8 usa su propia variable obligatoria y no admite `SKIP`; la cobertura común de este lote quedó en el contrato Caja seguro y en la regresión pura F8.
- Persisten fallas ajenas al lote en `test:deposit-security`; no se corrigieron para respetar el alcance exclusivo F5.

### Próximo lote

F6 — operaciones, RBAC y API. No iniciado en este turno.

## Lote F6 — Operaciones, RBAC y API

### Tareas completadas

- [x] 6.1 Operaciones generales y contrapartidas append-only con sesión vigente, hora DB y aislamiento tenant.
- [x] 6.2 Seis permisos de Caja independientes, persistidos deny-by-default y resueltos con acceso implícito sólo para `BUSINESS_ADMIN`/`SUPER_ADMIN`.
- [x] 6.3 API de Caja y finanzas de Agenda con validación, RBAC, errores estables, filtros, búsqueda y cursor `(effectiveAt,id)`.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1 | `scripts/cash-operations-pg-contract-test.ts` | Unit + source + PostgreSQL opcional | Contratos F2–F5 verdes | Falló porque `CashService` no implementaba `recordCashOperation` | Servicio/repositorio pasan el contrato unitario/estático | Gasto no efectivo, retiro, ingreso, ajuste positivo/negativo, devolución, stale session, reversa y doble reversa; fixture PG cubre resumen/tenant/append-only | Normalización de cada operación quedó separada del writer SQL; reversa copia importe/medio/cuenta y opone dirección |
| 6.2 | `scripts/cash-permissions-contract-test.ts` | Unit + source/migration | `staff-secretary` verde | Falló porque los seis permisos no existían; un RED adicional mostró que cobros no habilitaban corregir su propio movimiento | Schema, migración, auth y resolución de permisos verdes | Staff sin permisos, permiso individual, preset CUSTOM, legacy financiero sin herencia, BUSINESS_ADMIN/SUPER_ADMIN implícitos y ACCOUNT_ADMIN denegado | `hasCashPermission` centraliza roles; el tipo de movimiento limita qué permiso permite su contrapartida |
| 6.3 | `scripts/cash-routes-contract-test.ts` | Integración Fastify + source | Servicios y RBAC F6 verdes | ENOENT porque no existía `cash-register.ts` | Rutas Caja/Agenda inyectadas con servicio falso pasan | 400/403/404/409, tenant autenticado, operación vs ajuste, permisos Agenda independientes, tipo/medio/query y `nextCursor` | Dependencia `CashService` es inyectable en contratos; errores se mapean en un único adaptador HTTP |

### Comportamiento implementado

- `EXPENSE` acepta CASH por defecto o medio explícito y exige descripción; `WITHDRAWAL` es sólo CASH y exige persona; `CASH_IN` exige descripción; `ADJUSTMENT` recibe delta no cero y observación; `REFUND` exige medio y descripción.
- Toda operación manual exige jornada/sesión abiertas, persiste `CASH_REGISTER`, usa hora leída de DB y queda atribuida a la sesión/responsable.
- Una corrección agrega `REVERSAL` exacta y opuesta, conserva el original y rechaza una segunda reversa o una reversa de reversa.
- Las contrapartidas también respetan permiso por tipo: pagos, operaciones generales y ajustes no se habilitan entre sí.
- Se agregaron `canViewCashRegister`, `canRecordAppointmentPayments`, `canApplyDiscounts`, `canManageCashOperations`, `canAdjustCash` y `canManageCashSessions` con default `false`; el preset `SECRETARY_CASHIER` los habilita explícitamente.
- `AuthUser`, login/me, gestión de staff y el guard de rutas transportan/aplican los permisos. Los permisos financieros legacy no conceden Caja.
- `cash-register.ts` expone estado actual, jornadas, resumen, movimientos paginados, apertura, Nueva sesión, cierre, operaciones y contrapartidas; quedó registrado después del guard de autenticación.
- `appointment.ts` expone cuenta/historial, total estimativo, descuento y pagos; el permiso de cobro de Agenda no depende de ver Caja.
- Las lecturas filtran siempre por `businessId`; búsqueda cubre cliente, descripción, contraparte y observación. El cursor base64url conserva el orden descendente estable `(effectiveAt,id)` sin duplicados.
- Los errores se normalizan como `400 VALIDATION`, `403 CASH_PERMISSION_REQUIRED`, `404 NOT_FOUND` y conflictos `409` (`CASH_CLOSED`, `STALE_SESSION`, `OVERPAYMENT`, `OPEN_DAY_EXISTS`, entre otros).

### Pruebas

- RED 6.1: `cash-operations-pg-contract-test.ts` falló por ausencia de `recordCashOperation`.
- RED 6.2: `cash-permissions-contract-test.ts` falló porque `canViewCashRegister` y los demás permisos no existían.
- RED 6.3: `cash-routes-contract-test.ts` falló con ENOENT para `src/routes/cash-register.ts`.
- `npm run test:cash-operations-pg`: PASS unitario/estático; PG `SKIP` explícito sin `TEST_DATABASE_URL`.
- `npm run test:cash-permissions`: PASS.
- `npm run test:cash-routes`: PASS con Fastify inject.
- Contratos `cash-schema`, `cash-sessions`, `appointment-account-backfill` y `cash-payments`: PASS; PG `SKIP` sin URL segura.
- `npm run test:staff-secretary`: PASS.
- `npm run test:deposits`: 22 PASS.
- `npm run test:booking-v2`: 247 PASS.
- `npx prisma validate`: PASS.
- `npm run test:text-encoding`: PASS.
- `npx tsc --noEmit --pretty false`: FAIL global por errores preexistentes; el filtro focalizado no reportó errores F6.

### Riesgos pendientes

- Los casos PostgreSQL reales de F6 están preparados, pero no se ejecutaron porque falta `TEST_DATABASE_URL` segura y ya migrada.
- El cliente Prisma generado permanece sujeto al `prisma generate` normal del arranque/despliegue; no se ejecutó generación ni build en este lote.
- La publicación post-commit y la UI permanecen fuera de alcance hasta F7.

### Próximo lote

F7 — realtime y UI. No iniciado en este turno.

## Lote F7 — Realtime y UI

### Tareas completadas

- [x] 7.1 Notificaciones PostgreSQL/SSE posteriores al commit, tenant-scoped y sin entrega duplicada entre streams.
- [x] 7.2 Caja integrada al CRM con navegación, jornadas, responsables, historial, filtros, paginación y estados vacíos.
- [x] 7.3 Finanzas desplegables en Agenda, preservación del turno/borrador al abrir Caja y ausencia de diálogos nativos.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 7.1 | `scripts/cash-realtime-ui-contract-test.ts` | Source + PostgreSQL opcional | Contratos F6 y realtime CRM verdes | El contrato se amplió primero para exigir silencio antes de COMMIT, silencio luego de ROLLBACK y una única notificación luego de COMMIT | Contrato estático/unitario verde; rama PG quedó en `SKIP` explícito por ausencia de `TEST_DATABASE_URL` | Suscriptor del tenant propio recibe el cambio y el tenant ajeno no recibe payload; precommit, rollback y commit quedan separados | Los streams `/crm/events` y `/crm/cash-events` filtran tipos mutuamente excluyentes para evitar entrega doble |
| 7.2 | mismo contrato + `scripts/cash-permissions-contract-test.ts` + `scripts/crm-ui-inline-syntax-test.ts` | UI source/integración | Rutas y permisos F6 verdes | El contrato exigió que una jornada histórica cargara su propio resumen y que responsables activos fueran visibles según permiso | UI, permisos y sintaxis ejecutaron en verde | Estado actual, jornada histórica, responsable, filtros, paginación y vacíos | Caja quedó aislada en `src/routes/crm-ui/cash-register.ts` para no seguir inflando el shell principal |
| 7.3 | `scripts/cash-realtime-ui-contract-test.ts` | UI source/integración | UI Caja 7.2 verde | El contrato exigió que cancelar “Abrir caja” restaurara la Agenda, el modal del turno y el borrador previo | Contrato verde para cancelar y para abrir Caja desde el CTA financiero | Cancelar restaura turno/borrador; abrir navega a Caja conservando el contexto de retorno | El flujo reutiliza feedback y modales integrados; no usa `alert`, `confirm` ni `prompt` |

### Evidencia ejecutada

- `npm run test:cash-realtime-ui`: PASS estático/unitario; la rama PostgreSQL informó `SKIP` porque no existe `TEST_DATABASE_URL`.
- `npm run test:cash-permissions`: PASS.
- `npm run test:crm-ui-syntax`: PASS.
- El contrato PG conserva aserciones explícitas para precommit, rollback y commit; no se declara como ejecutado sin una base segura.

## Lote F8 — Rollout y aceptación

### Tareas completadas

- [x] 8.1 Feature flag cerrado por defecto, fallback legacy obligatorio durante todo el MVP y auditoría/backfill tenant-scoped, reanudable e idempotente.
- [x] 8.2 Aceptación integral ejecutada sobre Caja, Agenda, depósitos, bot, RBAC, tenant, concurrencia, SSE, Prisma, TypeScript y UTF-8.
- [x] 8.3 Runbook operativo de activación, backfill, operación, rollback y recuperación documentado sin acciones destructivas sobre el ledger.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 8.1 | `scripts/cash-rollout-contract-test.ts` | Unit + source | Contratos F1–F7 focalizados verdes | El contrato rechazó que `CASH_REGISTER_LEGACY_FALLBACK_ENABLED=false` fuese aceptado con Caja activa | `resolveCashRegisterConfig` ahora falla cerrado siempre que se intente apagar el fallback durante el MVP | Flag omitido/apagado/encendido, valores no booleanos y fallback inválido; UI/rutas/listener condicionados | Regla de compatibilidad quedó centralizada en la configuración |
| 8.2 | Contratos `cash-*`, Agenda, depósitos, bot y realtime | Integración + source + PostgreSQL opcional | Suite focalizada F1–F7 verde; `deposit-security` ya fallaba por documentación ajena | El único RED propio fue la política incompleta del fallback de 8.1 | Todos los contratos propios de `crm-caja` pasan; Prisma y UTF-8 pasan | RBAC positivo/negativo, tenant, carreras, SSE separado, flag on/off, pagos/señas con/sin sesión | Sin cambios fuera del RED propio; fallas globales preexistentes quedaron reportadas |
| 8.3 | `scripts/cash-rollout-contract-test.ts` | Source/runbook | Runbook existente auditado contra diseño y spec | El contrato de rollout completo permanecía rojo hasta corregir 8.1 | El mismo contrato valida variables, auditoría/backfill y prohibición de SQL destructivo | Preflight, activación, operación, rollback y recuperación idempotente cubiertos | Documentación separa claramente audit de apply y preserva ledger |

### Comportamiento implementado

- `CASH_REGISTER_ENABLED` queda apagado por defecto y controla UI, API financiera, proyección nueva y listener realtime.
- `CASH_REGISTER_LEGACY_FALLBACK_ENABLED` queda encendido por defecto y no puede apagarse durante el MVP, esté Caja activa o no; su retiro sigue reservado a 9.1.
- `cash:rollout` exige `businessId`, audita sin mutar por defecto y sólo aplica backfill con `--apply` más `CASH_REGISTER_BACKFILL_APPLY=true` exacto.
- La auditoría reporta zona, cuentas/enlaces, pagos legacy, señas aprobadas pendientes y cantidad de entradas; la activación sólo queda lista sin faltantes ni conflictos.
- El rollback apaga el flag y conserva cuentas, enlaces y `CashEntry`; jamás revierte ni borra el ledger.

### Pruebas de aceptación

- PASS: `test:cash-schema-pg`, `test:cash-sessions-pg`, `test:cash-payments-pg`, `test:cash-operations-pg`, `test:appointment-account-backfill-pg`; cada rama PostgreSQL informó `SKIP` explícito porque no existe `TEST_DATABASE_URL` segura.
- PASS: `test:cash-permissions`, `test:cash-routes`, `test:cash-realtime-ui`, `test:cash-rollout`, `test:staff-secretary`, `test:agenda-business-scope`.
- PASS: `test:appointment-payload`, `test:manual-appointment-deposit`, `test:deposits` (22), `test:bot-options-f8-review-pure`, `test:bot-options-f8-terms`.
- PASS: `test:crm-realtime-events`, `test:appointment-realtime-db`, `test:crm-ui-syntax`, `test:crm-ui-interactive`.
- PASS: `npx prisma validate` y `npm run test:text-encoding`.
- `npx tsc --noEmit --pretty false`: FAIL global con 481 líneas de diagnósticos preexistentes en áreas ajenas; el filtro focalizado encontró sólo `src/routes/crm.ts:2094`, también ajeno al flujo Caja (`conversation.businessId` nullable al enviar WhatsApp). No se alteró por alcance.
- `test:deposit-security`: FAIL preexistente por una frase requerida en `docs/nuevo-bot/security-and-privacy-runbook.md`, ajena a `crm-caja`; no se modificó.
- Contratos bot F8 PostgreSQL: `SKIP` operativo explícito; faltan `TEST_DATABASE_URL`, `BOT_OPTIONS_F8_TEST_DATABASE_URL` y `DATABASE_URL`, por lo que no se usó ninguna base no autorizada.

### Riesgos pendientes

- Antes del rollout real se deben ejecutar las ramas PostgreSQL contra una base de prueba segura, ya migrada y autorizada.
- El repositorio completo todavía no cumple `tsc --noEmit`; las fallas no fueron introducidas ni corregidas por este lote para evitar tocar trabajo ajeno.
- La regresión histórica `deposit-security` continúa roja fuera del cambio `crm-caja`.

### Próximo lote

F8 MVP completo. Las tareas 9.1 y 9.2 continúan pendientes y no fueron implementadas.

## Remediación posterior a verify

### Tareas completadas

- [x] R1 El SSE resuelve tenant deny-by-default: BUSINESS_ADMIN y STAFF ignoran `query.businessId`; sólo SUPER_ADMIN puede seleccionar explícitamente otro negocio.
- [x] R2 El rollout aplica una segunda pasada paginada sobre señas aprobadas, reutiliza el proyector transaccional y reporta creadas, replays y conflictos por depósito.
- [x] R3 La proyección obtiene el advisory lock del negocio antes de leer/bloquear depósito y cuenta; los aprobadores toman el mismo lock antes de asegurar la cuenta.
- [x] R4 El preflight valida IANA realmente, los pagos legacy se comparan por ID determinístico de su turno, la UI usa `Business.timezone` y el runbook explicita el alcance global del flag.
- [x] R5 Se incorporó arriba la evidencia faltante de F7, distinguiendo lo ejecutado de la rama PG omitida.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| R1 | `scripts/cash-realtime-ui-contract-test.ts` | Fastify + source | `test:cash-realtime-ui` verde antes del cambio | Falló porque `resolveCrmRealtimeBusinessId` no existía | BUSINESS_ADMIN/STAFF quedan en tenant autenticado y SUPER_ADMIN selecciona tenant explícito | Dos roles no privilegiados, SUPER_ADMIN con tenant y SUPER_ADMIN sin tenant | La resolución tenant quedó en función pura reutilizada por el endpoint real |
| R2 | `scripts/cash-payment-pg-contract-test.ts`, `scripts/cash-rollout-contract-test.ts` | Unit + source + PG opcional | `test:cash-payments-pg` y `test:cash-rollout` verdes | Fallaron por ausencia de `backfillApprovedDeposits` y de su integración al APPLY | Ambos contratos verdes | Creación, replay, conflicto, cursor y lote inválido | La selección tenant-scoped vive en repositorio y el procesamiento/reporte en servicio |
| R3 | `scripts/cash-payment-pg-contract-test.ts` | Source + PostgreSQL opcional | Contrato F5 verde | Falló al exigir lock negocio→cuenta en cada aprobador | Contrato estático verde | Se agregó carrera PG proyección-vs-cierre: ambos deben completar y una vinculación sólo puede preceder al cierre | Todos los caminos comparten el advisory lock `cash-register:<businessId>`; PG queda `SKIP` explícito sin base segura |
| R4 | `scripts/cash-rollout-contract-test.ts`, `scripts/cash-realtime-ui-contract-test.ts` | Unit + source | Contratos rollout/UI verdes | Fallaron al exigir validación IANA, correspondencia determinística, zona del negocio y advertencia del flag global | Contratos verdes | ID estable/cross-tenant distinto y zona canónica aplicada a todas las fechas de Caja | Se reutilizan `assertIanaTimezone` y `legacyPaymentEntryId`; no se agrega configuración paralela |

### Pruebas ejecutadas

- PASS: `test:cash-payments-pg`, `test:cash-rollout`, `test:cash-realtime-ui`, `test:egress-baseline:lifecycle`, `test:deposits` (22), `test:booking-v2` (247), `npx prisma validate` y `test:text-encoding`.
- `npx tsc --noEmit --pretty false` continúa rojo globalmente, pero el filtro no reportó diagnósticos en los archivos de esta remediación.
- Las ramas PostgreSQL de Caja continúan en `SKIP` explícito porque `TEST_DATABASE_URL` no está definida; no se usó ninguna base no autorizada.
- No se ejecutaron build, migraciones, backfill real, commit, push ni deploy.

## Remediación posterior a la re-verificación

### Tareas completadas

- [x] C1 Se eliminaron `TS7022` y `TS7006` del rollout tipando explícitamente el lote de turnos, los IDs esperados y el parámetro del callback.
- [x] C2 El contrato PG de pagos ahora cubre también proyección de seña contra **Nueva sesión** con una barrera sobre el mismo advisory lock del negocio.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| C1 | `scripts/cash-rollout-contract-test.ts` + `npx tsc --noEmit` | TypeScript/source | `test:cash-rollout` verde | La re-verificación reportó `TS7022` en `appointments` y `TS7006` en el callback de `map` | El typecheck global sigue rojo por deuda ajena, pero ahora informa **0 diagnósticos** en `cash-register-rollout.ts` y `cash-payment-pg-contract-test.ts` | Lote y callback tienen tipos explícitos sin cambiar la consulta ni el cálculo determinístico | Cambio exclusivamente de tipos; `test:cash-rollout` continúa verde |
| C2 | `scripts/cash-payment-pg-contract-test.ts` | PostgreSQL concurrente opcional | `test:cash-payments-pg` verde estático/unitario | La re-verificación rechazó R3 porque sólo existía la carrera contra cierre y faltaba Nueva sesión | El contrato quedó compilado y su rama está lista para ejecutarse con `TEST_DATABASE_URL` segura | La barrera toma `cash-register:<businessId>`, encola primero Nueva sesión y luego la proyección; al liberar exige atribución a la sesión nueva y nunca a la cerrada | Se extrajo `waitForCashLockWaiters` para observar esperas reales en `pg_locks`; ejecución PG en `SKIP` por falta de base segura |

### Pruebas ejecutadas

- PASS: `test:cash-payments-pg` (rama PostgreSQL `SKIP`: falta `TEST_DATABASE_URL`) y `test:cash-rollout`.
- `npx tsc --noEmit --pretty false`: exit 2 por deuda global preexistente, 482 líneas; **0 diagnósticos focalizados** en los dos archivos remediados.
- PASS: `npx prisma validate`, `test:text-encoding` y `git diff --check`.
- No se ejecutaron build, migraciones, backfill real, commit, push ni deploy.

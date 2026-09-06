# Design: Caja del CRM y pagos de turnos

## Enfoque técnico

Agregar un módulo `cash` (rutas → servicios → Prisma) y mantener Agenda como otra entrada al mismo agregado financiero. PostgreSQL conserva invariantes, idempotencia y eventos post-commit; `crm-ui.ts` sólo presenta contratos HTTP.

## Decisiones de arquitectura

| Decisión | Alternativa | Razón |
|---|---|---|
| `AppointmentAccount` + `AppointmentAccountLink` | FK polimórfica a turno/grupo/visita | Una cuenta enlaza N `Appointment`; `appointmentId` único impide doble cuenta. `BookingVisit` y `coordinationGroupId` sólo resuelven/backfillean enlaces, no son FK financieras. |
| `CashRegisterDay`, `CashSession`, `CashEntry` append-only | Totales mutables o doble partida | La jornada cruza medianoche; sesiones cambian responsable; el ledger cubre MVP sin contabilidad formal. |
| `amount > 0` + `direction` | Importes con signo | `INFLOW/OUTFLOW` evita ambigüedad; `reversesEntryId` único crea contrapartida opuesta. UPDATE/DELETE se rechazan por trigger. |
| Hora DB y zona `Business.timezone` IANA | Zona del navegador/bot | `effectiveAt=clock_timestamp()` no editable; la jornada, no el día calendario, delimita métricas. |

## Modelo e invariantes

Enums: `AppointmentPricingMode(FIXED,ESTIMATED)`, `CashEntryType(PAYMENT,LEGACY_PAYMENT,EXPENSE,WITHDRAWAL,CASH_IN,ADJUSTMENT,REFUND,REVERSAL)`, `CashDirection(INFLOW,OUTFLOW)`, `CashPaymentMethod(CASH,TRANSFER,CARD,UNSPECIFIED)`, `CashEntryOrigin(AGENDA,CASH_REGISTER,WEB_DEPOSIT,BOT_DEPOSIT,MIGRATION)`; Mercado Pago=`TRANSFER`.

`AppointmentAccount(businessId, pricingMode, agreedAmount?, discountAmount=0)`; precio fijo inmutable, estimativo editable sólo hasta valor válido. `AppointmentAccountLink(businessId,accountId,appointmentId)` usa FKs compuestas. Se agrega/backfillea `Appointment.businessId` y `@@unique([businessId,id])` para no confiar en joins indirectos. Simple/visit enlazan un turno; web coordinada enlaza todos los del grupo; manuales individuales quedan separados. Toda consulta resuelve por link. `CashEntry` lleva `businessId`, `accountId?`, `registerDayId?`, `cashSessionId?`, tipo/medio/dirección/importe/origen/observación, `bookingDepositId? @unique`, `reversesEntryId? @unique`, `effectiveAt` DB. `CashRegisterDay` guarda apertura/cierre, efectivo inicial/esperado/contado; `CashSession`, apertura/cierre y controles, referencia usuario activo tenant-safe y guarda nombre snapshot. Todas las relaciones nuevas usan `(businessId,id)`.

Migración SQL aplica CHECKs coherentes por tipo/medio, importe positivo, contrapartida opuesta y descripción obligatoria donde corresponda; índices `(businessId,effectiveAt,id)`, `(registerDayId,effectiveAt,id)`, cuenta y búsqueda. Índices parciales únicos garantizan una jornada y una sesión abiertas por negocio. Prisma no expresa CHECK/partial-index/triggers: quedan en `migration.sql` y contratos PostgreSQL.

Fórmulas (`INFLOW=+`, `OUTFLOW=−`): `final=agreed-discount`; `paid=Σ signed(PAYMENT|LEGACY_PAYMENT|sus REVERSAL)`; `balance=final-paid`, siempre `>=0`. Jornada: `gross=Σ PAYMENT inflow`; `refunds=Σ REFUND outflow`; `net=gross-refunds-EXPENSE`; por medio suma su tipo/dirección. `expectedCash=openingCash+CASH payments+CASH_IN±CASH adjustments-CASH expenses-WITHDRAWAL-CASH refunds`.

## Flujos y concurrencia

```text
Agenda/Caja → CashService → tx(lock business/account) → validar tenant/sesión/saldo → ledger
                                                            ↓ commit
                                                NOTIFY cash_changed → LISTEN → SSE
```

Pago mixto bloquea cuenta, valida todas las líneas y las inserta juntas; nunca sobrepaga. Abrir/cerrar/Nueva sesión bloquean negocio: Nueva sesión cierra y abre al mismo `dbNow`, registra esperado/contado/diferencia sin ajuste; cierre finaliza jornada/sesión y la próxima apertura hereda efectivo esperado. Control y ajuste son operaciones separadas. Aprobadores web legacy y F8 bot proyectan `BookingDeposit` dentro de su transacción; unique hace reintentos idempotentes y permite `cashSessionId=null`. Sólo se notifica por trigger AFTER commit.

## API y UI

`GET /appointments/:id/finance`; `PATCH .../estimated-total`; `PATCH .../discount`; `POST .../payments {lines:[{amount,method}],observation?}`. Caja: `GET /cash-register/current|days|days/:id/summary|days/:id/entries?cursor&type&method&q`; `POST /cash-register/open|new-session|close|entries|entries/:id/reverse`. Cursor estable `(effectiveAt,id)`; respuestas incluyen resumen, permisos y `nextCursor`. Errores: `400 VALIDATION`, `403 CASH_PERMISSION_REQUIRED`, `404 NOT_FOUND`, `409 CASH_CLOSED|STALE_SESSION|OVERPAYMENT|OPEN_DAY_EXISTS`.

`crm-ui.ts` agrega navegación Caja, estados abrir/abierta/cerrada, modales integrados de jornada/sesión, dashboard, filtros y carga incremental. Agenda agrega acordeón “Pago del turno” cerrado; conserva borrador en estado cliente mientras abre Caja. Sin diálogos nativos.

RBAC nuevo en `User`, `auth.ts` y `staff-permission-service.ts`: `canViewCashRegister`, `canRecordAppointmentPayments`, `canApplyDiscounts`, `canManageCashOperations`, `canAdjustCash`, `canManageCashSessions`; STAFF deny-by-default por ruta, BUSINESS_ADMIN/SUPER_ADMIN implícitos, ACCOUNT_ADMIN no. Realtime usa canal/trigger/listener `cash_changed` y `/crm/cash-events`, tenant-scoped, sin permiso de conversaciones.

## Archivos y rollout/TDD

Modificar `prisma/schema.prisma`, migración nueva, `src/routes/{appointment,cash-register,crm-ui,auth}.ts`, `src/services/{cash-service,staff-permission-service,crm-realtime-events}.ts`, listener y `server.ts`; crear contratos en `scripts/`.

Orden RED/GREEN: dominio puro (fórmulas); PostgreSQL (constraints, locks, concurrencia, tenant, append-only); rutas/RBAC; aprobación web+F8; UI/SSE/E2E; regresión Agenda/señas y UTF-8. Rollout aditivo: zona nullable → backfill desde settings válidos o carga administrativa (Caja falla cerrada) → cuentas por `BookingVisit`, por `(businessId,coordinationGroupId)` web y por turno manual → depósitos aprobados idempotentes; legacy manual crea `UNSPECIFIED` sin jornada/fecha histórica. Lectura nueva con fallback legacy durante flag; luego dejar de escribir campos legacy. Rollback apaga flag y conserva ledger; no se destruyen datos.

## Riesgos

Carreras de cobro/sesión, duplicación entre dos aprobadores, grupos legacy inconsistentes, zonas faltantes y exposición SSE; se mitigan con locks, uniques, backfill reportable, fail-closed y pruebas negativas tenant/RBAC.

## Preguntas abiertas

Ninguna bloqueante.

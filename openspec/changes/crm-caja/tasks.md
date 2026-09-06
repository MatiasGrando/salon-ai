# Tasks: Caja del CRM y pagos de turnos

> MVP F8; RED→GREEN→regresión. `D`=dependencias. Sin build.

## F1 — Dominio y tiempo

- [x] 1.1 **RED:** crear `scripts/cash-domain-contract-test.ts` para fórmulas, enteros, descuento, saldo/no sobrepago, signos, reversas y métricas. D: ninguna.
- [x] 1.2 **GREEN:** crear `src/services/cash-domain.ts`; pasar 1.1 sin I/O. D: 1.1.
- [x] 1.3 **RED/GREEN:** cubrir zona IANA, transmedianoche y efectivo heredado; agregar/backfillear `Business.timezone` y settings. D: 1.2.

## F2 — Persistencia segura

- [x] 2.1 **RED:** crear `scripts/cash-schema-pg-contract-test.ts` para tenant, CHECKs, FKs compuestas, únicos parciales, append-only e idempotencia. D: F1.
- [x] 2.2 **GREEN:** modificar `prisma/schema.prisma` y nueva `prisma/migrations/*/migration.sql` con `CashRegisterDay`, `CashSession`, `AppointmentAccount/Link`, `CashEntry`, enums, índices y triggers. D: 2.1.
- [x] 2.3 **REGRESIÓN:** validar PostgreSQL y `npx prisma validate`; checkpoint `feat(caja): agregar persistencia financiera`. D: 2.2.

## F3 — Jornadas y sesiones

- [x] 3.1 **RED:** crear `scripts/cash-session-pg-contract-test.ts`: abrir/cerrar/nueva, concurrencia, responsable tenant-safe, controles sin ajuste y arrastre. D: F2.
- [x] 3.2 **GREEN:** crear `src/services/cash-service.ts` y repositorio Prisma transaccional; usar reloj DB y locks por negocio. D: 3.1.
- [x] 3.3 **REGRESIÓN:** probar medianoche y carreras de sesión. D: 3.2.

## F4 — Cuenta y migración legacy

- [x] 4.1 **RED:** crear `scripts/appointment-account-backfill-pg-contract-test.ts` para simple, coordinada, `BookingVisit`, precio congelado y legacy `UNSPECIFIED`. D: F2.
- [x] 4.2 **GREEN:** implementar backfill reportable y resolución en `cash-service.ts`; no inventar fecha/medio. D: 4.1.
- [x] 4.3 **REGRESIÓN:** probar enlaces únicos, grupos inconsistentes y aislamiento. D: 4.2.

## F5 — Cobros y señas

- [x] 5.1 **RED:** crear `scripts/cash-payment-pg-contract-test.ts`: simple/mixto, sesión, estimativo, descuento monto y sobrepago concurrente. D: F3–F4.
- [x] 5.2 **GREEN:** implementar cuenta/saldo y escritura atómica en `cash-service.ts`; adaptar Agenda. D: 5.1.
- [x] 5.3 **RED/GREEN:** extender contratos WEB/F8; proyectar señas aprobadas una vez, con/sin sesión. D: 5.2.

## F6 — Operaciones, RBAC y API

- [x] 6.1 **RED/GREEN:** contrato PG y servicio de gastos, retiros, ingresos, ajustes, devoluciones y contrapartidas. D: F5.
- [x] 6.2 **RED/GREEN:** extender permisos en `schema.prisma`, `auth.ts`, `staff-permission-service.ts`; contrato deny-by-default y ADMIN/SUPER_ADMIN implícitos. D: F2.
- [x] 6.3 **RED/GREEN:** crear `src/routes/cash-register.ts`, ampliar `appointment.ts`; cubrir errores, tenant, cursor, filtros y búsqueda. D: 6.1–6.2.

## F7 — Realtime y UI

- [x] 7.1 **RED/GREEN:** contrato PostgreSQL/SSE post-commit tenant-scoped; ampliar `crm-realtime-events.ts`, listener y `server.ts`. D: F6.
- [x] 7.2 **RED/GREEN:** dividir Caja en `src/routes/crm-ui/`: navegación, sesiones, tablero, operaciones, filtros, paginación y vacíos. D: 6.3.
- [x] 7.3 **RED/GREEN:** agregar acordeón Agenda, total/descuento/historial/pago y CTA sin sesión preservando borrador; sin diálogos nativos. D: 7.2.

## F8 — Rollout y aceptación

- [x] 8.1 Agregar flag, fallback legacy y auditoría/backfill; checkpoint reversible conserva ledger. D: F4–F7.
- [x] 8.2 Ejecutar contratos Caja, Agenda, depósitos, bot, RBAC, tenant, concurrencia, SSE, `npx tsc --noEmit` y `npm run test:text-encoding`; corregir sólo por RED→GREEN. D: 8.1.
- [x] 8.3 Documentar operación/rollback en `docs/cash-register.md`; commits sugeridos por F3, F6, F7 y rollout. D: 8.2.

## Remediación posterior a verify

- [x] R1 **RED/GREEN:** cerrar selección SSE cross-tenant y cubrir BUSINESS_ADMIN/STAFF/SUPER_ADMIN con Fastify.
- [x] R2 **RED/GREEN:** proyectar señas aprobadas históricas mediante backfill tenant-scoped, paginado, reanudable e idempotente, con replays y conflictos reportados.
- [x] R3 **RED/GREEN:** serializar proyección de señas y cierres/Nueva sesión con orden de locks negocio→cuenta; agregar contrato PostgreSQL concurrente con `SKIP` seguro cuando falta base.
- [x] R4 **REGRESIÓN:** validar zona IANA en rollout, auditar pagos legacy por ID determinístico, formatear Caja en zona del negocio y documentar activación global sólo tras auditar todos los tenants.
- [x] R5 **EVIDENCIA:** incorporar la evidencia TDD veraz faltante de F7 al progreso acumulado.

## Posterior al MVP

- [ ] 9.1 Retirar flag/campos legacy sólo tras auditoría estable; migración destructiva separada.
- [ ] 9.2 Evaluar recibos, exportaciones, conciliación, comisiones, saldo a favor y doble partida como cambios independientes.

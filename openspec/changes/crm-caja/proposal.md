# Proposal: Caja del CRM y pagos de turnos

## Intent

Incorporar una Caja con cobros desde Agenda o Caja sobre una cuenta por reserva, control de efectivo y acceso por permisos.

## Scope

### In Scope
- Jornadas que cruzan medianoche, sesiones por responsable y efectivo heredado.
- Cuenta única por reserva/grupo coordinado; total editable sólo para estimativos, descuentos y saldo común.
- Pagos simples/mixtos sin sobrepago y señas aprobadas idempotentes.
- Gastos, retiros, ingresos, ajustes, devoluciones generales y contrapartidas.
- Ledger común, filtros, realtime, permisos y aislamiento tenant.
- Backfill legacy sin inventar medio, fecha ni totales históricos.

### Out of Scope
- Facturación fiscal, comisiones, saldos a favor, conciliación automática, exportaciones, recibos y contabilidad de doble partida.

## Capabilities

### New Capabilities
- `appointment-finance`: cuenta, precio definitivo, descuentos, pagos, señas y saldo de reservas simples/coordinadas.
- `cash-register`: jornadas, sesiones, movimientos, filtros y totales.
- `cash-access-realtime`: permisos, aislamiento tenant y sincronización Agenda/Caja.

### Modified Capabilities
None.

## Approach

Agregar servicios financieros entre Fastify y Prisma con ledger append-only. Los pagos manuales requieren sesión; las señas se proyectan una vez y pueden quedar fuera de sesión. El servidor asigna hora según la zona IANA del negocio. `ADMIN`/`SUPER_ADMIN` acceden implícitamente; `STAFF`, mediante permisos explícitos. Transacciones, restricciones e idempotencia protegerán invariantes; los eventos se publicarán post-commit.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/` | Modified | Modelos, migraciones, permisos, zona e índices. |
| `src/routes/appointment.ts`, `crm.ts`, `public-booking.ts` | Modified | Agenda, señas y grupos. |
| `src/services/` | Modified | Invariantes, autorización y realtime. |
| `src/routes/crm-ui.ts` | Modified | Sección Caja y acordeón Pago del turno. |
| `scripts/` | Modified | Contratos UI, dominio, permisos y concurrencia. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicar señas/pagos concurrentes | High | Claves únicas, locks y pruebas PostgreSQL. |
| Exposición entre negocios/roles | High | `businessId` obligatorio y pruebas negativas por ruta. |
| Alterar historia legacy | Medium | Backfill conservador y despliegue aditivo. |
| Totales erróneos por horario | Medium | Zona canónica y jornada explícita, no día calendario. |

## Rollback Plan

Desactivar Caja y restaurar la lectura legacy de señas. Conservar tablas nuevas para auditoría; retirarlas sólo si no contienen movimientos exclusivos.

## Dependencies

- Zona IANA por negocio y backfill validado.

## Success Criteria

- [ ] Agenda y Caja reflejan la misma cuenta, sin sobrepagos ni duplicación de señas.
- [ ] Totales, efectivo heredado y sesiones permanecen correctos al cruzar medianoche.
- [ ] Todos los endpoints respetan permisos y `businessId`; realtime sólo notifica al tenant correcto.
- [ ] Correcciones conservan historial y el backfill no inventa medio ni fecha.

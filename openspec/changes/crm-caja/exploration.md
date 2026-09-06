## Exploration: Caja del CRM y pagos de turnos

### Current State

- El CRM es un monolito modular Fastify: rutas HTTP, servicios de dominio y Prisma; la interfaz completa se genera desde `src/routes/crm-ui.ts`.
- `Appointment` guarda precio cotizado y dos campos legacy de seña manual (`manualDepositPaid`, `manualDepositAmount`), pero no existe una cuenta financiera del turno ni un historial de pagos, descuentos, devoluciones, gastos o caja.
- `BookingDeposit` representa la retención/seña del proceso de reserva, con estados y auditoría de comprobantes. Al aprobarse confirma el turno, pero hoy no proyecta un cobro reutilizable por Caja.
- Las reservas web coordinadas son varios `Appointment` enlazados por `coordinationGroupId`; la seña se asocia sólo al primer turno. El motor nuevo del bot usa `BookingVisit` como agregado y un `Appointment` con `AppointmentServiceItem[]`.
- Agenda ya ofrece un modal integrado Nuevo/Editar turno y un acordeón `Información adicional`; la seña manual actual vive allí. Los pagos deberán reemplazar esa representación booleana sin duplicar registros.
- Los permisos staff son booleanos en `User`, se resuelven por presets y se aplican tanto en UI como en `canStaffAccessRoute`. Las rutas desconocidas actualmente caen en `true`, por lo que Caja exige reglas explícitas de servidor, no sólo ocultar navegación.
- El realtime CRM usa SSE y eventos por `businessId`; los cambios de turnos tienen notificación PostgreSQL entre réplicas. No existe evento financiero y `/crm/events` exige hoy permiso de conversaciones.
- La única zona IANA persistida es `BusinessBotOptionsSettings.timezone`, opcional y conceptualmente del bot. Partes de Agenda usan zona del navegador o valores Argentina hardcodeados. Caja necesita un día comercial calculado siempre con una zona canónica del negocio.
- No existe `openspec/config.yaml` en el checkout. No impide persistir esta exploración, pero conviene ejecutar la inicialización OpenSpec antes de las fases siguientes para disponer de contexto y reglas de propuesta/spec consistentes.

### Affected Areas

- `prisma/schema.prisma` y `prisma/migrations/` — sesiones, cuenta financiera, ledger append-only, relaciones tenant-safe, permisos e índices.
- `src/routes/appointment.ts` — exponer la cuenta financiera junto al turno y autorizar pagos desde Agenda independientemente del acceso completo a Caja.
- `src/services/appointment-service.ts` — creación/edición de turnos y sustitución gradual de la seña manual legacy.
- `src/routes/crm.ts` y flujos F8 del bot — convertir una seña aprobada en un pago idempotente, con o sin sesión activa.
- `src/routes/public-booking.ts` — resolución de cuenta única para grupos web coordinados.
- `src/services/staff-permission-service.ts`, rutas de usuarios y `/auth/me` — permisos granulares, presets y autorización de servidor.
- `src/routes/crm-ui.ts` — nueva sección Caja; acordeón Pago del turno cerrado por defecto; formularios integrados para pagos, descuento, precio final, gastos, retiros, ingreso, ajuste, devolución y Nueva sesión.
- `src/services/crm-realtime-events.ts`, listener PostgreSQL y `/crm/events` — refresco multiusuario de Caja/Agenda sin depender del permiso de conversaciones.
- `scripts/*contract-test.ts` — contratos UI/autorización, pruebas de dominio, integración PostgreSQL y concurrencia.

### Approaches

1. **Movimientos directamente vinculados a turno/grupo** — guardar `appointmentId`, `coordinationGroupId` o `visitId` opcionales en cada movimiento y calcular la cuenta al consultar.
   - Pros: migración pequeña; implementación inicial rápida.
   - Cons: relación polimórfica frágil; reglas duplicadas para web, bot y manual; difícil garantizar una sola cuenta coordinada; depende de identificadores que hoy no son agregados tenant-safe.
   - Effort: Medium

2. **Cuenta financiera explícita + ledger append-only + sesiones** — crear una cuenta por reserva/cita, enlazar uno o varios turnos, y registrar entradas inmutables de pago/corrección/devolución/gasto/retiro/ingreso/ajuste.
   - Pros: un mismo registro sirve en Agenda y Caja; soporta pagos mixtos e historial; resuelve grupos coordinados; cálculos y autorización quedan centralizados; permite idempotencia de señas.
   - Cons: más modelos y una migración/backfill cuidadosa; obliga a definir invariantes de montos, fechas y correcciones.
   - Effort: High

3. **Libro mayor contable de doble partida** — modelar cuentas contables y asientos balanceados para toda operación.
   - Pros: máxima extensibilidad y conciliación contable futura.
   - Cons: complejidad desproporcionada para el MVP; UX y soporte más difíciles; introduce contabilidad formal que el alcance no requiere.
   - Effort: Very High

### Recommendation

Usar el enfoque 2 con límites de dominio claros:

- **AppointmentAccount**: agregado financiero del turno/reserva. Conserva importe base acordado, descuento e importe final. Una tabla de enlace permite asociar uno o varios `Appointment`; cada turno pertenece como máximo a una cuenta.
- **CashEntry** append-only y tenant-scoped: importe positivo, tipo, medio (`CASH`, `TRANSFER`, `CARD`), `effectiveAt` asignado por el servidor, origen y observación. Un pago mixto crea varias entradas. Corrección usa `reversesEntryId` único; no se edita ni borra el original. Los pagos enlazan la cuenta del turno; las devoluciones de v1 son movimientos generales de Caja, sin vínculo obligatorio a turno/pago y con descripción obligatoria. Gastos, retiros, ingresos y ajustes tampoco necesitan turno. `bookingDepositId` único vuelve idempotente la proyección de señas.
- **CashRegisterDay/Jornada**: agregado explícito desde Abrir caja hasta Cerrar caja, independiente de la medianoche y capaz de contener varias sesiones. Conserva efectivo inicial y final esperado/contado. La próxima jornada hereda el efectivo final de la anterior.
- **CashSession**: pertenece a una jornada y referencia un usuario/perfil activo del negocio como responsable, conservando además el nombre snapshot. Una restricción parcial garantiza una sola sesión abierta por negocio. “Nueva sesión” cierra la actual y abre otra en una transacción con bloqueo por `businessId`; mantiene jornada, totales y efectivo. La diferencia esperada/contada queda registrada pero no crea ajuste automático.
- **Saldo físico continuo**: el efectivo esperado se deriva del inicial de la jornada más entradas/salidas en efectivo. `CASH_IN` y `CASH_ADJUSTMENT` cambian efectivo, no Total cobrado. La medianoche no reinicia una jornada abierta ni sus totales.
- **Proyección de señas**: sólo `BookingDeposit.APPROVED` crea pago por transferencia en v1. Si hay sesión abierta se enlaza; si no, queda `cashSessionId = null`. Debe ocurrir atómicamente con la aprobación o mediante proyección idempotente durable; nunca desde la UI.
- **Agenda**: el acordeón cerrado muestra total/saldo/estado. Abierto consulta la misma cuenta y registra pagos mediante endpoints financieros dedicados. Crear turno sin pago sigue permitido sin sesión; intentar agregar un pago manual muestra un CTA integrado “Abrir caja” cuando tiene permiso, o informa que necesita una sesión activa cuando no lo tiene.
- **Permisos separados**: `canViewCashRegister`, `canRecordAppointmentPayments`, `canApplyDiscounts`, `canManageCashExpensesWithdrawals`, `canAdjustCash`, `canStartCashSession`. `BUSINESS_ADMIN` y `SUPER_ADMIN` los obtienen implícitamente; STAFF sólo con `true`. `ACCOUNT_ADMIN` no obtiene acceso automático en la decisión actual. No inferir permisos de Caja desde `canViewFinancialAmounts`.
- **Servicio de dominio**: centralizar invariantes, transacciones, tenant isolation, cálculo de saldo y consultas por jornada fuera de `crm-ui.ts` y de handlers extensos. Publicar eventos únicamente después del commit.

#### Invariantes sugeridas para especificar

- Importes enteros no negativos, misma moneda implícita del negocio en v1; saldo del turno = total final - pagos válidos. Las devoluciones generales de Caja no reabren ni recalculan el saldo del turno en v1.
- No permitir sobrepagos simples ni mixtos; todas las líneas del pago se validan juntas contra el saldo antes de escribir.
- Descuento nunca puede volver el total final menor que lo ya cobrado sin una devolución/corrección previa.
- Retiro sólo usa efectivo; gasto usa efectivo por defecto pero admite los tres medios; ingreso y ajuste afectan sólo efectivo físico.
- “Total cobrado” es bruto: suma pagos de turnos y señas aprobadas; las devoluciones se muestran separadas y no se netean silenciosamente. Mercado Pago se clasifica como transferencia en v1 y tarjeta queda para posnet directo.
- Los totales de Caja pertenecen a la jornada operativa seleccionada; fecha/hora de cada movimiento proviene del reloj del servidor y no es editable en v1.
- Entradas confirmadas son inmutables; toda rectificación es otra entrada vinculada.
- El precio fijo se congela en la cuenta y no es editable; un cambio comercial se expresa con descuento. En servicios estimativos el total base es obligatorio y editable. La UI acepta el descuento únicamente como monto nominal entero y no exige motivo en v1.
- Los pagos manuales requieren sesión activa. Una seña aprobada nunca se bloquea: se vincula a la sesión activa si existe y queda fuera de sesión si no existe.

#### Migración y backfill

1. Añadir modelos, claves compuestas/índices, permisos con default seguro `false` y zona canónica del negocio.
2. Crear cuentas para turnos existentes: agrupar web por `(businessId, coordinationGroupId)` y dejar turnos manuales separados; bot con `BookingVisit`/service items permanece una cuenta.
3. Proyectar depósitos ya `APPROVED` como transferencias usando `reviewedAt` y `bookingDepositId` único; quedan fuera de sesión.
4. No inventar medio ni fecha para `manualDepositPaid/manualDepositAmount`: migrarlos como “Pago anterior sin especificar”. Computan para pagado/saldo del turno, pero quedan fuera de sesión, jornada, totales diarios y desglose por medio.
5. Introducir escritura dual sólo si es imprescindible durante despliegue; luego dejar de escribir los campos legacy y retirarlos en una migración posterior.

#### MVP recomendado

- Jornada operativa con primera apertura, sesiones múltiples, Nueva sesión, Cerrar caja, responsable activo y control de efectivo.
- Cuenta financiera del turno, precio final estimativo, descuento, pagos simples/mixtos desde Agenda.
- Caja por jornada: Total cobrado bruto, efectivo, transferencias, tarjetas, devoluciones, gastos, retiros, efectivo inicial/esperado y movimientos recientes.
- Gastos, retiros, ingreso de efectivo, ajustes, devoluciones y contrapartidas.
- Proyección idempotente de señas aprobadas y cuenta única coordinada.
- Permisos de servidor/UI, aislamiento tenant, zona canónica y actualización multiusuario.
- Filtros: jornada, tipo, medio, búsqueda por cliente/descripción y carga incremental.

Fuera del MVP: facturación fiscal, comisiones, saldo a favor, cuotas, conciliación automática con bancos/posnet, categorías avanzadas, recibos, exportaciones y contabilidad de doble partida.

#### Decisiones cerradas y cuestiones menores para proposal/spec

Ya no quedan decisiones funcionales bloqueantes para la propuesta. Se cerró: acceso automático de `BUSINESS_ADMIN`/`SUPER_ADMIN`; responsable activo; reloj de servidor no editable; cobrado bruto; devolución general separada; diferencia sin ajuste automático; jornada apertura-cierre; precio fijo congelado/estimativo editable; descuento persistido como monto; legacy sin especificar; pagos sin sobrepago; filtros MVP y clasificación de Mercado Pago.

Cuestiones menores que pueden resolverse razonablemente en proposal/spec sin frenar la fase:

- Nombre definitivo de modelos y endpoints (`CashRegisterDay` vs `CashRegisterPeriod`, etc.).
- Si Cerrar caja exige también conteo físico o reutiliza el mismo control de Nueva sesión.
- Presentación de devoluciones por medio en el resumen, manteniendo siempre el total separado.
- Permitir o no seleccionar consecutivamente al mismo responsable activo.
- Moneda implícita por negocio en v1.
- Cantidad de movimientos por página/lote y orden secundario estable.
- Política visual del pago legacy “sin especificar” y herramientas futuras de conciliación.

#### Testing recomendado (Strict TDD)

- Pruebas puras de totales por jornada, saldo, signos, descuento nominal, reversas, devoluciones generales, no sobrepago y grupos coordinados.
- Contratos PostgreSQL para una sola sesión/jornada abierta, Nueva sesión atómica, Cerrar caja, arrastre de efectivo, idempotencia de depósito, append-only, tenant isolation y concurrencia de pagos/ajustes.
- Contratos de autorización por cada permiso y prueba negativa de rutas Caja para STAFF sin permiso.
- Contratos UI del acordeón cerrado, estados sin sesión, formularios integrados y ausencia de `alert/confirm/prompt`.
- Integración de aprobación WEB y F8 BOT para demostrar que un comprobante pendiente no cobra y una aprobación cobra exactamente una vez.
- Realtime after-commit y aislamiento por `businessId`; regresión de Agenda y señas actuales.

### Risks

- **Datos legacy ambiguos**: asumir efectivo o una fecha para señas manuales falsearía los totales.
- **Duplicación de señas**: existen dos caminos de aprobación (WEB legacy y F8/Bot); ambos requieren la misma clave idempotente.
- **Jornada y reportes históricos**: aunque la jornada sea independiente de medianoche, filtros futuros por fecha calendario seguirán necesitando zona canónica del negocio.
- **Autorización**: el fallback permisivo de rutas staff puede exponer Caja si no se agregan reglas explícitas y pruebas negativas.
- **Carreras**: dos pagos o dos “Nueva sesión” simultáneos pueden producir sobrepago o sesiones dobles sin locks/restricciones.
- **Cuenta coordinada**: `coordinationGroupId` no es hoy una entidad ni una clave tenant-scoped; no debe usarse solo como FK financiera.
- **Totales mutables**: recalcular precios desde el catálogo actual alteraría historia; la cuenta debe congelar el monto acordado.
- **Realtime por réplicas**: publicar sólo en memoria tras un commit no alcanza para instancias múltiples; evaluar NOTIFY/trigger como en Agenda.

### Ready for Proposal

Sí. Las decisiones bloqueantes están resueltas y el alcance de MVP es suficiente para redactar propuesta y especificaciones. La ausencia de `openspec/config.yaml` no invalida este artefacto ni es una decisión funcional, pero el protocolo asigna su creación a `sdd-init`, mientras que `sdd-explore` sólo puede crear/actualizar `exploration.md`; por eso no se inicializó desde esta fase. El orquestador debería ejecutar `sdd-init` en modo OpenSpec antes de `sdd-propose` para restaurar la estructura contractual completa.

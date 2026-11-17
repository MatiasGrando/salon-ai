# Tiempo de respuesta al mover y cobrar turnos

Alcance autorizado: mejorar la respuesta visible y el costo de guardar movimientos y cobros de Agenda. Caja actual, incidencias de reservas de Instagram y despliegue quedan fuera de este trabajo.

Base `4632398`, rama `codex/instagram-pantalla-principal`. TDD habilitado por `openspec/config.yaml` (`strict_tdd: true`), runner `node --import tsx` y scripts relevantes de `package.json`. Validar `npm run test:text-encoding` antes de cada commit. Mirror Engram `odd/crm-appointment-action-latency/tasks` pendiente, sin herramienta Engram disponible.

Estrategia de entrega `ask-on-risk`, con la decisión previa `feature-branch-chain` de esta misma optimización de Agenda (`odd/tasks/crm-priority-loading.md`). Previsión inicial ~390 líneas, revisada a ~600 con las regresiones de respuestas tardías y medición. Cortes locales por unidad de trabajo, sin PR solicitado. RDD efectivo `on` según configuración global.

- [x] A1. Mostrar al instante la posición tentativa al mover un turno, confirmar con la respuesta del servidor o restaurar la posición anterior. Conservar permisos y flujo de conflicto, sin recargar el rango activo. Ruta delegada por preparación y cambios en CRM y pruebas de arrastre y de rangos.
- [ ] A2. Aplicar el pago confirmado directo desde el POST y eliminar consultas bloqueantes y la recarga completa de Agenda. Mantener validación, protección del doble submit y actualización del detalle. Ruta delegada por preparación y cambios en CRM Caja y prueba de cobro.
- [x] A3. Identificar el costo de servidor, instrumentar fases y eliminar trabajo redundante si es seguro según los contratos existentes. Validar rutas y pruebas de guardado sin datos reales. Ruta delegada por mapeo de rutas, servicios y pruebas.

A1 RED: el turno quedaba en el horario anterior al demorar el PATCH, un rango tardío podía revertir el resultado y un error 503 no verificaba el horario. GREEN: contratos de bloqueo/arrastre, rangos y navegación, alcance de Agenda, tiempo real y sintaxis CRM. El tramo de navegador se omitió por Playwright ausente en el repositorio de trabajo. Verificación de duraciones reales pendiente.

A1 commit `d7acbcc`, 181 líneas en el rango local. RDD medio, `under_budget`, frontera pendiente `4632398`.

A3 RED: cuatro lecturas de disponibilidad previas, respuesta sin Server-Timing y política de superposición no equivalente. GREEN: contrato de arrastre profesional, rutas incrementales y transacción de cobro con finalización. La edición conserva las superposiciones con turnos realizados y reservas retenidas, y valida dentro de la transacción. El cobro conserva sus bloqueos y devuelve la fecha de los movimientos ya registrada. Server-Timing permite separar comienzo de transacción, validación, escritura y, para cobro, bloqueo de caja. El contrato de concurrencia de creación falla también en la base `4632398`. SQL con PostgreSQL real y milisegundos de producción pendientes.

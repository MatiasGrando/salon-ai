# Tiempo de respuesta al mover y cobrar turnos

Alcance autorizado: mejorar la respuesta visible y el costo de guardar movimientos y cobros de Agenda. Caja actual, incidencias de reservas de Instagram y despliegue quedan fuera de este trabajo.

Base `4632398`, rama `codex/instagram-pantalla-principal`. TDD habilitado por `openspec/config.yaml` (`strict_tdd: true`), runner `node --import tsx` y scripts relevantes de `package.json`. Validar `npm run test:text-encoding` antes de cada commit. Mirror Engram `odd/crm-appointment-action-latency/tasks` pendiente, sin herramienta Engram disponible.

Estrategia de entrega `ask-on-risk`, con la decisión previa `feature-branch-chain` de esta misma optimización de Agenda (`odd/tasks/crm-priority-loading.md`). Previsión inicial ~390 líneas, revisada a ~600 con las regresiones de respuestas tardías y medición. Cortes locales por unidad de trabajo, sin PR solicitado. RDD efectivo `on` según configuración global.

- [x] A1. Mostrar al instante la posición tentativa al mover un turno, confirmar con la respuesta del servidor o restaurar la posición anterior. Conservar permisos y flujo de conflicto, sin recargar el rango activo. Ruta delegada por preparación y cambios en CRM y pruebas de arrastre y de rangos.
- [x] A2. Aplicar el pago confirmado directo desde el POST y eliminar consultas bloqueantes y la recarga completa de Agenda. Mantener validación, protección del doble submit y actualización del detalle. Ruta delegada por preparación y cambios en CRM Caja y prueba de cobro.
- [x] A3. Identificar el costo de servidor, instrumentar fases y eliminar trabajo redundante si es seguro según los contratos existentes. Validar rutas y pruebas de guardado sin datos reales. Ruta delegada por mapeo de rutas, servicios y pruebas.

A1 RED: el turno quedaba en el horario anterior al demorar el PATCH, un rango tardío podía revertir el resultado y un error 503 no verificaba el horario. GREEN: contratos de bloqueo/arrastre, rangos y navegación, alcance de Agenda, tiempo real y sintaxis CRM. El tramo de navegador se omitió por Playwright ausente en el repositorio de trabajo. Verificación de duraciones reales pendiente.

A1 commit `d7acbcc`, 181 líneas en el rango local. RDD medio, `under_budget`, frontera pendiente `4632398`.

A3 RED: cuatro lecturas de disponibilidad previas, respuesta sin Server-Timing y política de superposición no equivalente. GREEN: contrato de arrastre profesional, rutas incrementales y transacción de cobro con finalización. La edición conserva las superposiciones con turnos realizados y reservas retenidas, y valida dentro de la transacción. El cobro conserva sus bloqueos y devuelve la fecha de los movimientos ya registrada. Server-Timing permite separar comienzo de transacción, validación, escritura y, para cobro, bloqueo de caja. El contrato de concurrencia de creación falla también en la base `4632398`. SQL con PostgreSQL real y milisegundos de producción pendientes.

A3 commit `4d235c2`, rango de entrega de 393 líneas desde `4632398`. RDD medio, `under_budget`.

A2 RED: botón bloqueado aun después de POST confirmado. GREEN: contrato de medios de pago, doble clic, actualizaciones demoradas, aislamiento de consultas anteriores, resultado ambiguo y al fallar la proyección visual, más sintaxis, alcance de Caja y resumen financiero. Cero lecturas posteriores en el flujo directo con detalle precargado, o un GET de finanzas silencioso si falta el detalle. Si un evento llega antes de la respuesta podría activar el refresco existente; los eventos propios confirmados se deduplican por ID. La aserción de caja en tiempo real sobre la antigua navegación ya falla en la base `4632398`. La prueba de pago con PostgreSQL real queda pendiente.

A2 commit `8e526f4`. Rango local `4632398..8e526f4`: 14 archivos y 664 líneas según el evaluador. RDD medio, `slice_budget_reached`. STATUS exacto y STATUS con temporales excluidos ejecutados; `review.start` con relay devolvió solicitud de consentimiento. Decisión pendiente para ese candidato; sin revisor iniciado.

Verificación adicional: el SQL se ejecutó en PGlite con casos de turno realizado, reserva retenida vencida, seña vencida y exclusión del turno editado. El contrato general `test:cash-payments-pg` se detuvo en una aserción previa sobre F8 (dos proyectores detectados, uno esperado; los dos archivos de la comprobación son idénticos a la base). Sin ensayo en producción ni medición real de tiempos. El cambio está en la rama local de trabajo. Próximo paso: resolver la solicitud de revisión y medir en el entorno servido al validar con un turno de prueba.

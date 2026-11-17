# Tiempo de respuesta al mover y cobrar turnos

Alcance autorizado: mejorar la respuesta visible y el costo de guardar movimientos y cobros de Agenda. Caja actual, incidencias de reservas de Instagram y despliegue quedan fuera de este trabajo.

Base `4632398`, rama `codex/instagram-pantalla-principal`. TDD habilitado por `openspec/config.yaml` (`strict_tdd: true`), runner `node --import tsx` y scripts relevantes de `package.json`. Validar `npm run test:text-encoding` antes de cada commit. Mirror Engram `odd/crm-appointment-action-latency/tasks` pendiente, sin herramienta Engram disponible.

Estrategia de entrega `ask-on-risk`, con la decisión previa `feature-branch-chain` de esta misma optimización de Agenda (`odd/tasks/crm-priority-loading.md`). Previsión inicial ~390 líneas, revisada a ~600 con las regresiones de respuestas tardías y medición. Cortes locales por unidad de trabajo, sin PR solicitado. RDD efectivo `on` según configuración global.

- [x] A1. Mostrar al instante la posición tentativa al mover un turno, confirmar con la respuesta del servidor o restaurar la posición anterior. Conservar permisos y flujo de conflicto, sin recargar el rango activo. Ruta delegada por preparación y cambios en CRM y pruebas de arrastre y de rangos.
- [ ] A2. Aplicar el pago confirmado directo desde el POST y eliminar consultas bloqueantes y la recarga completa de Agenda. Mantener validación, protección del doble submit y actualización del detalle. Ruta delegada por preparación y cambios en CRM Caja y prueba de cobro.
- [ ] A3. Identificar el costo de servidor, instrumentar fases y eliminar trabajo redundante si es seguro según los contratos existentes. Validar rutas y pruebas de guardado sin datos reales. Ruta delegada por mapeo de rutas, servicios y pruebas.

A1 RED: el turno quedaba en el horario anterior al demorar el PATCH, un rango tardío podía revertir el resultado y un error 503 no verificaba el horario. GREEN: contratos de bloqueo/arrastre, rangos y navegación, alcance de Agenda, tiempo real y sintaxis CRM. El tramo de navegador se omitió por Playwright ausente en el repositorio de trabajo. Verificación de duraciones reales pendiente.
